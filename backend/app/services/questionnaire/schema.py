"""
问卷 / 报告的数据契约（schema）+ 校验。

interaction_type 固定枚举 → 前端按类型渲染、后端按类型校验。
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any, Dict, List, Optional

INTERACTION_TYPES = {"bubble_single", "bubble_multi", "two_choice", "slider", "sentence_complete"}
DIMENSIONS = ["浪头", "落点", "水深", "暗礁", "回岸", "钱位"]

# 报告动作恒为三选一（始终全给，lean 仅高亮）
ACTIONS = [
    {"key": "buy", "label": "买下它"},
    {"key": "keep_floating", "label": "继续漂着"},
    {"key": "let_go", "label": "放手啦"},
]
LEANS = {"buy", "keep_floating", "let_go"}


@dataclass
class Option:
    label: str
    value: str
    score: int


@dataclass
class Question:
    id: str
    dimension: str
    score_key: str
    interaction_type: str
    question: str
    question_reason: str = ""            # 前端可选展示「为什么问你这个」
    persona: Optional[str] = None
    options: List[Option] = field(default_factory=list)   # bubble_*/two_choice
    slider: Optional[Dict[str, Any]] = None               # {min,max,step,min_label,max_label,score_rule}
    input: Optional[Dict[str, Any]] = None                # {placeholder,score_rule}
    evidence: Optional[Dict[str, Any]] = None             # {kind,text,source}

    def to_dict(self) -> Dict[str, Any]:
        d = asdict(self)
        return {k: v for k, v in d.items() if v is not None}


@dataclass
class Questionnaire:
    product_name: str
    intro: str
    questions: List[Question]
    meta: Dict[str, Any] = field(default_factory=dict)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "product_name": self.product_name,
            "intro": self.intro,
            "questions": [q.to_dict() for q in self.questions],
            "meta": self.meta,
        }


@dataclass
class Answer:
    score_key: str
    dimension: str
    value: Any
    score: int


@dataclass
class Report:
    product_name: str
    review_digest: str
    your_signals: str
    lean: str                                  # buy / keep_floating / let_go
    confidence: str                            # high / medium / low
    suggestion_text: str
    score_summary: Dict[str, int] = field(default_factory=dict)
    actions: List[Dict[str, str]] = field(default_factory=lambda: list(ACTIONS))

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def validate_question(q: Question) -> List[str]:
    """返回错误列表，空=合格。供 generator 决定是否回退该维度模板。"""
    errs: List[str] = []
    if q.dimension not in DIMENSIONS:
        errs.append(f"未知维度 {q.dimension}")
    if q.interaction_type not in INTERACTION_TYPES:
        errs.append(f"未知交互 {q.interaction_type}")
    if not q.question or len(q.question) > 40:
        errs.append("question 为空或超过 40 字")
    if not q.question_reason:
        errs.append("缺 question_reason")

    if q.interaction_type in {"bubble_single", "bubble_multi", "two_choice"}:
        if len(q.options) < 2:
            errs.append("选项类至少 2 个 option")
        elif any(not o.label or not isinstance(o.score, int) for o in q.options):
            errs.append("option 需有 label 和整数 score")
        if q.interaction_type == "two_choice" and len(q.options) != 2:
            errs.append("two_choice 必须恰好 2 个 option")
    elif q.interaction_type == "slider":
        s = q.slider or {}
        if not all(k in s for k in ("min", "max", "step", "min_label", "max_label", "score_rule")):
            errs.append("slider 缺字段")
    elif q.interaction_type == "sentence_complete":
        if not (q.input or {}).get("placeholder"):
            errs.append("sentence_complete 缺 input.placeholder")
    return errs
