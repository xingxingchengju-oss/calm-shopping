"""
端到端演示：链接 / 分享文本 → 识别商品(§5.3) → 翻真实评价(§5.4) → 好坏报告。

用法（在 backend/ 目录下）：
    python demo_link_to_reviews.py                     # 跑 3 个内置样例
    python demo_link_to_reviews.py "【淘宝】... 链接 ... 「商品名」"
环境变量同 insight：BRAVE_API_KEY（真实检索更稳）/ ANTHROPIC_API_KEY（好坏提炼更好）。
"""
import os
import sys

sys.stdout.reconfigure(encoding="utf-8")
_BACKEND = os.path.dirname(os.path.abspath(__file__))
if _BACKEND not in sys.path:
    sys.path.insert(0, _BACKEND)

from app.services.recognition import recognize_link, review_query  # noqa: E402
from app.services.insight import build_report  # noqa: E402
from app.services.pricing import assess_price  # noqa: E402

SAMPLES = [
    "【淘宝】大促价保 https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To CZ321 "
    "「X影驰RTX5060TI/5070TI/5080/5090名人堂台式机电脑独立游戏显卡」",
    "【京东】https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@ MF8555 「Apple/苹果 AirPods 4」",
    "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia",
]


def run(text: str) -> None:
    print("\n" + "=" * 60)
    product = recognize_link(text)
    price = product["price"]["current_price"]
    print(f"🛒 识别商品（{product['source_platform']}）")
    print(f"   名称：{product['product_name'] or '未识别'}")
    print(f"   价格：{price if price is not None else '未识别（登录态屏蔽）'}")
    print(f"   ID  ：{product['product_id'] or '未识别'}  →  {product['canonical_url']}")
    print(f"   促销刺激：{', '.join(product['promotion_stimuli']) or '无'}")
    print(f"   缺失字段：{', '.join(product['recognition']['missing_fields']) or '无'}"
          f"  需用户确认：{product['recognition']['needs_user_confirmation']}")

    q = review_query(product)
    if not q:
        print("\n⚠️ 没识别出商品名（如拼多多无标题）→ 建议截图 OCR 或手动输入商品名后再翻评价。")
        return

    print(f"\n🔎 用关键词「{q}」去翻真实评价 …")
    report = build_report(q, use_search=True, allow_sample=True)
    print(f"🧊 {report.verdict}")
    print("✅ 真香点：" + "；".join(report.pros[:4]) if report.pros else "✅ 真香点：（暂无）")
    print("⚠️ 避雷点：" + "；".join(report.cons[:4]) if report.cons else "⚠️ 避雷点：（暂无）")
    print(f"📌 {report.sources_summary}")
    print(f"💬 冷静期定制问题（暗礁/缺点）：{report.cooldown_question()}")

    # 条件维度：好价 / 钱位（仅贵价 >阈值 触发）
    pv = assess_price(product)
    if pv:
        print(f"\n💰 行情/钱位（贵价触发，{pv.method}）：{pv.verdict} · 趋势 {pv.trend} — {pv.assessment}")
        print(f"   要不要等：{pv.wait_suggestion}")
        print(f"   钱·冷静问题：{pv.question}")


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    if args:
        run(" ".join(args))
    else:
        for s in SAMPLES:
            run(s)
    print()


if __name__ == "__main__":
    main()
