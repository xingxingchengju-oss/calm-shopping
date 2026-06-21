"""
DuckDuckGo HTML retriever — FREE but BEST-EFFORT.

实测：能用一两次后会返回 202 反爬挑战页。因此它是「免费兜底」层，不是稳定主力。
带退避重试；连续被 202 就放弃并返回空，由上层降级到别的来源 / AI 先验。
稳定的产品定向检索请用 brave.py（需 API key）。
"""
from __future__ import annotations

import html
import logging
import re
import time
from typing import List
from urllib.parse import unquote, urlparse, parse_qs

import requests

from .base import SearchResult, REVIEW_ANGLES

LOGGER = logging.getLogger("insight.ddg")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
ENDPOINT = "https://html.duckduckgo.com/html/"
_RESULT_RE = re.compile(r'result__a"[^>]*href="(?P<href>[^"]+)"[^>]*>(?P<title>.*?)</a>', re.S)
_SNIPPET_RE = re.compile(r'result__snippet"[^>]*>(?P<snippet>.*?)</a>', re.S)


def _clean(t: str) -> str:
    return html.unescape(re.sub(r"<.*?>", "", t)).strip()


def _real_url(href: str) -> str:
    if "uddg=" in href:
        q = parse_qs(urlparse(href if href.startswith("http") else "https:" + href).query)
        if q.get("uddg"):
            return unquote(q["uddg"][0])
    return href if href.startswith("http") else "https:" + href


class DuckDuckGoRetriever:
    name = "duckduckgo"

    def __init__(self, min_interval: float = 1.5, timeout: int = 12, retries: int = 2) -> None:
        self.session = requests.Session()
        self.session.headers.update({"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9"})
        self.min_interval, self.timeout, self.retries = min_interval, timeout, retries
        self._last = 0.0

    def _throttle(self) -> None:
        gap = time.monotonic() - self._last
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last = time.monotonic()

    def _search_once(self, query: str, max_results: int) -> List[SearchResult]:
        for attempt in range(self.retries + 1):
            self._throttle()
            try:
                r = self.session.get(ENDPOINT, params={"q": query}, timeout=self.timeout)
            except requests.RequestException as exc:
                LOGGER.warning("DDG request error %r: %s", query, exc)
                return []
            if r.status_code == 202 or "result__a" not in r.text:
                # 反爬挑战：退避后重试，最终放弃
                if attempt < self.retries:
                    time.sleep(2.0 * (attempt + 1))
                    continue
                LOGGER.warning("DDG blocked (202/empty) for %r after %d tries", query, attempt + 1)
                return []
            titles = list(_RESULT_RE.finditer(r.text))
            snippets = _SNIPPET_RE.findall(r.text)
            out = []
            for i, m in enumerate(titles[:max_results]):
                out.append(SearchResult(
                    title=_clean(m.group("title")),
                    url=_real_url(m.group("href")),
                    snippet=_clean(snippets[i]) if i < len(snippets) else "",
                ))
            return out
        return []

    def search_product(self, product: str, max_results: int = 8, angles=None) -> List[SearchResult]:
        seen, merged = set(), []
        for ang in (angles or REVIEW_ANGLES):
            for res in self._search_once(f"{product} {ang}", per_angle := 6):
                key = res.url.split("?")[0]
                if key in seen or not res.title:
                    continue
                seen.add(key)
                merged.append(res)
                if len(merged) >= max_results:
                    break
            if len(merged) >= max_results:
                break
        LOGGER.info("DDG search_product(%r): %d results", product, len(merged))
        return merged
