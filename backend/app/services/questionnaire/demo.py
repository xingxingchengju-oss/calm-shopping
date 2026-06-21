"""
端到端：链接 → 识别商品 → 翻真实评价 → (贵价)行情 → AI 五问 → 作答 → 报告。

用法（backend/ 下）：
    python app/services/questionnaire/demo.py                 # 默认显卡样例(含钱位)，自动模拟作答
    python app/services/questionnaire/demo.py "【京东】… 「商品名」"
    python app/services/questionnaire/demo.py --interactive   # 命令行真实作答
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
_BACKEND = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.services.insight import build_report  # noqa: E402
from app.services.pricing import assess_price  # noqa: E402
from app.services.questionnaire import (  # noqa: E402
    Answer, generate_questionnaire, generate_report, score_answer,
)
from app.services.recognition import recognize_link, review_query  # noqa: E402

DEFAULT_SAMPLE = (
    "【淘宝】大促价保 https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To CZ321 "
    "「X影驰RTX5060TI/5070TI/5080/5090名人堂台式机电脑独立游戏显卡」"
)


def _print_question(i, q):
    print(f"\n  {i}. [{q.dimension}·{q.interaction_type}] {q.question}")
    if q.question_reason:
        print(f"     ↳ 为什么问：{q.question_reason}")
    if q.options:
        print("     选项：" + " / ".join(f"{o.label}({o.score:+d})" for o in q.options))
    if q.slider:
        print(f"     滑块：{q.slider['min_label']}…{q.slider['max_label']}（{q.slider['score_rule']}）")
    if q.input:
        print(f"     填空：{q.input['placeholder']}")
    if q.evidence:
        print(f"     依据：{q.evidence.get('text','')}")


def _simulate(q) -> Answer:
    """代表性模拟：偏『冲动/低频』一侧，演示产品如何接住一次冲动。"""
    if q.interaction_type == "bubble_multi":
        value = [o.value for o in q.options if o.score < 0][:2] or [q.options[0].value]
    elif q.interaction_type in {"two_choice", "bubble_single"}:
        value = min(q.options, key=lambda o: o.score).value      # 最 let_go 的一侧
    elif q.interaction_type == "slider":
        value = 2                                                # 几乎不用
    else:  # sentence_complete
        value = ""                                               # 没想好具体场景
    return Answer(score_key=q.score_key, dimension=q.dimension, value=value,
                  score=score_answer(q.id, value))


def _ask(q) -> Answer:
    """命令行真实作答。"""
    if q.interaction_type in {"two_choice", "bubble_single", "bubble_multi"}:
        for idx, o in enumerate(q.options):
            print(f"      [{idx}] {o.label}")
        raw = input("   选（多选用逗号）: ").strip()
        idxs = [int(x) for x in raw.replace("，", ",").split(",") if x.strip().isdigit()]
        if q.interaction_type == "bubble_multi":
            value = [q.options[i].value for i in idxs if 0 <= i < len(q.options)]
        else:
            value = q.options[idxs[0]].value if idxs else q.options[0].value
    elif q.interaction_type == "slider":
        value = int((input(f"   一个月几次（{q.slider['min']}-{q.slider['max']}）: ").strip() or "0"))
    else:
        value = input("   补全: ").strip()
    return Answer(score_key=q.score_key, dimension=q.dimension, value=value,
                  score=score_answer(q.id, value))


def run(text: str, interactive: bool = False) -> None:
    product = recognize_link(text)
    name = product.get("product_name")
    print("=" * 64)
    print(f"🛒 识别：{name or '未识别'}（{product['source_platform']}）"
          f" 价 {product['price']['current_price']} 品类 {product.get('product_category') or '—'}")
    u = product.get("understanding") or {}
    if u:
        print(f"   商品理解：品类={product.get('product_category')} 耐用={u.get('durability')} "
              f"使用模式={u.get('usage_pattern_prior')} 套装={u.get('is_bundle_or_set')} 查询词={u.get('core_query')}")

    q = review_query(product)
    if not q:
        print("⚠️ 没识别出商品名 → 建议截图 OCR / 手填后再来。")
        return

    insight = build_report(q, use_search=True, allow_sample=True)
    pricing = assess_price(product)            # 便宜/无价 → None → 无钱位题
    quiz = generate_questionnaire(product, insight, pricing)

    print(f"\n🫧 {quiz.intro}")
    print(f"   （维度：{'/'.join(quiz.meta['dimensions_used'])}）")
    answers = []
    for i, ques in enumerate(quiz.questions, 1):
        _print_question(i, ques)
        ans = _ask(ques) if interactive else _simulate(ques)
        if not interactive:
            print(f"     〔模拟作答〕{ans.value}  → {ans.score:+d}")
        answers.append(ans)

    report = generate_report(product, insight, pricing, answers)
    print("\n" + "—" * 64)
    print(f"📋 冷静报告（倾向：{report.lean} · 置信：{report.confidence}）")
    print(f"   风评里看到：{report.review_digest}")
    print(f"   你的信号　：{report.your_signals}")
    print(f"   豚豚建议　：{report.suggestion_text}")
    print(f"   动作三选一：{' / '.join(a['label'] for a in report.actions)}")
    print(f"   打分明细　：{report.score_summary}（合计 {sum(report.score_summary.values())}）")


def main() -> None:
    interactive = "--interactive" in sys.argv
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    run(" ".join(args) if args else DEFAULT_SAMPLE, interactive=interactive)


if __name__ == "__main__":
    main()
