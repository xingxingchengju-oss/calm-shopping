# 冷静购 · LengJingGou

> 一个理性消费助手 Web 应用：在你即将冲动下单前，陪你冷静一会儿再决定。对标 Forest，把「专注养成」换成「冷静消费养成」。

AIGC2026 参赛项目。

## 它解决什么

电商平台用低价、限时、满减、直播、种草不断制造「现在就买」的冲动。冷静购在你想买的那一刻介入：

1. **识别商品** —— 上传截图（OCR）或粘贴淘宝/拼多多/京东链接。
2. **冷静分析** —— 判断冲动等级、当前购买动机、是否可替代、是否建议进入冷静期。
3. **冷静期** —— 低价冲动品 3 分钟，中高价 24 小时，贵价 3 天沉淀。
4. **养成与成就** —— 每完成一次冷静、每放弃一次冲动消费都给正向反馈，连续使用形成 streak。

配合「消费性格测评」与「用户记忆」，让建议越来越懂你——像朋友陪伴，而不是系统监控。

## 技术栈

- **前端**：React + Vite + TypeScript （见 [frontend/README.md](frontend/README.md)）
- **后端**：Python + FastAPI （见 [backend/README.md](backend/README.md)）
- **AI**：Anthropic Claude（消费分析 / 测评解读 / 冷静期文案）
- **商品识别**：OCR + 平台链接解析
- **辅助数据**：小红书爬虫（见 [docs/tools/xiaohongshu-scraper.md](docs/tools/xiaohongshu-scraper.md)）

## 文档

| 文档 | 内容 |
|------|------|
| [docs/PRD.md](docs/PRD.md) | 产品需求（从草稿重建，请与原件核对） |
| [docs/architecture.md](docs/architecture.md) | 系统架构 |
| [docs/data-model.md](docs/data-model.md) | 数据模型 |
| [docs/api.md](docs/api.md) | 前后端 API 契约 |
| [CLAUDE.md](CLAUDE.md) | 给 Claude Code 的项目向导 |

## 当前状态

🚧 脚手架阶段：仅目录结构 + 文档 + 占位说明，尚无可运行代码。下一步按 PRD 五大核心功能逐个实现。

## 快速开始（实现后）

```bash
# 前端
cd frontend && npm install && npm run dev

# 后端
cd backend && python -m venv .venv && . .venv/Scripts/activate
pip install -r requirements.txt && uvicorn app.main:app --reload
```

> 以上命令是规划中的目标用法，对应代码尚未编写。


## 贴纸成就系统二期

- 小院贴纸大厅进入 web/sticker-wall.html，场景编辑器为 web/sticker.html。
- 游客只拥有默认贴纸；游客布局使用 calm_sticker_scene_layouts.v2.guest，旧 v1 布局不会迁移或删除。
- 登录用户的贴纸所有权、成就统计和场景布局使用 Supabase；贴纸购买通过数据库 RPC 原子扣减河币并授予贴纸。
- 数据库 migration 位于 supabase/migrations/20260630_sticker_phase2.sql，已在当前 web/js/config.js 对应的 Supabase 项目部署。
- 已验证 5 张二期表、12 条贴纸定义、5 个 RLS 策略、全部 5 张表启用 RLS，以及 4 个公开 RPC。
- 未使用真实用户数据执行购买破坏性测试；如需验证并发购买和跨账号行为，应创建专门测试账号。
