"""
好坏提炼：把检索到的真实评价片段 → 结构化「优点 / 值得警惕」。

两条路径：
  - Claude（设了 ANTHROPIC_API_KEY 时）：质量高，能归纳、去重、判断语气。
  - 规则兜底（无 key 时）：基于「避雷/吃灰/智商税…」等词典做正负分桶，保证离线也能跑。
这一层是「效果要好」的关键，且它本身稳定（自家模型，不受反爬影响）。
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import List, Optional, Tuple

from ...integrations import llm

LOGGER = logging.getLogger("insight.extractor")

_EXTRACT_SYSTEM = (
    "你是理性消费助手「冷静购」的分析模块。基于给定的真实评价片段，"
    "提炼某商品的「优点」和「值得警惕的点」。要求：中立、简洁，每条不超过20字；"
    "只依据片段，不编造；最后给一句温和的总结（不替用户下购买结论）。"
    '只输出 JSON：{"pros":[...],"cons":[...],"verdict":"..."}'
)

# 默认模型见 CLAUDE.md：高频分析用 sonnet
CLAUDE_MODEL = os.environ.get("LJG_CLAUDE_MODEL", "claude-sonnet-4-6")

# 具体抱怨/夸赞词：用于在子句级别定位真正的「好坏」，而不是整条标题
CON_KEYS = ["避雷", "缺点", "后悔", "吃灰", "闲置", "智商税", "翻车", "鸡肋", "差评",
            "踩坑", "不值", "难用", "噪音", "危害", "禁忌", "缺陷", "别买", "不推荐",
            "清洗", "难洗", "虚标", "异味", "占地", "麻烦", "低价", "赠品", "鸡肋"]
PRO_KEYS = ["好用", "值得", "推荐", "真香", "必买", "神器", "惊艳", "优点", "实用",
            "方便", "喜欢", "性价比", "耐用", "建议买", "回购", "省", "划算"]

_CLAUSE = re.compile(r"[，。、；：？！~,.;!?\n（）()【】]+")
_STRIP_PREFIX = re.compile(r"^(测评师?|很多人|不少人|大家|有人|据说|提醒|注意|存在|觉得|认为)+")
# 标题/清单式套话：含这些的子句是「文章标题」而非真实评价，丢弃
_META = ["优缺点", "攻略", "榜单", "大全", "排行", "十大", "盘点", "推荐20", "测评师", "合集", "种草"]


def _clauses(text: str) -> List[str]:
    out = []
    for c in _CLAUSE.split(text):
        c = _STRIP_PREFIX.sub("", c.strip())
        if 3 <= len(c) <= 18 and not any(m in c for m in _META):
            out.append(c)
    return out


# ---------------- 规则兜底 ----------------
def _rule_based(product: str, texts: List[str], cap: int = 6) -> Tuple[List[str], List[str], str]:
    pros, cons = [], []
    seen_p, seen_c = set(), set()
    for t in texts:
        for clause in _clauses(re.sub(r"\s+", " ", t)):
            hit_c = any(k in clause for k in CON_KEYS)
            hit_p = any(k in clause for k in PRO_KEYS)
            if hit_c and not hit_p:
                key = clause[:8]
                if key not in seen_c:
                    seen_c.add(key)
                    cons.append(clause)
            elif hit_p and not hit_c:
                key = clause[:8]
                if key not in seen_p:
                    seen_p.add(key)
                    pros.append(clause)
    pros, cons = pros[:cap], cons[:cap]
    if cons and not pros:
        verdict = f"{product}：多数声音偏向提醒避雷，购买前建议先想清楚使用频率。"
    elif pros and not cons:
        verdict = f"{product}：口碑整体偏正面，但仍可冷静确认是否真的需要。"
    elif pros or cons:
        verdict = f"{product}：好坏评价都有，值得花点时间权衡再决定。"
    else:
        verdict = f"{product}：暂无足够真实评价，建议你粘贴几条看到的评论再分析。"
    return pros, cons, verdict


# ---------------- Claude 路径 ----------------
def _claude(product: str, texts: List[str]) -> Tuple[List[str], List[str], str]:
    import anthropic  # 延迟导入，未装/无 key 时走兜底

    client = anthropic.Anthropic()  # 读 ANTHROPIC_API_KEY
    joined = "\n".join(f"- {t}" for t in texts[:40] if t.strip())
    system = (
        "你是理性消费助手「冷静购」的分析模块。基于给定的真实评价片段，"
        "提炼某商品的「优点」和「值得警惕的点」。要求：中立、简洁，每条不超过20字；"
        "只依据片段，不编造；最后给一句温和的总结（不替用户下购买结论）。"
        '只输出 JSON：{"pros":[...],"cons":[...],"verdict":"..."}'
    )
    user = f"商品：{product}\n真实评价片段：\n{joined or '（暂无检索片段，请仅基于品类常识给出常见优点/警惕点，并在 verdict 注明为常识推断）'}"
    msg = client.messages.create(
        model=CLAUDE_MODEL, max_tokens=800, system=system,
        messages=[{"role": "user", "content": user}],
    )
    raw = "".join(b.text for b in msg.content if getattr(b, "type", "") == "text")
    m = re.search(r"\{.*\}", raw, re.S)
    data = json.loads(m.group(0) if m else raw)
    return (
        [str(x) for x in data.get("pros", [])][:8],
        [str(x) for x in data.get("cons", [])][:8],
        str(data.get("verdict", "")),
    )


def _llm_extract(product: str, texts: List[str]) -> Optional[Tuple[List[str], List[str], str]]:
    """统一 LLM（DeepSeek 等）提炼好坏。失败返回 None。"""
    joined = "\n".join(f"- {t}" for t in texts[:40] if t.strip())
    user = (
        f"商品：{product}\n真实评价片段：\n"
        f"{joined or '（暂无检索片段，请仅基于品类常识给出常见优点/警惕点，并在 verdict 注明为常识推断）'}"
    )
    data = llm.chat_json(user, system=_EXTRACT_SYSTEM, max_tokens=800, temperature=0.3)
    if not isinstance(data, dict):
        return None
    return (
        [str(x) for x in data.get("pros", [])][:8],
        [str(x) for x in data.get("cons", [])][:8],
        str(data.get("verdict", "")),
    )


def extract_pros_cons(product: str, texts: List[str]) -> Tuple[List[str], List[str], str, str]:
    """返回 (pros, cons, verdict, method)。优先统一 LLM(DeepSeek)，再 Claude，最后规则兜底。"""
    if llm.available():
        out = _llm_extract(product, texts)
        if out:
            return (*out, "llm")
    if os.environ.get("ANTHROPIC_API_KEY"):
        try:
            pros, cons, verdict = _claude(product, texts)
            return pros, cons, verdict, "claude"
        except Exception as exc:
            LOGGER.warning("Claude extract failed (%s); falling back to rules.", exc)
    pros, cons, verdict = _rule_based(product, texts)
    return pros, cons, verdict, "rule-based"
