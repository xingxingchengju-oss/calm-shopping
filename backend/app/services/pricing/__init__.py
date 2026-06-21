"""
行情 / 钱位维度（条件触发，重时效）。

只在贵价商品（current_price > 阈值，默认 300）时启用。

为什么不用「历史最低价」：历史最低是误导性锚点——像显卡这类在上行周期的商品，
历史低点回不去，拿当前价跟它比永远「偏高、再等」，反而可能等到更贵。
所以这里用 **近期行情 + 趋势方向** 来判：
- 当前价相对【近期】是偏贵/正常/划算；
- 趋势是涨/跌/平稳；
- 据此给【趋势感知】的等待建议（涨价/紧俏 → 等不一定更便宜；下行/临近迭代 → 可等）。
不做精确未来价格预测；大促日历只在趋势支持「会降」时作次要佐证。
阈值可配：环境变量 LJG_PRICE_DIM_THRESHOLD。
"""
from __future__ import annotations

import datetime as _dt
import logging
import os
from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

from ...integrations import llm
from ...integrations.review_search import search_prices

LOGGER = logging.getLogger("pricing")

DEFAULT_THRESHOLD = float(os.environ.get("LJG_PRICE_DIM_THRESHOLD", "300"))

# 主要电商大促日历（近似日期）—— 仅作「趋势会降」时的次要佐证
_SALES = [(1, 20, "年货节"), (3, 8, "38大促"), (6, 18, "618"), (11, 11, "双11"), (12, 12, "双12")]

_SYSTEM = (
    "你是理性消费助手「冷静购」的『行情』分析模块。基于检索到的近期价格/走势片段，"
    "再结合你对该品类的常识，判断：\n"
    "1) 当前价相对【近期行情】是偏贵/正常/划算（**不要只盯历史最低价**，要看近期与当下）；\n"
    "2) 这类商品当前价格趋势是涨/跌/平稳（例如显卡近年偏紧俏上行；消费电子上市后通常下行）；\n"
    "3) 据此给『要不要等』：若趋势上行或紧俏，明确指出『等不一定更便宜、甚至可能涨』；"
    "若下行或临近新品迭代，可建议等；若已是近期低点，说明现在合适。\n"
    "中立、简洁、不编造具体数字。"
    '只输出 JSON：{"verdict":"偏贵|正常|划算|未知","trend":"涨|跌|平稳|不确定",'
    '"assessment":"一句话<=30字","wait_suggestion":"一句话<=30字"}'
)


@dataclass
class PriceVerdict:
    product: str
    current_price: float
    verdict: str                 # 相对近期行情：偏贵 / 正常 / 划算 / 未知
    trend: str                   # 涨 / 跌 / 平稳 / 不确定
    assessment: str              # 一句话判断
    wait_suggestion: str         # 趋势感知的等待建议
    next_sale: str               # 下个大促名（次要佐证）
    days_to_sale: int            # 距下个大促天数
    question: str                # 「钱」框架的冷静问题（趋势感知）
    method: str                  # llm / rule-based
    sources: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def _next_big_sale(today: Optional[_dt.date] = None) -> tuple[str, int]:
    today = today or _dt.date.today()
    candidates: List[tuple[_dt.date, str]] = []
    for m, d, name in _SALES:
        for year in (today.year, today.year + 1):
            day = _dt.date(year, m, d)
            if day >= today:
                candidates.append((day, name))
                break
    day, name = min(candidates, key=lambda x: x[0])
    return name, (day - today).days


def _build_question(name: str, price_disp, assess: str, trend: str, sale: str, days: int) -> str:
    assess = assess.rstrip("。.，, ")
    if trend == "涨":
        return (
            f"这件商品要 {price_disp} 元，{assess}。这类东西当前在涨价，等大促不一定更便宜、甚至可能更贵"
            f"——所以真问题是：你是真的需要它，还是被『再不买就涨了』推着走？"
        )
    if trend == "跌":
        return (
            f"这件商品要 {price_disp} 元，{assess}。而且行情还在往下走，离 {sale} 还有 {days} 天"
            f"——你确定现在买，而不是放进愿望池再等等？"
        )
    return (
        f"这件商品要 {price_disp} 元，{assess}。"
        f"先放进愿望池压一压，过两天还想要再买，也不迟——你确定现在就买吗？"
    )


def assess_price(
    product: Dict[str, Any],
    *,
    threshold: Optional[float] = None,
    today: Optional[_dt.date] = None,
) -> Optional[PriceVerdict]:
    """贵价商品才返回 PriceVerdict；便宜/无价返回 None（维度不出现）。"""
    price = (product.get("price") or {}).get("current_price")
    name = (product.get("product_name") or "").strip()
    threshold = DEFAULT_THRESHOLD if threshold is None else threshold

    if price is None or not name or float(price) <= threshold:
        return None

    sale_name, days = _next_big_sale(today)

    # 1) 搜近期价/走势片段
    results, _backend = search_prices(name, max_results=6)
    snippets = "\n".join(f"- {r.text}" for r in results) if results else ""
    sources = [{"title": r.title, "url": r.url, "source": r.source} for r in results][:5]

    # 2) DeepSeek 判：相对近期行情 + 趋势 + 趋势感知的等待建议
    verdict, trend = "未知", "不确定"
    assessment = "未查到近期行情，难判断这个价值不值。"
    wait = "可以先放进愿望池，观察几天行情再决定。"
    method = "rule-based"
    if llm.available():
        data = llm.chat_json(
            f"商品：{name}\n当前价：{price} 元\n（参考：下个大促 {sale_name} 还有 {days} 天）\n"
            f"检索到的近期价格/走势片段：\n{snippets or '（无）'}",
            system=_SYSTEM, max_tokens=320, temperature=0.2,
        )
        if isinstance(data, dict) and data.get("verdict"):
            verdict = str(data.get("verdict", "未知"))
            trend = str(data.get("trend", "不确定"))
            assessment = str(data.get("assessment", assessment))
            wait = str(data.get("wait_suggestion", wait))
            method = "llm"

    price_disp = int(price) if float(price).is_integer() else price
    question = _build_question(name, price_disp, assessment, trend, sale_name, days)

    return PriceVerdict(
        product=name, current_price=float(price), verdict=verdict, trend=trend,
        assessment=assessment, wait_suggestion=wait, next_sale=sale_name, days_to_sale=days,
        question=question, method=method, sources=sources,
    )
