"""
六个固定维度的 SPEC：默认交互、score_key、固定选项分、兜底模板、作答打分。

评分约定：**正分=更像理性需要(偏 buy)，负分=更像冲动(偏 let_go)**。
分数固定在这里（SPEC），AI 只定制 question/label 措辞，不改分 —— 保证打分透明。
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional

from .schema import Option, Question

# ---- 各维度固定选项槽（value 决定分数；label 是默认措辞，AI 可改）----
SLOTS: Dict[str, List[Dict[str, Any]]] = {
    "crest": [  # 浪头 bubble_multi
        {"value": "need", "label": "刚需该换了", "score": 1},
        {"value": "cheap", "label": "限时/低价划算", "score": -1},
        {"value": "looks", "label": "外观好看", "score": -1},
        {"value": "recommend", "label": "别人种草", "score": -1},
        {"value": "fomo", "label": "怕涨价/限量", "score": -1},
        {"value": "reward", "label": "想犒劳自己", "score": -1},
    ],
    "reef": [  # 暗礁 two_choice
        {"value": "accept", "label": "能接受", "score": 1},
        {"value": "reject", "label": "接受不了", "score": -2},
    ],
    "shore": [  # 回岸 bubble_single
        {"value": "need", "label": "真的会不方便", "score": 1},
        {"value": "meh", "label": "也就那样", "score": -1},
        {"value": "wait", "label": "能等到更合适的", "score": -2},
    ],
    "money": [  # 钱位 two_choice
        {"value": "buy", "label": "就它了", "score": 1},
        {"value": "wait", "label": "再压压等等", "score": -1},
    ],
}

_SLIDER_DEPTH = {
    "min": 0, "max": 30, "step": 1, "min_label": "几乎不用", "max_label": "几乎每天",
    "score_rule": "0-3次→-2; 4-10→0; 11+→+2",
}
_INPUT_LANDING = {"placeholder": "通勤 / 运动 / 打电话…", "score_rule": "答出具体场景→+2; 模糊或空→-1"}

# 维度元数据（有序）。conditional=True 的维度仅满足条件时纳入。
# intent：每维 question 必须问的内容，约束 LLM 不许跑题（尤其 slider/sentence 语义固定）。
SPECS: List[Dict[str, Any]] = [
    {"id": "crest", "dimension": "浪头", "score_key": "impulse_source", "interaction": "bubble_multi", "conditional": False,
     "intent": "问 TA 这次想买的主要驱动力，对应给定选项（刚需/低价/颜值/种草/怕涨/犒劳自己）"},
    {"id": "landing", "dimension": "落点", "score_key": "scenario_clarity", "interaction": "sentence_complete", "conditional": False,
     "intent": "让 TA 补全『会在什么具体场景/用途下用它』，必须是让用户填空说出使用场景"},
    {"id": "depth", "dimension": "水深", "score_key": "usage_frequency", "interaction": "slider", "conditional": False,
     "intent": "问 TA 估计【多久用一次/使用频率】，必须对应滑块『几乎不用↔几乎每天』，不要问别的"},
    {"id": "reef", "dimension": "暗礁", "score_key": "con_tolerance", "interaction": "two_choice", "conditional": False,
     "intent": "拿 cons 里最显著的缺点，问 TA『能不能接受』"},
    {"id": "shore", "dimension": "回岸", "score_key": "urgency_resilience", "interaction": "bubble_single", "conditional": False,
     "intent": "问 TA『如果现在不买会怎样』，拆掉紧迫感"},
    {"id": "money", "dimension": "钱位", "score_key": "price_acceptance", "interaction": "two_choice", "conditional": True,
     "intent": "结合价格判断，问 TA『现在就买还是再压压等等』"},
]
SPEC_BY_ID = {s["id"]: s for s in SPECS}


def _opts(slot_id: str) -> List[Option]:
    return [Option(label=o["label"], value=o["value"], score=o["score"]) for o in SLOTS[slot_id]]


def top_con(ctx: Dict[str, Any]) -> Optional[str]:
    cons = ctx.get("cons") or []
    return cons[0] if cons else None


# ---------------- 兜底模板（无 LLM / 单题不合格时用）----------------
def fallback(spec_id: str, ctx: Dict[str, Any]) -> Question:
    s = SPEC_BY_ID[spec_id]
    base = dict(id=spec_id, dimension=s["dimension"], score_key=s["score_key"],
                interaction_type=s["interaction"], persona="豚豚想问问")

    if spec_id == "crest":
        return Question(**base, question="你这次想买，更像哪种？（可多选）",
                        question_reason="想看看你这次是刚需，还是被营销推着走。",
                        options=_opts("crest"))
    if spec_id == "landing":
        return Question(**base, question="我打算主要在 ___ 用它",
                        question_reason="能说出具体场景，往往说明真的用得上。",
                        input=dict(_INPUT_LANDING))
    if spec_id == "depth":
        prior = ctx.get("usage_pattern_prior") or "容易买了闲置"
        return Question(**base, question="估一下，它一个月大概会用几次？",
                        question_reason=f"这类东西{prior}，先估下真实频率。",
                        slider=dict(_SLIDER_DEPTH))
    if spec_id == "reef":
        con = top_con(ctx) or "有一些缺点"
        return Question(**base, question=f"不少人说它「{con}」，你能接受吗？",
                        question_reason=f"它的差评集中在「{con}」，先确认你能不能接受。",
                        options=_opts("reef"), evidence={"kind": "review_con", "text": con})
    if spec_id == "shore":
        return Question(**base, question="如果现在不买，你觉得会怎样？",
                        question_reason="想帮你拆掉『现在不买就亏了』的紧迫感。",
                        options=_opts("shore"))
    if spec_id == "money":
        v, t = ctx.get("price_verdict") or "这个价", ctx.get("price_trend") or ""
        return Question(**base, question=f"这价{('「'+v+('·'+t if t else '')+'」') }，你还想现在就买吗？",
                        question_reason="它的价位和趋势值得先想想要不要现在买。",
                        options=_opts("money"),
                        evidence={"kind": "price", "text": f"{v} {t} {ctx.get('price_assessment') or ''}".strip()})
    raise ValueError(spec_id)


# ---------------- 作答打分（demo 模拟 / 未来真实作答共用）----------------
def score_answer(spec_id: str, value: Any) -> int:
    """根据维度与作答值算分（分数口径固定在 SPEC）。"""
    s = SPEC_BY_ID[spec_id]
    itype = s["interaction"]

    if itype == "bubble_multi":  # 浪头：多选求和后 clamp[-2,1]
        by_val = {o["value"]: o["score"] for o in SLOTS[spec_id]}
        vals = value if isinstance(value, list) else [value]
        total = sum(by_val.get(v, 0) for v in vals if isinstance(v, str))
        return max(-2, min(1, total))
    if itype in {"two_choice", "bubble_single"}:
        by_val = {o["value"]: o["score"] for o in SLOTS[spec_id]}
        return by_val.get(value if isinstance(value, str) else "", 0)
    if itype == "slider":  # 水深
        n = int(value or 0)
        return -2 if n <= 3 else (0 if n <= 10 else 2)
    if itype == "sentence_complete":  # 落点：具体场景+2，模糊/空-1
        text = (value or "").strip()
        vague = {"", "不知道", "随便", "看情况", "不一定", "都行"}
        return 2 if (len(text) >= 2 and text not in vague) else -1
    return 0
