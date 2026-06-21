# linkparser · 商品链接解析（PRD §5.3 链接侧）

来源：朋友提供的 `lengjingou_product_parser.py`（原在 `temp/`），已归位 + 加实时抓取封装。

## 职责

分享文本 / 商品链接 → 统一商品对象（平台、商品 id、清洗后 canonical_url、商品名、价格、促销刺激、店铺、主图、SKU、识别置信度与缺失字段）。**不编造字段**，拿不到就记进 `recognition.missing_fields`。

## 用法

```python
from app.integrations.linkparser import parse_product
product = parse_product("【淘宝】大促 https://e.tb.cn/xxx 「商品名」")   # fetch=True 会联网补 id/价格
```

## 文件

| 文件 | 作用 |
|------|------|
| `parser.py` | 核心：平台识别、商品 id 提取、canonical 化、外部字段归一化、`build_product_output` |
| `fetcher.py` | 实时跟随短链跳转，从最终 URL / HTML 恢复 id/价格；并入渲染兜底 |
| `__init__.py` | 门面 `parse_product()` |
| `browser_render_metadata.json` | 登录态屏蔽字段的人工/浏览器渲染兜底（key=原始短链） |
| `examples/` | 三个链接的示例输出与字段模板（参考） |

## 能力边界（2026-06 实测）

| 平台 | 商品名 | 商品 id | 价格 | 备注 |
|------|--------|---------|------|------|
| 淘宝/天猫 | ✅ 分享标题 | ✅ 短链恢复 | ✅ 短链参数 | 主图/店铺/品类登录态屏蔽 |
| 京东 | ✅ 分享标题 | ✅ 短链恢复 | ⚠️ 需渲染兜底 | 价格未登录脱敏(¥7??) |
| 拼多多 | ❌ 无标题 | ✅ goods_id | ❌ | 详情 needLogin，名缺失→需 OCR/手填 |

> 对 §5.4「翻真实评价」最关键的是**商品名**——淘宝/京东分享文本里的「标题」即可拿到，所以即使详情被屏蔽，链接→评价的链路依然成立。价格/主图等是增强项。

## 已知风险 / 下一步

- 京东价格依赖手工 `browser_render_metadata.json`；产品化需把浏览器渲染做成服务，或接官方/授权接口。
- 淘宝主图/店铺/品类、拼多多详情需登录态/官方接口/截图 OCR。
- 裸链接（无分享标题）拿不到商品名 → 走截图 OCR 或让用户手填。
