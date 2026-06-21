# 前端 · 冷静购

React 18 + Vite + TypeScript。移动优先的 Web 应用（PRD：Web 优先，可扩展小程序/App）。

> 🚧 脚手架阶段：仅目录结构 + 说明，**尚无代码**，未初始化 `package.json`。下方为规划中的结构与依赖。

## 计划依赖（实现时再 `npm install`）

- `react` / `react-dom`
- `react-router-dom` —— 页面路由
- `@tanstack/react-query` 或 `axios` —— 调后端
- 状态管理：`zustand`（轻量，适合 MVP）
- UI：`tailwindcss` 或组件库（待定）
- `vite` / `typescript` / `@vitejs/plugin-react`

## 目录结构（规划）

```
frontend/
├── public/                 # 静态资源
└── src/
    ├── pages/              # 路由级页面
    │   ├── Home            # 首页（入口：截图/链接识别）
    │   ├── Personality     # 消费性格测评（首屏体验）
    │   ├── Recognition     # 商品识别（上传截图 / 粘贴链接）
    │   ├── Analysis        # 冷静分析结果
    │   ├── Cooldown        # 冷静期（3 分钟轻互动 / 倒计时即成就）
    │   ├── Wishlist        # 愿望清单 / 沉淀池
    │   └── Achievements    # 养成与成就
    ├── features/           # 业务模块，与后端 services 一一对应
    │   ├── personality/    # 测评题目、雷达图、人格标签
    │   ├── profile/        # 用户画像查看/修改
    │   ├── recognition/    # 截图上传、链接解析 UI
    │   ├── analysis/       # 冲动等级、陪伴文案展示
    │   ├── cooldown/       # 冷静期交互
    │   ├── wishlist/       # 沉淀池列表与状态
    │   └── gamification/   # 得值、streak、徽章
    ├── components/         # 通用 UI 组件
    ├── api/                # 后端接口封装（见 docs/api.md）
    ├── store/              # 全局状态（zustand）
    ├── hooks/              # 自定义 hooks
    ├── types/             # TS 类型（与 docs/data-model.md 对齐）
    ├── utils/              # 工具函数
    └── assets/            # 图片/字体等
```

## 设计红线（务必遵守，PRD §8/§9）

文案与交互不教育、不制造愧疚、强调陪伴和正向反馈；测评做成「性格测试」体验，避免填表/审问感。详见 [CLAUDE.md](../CLAUDE.md#产品设计红线prd-89)。
