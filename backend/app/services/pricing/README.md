# pricing · 行情/钱位维度（条件触发，重时效）

「AI 定制冷静五问」之外的**条件第 6 维**：只在**贵价商品**（`current_price > 阈值`，默认 300，可配 `LJG_PRICE_DIM_THRESHOLD`）时出现；便宜商品返回 `None`，维度不出现（题量动态化）。

## 做什么

```
assess_price(product) →  PriceVerdict | None
  贵价? ─否─▶ None
       └─是─▶ Brave 搜【近期价/走势/比价】片段 → DeepSeek 判：
                ① 相对近期行情：偏贵/正常/划算
                ② 趋势：涨/跌/平稳
                ③ 趋势感知的「要不要等」
              → 一个「钱」框架的冷静问题
```

## 设计红线（为什么不看历史最低价）

- **历史最低价是误导性锚点**：像显卡这种上行周期的商品，历史低点回不去，拿当前价跟它比永远「偏高、再等」，反而可能等到更贵。所以用 **近期行情 + 趋势** 判，要**时效性**。
- **等待建议必须趋势感知**：涨价/紧俏 → 明说「等不一定更便宜、甚至更贵」，把问题拉回「你是不是真需要」；下行/临近迭代 → 可建议等；已是近期低 → 现在合适。
- **不做精确未来价格预测**（猜测、易误导、踩红线「不编造」）。大促日历只在「趋势会降」时作次要佐证。

## 复用

- 检索：`integrations/review_search.search_prices`（角度=近期价/走势/比价；Brave 稳定，DDG 兜底）。
- 判断：`integrations/llm`（DeepSeek；无 key 走规则兜底）。

## 输出 `PriceVerdict`

`verdict`(偏贵/正常/划算/未知) · `trend`(涨/跌/平稳/不确定) · `assessment` · `wait_suggestion`(趋势感知) · `next_sale`/`days_to_sale`(次要) · `question`(钱·冷静问题) · `sources`。
