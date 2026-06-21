"""AI 定制冷静五问（+条件钱位）服务。见 CLAUDE.md「AI 定制冷静五问」。"""
from .dimensions import SPEC_BY_ID, score_answer
from .generator import generate_questionnaire
from .report import generate_report
from .schema import Answer, Option, Question, Questionnaire, Report

__all__ = [
    "generate_questionnaire", "generate_report", "score_answer",
    "Questionnaire", "Question", "Option", "Answer", "Report", "SPEC_BY_ID",
]
