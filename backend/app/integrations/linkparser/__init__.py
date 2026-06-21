"""
商品链接解析（PRD §5.3 链接侧）。

    from app.integrations.linkparser import parse_product
    product = parse_product("【淘宝】... https://e.tb.cn/xxx ... 「商品名」")

parse_product：分享文本/链接 → 统一商品对象（platform/id/canonical_url/name/price/
promotion_stimuli/recognition...）。fetch=True 时联网跟随短链补 id/价格。
名称优先来自分享文本里的「标题」，因此即使详情页被登录态屏蔽，通常也能拿到商品名
——这正是「翻真实评价」所需的关键字段。
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from .fetcher import fetch_live_metadata
from .parser import (
    ProductParser,
    canonicalize_product_url,
    detect_platform,
    extract_first_url,
    extract_product_id,
    extract_product_name,
    extract_quoted_product_name,
)

__all__ = [
    "parse_product", "ProductParser", "detect_platform", "extract_product_id",
    "canonicalize_product_url", "extract_first_url", "extract_product_name", "fetch_live_metadata",
]


def parse_product(
    text_or_url: str,
    *,
    fetch: bool = True,
    live_metadata: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """分享文本或链接 → 统一商品对象。fetch=True 时联网补全 id/价格（best-effort）。"""
    live = dict(live_metadata or {})
    if fetch and not live:
        live = fetch_live_metadata(text_or_url)
    return ProductParser().parse_share_text(text_or_url, live_metadata=live)
