"""
口碑检索门面：优先用稳定的 Brave API，没有 key 时降级到免费 best-effort 的 DuckDuckGo。

    from app.integrations.review_search import search_reviews
    results, backend = search_reviews("破壁机")
"""
from __future__ import annotations

import logging
from typing import List, Tuple

from .base import SearchResult, ReviewRetriever, REVIEW_ANGLES, PRICE_ANGLES
from .brave import BraveRetriever
from .ddg import DuckDuckGoRetriever

LOGGER = logging.getLogger("insight.search")

__all__ = [
    "search_reviews", "search_prices", "SearchResult", "ReviewRetriever",
    "BraveRetriever", "DuckDuckGoRetriever",
]


def _search(product: str, angles, max_results: int) -> Tuple[List[SearchResult], str]:
    """稳定优先(Brave)，免费兜底(DDG)。返回 (结果, 后端名)。"""
    brave = BraveRetriever()
    if brave.available:
        res = brave.search_product(product, max_results, angles=angles)
        if res:
            return res, "brave"
        LOGGER.info("Brave returned empty, falling back to DuckDuckGo.")
    res = DuckDuckGoRetriever().search_product(product, max_results, angles=angles)
    return res, "duckduckgo"


def search_reviews(product: str, max_results: int = 8) -> Tuple[List[SearchResult], str]:
    """翻真实评价（好坏角度）。"""
    return _search(product, REVIEW_ANGLES, max_results)


def search_prices(product: str, max_results: int = 8) -> Tuple[List[SearchResult], str]:
    """翻历史价/大促价（钱位维度）。"""
    return _search(product, PRICE_ANGLES, max_results)
