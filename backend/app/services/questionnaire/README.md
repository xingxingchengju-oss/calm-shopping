# questionnaire · AI 定制冷静五问（+条件钱位）

对应 CLAUDE.md「AI 定制冷静五问」。把 recognition / insight / pricing 的产出，组装成「丢链接 → 五问 → 作答 → 报告（买下它/继续漂着/放手啦）」。

## 对外接口

```python
from app.services.questionnaire import generate_questionnaire, generate_report, score_answer, Answer
quiz   = generate_questionnaire(product, insight, pricing=None)   # → Questionnaire
report = generate_report(product, insight, pricing, answers)      # → Report
```

## 五个固定维度（+ 条件第 6 维）

| id | 维度 | 默认交互 | score_key | 证据 | 触发 |
|----|------|---------|-----------|------|------|
| crest | 浪头 为什么现在买 | 多选气泡 | impulse_source | promotion_stimuli+price | 总是 |
| landing | 落点 用在哪场景 | 短句补全 | scenario_clarity | category+understanding | 总是 |
| depth | 水深 会不会常用 | 滑块 | usage_frequency | usage_pattern_prior+闲置信号 | 总是 |
| reef | 暗礁 缺点能否接受 | 二选一 | con_tolerance | insight.cons 最显著那条 | 总是 |
| shore | 回岸 不买失去啥 | 单选气泡 | urgency_resilience | pricing.trend+promo | 总是 |
| money | 钱位 值不值这价 | 二选一 | price_acceptance | pricing | **pricing 非 None**（贵价≥300） |

## 关键设计

- **维度/score_key/选项分由 SPEC 固定**（`dimensions.py`），AI 只定制 question 文案 / question_reason / evidence / label 措辞 / 在枚举内选交互。打分透明、可手算。
- **一次 LLM 生成全部题** → 逐题 `validate_question` → 不合格回退该维度模板（`generator.py`）。无 LLM → 全走模板，照样完整。
- 每题 `intent` 约束问法不跑题（尤其 slider 必问使用频率）。
- 交互枚举：`bubble_single / bubble_multi / two_choice / slider / sentence_complete`。

## 报告（`report.py`）

- **soft score**：Σ 各题分（暗礁/水深权重已含在更大分值里）。
- **lean**：`≤-3 放手 / ≥+3 买 / 否则继续漂着`（我们算，确定性）；三动作**始终全给**，lean 仅高亮。
- **confidence**：high/medium/low（识别+口碑+品类质量），低置信前端可弱化结论。
- **红线**：不替用户下结论、不制造愧疚、**不制造确定性**（只说「更偏向」）。

## 跑

```bash
cd backend
python app/services/questionnaire/demo.py                # 显卡样例(含钱位)，自动模拟作答
python app/services/questionnaire/demo.py --interactive  # 命令行真实作答
```
依赖 `.env` 的 `BRAVE_API_KEY`(真实评价)、`LLM_API_KEY`(DeepSeek)；不配也能用样本+模板跑。

## 待办（本轮未做）

前端渲染、answers 回写 profile、动态题量、截图 OCR。
