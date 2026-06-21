"""
小红书 真实笔记正文 适配器（best-effort 增强源）。

封装 tools/ 下已验证的 xhs_web.py（基于公开页面 SSR）。能力边界（实测）：
  - 可抓：explore feed 的真实笔记正文（无需登录）。
  - 不可：按商品关键词搜索 / 评论（需登录 Cookie）。
因此它是「机会性增强」：当能抓到与商品相关的笔记正文时，作为真实佐证叠加；
抓不到就降级，由 review_search / AI 先验兜底。不在关键路径。
"""
from __future__ import annotations

import logging
import os
import sys
from typing import List, Optional

LOGGER = logging.getLogger("insight.xhs")

# 定位 tools/.../src 下的 xhs_web.py
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", ".."))
_XHS_SRC = os.path.join(
    _REPO_ROOT, "tools", "all-in-one-rednote-xiaohongshu-scraper-main", "src"
)


def _load_client():
    if _XHS_SRC not in sys.path:
        sys.path.insert(0, _XHS_SRC)
    try:
        from xhs_web import XhsWebClient  # type: ignore
        return XhsWebClient(cookie=os.environ.get("XHS_COOKIE"))
    except Exception as exc:  # pragma: no cover - 工具缺失时优雅降级
        LOGGER.warning("xhs_web unavailable: %s", exc)
        return None


def fetch_note_bodies(limit: int = 5) -> List[dict]:
    """抓 explore feed 的若干篇笔记正文（best-effort，失败返回 []）。"""
    client = _load_client()
    if client is None:
        return []
    try:
        return client.feed_with_bodies(limit=limit)
    except Exception as exc:
        LOGGER.warning("xhs fetch_note_bodies failed: %s", exc)
        return []


def fetch_note(url_or_id: str, xsec_token: Optional[str] = None) -> Optional[dict]:
    """抓单篇笔记正文（需 token，通常来自分享链接）。"""
    client = _load_client()
    if client is None:
        return None
    try:
        import re
        nid = url_or_id
        m = re.search(r"/explore/([0-9a-fA-F]+)", url_or_id)
        if m:
            nid = m.group(1)
            tm = re.search(r"xsec_token=([^&]+)", url_or_id)
            if tm:
                xsec_token = tm.group(1)
        return client.note(nid, xsec_token)
    except Exception as exc:
        LOGGER.warning("xhs fetch_note failed: %s", exc)
        return None
