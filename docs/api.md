# 前后端 API 契约（草案）

> REST + JSON。脚手架阶段，仅约定接口形状，实现时以代码为准。基础前缀：`/api`。

## 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/login` | 手机号 / 扫码登录（PRD §6.1），返回 token |

## 消费性格测评（PRD §5.1）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/personality/questions` | 拉取测评题目（5~8 题） |
| POST | `/api/personality/submit` | 提交答案 → 返回人格标签、雷达图、冲动触发点、冷静策略 |

## 用户画像（PRD §5.2 / §9）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/profile` | 查看自己的消费画像 |
| PATCH | `/api/profile` | 修改画像（用户可改/删，§9 隐私原则） |
| DELETE | `/api/profile` | 删除画像数据 |

## 商品识别（PRD §5.3）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/recognition/image` | 上传截图（multipart）→ OCR 抽取商品信息 |
| POST | `/api/recognition/link` | 提交淘宝/拼多多/京东链接 → 解析商品信息 |

请求/响应示例（link）：

```jsonc
// POST /api/recognition/link
{ "url": "https://item.jd.com/100012043978.html" }

// 200
{
  "source": "jd",
  "name": "某保温杯 500ml",
  "price": 89.0,
  "category": "家居",
  "marketing_signals": ["限时", "满减"]
}
```

## 冷静消费分析（PRD §5.4）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/analysis` | 入参商品信息 → 返回冲动等级、动机、可替代性、是否建议冷静期、陪伴文案 |

```jsonc
// 200
{
  "impulse_level": "high",
  "motivation": "情绪驱动 + 限时折扣",
  "replaceable": true,
  "is_low_price_impulse": false,
  "suggest_cooldown": true,
  "linked_triggers": ["限时", "种草"],
  "message": "你不是不能买，只是可以先把决定权留下来，再回来看看。"
}
```

## 冷静期（PRD §5.5）

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/cooldown` | 开启冷静期（duration: three_minutes / 24_hours / 3_days） |
| GET | `/api/cooldown/{id}` | 查询冷静期状态与剩余时间 |
| POST | `/api/cooldown/{id}/interact` | 3 分钟冷静的轻互动（情绪打分等） |
| POST | `/api/cooldown/{id}/resolve` | 结束：purchased / abandoned |

## 沉淀池（PRD §5.6）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/wishlist` | 列出沉淀池条目 |
| POST | `/api/wishlist` | 加入沉淀池 |
| PATCH | `/api/wishlist/{id}` | 更新状态：still_want / cooled_down / abandoned / purchased |

## 成就 / 养成（PRD §5.7）

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/achievements` | 得值、streak、省下金额、徽章 |
