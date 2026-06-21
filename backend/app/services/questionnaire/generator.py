"""
问卷生成：各维度【并发】各调一次 LLM（每维一题）→ 逐题校验 → 不合格回退该维度模板。
维度/score_key/选项分由 SPEC 固定，LLM 只定制 question/reason/evidence/label 措辞。

为什么按维度拆开并发：单次大调用要一口气吐出 5~6 题的大 JSON（实测 ~16s 瓶颈）；
拆成每维一小调用并发跑（DashScope 同域、实测 6 并发 1.7s 全成功），约 16s→2s。
代价：system 提示重复几遍（token 略增，可忽略）；跨题连贯性略降（各维主题本就不同，风险低）；
个别维度被限流/失败 → 该维度回退模板（仍合法），不影响整卷。
"""
from __future__ import annotations

import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from ...integrations import llm
from .dimensions import SLOTS, SPECS, SPEC_BY_ID, fallback, top_con
from .schema import Option, Question, Questionnaire, validate_question

LOGGER = logging.getLogger("questionnaire.generator")

_SYSTEM_ONE = (
    "你是「冷静购」里的小助手豚豚，在用户冲动下单前，用一句话的小问题陪 TA 冷静一下。"
    "风格：陪伴、温和、口语、不说教、不制造愧疚，一句话。\n"
    "【硬约束】维度、score_key、交互类型、选项的『打分』都由系统固定，你不能改；你只为【给定的这一个维度】产出：\n"
    "1) question：紧扣给定 intent，贴这件商品（引用真实风评/价格），一句话，**不许跑题**；\n"
    "2) question_reason：一句话说为什么问这个（点出依据）；\n"
    "3) evidence：引用哪条风评/价格（可空）；\n"
    "4) 可微调选项 label 措辞，但**保持其含义与顺序**。\n"
    "slider 题必须问『使用频率/多久用一次』；暗礁题从给的 cons 里挑【最显著/重复出现】的那条来问。\n"
    '只输出 JSON：{"question":"…","question_reason":"…","evidence":{"kind":"…","text":"…","source":"…"},'
    '"options":[{"value":"need","label":"…"}]}。options 只给 value+label（不要 score）；slider/sentence 题不用 options。'
)

_SYSTEM_INTRO = (
    "你是「冷静购」的小助手豚豚。为用户即将冷静思考的这件商品写一句温和、口语、不说教的引导语，"
    "像朋友拉 TA 先别急着下单、陪 TA 在河里漂一会儿。只输出一句话，不要引号、不要解释。"
)


def _active_specs(pricing) -> List[Dict[str, Any]]:
    return [s for s in SPECS if not s["conditional"] or (s["id"] == "money" and pricing is not None)]


def _gen_one(spec: Dict[str, Any], ctx: Dict[str, Any]) -> Tuple[str, Optional[Dict]]:
    """为单个维度生成一题（LLM）。失败返回 (id, None)，由调用方回退模板。"""
    brief = {"dimension": spec["dimension"], "interaction": spec["interaction"], "intent": spec["intent"],
             "options": [{"value": o["value"], "label": o["label"]} for o in SLOTS.get(spec["id"], [])]}
    data = llm.chat_json(
        f"商品上下文：{ctx}\n本题维度（只出这一题）：{brief}",
        system=_SYSTEM_ONE, max_tokens=320, temperature=0.3,
    )
    return spec["id"], (data if isinstance(data, dict) else None)


def _gen_intro(name: str, ctx: Dict[str, Any]) -> Optional[str]:
    txt = llm.chat(
        f"商品：{name}；卖点：{ctx.get('pros')}；可能的坑：{ctx.get('cons')}。",
        system=_SYSTEM_INTRO, max_tokens=80, temperature=0.4,
    )
    if not txt:
        return None
    return txt.strip().strip("「」\"'。 ").splitlines()[0][:60] or None


