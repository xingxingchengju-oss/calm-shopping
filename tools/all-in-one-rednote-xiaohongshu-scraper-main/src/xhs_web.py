"""
xhs_web.py — Xiaohongshu (RedNote) public web scraper via SSR __INITIAL_STATE__.

WHY THIS EXISTS
---------------
The original ``web_api/sns/*`` endpoints in this repo are dead (live test returns
HTTP 500 "create invoker failed, service: jarvis-gateway-default"), and the real
signed JSON API (edith.xiaohongshu.com) requires a logged-in cookie + an x-s/x-t
signature. This module instead parses the server-side-rendered
``window.__INITIAL_STATE__`` blob that Xiaohongshu embeds in its public HTML.

WHAT WORKS WITHOUT LOGIN (verified live 2026-06)
    - feed : the public explore feed -> real notes (id, title, likes, author, token)
    - note : a note's full BODY/desc + likes + tags  (needs that note's xsec_token,
             which the feed/search response provides)

WHAT NEEDS A LOGGED-IN COOKIE (set env XHS_COOKIE)
    - search   : keyword search results are loaded client-side via a signed XHR;
                 they are NOT in the SSR HTML, so anonymous search returns empty.
    - comments : a note's comments are loaded via a signed XHR, not SSR'd.

For 冷静购 "真实口碑佐证" (§5.4), the note BODY is the highest-value signal
(避雷/后悔/吃灰/替代 content lives in the note text). Comments are a bonus that
needs login.

Dependencies: requests (see requirements.txt). Stdlib otherwise.

CLI
    python xhs_web.py feed --limit 10
    python xhs_web.py note --url "https://www.xiaohongshu.com/explore/<id>?xsec_token=..."
    python xhs_web.py search --keyword "破壁机" --limit 10      # needs XHS_COOKIE
Output: data/xhs_web_<mode>_<timestamp>.json  (or --output PATH)
"""
from __future__ import annotations

import argparse
import datetime as _dt
import json
import logging
import os
import re
import sys
import time
from typing import Any, Dict, List, Optional

import requests

LOGGER = logging.getLogger("rednote.xhs_web")

UA = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)
STATE_RE = re.compile(r"window\.__INITIAL_STATE__\s*=\s*(\{.*?\})\s*</script>", re.S)


def _now() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat()


def _first_list(obj: Any) -> List[Any]:
    """Xiaohongshu wraps some reactive values; pull the first list we can find."""
    if isinstance(obj, list):
        return obj
    if isinstance(obj, dict):
        for key in ("value", "_value", "_rawValue"):
            if isinstance(obj.get(key), list):
                return obj[key]
        for v in obj.values():
            if isinstance(v, list):
                return v
    return []


