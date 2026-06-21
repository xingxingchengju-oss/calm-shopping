"""
Brave Search API retriever — STABLE, product-targeted, the recommended primary.

为什么用它：搜索 API 就是给程序调用设计的，稳定、合规、不会像抓 HTML 那样被 202 封。
Brave 有免费层（注册即得 key）。把 key 放进环境变量 BRAVE_API_KEY 即启用。
申请：https://api-dashboard.search.brave.com/  （免费层每月有额度，够 MVP/比赛）

同类可替换：Tavily、Bing Web Search、Google Programmable Search —— 接口形状类似，
都可按本文件照葫芦画瓢再加一个 Retriever。
"""
from __future__ import annotations

import logging
import os
import time
from typing import List, Optional

import requests

from .base import SearchResult, REVIEW_ANGLES

LOGGER = logging.getLogger("insight.brave")
ENDPOINT = "https://api.search.brave.com/res/v1/web/search"


class BraveRetriever:
    name = "brave"

    def __init__(self, api_key: Optional[str] = None, min_interval: float = 1.1, timeout: int = 12) -> None:
        self.api_key = api_key or os.environ.get("BRAVE_API_KEY")
        self.min_interval, self.timeout = min_interval, timeout
        self._last = 0.0

    @property
    def available(self) -> bool:
        return bool(self.api_key)

    def _throttle(self) -> None:
        gap = time.monotonic() - self._last
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last = time.monotonic()

    def _search_once(self, query: str, count: int) -> List[SearchResult]:
        self._throttle()
        headers = {"Accept": "application/json", "X-Subscription-Token": self.api_key}
        params = {"q": query, "count": count, "country": "cn", "search_lang": "zh-hans"}
        try:
            r = requests.get(ENDPOINT, headers=headers, params=params, timeout=self.timeout)
        except requests.RequestException as exc:
            LOGGER.warning("Brave request error %r: %s", query, exc)
            return []
        if not r.ok:
            LOGGER.warning("Brave non-OK %s for %r: %s", r.status_code, query, r.text[:120])
            return []
        web = (r.json().get("web") or {}).get("results") or []
        return [
            SearchResult(
                title=item.get("title", ""),
                url=item.get("url", ""),
                snippet=item.get("description", ""),
            )
            for item in web
        ]

    def search_product(self, product: str, max_results: int = 8, angles=None) -> List[SearchResult]:
        if not self.available:
            LOGGER.info("Brave disabled (no BRAVE_API_KEY).")
            return []
        seen, merged = set(), []
        for ang in (angles or REVIEW_ANGLES):
            for res in self._search_once(f"{product} {ang}", 6):
                key = res.url.split("?")[0]
                if key in seen or not res.title:
                    continue
                seen.add(key)
                merged.append(res)
                if len(merged) >= max_results:
                    break
            if len(merged) >= max_results:
                break
        LOGGER.info("Brave search_product(%r): %d results", product, len(merged))
        return merged