def _build_ctx(product: Dict[str, Any], insight, pricing) -> Dict[str, Any]:
    u = product.get("understanding") or {}
    price = (product.get("price") or {}).get("current_price")
    ctx = {
        "name": product.get("product_name"),
        "category": product.get("product_category"),
        "durability": u.get("durability"),
        "usage_pattern_prior": u.get("usage_pattern_prior"),
        "is_bundle_or_set": u.get("is_bundle_or_set"),
        "price": price,
        "promotion_stimuli": product.get("promotion_stimuli") or [],
        "pros": (getattr(insight, "pros", []) or [])[:2],
        "cons": (getattr(insight, "cons", []) or [])[:3],
    }
    if pricing is not None:
        ctx["price_verdict"] = pricing.verdict
        ctx["price_trend"] = pricing.trend
        ctx["price_assessment"] = pricing.assessment
    return ctx


def _options_from_llm(spec_id: str, llm_options: Optional[List[Dict]]) -> List[Option]:
    """以 SPEC 固定分为准；label 用 LLM 给的（按 value 匹配），否则用默认。"""
    label_by_val = {}
    for o in (llm_options or []):
        if isinstance(o, dict) and o.get("value"):
            label_by_val[o["value"]] = o.get("label")
    return [
        Option(label=label_by_val.get(slot["value"]) or slot["label"], value=slot["value"], score=slot["score"])
        for slot in SLOTS[spec_id]
    ]


def _build_question(spec: Dict[str, Any], llm_q: Optional[Dict], ctx: Dict[str, Any]) -> Question:
    """用 LLM 的措辞 + SPEC 的结构/分数拼一题；失败由调用方回退模板。"""
    if not llm_q:
        return fallback(spec["id"], ctx)
    sid, itype = spec["id"], spec["interaction"]
    q = Question(
        id=sid, dimension=spec["dimension"], score_key=spec["score_key"], interaction_type=itype,
        question=str(llm_q.get("question") or "").strip(),
        question_reason=str(llm_q.get("question_reason") or "").strip(),
        persona="豚豚想问问",
        evidence=llm_q.get("evidence") if isinstance(llm_q.get("evidence"), dict) else None,
    )
    if itype in {"bubble_multi", "bubble_single", "two_choice"}:
        q.options = _options_from_llm(sid, llm_q.get("options"))
    elif itype == "slider":
        q.slider = fallback(sid, ctx).slider
    elif itype == "sentence_complete":
        q.input = fallback(sid, ctx).input
    # 暗礁/钱位 evidence 兜底
    if q.evidence is None and sid == "reef" and top_con(ctx):
        q.evidence = {"kind": "review_con", "text": top_con(ctx)}
    return q


def generate_questionnaire(product: Dict[str, Any], insight, pricing=None, profile=None) -> Questionnaire:
    ctx = _build_ctx(product, insight, pricing)
    active = _active_specs(pricing)
    name = ctx.get("name") or "这件商品"

    llm_map: Dict[str, Dict] = {}
    intro = None
    if llm.available():
        # 各维度 + 引导语并发各调一次（同域 DashScope，实测 ~16s→~2s）。
        with ThreadPoolExecutor(max_workers=len(active) + 1) as ex:
            fut_intro = ex.submit(_gen_intro, name, ctx)
            futs = [ex.submit(_gen_one, s, ctx) for s in active]
            for f in futs:
                sid, data = f.result()
                if data:
                    llm_map[sid] = data
            intro = fut_intro.result()

    questions: List[Question] = []
    for spec in active:
        q = _build_question(spec, llm_map.get(spec["id"]), ctx)
        errs = validate_question(q)
        if errs:
            LOGGER.info("维度 %s 回退模板：%s", spec["id"], errs)
            q = fallback(spec["id"], ctx)
        questions.append(q)

    return Questionnaire(
        product_name=name,
        intro=intro or f"豚豚发现你在看「{name}」～先陪你漂一会儿，回几个小问题（约 90 秒）。",
        questions=questions,
        meta={
            "dimensions_used": [s["dimension"] for s in active],
            "has_price_dim": pricing is not None,
            "evidence_summary": getattr(insight, "sources_summary", ""),
        },
    )
