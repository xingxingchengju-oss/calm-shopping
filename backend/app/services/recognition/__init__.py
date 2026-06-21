"""
§5.3 商品识别（服务层）。链接/分享文本侧 + 截图侧（多模态视觉）。两条路返回同构商品对象，下游统一吃。

recognize_link(text)       → 链接/分享文本 → 统一商品对象（封装 integrations/linkparser）
recognize_screenshot(img)  → 商品截图 → 统一商品对象（封装 integrations/vision；需 VISION_API_KEY）
understand_product(p)      → 用 LLM 补全：品类 / 耐用度 / 使用模式先验 / 干净查询词（修复链接常缺 category、脏标题、整机vs配件漂移）
review_query(product)      → 从识别结果里挑一个适合「去翻真实评价」的关键词，喂给 §5.4 insight
"""
from __future__ import annotations

from typing import Any, Dict, Optional

from ...integrations import llm, vision
from ...integrations.linkparser import parse_product

__all__ = ["recognize_link", "recognize_screenshot", "understand_product", "review_query"]

_UNDERSTAND_SYSTEM = (
    "你从电商商品标题里抽取结构化『商品理解』，帮助后续搜索真实评价、判断价格、生成冷静问题。"
    "注意：durability 和 usage_pattern_prior 只是【先验参考】，不是结论。"
    "只输出 JSON：{"
    '"category":"品类，尽量到二级，如 蓝牙耳机/显卡/破壁机",'
    '"durability":"耐用|易耗|偶用",'
    '"usage_pattern_prior":"高频刚需|低频场景|兴趣尝鲜|替换升级",'
    '"core_query":"搜评价用的干净查询词，品牌+核心型号+品类，2~6词，去促销词/型号罗列/规格/店铺名",'
    '"normalized_name":"规范化商品名",'
    '"is_bundle_or_set":true或false（标题是否套装/整机/系列合集；若是，core_query 对准用户真正关心的主体）}'
)

_QUERY_SYSTEM = (
    "你从电商商品标题里提取一个用于『搜索真实评价/避雷』的干净查询词。"
    "保留品牌+核心型号+品类，去掉促销词、店铺名、重复型号罗列、规格参数。"
    "尽量短（2~6 个词）。只输出查询词本身，不要引号、不要解释。"
)

_SCREENSHOT_SYSTEM = (
    "你从一张电商商品截图里抽取结构化信息，供后续判断是否冲动消费。看不清或图里没有的字段给 null/空，不要编造。"
    "只输出 JSON：{"
    '"platform":"淘宝|天猫|京东|拼多多|抖音|其它|未知",'
    '"product_name":"商品标题，尽量完整",'
    '"category":"品类，如 蓝牙耳机/咖啡/显卡；识别不出留空",'
    '"current_price":数字或null（到手价/现价，去掉￥与单位）,'
    '"original_price":数字或null（划线原价）,'
    '"shop_name":"店铺名或空",'
    '"promotion":["截图里出现的营销词，如 限时/大促/满减/补贴/秒杀；没有则空数组"]}'
)


def recognize_link(text_or_url: str, *, fetch: bool = True, enrich: bool = True) -> Dict[str, Any]:
    """链接/分享文本 → 统一商品对象。enrich=True 且配了 LLM 时，补全商品理解。"""
    product = parse_product(text_or_url, fetch=fetch)
    if enrich and llm.available():
        understand_product(product)
    return product


def recognize_screenshot(image: Any, *, enrich: bool = True) -> Dict[str, Any]:
    """商品截图 → 统一商品对象（与 recognize_link 同构，下游无需区分来源）。

    image: bytes / base64 / data URL / 图片链接。需配置 VISION_API_KEY（VL 模型）。
    无视觉能力/识别失败 → 返回 needs_user_confirmation 的空壳，不编造。
    """
    data = vision.look_json(image, "识别这张电商商品截图，按要求只输出 JSON。",
                            system=_SCREENSHOT_SYSTEM, max_tokens=500, temperature=0.0)
    product = _screenshot_product(data if isinstance(data, dict) else {})
    if enrich and product.get("product_name") and llm.available():
        understand_product(product)
    return product


