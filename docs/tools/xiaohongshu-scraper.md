# 小红书爬虫使用说明 + 实测可行性

工具位置：`tools/all-in-one-rednote-xiaohongshu-scraper-main/`

本文档分两部分：
- A. 原始第三方仓库（`src/main.py` 等）—— **端点已失效，不可用**。
- B. 我们新增的可用模块 `src/xhs_web.py` —— 基于公开页面 SSR，**实测可跑**。
- C. 实测结论与对 §5.4「真实口碑佐证」的影响（重要）。

---

## A. 原始仓库（不可用）

Python CLI，4 种模式（`search`/`comment`/`profile`/`userPosts`）。代码有三处问题：

1. 每个 `.py` 首行被损坏成 `thonimport ...`（应为 `import ...`，是 ` ```python ` 代码块头残留）。
2. `utils/rate_limit.py` 被截断，缺各 extractor 调用的 `wait()` 方法 → 运行必崩。
3. **`settings.json` 里的 `web_api/sns/*` 端点已失效**。实测：
   ```
   GET https://www.xiaohongshu.com/web_api/sns/v1/search/notes  →  HTTP 500
   body: "create invoker failed, service: jarvis-gateway-default"
   ```
   即使修好 1、2，也拿不到数据。真实小红书 API（`edith.xiaohongshu.com`）需要登录 Cookie + `x-s`/`x-t` 签名，匿名不可达。

> 结论：原始仓库当参考即可，不要在它基础上继续开发。

## B. 可用模块 `xhs_web.py`（基于公开页面 SSR）

原理：小红书把数据服务端渲染进公开 HTML 的 `window.__INITIAL_STATE__`，无需登录即可解析。

```bash
cd tools/all-in-one-rednote-xiaohongshu-scraper-main/src

# 1) 抓公开 explore feed（真实笔记：id/标题/赞/作者/token）
python xhs_web.py feed --limit 10

# 2) feed + 每条笔记的完整正文（§5.4 想要的形状）
python xhs_web.py feed --bodies --limit 5

# 3) 抓单篇笔记正文（需要该笔记的 xsec_token，从 feed/分享链接里拿）
python xhs_web.py note --url "https://www.xiaohongshu.com/explore/<id>?xsec_token=...&xsec_source=pc_feed"

# 4) 关键词搜索（需登录）—— 见下方说明，匿名返回空
XHS_COOKIE="<你的登录cookie>" python xhs_web.py search --keyword "破壁机" --limit 10
```

输出：`data/xhs_web_<mode>_<时间戳>.json`（或 `--output PATH`）。依赖：仅 `requests`。

### 各能力实测（2026-06，匿名无登录）

| 能力 | 匿名可用？ | 说明 |
|------|-----------|------|
| explore feed（笔记列表） | ✅ | 一次约 20+ 条真实笔记 |
| 笔记**正文** + 赞/收藏/评论数/标签 | ✅ | 需该笔记的 `xsec_token`；token 过期则正文为空（已优雅处理） |
| 关键词**搜索** | ❌ | 结果由前端签名 XHR 加载，**不在 SSR**，匿名为空 → 需登录 Cookie |
| **评论** | ❌ | 同样走签名 XHR，不在 SSR → 需登录 Cookie |

**实测样例**（`feed --bodies --limit 4`）：成功抓到 4 条笔记，3 条含完整正文（如「淄博·八大局紫米饼…」赞 2 万、评论 1241），1 条因 token 过期正文为空（已降级处理）。证明「抓真实笔记正文」机制可行。

## C. 实测结论 → 对 §5.4 的影响（重要）

跨平台实测都指向同一结论：**匿名、实时抓取「指定商品」的真实评论，已不是稳定可依赖的路线。**

- 小红书：搜索、评论均需登录；匿名只能抓随机 feed，**无法按商品定向**。
- 京东：曾经公开的评论 API `club.jd.com/comment/productPageComments.action` 实测返回 `系统繁忙`（反爬拦截），匿名也拿不到。
- 淘宝 / 拼多多：封锁更严。

**建议（待团队拍板，未写入 PRD；完整讨论与权衡见 [`../proposals/data-acquisition-strategy.md`](../proposals/data-acquisition-strategy.md)）**：可考虑不把实时爬虫当核心数据源，改为分层取数——

1. **永远可用**：Claude 基于「品类 + 商品名 + 价格 + 营销话术」生成结构化佐证（常见智商税点 / 吃灰率 / 适用人群 / 同类替代 / 典型后悔理由）——模型先验，零反爬零合规风险。
2. **用户提供**：用户粘贴 / 截图评论 → AI 总结差评与风险（无登录、无反爬）。
3. **机会性增强**：能抓到真实笔记正文时叠加为「真实世界佐证」并标注来源；抓不到优雅降级，前端不空白。
4. **仅 Demo / 本地授权**：用户在本地粘贴自己的 Cookie（`XHS_COOKIE`）解锁搜索 / 评论，本地运行、绝不服务端存储。

> 在 backend 里调用：封装到 `backend/app/integrations/xhs_scraper`（复用 `xhs_web.py`），提炼/编排走 `backend/app/services/insight`，务必异步 + 缓存 + 失败降级。

## 合规

遵守目标平台频率限制与 robots、仅在授权范围内采集；`xhs_web.py` 内置请求间隔（默认 1.5s）。不存储 / 不展示可定位到具体个人的敏感信息。
