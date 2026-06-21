"""
短链实时解析：跟随跳转 → 从最终 URL / HTML 里恢复商品 id、价格等。

来源：把朋友 temp/parse_examples.py 里的 fetch_live_metadata 正式化为模块（改用 requests）。
实测（2026-06）：淘宝可恢复 id+价格；京东可恢复 id（价格登录态屏蔽）；拼多多仅 goods_id。
登录态屏蔽的字段（京东价格/主图、淘宝主图店铺、拼多多详情）由 browser_render_metadata.json
作为人工/浏览器渲染兜底；后续可替换为真正的渲染服务或官方/授权接口。
"""
from __future__ import annotations

import json
import logging
import os
from typing import Any, Dict

import requests

from .parser import extract_first_url, extract_redirect_metadata

LOGGER = logging.getLogger("linkparser.fetcher")

_MOBILE_UA = (
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) "
    "AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1"
)
_RENDER_PATH = os.path.join(os.path.dirname(__file__), "browser_render_metadata.json")


def _load_render_store() -> Dict[str, Any]:
    try:
        with open(_RENDER_PATH, encoding="utf-8") as f:
            return json.load(f)
    except Exception:
        return {}


def fetch_live_metadata(share_text_or_url: str, *, timeout: int = 15) -> Dict[str, Any]:
    """跟随短链跳转，恢复 product_id/价格等；并并入渲染兜底字段。失败时返回带状态的 dict。"""
    url = extract_first_url(share_text_or_url) or share_text_or_url
    meta: Dict[str, Any]
    try:
        resp = requests.get(url, headers={"User-Agent": _MOBILE_UA}, timeout=timeout, allow_redirects=True)
        html = resp.text
        meta = extract_redirect_metadata(url, final_url=resp.url, html=html)
        meta["final_url"] = resp.url
    except Exception as exc:  # 网络/解析失败 → 不阻塞，交由分享文本标题兜底
        LOGGER.warning("fetch_live_metadata failed for %s: %s", url, exc)
        meta = {"fetch_status": "fetch_failed", "fetch_error": f"{type(exc).__name__}: {exc}"}

    # 渲染/登录态兜底（按原始短链 key 命中）
    render = _load_render_store().get(url)
    if render:
        meta = {**meta, **render}
    return meta
