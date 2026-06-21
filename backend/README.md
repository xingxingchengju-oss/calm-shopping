# 后端 · 冷静购

Python 3.11+ + FastAPI。纯 API 服务，给前端（及未来小程序/App）提供能力。

> 🚧 脚手架阶段：仅目录结构 + 说明，**尚无代码**，未初始化 `requirements.txt`。下方为规划中的结构与依赖。

## 计划依赖（实现时再 `pip install`）

- `fastapi` / `uvicorn[standard]`
- `pydantic` —— 请求/响应模型（对应 docs/data-model.md）
- `anthropic` —— Claude SDK（分析/测评解读/冷静期文案）
- `httpx` —— 解析商品链接、调外部服务
- OCR：`pytesseract` + `Pillow`，或多模态走 Claude（PRD §11 待定）
- 存储（MVP）：`sqlite3`（标准库）或 `sqlmodel`
- 测试：`pytest`

## 目录结构（规划）

```
backend/
├── app/
│   ├── main.py            # FastAPI 入口（挂载路由）
│   ├── api/               # 路由层，按资源分文件（见 docs/api.md）
│   ├── core/              # 配置、依赖注入、鉴权、日志
│   ├── models/           # 持久化模型（ORM / 数据类）
│   ├── schemas/          # pydantic 请求/响应 schema
│   ├── services/         # 业务逻辑，按 PRD §5 核心功能切分
│   │   ├── personality/  # §5.1 消费性格测评
│   │   ├── profile/      # §5.2 用户记忆与个性化
│   │   ├── recognition/  # §5.3 商品识别（OCR / 链接）
│   │   ├── analysis/     # §5.4 冷静消费分析（调 Claude）
│   │   ├── cooldown/     # §5.5 冷静期（3min/24h/3天）
│   │   ├── wishlist/     # §5.6 愿望清单/沉淀池
│   │   └── gamification/ # §5.7 养成与成就
│   ├── integrations/     # 外部能力封装
│   │   ├── claude/       # Anthropic SDK 客户端
│   │   ├── ocr/          # 截图文字识别
│   │   ├── linkparser/   # 淘宝/拼多多/京东 链接解析
│   │   └── xhs_scraper/  # 封装 tools/ 下小红书爬虫（可选）
│   └── prompts/          # Claude prompt 模板（与业务解耦，便于调优）
└── tests/
```

## 模块职责速查

| 模块 | 输入 | 输出 | 备注 |
|------|------|------|------|
| personality | 测评答案 | 人格标签 + 雷达图 + 触发点 + 策略 | 结果写入 profile |
| profile | 历次行为 | 持续更新的消费画像 | 用户可查/改/删（§9） |
| recognition | 截图 / 链接 | 结构化商品信息 | OCR 结果允许用户修正 |
| analysis | 商品 + 画像 | 冲动等级/动机/可替代/建议 + 陪伴文案 | 调 Claude，prompt 在 prompts/ |
| cooldown | 商品 + 等级 | 冷静期会话 | 价格/等级 → 时长映射 |
| wishlist | 商品 + 冷静期 | 沉淀池条目 + 状态流转 | still_want→cooled_down→abandoned/purchased |
| gamification | 冷静/放弃事件 | 得值/streak/徽章/省下金额 | 对标 Forest |

## Claude 用法

集中在 `integrations/claude` + `prompts/`。模型选型见 [CLAUDE.md](../CLAUDE.md#claude-模型选型重要)：默认 `claude-sonnet-4-6`，复杂推理用 `claude-opus-4-8`。
