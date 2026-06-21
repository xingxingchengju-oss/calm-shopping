"""Common types + interface for product-review retrieval backends."""
from __future__ import annotations

from dataclasses import dataclass, asdict
from typing import Dict, List, Protocol
from urllib.parse import urlparse


@dataclass
class SearchResult:
    title: str
    url: str
    snippet: str
    source: str = ""  # 站点域名，如 zhihu.com

    def __post_init__(self) -> None:
        if not self.source and self.url:
            self.source = urlparse(self.url).netloc.replace("www.", "")

    @property
    def text(self) -> str:
        """标题 + 摘要，喂给好坏提炼。"""
        return f"{self.title}。{self.snippet}".strip("。 ")

    def to_dict(self) -> Dict[str, str]:
        return asdict(self)


class ReviewRetriever(Protocol):
    """检索后端统一接口。实现：Brave(稳/需key)、DuckDuckGo(免费/best-effort)。"""

    name: str

    def search_product(self, product: str, max_results: int = 8) -> List[SearchResult]:
        ...


# 针对一个商品的多角度检索词（聚焦「好坏」）
REVIEW_ANGLES = ["真实评价", "缺点 避雷", "测评 值不值", "后悔 吃灰 智商税"]
# 价格/行情角度（钱位维度用）—— 重时效：近期价、走势、当下比价，不盯历史最低
PRICE_ANGLES = ["最新价格 现在多少钱", "价格走势 会涨还是会跌", "近期 京东 淘宝 报价", "值不值这个价"]
