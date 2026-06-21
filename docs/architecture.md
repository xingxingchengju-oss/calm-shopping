# 系统架构

> 脚手架阶段的目标架构。代码尚未实现，本文件描述各部分如何协作。

## 总览

```
┌─────────────────────────────────────────────────────────┐
│                   前端 (React + Vite + TS)                │
│  pages: 首页 / 测评 / 识别 / 分析结果 / 冷静期 / 沉淀池 / 成就 │
│  features ── api 层 ──▶ 后端                                │
└───────────────────────────┬─────────────────────────────┘
                            │ HTTP (JSON, REST)
┌───────────────────────────▼─────────────────────────────┐
│                   后端 (Python + FastAPI)                 │
│  api/  ─▶  services/  ─▶  integrations/                   │
│                                                           │
│  services: personality · profile · recognition ·         │
│            analysis · cooldown · wishlist · gamification  │
│  integrations:                                            │
│     ├── claude      (Anthropic SDK — 分析/测评/文案)       │
│     ├── ocr         (截图文字识别)                         │
│     ├── linkparser  (淘宝/拼多多/京东 链接解析)            │
│     └── xhs_scraper (调用 tools/ 下小红书爬虫，可选)       │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────▼─────────────┐
              │   存储 (MVP：SQLite/文件)  │
              │   用户画像 / 沉淀池 / 成就  │
              └───────────────────────────┘
```

## 请求流：截图识别 → 分析 → 冷静期

1. 前端 `features/recognition` 上传截图 → `POST /api/recognition/image`。
2. 后端 `services/recognition` 调 `integrations/ocr` 取文字，规则抽取「名称 / 价格 / 平台 / 营销信息」。
3. 前端拿到商品结构化信息 → `POST /api/analysis`。
4. `services/analysis` 组合 `商品信息 + 用户画像(profile)` 构造 prompt，调 `integrations/claude`（默认 `claude-sonnet-4-6`）输出冲动等级、动机、是否可替代、是否建议冷静期。
5. 用户选择开启冷静期 → `services/cooldown` 按价格/等级映射 3 分钟 / 24 小时 / 3 天，写入 `wishlist`（沉淀池）。
6. 冷静完成 / 放弃购买 → `services/gamification` 记得值、更新 streak、检查成就解锁。

## 关键决策

- **前后端分离**：PRD「Web 优先，可扩展小程序/App」——后端纯 API，前端可替换为小程序壳。
- **Python 后端**：可直接复用 `tools/` 下的 Python 小红书爬虫，且 Anthropic Python SDK 接 Claude/OCR 顺手。
- **服务按核心功能切分**：与 PRD §5 一一对应，便于分工和迭代。
- **Claude 调用集中在 `integrations/claude` + `prompts/`**：prompt 模板与业务解耦，便于调优。模型选型见 [CLAUDE.md](../CLAUDE.md#claude-模型选型重要)。

## 数据获取（口碑佐证 §5.4）— 待拍板

口碑佐证的取数方式（实时爬虫 / 用户提供 / AI 先验 / 授权 API）**尚未确定**。实测已证明匿名实时抓「指定商品评论」在小红书、京东均被反爬封锁，候选方案与权衡见 `docs/proposals/data-acquisition-strategy.md`。定稿后再在此补架构图。

## MVP 存储

- MVP 阶段可用 SQLite 或本地 JSON（PRD §11 待确认：画像存本地还是账号体系）。
- 核心实体见 [data-model.md](data-model.md)。

## 待定（PRD §11）

- 冷静期时长固定还是动态。
- OCR 用规则还是多模态。
- 画像存本地还是后端账号。
