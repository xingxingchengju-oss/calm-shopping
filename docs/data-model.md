# 数据模型（草案）

> MVP 草案，字段会随实现调整。命名用英文，便于代码对应。

## User 用户

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 用户 ID |
| phone | string | 手机号（登录，PRD §6.1） |
| created_at | datetime | 注册时间 |

## ConsumptionProfile 消费画像（PRD §5.1 / §5.2）

测评结果 + 长期沉淀的偏好。用户可查看/修改/删除（PRD §9）。

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | string | 关联用户 |
| personality_tags | string[] | 消费人格标签，如「奖励型购物」「低价心动型」 |
| radar | object | 冲动雷达图维度：价格敏感度 / 情绪化程度 / 社交种草率 / 囤货安全感 / 价值即正义 |
| trigger_points | string[] | 主要冲动触发点：低价 / 限时 / 满减 / 直播 / 种草 / 情绪化 / 从众 |
| common_platforms | string[] | 常用平台：taobao / pdd / jd |
| risk_categories | string[] | 高风险品类：服饰 / 美妆 / 零食 / 家居 / 数码 … |
| sensitive_price_band | object | 容易「不到 X 就买」的价格带 |
| preferred_tone | enum | 偏好语气：温柔陪伴 / 理性分析 / 轻松调侃 / 直接戳穿 |
| long_term_goal | string | 省钱 / 减少囤货 / 控制情绪消费 / 提升生活品质 |
| updated_at | datetime | 最近更新 |

## Product 商品（PRD §5.3）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 商品记录 ID |
| source | enum | 来源平台：taobao / pdd / jd / screenshot / manual |
| source_url | string? | 原始链接（链接识别时） |
| name | string | 商品名称 |
| price | number | 价格 |
| category | string | 品类（可由用户修正大类） |
| marketing_signals | string[] | 页面营销刺激：折扣 / 限时 / 满减 / 低价 / 高销量 |
| raw_ocr_text | string? | 截图 OCR 原文（截图来源时） |
| created_at | datetime | 创建时间 |

## ImpulseAnalysis 冷静分析（PRD §5.4）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 分析 ID |
| product_id | string | 关联商品 |
| user_id | string | 关联用户 |
| impulse_level | enum | 冲动等级：low / medium / high |
| motivation | string | 当前购买动机判断 |
| replaceable | bool | 是否可替代 / 已有同类 |
| is_low_price_impulse | bool | 是否低价冲动品 |
| suggest_cooldown | bool | 是否建议进入冷静期 |
| linked_triggers | string[] | 命中的用户冲动触发点 |
| message | string | 温和陪伴式文案（Claude 生成） |

## CooldownSession 冷静期（PRD §5.5）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 会话 ID |
| product_id | string | 关联商品 |
| user_id | string | 关联用户 |
| duration | enum | three_minutes / 24_hours / 3_days |
| started_at | datetime | 开始时间 |
| ends_at | datetime | 结束时间 |
| status | enum | active / completed / abandoned_purchase / purchased |
| micro_interactions | object[] | 3 分钟冷静的轻互动记录（情绪打分 / 本月已花 / 深呼吸） |

## WishlistItem 沉淀池条目（PRD §5.6）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 条目 ID |
| product_id | string | 关联商品 |
| user_id | string | 关联用户 |
| added_at | datetime | 加入时间 |
| cooldown_session_id | string? | 关联冷静期 |
| status | enum | still_want / cooled_down / abandoned / purchased |

## Achievement 成就 / 养成（PRD §5.7）

| 字段 | 类型 | 说明 |
|------|------|------|
| user_id | string | 关联用户 |
| points | number | 累计得值 |
| streak_days | number | 连续冷静天数 |
| saved_amount | number | 累计「省下」金额 |
| badges | string[] | 已解锁徽章 |
| abandoned_count | number | 沉淀池放弃件数 |

## 实体关系

```
User 1──1 ConsumptionProfile
User 1──* Product 1──1 ImpulseAnalysis
            └──1 CooldownSession ──1 WishlistItem
User 1──1 Achievement
```
