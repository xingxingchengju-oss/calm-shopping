# CLAUDE.md — 冷静购 (LengJingGou)

> 本文件是 Claude Code 每次会话加载的项目向导。改动项目结构、技术栈或约定时，请同步更新本文件。

## 一句话简介

**冷静购** 是一个「理性消费助手」Web 应用：在用户即将冲动下单前，引导其冷静一会儿再决定，从而减少冲动购物。对标 Forest（专注养成 App）的机制——**即时、温和、长期使用、成就感**——但场景换成「冲动消费」。产品强调陪伴感与情绪价值，正向反馈，而非简单地劝人「别买」。

完整需求见 [docs/PRD.md](docs/PRD.md)。

## 当前状态

🚧 **脚手架 + 首个模块已落地**。大部分模块仍是「目录结构 + 文档 + 占位」，但 **`insight`（口碑佐证 §5.4）已实现可运行**：

```
backend/app/integrations/review_search/   # search_reviews(): Brave(稳/需key) → DuckDuckGo(免费兜底)
backend/app/integrations/xhs_scraper/      # 包装 xhs_web.py 抓小红书笔记正文(best-effort)
backend/app/integrations/linkparser/       # 链接/分享文本→商品信息(平台/id/价格/名称)，实测可跑
backend/app/integrations/llm/              # 统一文本 LLM(OpenAI兼容/通义qwen3.7-plus) — 智能查询词 + 好坏提炼 + 五问/报告
backend/app/integrations/vision/           # 多模态识图(OpenAI兼容/通义qwen3.7-plus) — 截图→商品JSON
backend/app/services/recognition/          # §5.3 识别(链接侧 + 截图侧) + 商品理解补全(品类/耐用/查询词) + review_query
backend/app/services/insight/              # 分层取证 + 好坏提炼(LLM/规则) + 报告
backend/app/services/pricing/              # 条件维度：行情/钱位(贵价>阈值触发，近期价+趋势，不看历史最低)
backend/app/services/questionnaire/        # AI定制冷静五问(+条件钱位) + 作答打分 + 冷静报告(买/漂/放手)
```

密钥放 `backend/.env`（已 gitignore；模板见 `.env.example`）：`BRAVE_API_KEY`(稳定评价检索) + `LLM_API_KEY/LLM_BASE_URL/LLM_MODEL`(文本，当前通义 qwen3.7-plus；可切回 DeepSeek) + `VISION_API_KEY/VISION_BASE_URL/VISION_MODEL`(识图，通义 qwen3.7-plus；纯文本模型如 qwen3.7-max 不收图)。文本与识图共用同一把通义 key。`app` 导入时自动加载。

试用 UI（最简）：`cd backend && python -m uvicorn app.main:app --reload` → 浏览器开 `http://127.0.0.1:8000`（粘链接 **或上传截图** → 五问 → 报告；前端是 `app/web/index.html` 静态页）。命令行版完整主流程：`python app/services/questionnaire/demo.py`（链接→识别+商品理解→Brave真实评价→行情→AI五问→模拟作答→冷静报告）。仅链接→评价：`python demo_link_to_reviews.py`；单独口碑：`python app/services/insight/demo.py 破壁机`。数据策略见 `docs/proposals/data-acquisition-strategy.md`（已采纳方案 B）。

## 技术栈

| 层 | 选型 |
|----|------|
| 前端 | React 18 + Vite + TypeScript |
| 后端 | Python 3.11+ + FastAPI |
| AI | Anthropic Claude（消费分析、性格测评解读、冷静期文案）|
| 商品识别 | OCR（截图）+ 链接解析（淘宝 / 拼多多 / 京东）|
| 数据采集（辅助） | `tools/` 下的小红书爬虫（Python，用于抓真实评价/种草内容喂给分析）|

> 前后端分离，便于后续扩展为小程序 / App（PRD：Web 优先，可扩展）。

### Claude 模型选型（重要）

调用 Claude 时使用最新模型 ID，不要凭记忆写旧 ID：

- 高频、低延迟的分析/文案 → `claude-sonnet-4-6`（默认）
- 复杂推理（如多商品对比、深度人格画像） → `claude-opus-4-8`
- 极轻量分类/抽取 → `claude-haiku-4-5-20251001`

涉及 Claude API 用法（定价、参数、tool use、缓存等）时，先查 `/claude-api` skill，不要凭记忆作答。

## 仓库结构

```
冷静购/
├── CLAUDE.md                  # 本文件
├── README.md                  # 项目概览 / 快速开始
├── .gitignore
├── docs/                      # 设计文档
│   ├── PRD.md                 # 产品需求（从原始草稿重建，需与原件核对）
│   ├── architecture.md        # 系统架构
│   ├── data-model.md          # 数据模型
│   ├── api.md                 # 前后端 API 契约
│   └── tools/
│       └── xiaohongshu-scraper.md  # 小红书爬虫使用说明 + 已知问题
├── frontend/                  # React + Vite + TS（详见 frontend/README.md）
├── backend/                   # Python FastAPI（详见 backend/README.md）
└── tools/
    └── all-in-one-rednote-xiaohongshu-scraper-main/  # 第三方小红书爬虫（现成）
```

## 五大核心功能（PRD §5）

