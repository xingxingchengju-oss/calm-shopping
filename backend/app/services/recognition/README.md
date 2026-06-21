# recognition · 商品识别（PRD §5.3）

把「链接 / 分享文本 / 截图」识别成统一商品对象，并给出「去翻真实评价」的关键词。

## 当前实现

- `recognize_link(text_or_url, fetch=True, enrich=True)` → 统一商品对象（封装 `integrations/linkparser`）；`enrich` 时自动调用商品理解补全。
- `understand_product(product)` → 用 LLM 补全链接常缺/脏的字段：回填 `product_category`，并产出 `product["understanding"] = {durability, usage_pattern_prior, core_query, normalized_name, is_bundle_or_set}`。修复「品类缺失」与「整机/配件」漂移。`durability/usage_pattern_prior` 仅为先验。
- `review_query(product)` → 挑搜评价的关键词：优先用 `understanding.core_query`，否则 LLM 抽词 / 规则兜底。

## 待接入

- 截图 OCR / 多模态识别（§5.3 截图侧）：截图 → 价格 + 营销关键词 + 品类大类（置信度低则让用户一键勾选）。

## 在主流程的位置

```
recognize_link(链接/分享文本)  →  product
review_query(product)         →  keyword  ──▶  services/insight.build_report(keyword)  # §5.4 翻真实评价
```

端到端演示：`backend/demo_link_to_reviews.py`。
