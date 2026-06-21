"""
口碑佐证编排（PRD §5.4 / 附录 B）：分层取证 + 逐层降级，再提炼好坏，产出 InsightReport。

层级：T0 用户粘贴 → T2 搜索聚合(稳/Brave，兜底 DDG) → T2 小红书笔记(best-effort)
      → 无真实证据且允许时用「真实检索样本」演示 → 交给 extractor 提炼好坏。
任一层失败都不阻塞；好坏提炼这一步本身稳定（Claude/规则）。
"""
from __future__ import annotations

import json
import logging
import os
from typing import List, Optional

from ...integrations.review_search import search_reviews
from ...integrations.xhs_scraper import fetch_note_bodies
from .extractor import extract_pros_cons
from .models import Evidence, InsightReport

LOGGER = logging.getLogger("insight.collector")
_SAMPLE_PATH = os.path.join(os.path.dirname(__file__), "sample_reviews.json")


def _load_sample(product: str) -> Optional[Evidence]:
    try:
        with open(_SAMPLE_PATH, encoding="utf-8") as f:
            data = json.load(f)
    except Exception:
        return None
    items = data.get(product)
    if not items:
        return None
    return Evidence(
        layer="T2",
        source="真实检索样本(离线)",
        texts=[f"{i.get('title','')}。{i.get('snippet','')}".strip("。 ") for i in items],
        refs=[{"title": i.get("title"), "url": i.get("url", ""), "source": i.get("source", "")} for i in items],
    )


def collect_evidence(
    product: str,
    user_pasted: Optional[List[str]] = None,
    use_search: bool = True,
    use_xhs: bool = False,
    allow_sample: bool = True,
) -> List[Evidence]:
    evidence: List[Evidence] = []

    # T0 用户提供（地基）
    if user_pasted:
        evidence.append(Evidence("T0", "你粘贴的评论", texts=[t for t in user_pasted if t.strip()]))

    # T2 搜索聚合（稳定主力）
    if use_search:
        results, backend = search_reviews(product)
        if results:
            evidence.append(Evidence(
                "T2", f"搜索聚合({backend})",
                texts=[r.text for r in results],
                refs=[{"title": r.title, "url": r.url, "source": r.source} for r in results],
            ))

    # T2 小红书笔记（best-effort 增强）
    if use_xhs:
        notes = fetch_note_bodies(limit=5)
        texts = [f"{n.get('title','')}。{n.get('desc','')}".strip("。 ") for n in notes if n.get("desc")]
        if texts:
            evidence.append(Evidence(
                "T2", "小红书笔记",
                texts=texts,
                refs=[{"title": n.get("title"), "url": n.get("url"), "source": "xiaohongshu.com"}
                      for n in notes if n.get("desc")],
            ))

    # 无真实 T2 证据时，用真实检索样本演示（清晰标注）
    if allow_sample and not any(e.layer == "T2" for e in evidence):
        sample = _load_sample(product)
        if sample:
            LOGGER.info("使用离线真实检索样本演示：%s", product)
            evidence.append(sample)

    return evidence


def build_report(product: str, **kwargs) -> InsightReport:
    evidence = collect_evidence(product, **kwargs)
    texts = [t for e in evidence for t in e.texts]
    pros, cons, verdict, method = extract_pros_cons(product, texts)

    if evidence:
        sources_summary = "本次佐证来源：" + "；".join(f"{e.source} {len(e.texts)} 条" for e in evidence)
    else:
        sources_summary = "本次佐证来源：无真实数据，仅可用 AI 先验（建议粘贴几条评论以增强）"
    coverage_note = "未覆盖：全网历史低价、各平台全部评论。以上为抽样佐证，仅供参考，非购买结论。"

    return InsightReport(
        product=product, pros=pros, cons=cons, verdict=verdict, method=method,
        sources_summary=sources_summary, coverage_note=coverage_note, evidence=evidence,
    )