def _num(v: Any) -> Optional[float]:
    try:
        return float(v) if v is not None and str(v).strip() != "" else None
    except (TypeError, ValueError):
        return None


def _screenshot_product(d: Dict[str, Any]) -> Dict[str, Any]:
    """把视觉模型抽取的字段规整成统一商品对象（mirror linkparser 的输出结构）。"""
    name = (str(d.get("product_name") or "").strip()) or None
    category = (str(d.get("category") or "").strip()) or None
    current = _num(d.get("current_price"))
    promo = [str(x).strip() for x in (d.get("promotion") or []) if str(x).strip()]
    platform = (str(d.get("platform") or "").strip()) or "未知"
    shop_name = (str(d.get("shop_name") or "").strip()) or None

    missing = [k for k, v in (("product_name", name), ("price.current_price", current),
                              ("product_category", category)) if not v]
    return {
        "source_platform": platform,           # 显示用中文标签（截图来源可能非四大平台）
        "input_source": "screenshot",
        "original_url": None,
        "canonical_url": None,
        "product_id": None,
        "product_name": name,
        "product_category": category,
        "price": {
            "current_price": current,
            "original_price": _num(d.get("original_price")),
            "coupon_price": None,
            "currency": "CNY",
        },
        "promotion_stimuli": promo,
        "shop": {"shop_name": shop_name, "shop_type": None},
        "images": {"main_image": None},
        "sku": {"sku_id": None, "selected_specs": {}},
        "recognition": {
            "confidence": 0.6 if name else 0.2,
            "missing_fields": missing,
            "needs_user_confirmation": (not name) or (current is None),
        },
        "raw_source": {"vision": d},
    }


def understand_product(product: Dict[str, Any]) -> Dict[str, Any]:
    """LLM 补全品类/耐用度/使用模式先验/干净查询词；回填进 product。无 LLM/失败则不编造。"""
    name = (product.get("product_name") or "").strip()
    if not name:
        return product
    price = (product.get("price") or {}).get("current_price")
    category = (product.get("product_category") or "").strip()

    data = llm.chat_json(
        f"商品标题：{name}\n已知品类：{category or '未知'}\n价格：{price if price is not None else '未知'}",
        system=_UNDERSTAND_SYSTEM, max_tokens=200, temperature=0.0,
    )
    if not isinstance(data, dict):
        return product

    understanding = {
        "durability": data.get("durability"),
        "usage_pattern_prior": data.get("usage_pattern_prior"),
        "core_query": (data.get("core_query") or "").strip() or None,
        "normalized_name": (data.get("normalized_name") or "").strip() or None,
        "is_bundle_or_set": bool(data.get("is_bundle_or_set", False)),
    }
    product["understanding"] = understanding
    # 仅在原本缺失时回填品类，不覆盖已识别到的
    if not category and data.get("category"):
        product["product_category"] = str(data["category"]).strip()
    return product


def review_query(product: Dict[str, Any]) -> Optional[str]:
    """挑一个适合搜评价的关键词。优先用商品理解里的 core_query；否则 LLM 抽词 / 规则兜底。
    目的：尽量命中『这一款』的评价，而非整个品类。"""
    understanding = product.get("understanding") or {}
    if understanding.get("core_query"):
        return understanding["core_query"][:40]

    name = (product.get("product_name") or "").strip()
    category = (product.get("product_category") or "").strip()
    if not name:
        return category or None

    if llm.available():
        q = llm.chat(
            f"商品标题：{name}\n品类提示：{category or '未知'}",
            system=_QUERY_SYSTEM, max_tokens=40, temperature=0.0,
        )
        if q:
            q = q.strip().strip("「」\"'。 ").splitlines()[0][:40]
            if q:
                return q

    cleaned = name.replace("/", " ").replace("|", " ").replace("，", " ").strip()
    return cleaned[:24]
