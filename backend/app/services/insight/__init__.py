"""口碑佐证服务（PRD §5.4）。"""
from .collector import build_report, collect_evidence
from .models import Evidence, InsightReport

__all__ = ["build_report", "collect_evidence", "Evidence", "InsightReport"]