class XhsWebClient:
    def __init__(self, cookie: Optional[str] = None, min_interval: float = 1.5) -> None:
        self.session = requests.Session()
        self.session.headers.update(
            {"User-Agent": UA, "Accept-Language": "zh-CN,zh;q=0.9", "Accept": "*/*"}
        )
        if cookie:
            self.session.headers["Cookie"] = cookie
        self.min_interval = min_interval
        self._last = 0.0

    # -- low level ---------------------------------------------------------
    def _throttle(self) -> None:
        gap = time.monotonic() - self._last
        if gap < self.min_interval:
            time.sleep(self.min_interval - gap)
        self._last = time.monotonic()

    def get_state(self, url: str) -> Optional[Dict[str, Any]]:
        self._throttle()
        resp = self.session.get(url, timeout=15)
        if not resp.ok:
            LOGGER.warning("Non-OK status %s for %s", resp.status_code, url)
            return None
        m = STATE_RE.search(resp.text)
        if not m:
            LOGGER.warning("No __INITIAL_STATE__ in %s (login wall or layout change?)", url)
            return None
        try:
            # __INITIAL_STATE__ uses bare `undefined` which isn't valid JSON
            return json.loads(m.group(1).replace("undefined", "null"))
        except json.JSONDecodeError as exc:
            LOGGER.error("Failed to parse __INITIAL_STATE__ from %s: %s", url, exc)
            return None

    # -- normalisation -----------------------------------------------------
    @staticmethod
    def _note_from_feed_item(item: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        if not isinstance(item, dict):
            return None
        nid = item.get("id")
        nc = item.get("noteCard") or {}
        if not nid or not nc:
            return None
        user = nc.get("user") or {}
        cover = nc.get("cover") or {}
        return {
            "id": nid,
            "xsec_token": item.get("xsecToken"),
            "title": nc.get("displayTitle") or "",
            "type": nc.get("type"),
            "liked_count": (nc.get("interactInfo") or {}).get("likedCount"),
            "author": user.get("nickname") or user.get("nickName") or "",
            "author_id": user.get("userId") or user.get("userid") or "",
            "cover": cover.get("urlDefault") or cover.get("url") or "",
            "url": f"https://www.xiaohongshu.com/explore/{nid}"
            + (f"?xsec_token={item.get('xsecToken')}&xsec_source=pc_feed"
               if item.get("xsecToken") else ""),
        }

    # -- public modes ------------------------------------------------------
    def feed(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Public explore feed (no login). Random real notes."""
        st = self.get_state("https://www.xiaohongshu.com/explore")
        if not st:
            return []
        items = _first_list((st.get("feed") or {}).get("feeds"))
        out = []
        for it in items:
            note = self._note_from_feed_item(it)
            if note:
                note["scrapedAt"] = _now()
                out.append(note)
            if len(out) >= limit:
                break
        LOGGER.info("feed: collected %d notes", len(out))
        return out

    def note(self, note_id: str, xsec_token: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """Full note body via SSR. xsec_token is required to view content."""
        url = f"https://www.xiaohongshu.com/explore/{note_id}"
        if xsec_token:
            url += f"?xsec_token={xsec_token}&xsec_source=pc_feed"
        st = self.get_state(url)
        if not st:
            return None
        ndm = (st.get("note") or {}).get("noteDetailMap") or {}
        entry = ndm.get(note_id) or (next(iter(ndm.values()), None) if ndm else None)
        if not entry:
            return None
        nd = entry.get("note") or {}
        if not nd.get("title") and not nd.get("desc"):
            LOGGER.warning("note %s has empty body (missing/expired xsec_token?)", note_id)
        interact = nd.get("interactInfo") or {}
        comments = [
            {"content": c.get("content", ""), "like_count": c.get("likeCount")}
            for c in _first_list((entry.get("comments") or {}).get("list"))
        ]
        return {
            "id": note_id,
            "title": nd.get("title") or "",
            "desc": nd.get("desc") or "",
            "liked_count": interact.get("likedCount"),
            "collected_count": interact.get("collectedCount"),
            "comment_count": interact.get("commentCount"),
            "tags": [t.get("name") for t in (nd.get("tagList") or []) if t.get("name")],
            "author": (nd.get("user") or {}).get("nickname", ""),
            "image_count": len(nd.get("imageList") or []),
            "comments": comments,  # empty unless logged in
            "comments_note": None if comments else "comments require login (XHS_COOKIE)",
            "url": url,
            "scrapedAt": _now(),
        }

    def feed_with_bodies(self, limit: int = 5) -> List[Dict[str, Any]]:
        """Convenience: feed + fetch each note's full body. The 冷静购 'insight' shape."""
        notes = self.feed(limit=limit)
        enriched = []
        for n in notes:
            detail = self.note(n["id"], n.get("xsec_token"))
            if detail:
                detail["author"] = detail["author"] or n["author"]
                enriched.append(detail)
        return enriched

    def search(self, keyword: str, limit: int = 20) -> List[Dict[str, Any]]:
        """Keyword search. NOTE: results are client-side/signed; SSR is empty without
        a valid logged-in cookie AND request signature. Returns [] + warns if gated."""
        from urllib.parse import quote

        st = self.get_state(
            f"https://www.xiaohongshu.com/search_result?keyword={quote(keyword)}"
        )
        items = _first_list((st or {}).get("search", {}).get("feeds")) if st else []
        if not items:
            LOGGER.warning(
                "search returned 0 results. Xiaohongshu search needs a logged-in "
                "cookie + signed request; set env XHS_COOKIE and note that the public "
                "SSR page does not embed search results."
            )
            return []
        out = []
        for it in items:
            note = self._note_from_feed_item(it)
            if note:
                note["keyword"] = keyword
                note["scrapedAt"] = _now()
                out.append(note)
            if len(out) >= limit:
                break
        return out


# --------------------------------------------------------------------------
def _default_output(mode: str) -> str:
    ts = _dt.datetime.now(_dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    base = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
    return os.path.join(base, "data", f"xhs_web_{mode}_{ts}.json")


def main() -> None:
    p = argparse.ArgumentParser(description="Xiaohongshu public web (SSR) scraper")
    p.add_argument("mode", choices=["feed", "note", "search"])
    p.add_argument("--keyword", help="search keyword (search mode)")
    p.add_argument("--url", help="note url with xsec_token (note mode)")
    p.add_argument("--note-id", help="note id (note mode; needs --token)")
    p.add_argument("--token", help="xsec_token (note mode)")
    p.add_argument("--limit", type=int, default=10)
    p.add_argument("--bodies", action="store_true", help="feed mode: also fetch note bodies")
    p.add_argument("--output")
    p.add_argument("--verbose", action="store_true")
    args = p.parse_args()

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="%(asctime)s [%(levelname)s] %(name)s - %(message)s",
    )

    client = XhsWebClient(cookie=os.environ.get("XHS_COOKIE"))

    if args.mode == "feed":
        data: Any = client.feed_with_bodies(args.limit) if args.bodies else client.feed(args.limit)
    elif args.mode == "note":
        nid, tok = args.note_id, args.token
        if args.url:
            m = re.search(r"/explore/([0-9a-fA-F]+)", args.url)
            nid = m.group(1) if m else nid
            tm = re.search(r"xsec_token=([^&]+)", args.url)
            tok = tm.group(1) if tm else tok
        if not nid:
            p.error("note mode needs --url or --note-id")
        data = client.note(nid, tok)
    else:
        if not args.keyword:
            p.error("search mode needs --keyword")
        data = client.search(args.keyword, args.limit)

    if not data:
        LOGGER.warning("No data produced.")
        sys.exit(0)

    out_path = args.output or _default_output(args.mode)
    os.makedirs(os.path.dirname(out_path), exist_ok=True)
    with open(out_path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
    n = len(data) if isinstance(data, list) else 1
    LOGGER.info("Wrote %d record(s) to %s", n, out_path)


if __name__ == "__main__":
    main()
