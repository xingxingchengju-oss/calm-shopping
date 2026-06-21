"""口碑佐证数据结构（对应 PRD §5.4）。"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List


@dataclass
class Evidence:
    """一层证据来源。"""
    layer: str            # T0 用户提供 / T1 AI先验 / T2 真实抓取
    source: str           # 人类可读来源名，如「搜索聚合(brave)」「小红书笔记」「你粘贴的评论」
    texts: List[str] = field(default_factory=list)   # 用于提炼的文本片段
    refs: List[Dict] = field(default_factory=list)    # 可引用出处 {title,url,source}


@dataclass
class InsightReport:
    """喂给 §5.5 冷静分析 / §5.6 冷静期定制问题 的口碑佐证报告。"""
    product: str
    pros: List[str]
    cons: List[str]
    verdict: str
    method: str                 # claude / rule-based
    sources_summary: str        # 标注来源（PRD §9 / 体验原则：佐证而非裁决）
    coverage_note: str          # 未覆盖范围
    evidence: List[Evidence] = field(default_factory=list)

    def to_dict(self) -> Dict:
        return {
            "product": self.product,
            "pros": self.pros,
            "cons": self.cons,
            "verdict": self.verdict,
            "method": self.method,
            "sources_summary": self.sources_summary,
            "coverage_note": self.coverage_note,
            "evidence": [
                {"layer": e.layer, "source": e.source, "count": len(e.texts), "refs": e.refs}
                for e in self.evidence
            ],
        }

    def cooldown_question(self) -> str:
        """把最关键的「坏处」变成冷静期里一个直击要害的问题（PRD §5.6）。"""
        if self.cons:
            return f"关于这件{self.product}，不少人提到「{self.cons[0]}」，你确定它适合你、会经常用吗？"
        return f"先放一放这件{self.product}，3 分钟后如果还想要，再决定也不迟。"
