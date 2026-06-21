"""
口碑佐证 端到端演示。

用法（在 backend/ 目录下）：
    python app/services/insight/demo.py 破壁机
    python app/services/insight/demo.py 美容仪 --xhs        # 额外尝试小红书笔记
环境变量（可选）：
    BRAVE_API_KEY     设了就用稳定的搜索 API（推荐）
    ANTHROPIC_API_KEY 设了就用 Claude 提炼好坏（效果更好），否则走规则兜底
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.services.insight.collector import build_report  # noqa: E402


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    product = args[0] if args else "破壁机"
    use_xhs = "--xhs" in sys.argv

    print(f"\n{'='*56}\n  冷静购 · 口碑佐证   商品：{product}\n{'='*56}")
    report = build_report(product, use_search=True, use_xhs=use_xhs, allow_sample=True)

    print(f"\n🧊 一句话结论：{report.verdict}")
    print(f"\n✅ 优点 / 真香点：")
    for p in report.pros or ["（暂无）"]:
        print(f"    · {p}")
    print(f"\n⚠️  值得警惕 / 避雷点：")
    for c in report.cons or ["（暂无）"]:
        print(f"    · {c}")

    print(f"\n📌 {report.sources_summary}")
    print(f"📎 {report.coverage_note}")
    print(f"🔧 提炼方式：{report.method}")

    print(f"\n💬 冷静期定制问题：\n    {report.cooldown_question()}")

    refs = [r for e in report.evidence for r in e.refs][:5]
    if refs:
        print(f"\n🔗 佐证出处（抽样）：")
        for r in refs:
            tag = f" <{r.get('source')}>" if r.get("source") else ""
            print(f"    - {r.get('title','')}{tag}")
    print()


if __name__ == "__main__":
    main()
