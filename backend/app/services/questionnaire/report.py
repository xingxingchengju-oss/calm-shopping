"""
作答分析 → 报告：soft-score 算倾向(lean) + 置信度(confidence) + LLM 三段措辞（带红线）+ 模板兜底。
倾向由我们算（确定性），LLM 只负责贴合 lean 的温和措辞。
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List

from ...integrations import llm
from .schema import Answer, Report

LOGGER = logging.getLogger("questionnaire.report")

_LEAN_LABEL = {"buy": "买下它", "keep_floating": "继续漂着", "let_go": "放手啦"}

_SYSTEM = (
    "你是「冷静购」的报告模块豚豚。根据风评、价格和用户回答，生成一段温和的冷静报告。"
    "红线：不替用户下结论、不制造愧疚、**不制造确定性**——只说『从你的回答看更偏向…』，"
    "不要说『你一定适合/不适合』。语气陪伴、正向。"
    "系统已算好倾向(lean)，你的措辞要与它一致但不强迫（三个动作用户都能选）。"
    '只输出 JSON：{"review_digest":"风评里看到什么(好+坏+价,1-2句)",'
    '"your_signals":"你的回答暴露了什么信号(结合答案,1-2句)",'
    '"suggestion_text":"一句温和建议，呼应 lean 但不下绝对结论"}'
)


def _lean(total: int) -> str:
    if total <= -3:
        return "let_go"
    if total >= 3:
        return "buy"
    return "keep_floating"


def _confidence(product: Dict[str, Any], insight) -> str:
    rec = product.get("recognition") or {}
    method = getattr(insight, "method", "")
    if rec.get("needs_user_confirmation") or method == "rule-based":
        return "low"
    has_cat = bool(product.get("product_category"))
    strong = method in {"llm", "claude"} and len(getattr(insight, "cons", []) or []) >= 2
    return "high" if (has_cat and strong) else "medium"


def generate_report(product: Dict[str, Any], insight, pricing, answers: List[Answer]) -> Report:
    total = sum(a.score for a in answers)
    lean = _lean(total)
    confidence = _confidence(product, insight)
    score_summary = {a.score_key: a.score for a in answers}
    name = product.get("product_name") or "这件商品"

    digest = signals = suggestion = None
    if llm.available():
        price_line = ""
        if pricing is not None:
            price_line = f"价格：{pricing.verdict}·{pricing.trend}，{pricing.assessment}\n"
        user = (
            f"商品：{name}\n风评好处：{getattr(insight,'pros',[])}\n风评坏处：{getattr(insight,'cons',[])}\n"
            f"风评结论：{getattr(insight,'verdict','')}\n{price_line}"
            f"用户回答：{[(a.dimension, a.value, a.score) for a in answers]}\n"
            f"系统倾向 lean：{lean}（buy/keep_floating/let_go）\n置信度：{confidence}"
        )
        data = llm.chat_json(user, system=_SYSTEM, max_tokens=500, temperature=0.4)
        if isinstance(data, dict):
            digest = (data.get("review_digest") or "").strip() or None
            signals = (data.get("your_signals") or "").strip() or None
            suggestion = (data.get("suggestion_text") or "").strip() or None

    # 模板兜底
    if not digest:
        pros, cons = getattr(insight, "pros", []), getattr(insight, "cons", [])
        digest = f"好处：{'；'.join(pros[:2]) or '—'}；要留意：{'；'.join(cons[:2]) or '—'}。"
    if not signals:
        signals = f"你的回答总体偏向「{_LEAN_LABEL[lean]}」（信号分 {total}）。"
    if not suggestion:
        _sug = {
            "let_go": "看起来它在你生活里出场机会不多～要不要先放手？想要的话它一直在河里漂着。",
            "buy": "从你的回答看，它确实挺合你需要的；如果决定了，就安心买下它吧。",
            "keep_floating": "还拿不准也没关系，先让它在河里漂一会儿，过两天再回来看看。",
        }
        suggestion = _sug[lean]

    return Report(
        product_name=name, review_digest=digest, your_signals=signals,
        lean=lean, confidence=confidence, suggestion_text=suggestion, score_summary=score_summary,
    )