实现时前端 `frontend/src/features/<name>` 与后端 `backend/app/services/<name>` 一一对应：

| 模块 | 说明 | PRD |
|------|------|-----|
| `personality` | 消费性格测评（5~8 题 → 趣味标签 + 内部结构化数值） | §5.1 |
| `profile` | 用户记忆与个性化拆解（基础信息、偏好、行为模型） | §5.2 |
| `recognition` | 商品识别（截图 OCR / 平台链接解析） | §5.3 |
| `insight` | 真实口碑佐证（抓小红书等真实评价 → 提炼避雷/吃灰/替代信号） | §5.4 |
| `analysis` | 冷静消费分析（冲动等级、动机、可替代性、是否进冷静期，引用口碑佐证） | §5.5 |
| `cooldown` | 冷静期（决策状态机：买/放弃/加入冷静；短冷静 3 分钟互动） | §5.6 |
| `wishlist` | 愿望清单 / 沉淀池 | §5.7 |
| `gamification` | 养成与成就（以「完成冷静」为主激励；不照搬 Forest 树/森林视觉） | §5.8 |

> `insight` 抓取走 `integrations/xhs_scraper`（封装 `tools/` 爬虫），提炼/编排走 `services/insight`，需异步 + 缓存 + 失败优雅降级。

## AI 定制冷静五问（重要产品方案）

用户主流程更新为：**丢入商品链接/截图 → 识别商品信息 → 后台同步获取真实口碑佐证 → AI 生成 5 个定制冷静问题 → 用户轻量回答 → 结合回答 + 风评 + 用户画像生成定制报告 → 用户选择购买 / 继续漂着 / 放手**。

这 5 个问题不应写死成固定问卷。推荐方案是：**固定判断维度，AI 定制具体问法、选项和交互形式**。这样既有 AIGC 个性化亮点，又能避免 AI 自由发挥导致跑题、重复、说教或前端无法渲染。

五个稳定维度：

| 维度 | 目的 | AI 定制依据 |
|------|------|-------------|
| 浪头：为什么现在想买 | 识别冲动来源，是刚需、低价、颜值、种草、限时还是情绪奖励 | 用户画像、营销词、价格、购买时间 |
| 落点：会进入哪个真实场景 | 验证用户能否说出具体使用场景，而不是停留在想象 | 商品品类、用户生活偏好、历史高风险品类 |
| 水深：会不会真的高频使用 | 预测使用频率和吃灰风险 | 商品耐用度、评论中的闲置/吃灰信号、用户历史行为 |
| 暗礁：缺点能不能接受 | 把真实评价里的缺点变成具体容忍度问题 | `insight` 提炼出的 cons、避雷点、差评片段 |
| 回岸：不立刻买会失去什么 | 拆掉“现在不买就亏了”的紧迫感，帮助用户拿回决策权 | 优惠强度、价格、冷静期策略、替代品 |

实现时可新增 `services/questionnaire` 或并入 `services/analysis`：输入 `product + profile + insight_report`，输出结构化 JSON。每题至少包含 `dimension`、`question`、`interaction_type`、`options`、`evidence`、`score_key`。后端必须做 schema 校验；AI 失败时用模板兜底。

前端表达不要叫“问卷”，更适合叫「豚豚的 5 个冷静小问题」「下单前 3 分钟」「让它在河里漂一会儿」。题型可多变：气泡选择、滑块、二选一、短句补全、漂流瓶卡片。每题控制在一句话，整套控制在 90 秒到 3 分钟内。

报告口径：AI 不替用户下结论，而是总结「风评里看到什么」「你的回答暴露了什么信号」「现在更适合的动作」。动作建议保持三选一：**买下它 / 继续漂着 / 放手啦**。语气遵守产品红线：陪伴、温和、正向反馈，不说教、不制造愧疚。

## 小红书爬虫工具（速记）

位置：`tools/all-in-one-rednote-xiaohongshu-scraper-main/`。Python CLI，4 种模式：`search` / `comment` / `profile` / `userPosts`，输出 JSON。

```bash
cd tools/all-in-one-rednote-xiaohongshu-scraper-main/src
python main.py --mode search --keyword "保温杯" --max-items 20
```

⚠️ **现成代码有 bug，跑之前要修**（每个 .py 首行被损坏成 `thonimport ...`；`rate_limit.py` 被截断缺 `wait()`；内置 API URL 多半不是可用端点）。详见 [docs/tools/xiaohongshu-scraper.md](docs/tools/xiaohongshu-scraper.md)。

## 产品/设计红线（PRD §8、§9）

写功能与文案时务必遵守：

- **不教育用户「你不应该买」**——通过呈现价值信息让用户自己有选择地反思。
- **不制造愧疚感**——想买不是错；个性化提示像朋友而非系统监控。
- **正向反馈**——每次冷静都给可感知的成就/奖励，强调陪伴。
- **隐私优先**——明确告知会记录偏好；用户可查看/修改/删除自己的画像与标签。
- **测评有趣**——首屏做成「性格测试」体验，避免说教/审问感。

## 约定

- 文档与面向用户文案用**中文**；代码标识符用英文。
- 后端模块边界按「核心功能」划分（见上表），前后端命名保持一致。
- 新增模块时：建好目录 + 写一个说明 README（职责、输入输出、对应 PRD 章节），再写实现。
