from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
import re
from typing import Any
from urllib.parse import parse_qs, unquote, urlparse, urlunparse


SUPPORTED_PLATFORMS = {"taobao", "tmall", "pdd", "jd"}
SUPPORTED_INPUT_SOURCES = {"link", "screenshot"}
PROMOTION_KEYWORDS = ("大促", "价保", "限时", "秒杀", "补贴", "低库存", "满减", "券后价", "直播价")
URL_PATTERN = re.compile(r"https?://[^\s，。！？、」]+")
CHINESE_TITLE_PATTERN = re.compile(r"「([^」]+)」")
# 分享口令/短码：纯 ASCII 且(含字母又含数字 / ≥4 位纯数字 / ≥4 位全大写)，如 HU071、CZ321、w7tgg6B62RP
SHARE_CODE_PATTERN = re.compile(r"^(?=[A-Za-z0-9]+$)(?:(?=.*[A-Za-z])(?=.*\d).+|\d{4,}|[A-Z]{4,})$")
# 平台前缀标签 / 淘口令包裹符，提取裸标题前先剥掉
_TAG_PATTERN = re.compile(r"【[^】]*】|\$[^$]+\$|₤[^₤]+₤|[（(]\s*复制[^）)]*[）)]")


@dataclass
class ProductRecognitionInput:
    source_platform: str
    input_source: str
    product_name: str | None
    current_price: int | float | str | Decimal | None
    original_url: str | None = None
    canonical_url: str | None = None
    product_id: str | None = None
    product_category: str | None = None
    original_price: int | float | str | Decimal | None = None
    coupon_price: int | float | str | Decimal | None = None
    promotion_text: str | None = None
    promotion_stimuli: list[str] = field(default_factory=list)
    shop_name: str | None = None
    shop_type: str | None = None
    main_image: str | None = None
    sku_id: str | None = None
    selected_specs: dict[str, str] = field(default_factory=dict)
    confidence: float = 1.0
    raw_source: dict[str, Any] = field(default_factory=dict)


def build_product_output(data: ProductRecognitionInput, *, allow_incomplete: bool = False) -> dict[str, Any]:
    _validate_enum(data.source_platform, SUPPORTED_PLATFORMS, "source_platform")
    _validate_enum(data.input_source, SUPPORTED_INPUT_SOURCES, "input_source")

    if data.current_price is None and not allow_incomplete:
        raise ValueError("price.current_price is required for complete product output")

    product_name = _clean_text(data.product_name)
    current_price = _normalize_optional_price(data.current_price)
    original_price = _normalize_optional_price(data.original_price)
    coupon_price = _normalize_optional_price(data.coupon_price)
    promotion_stimuli = _merge_promotions(data.promotion_stimuli, data.promotion_text)
    shop_type = data.shop_type or _infer_shop_type(data.shop_name)

    missing_fields = _missing_fields(
        product_name=product_name,
        current_price=current_price,
        product_id=data.product_id,
        product_category=data.product_category,
        canonical_url=data.canonical_url,
        original_url=data.original_url,
    )
    needs_user_confirmation = (
        data.confidence < 0.6
        or "product_name" in missing_fields
        or "price.current_price" in missing_fields
        or bool(
            data.input_source == "screenshot"
            and ("product_name" in missing_fields or "product_category" in missing_fields)
        )
    )

    return {
        "source_platform": data.source_platform,
        "input_source": data.input_source,
        "original_url": data.original_url,
        "canonical_url": data.canonical_url,
        "product_id": data.product_id,
        "product_name": product_name,
        "product_category": data.product_category,
        "price": {
            "current_price": current_price,
            "original_price": original_price,
            "coupon_price": coupon_price,
            "currency": "CNY",
        },
        "promotion_stimuli": promotion_stimuli,
        "shop": {
            "shop_name": data.shop_name,
            "shop_type": shop_type,
        },
        "images": {
            "main_image": data.main_image,
        },
        "sku": {
            "sku_id": data.sku_id,
            "selected_specs": data.selected_specs,
        },
        "recognition": {
            "confidence": data.confidence,
            "missing_fields": missing_fields,
            "needs_user_confirmation": needs_user_confirmation,
        },
        "raw_source": data.raw_source,
    }


class ProductParser:
    def parse_link(
        self,
        url: str,
        *,
        product_name: str | None,
        current_price: int | float | str | Decimal | None,
        product_category: str | None = None,
        original_price: int | float | str | Decimal | None = None,
        coupon_price: int | float | str | Decimal | None = None,
        promotion_text: str | None = None,
        shop_name: str | None = None,
        shop_type: str | None = None,
        main_image: str | None = None,
        selected_specs: dict[str, str] | None = None,
        confidence: float = 1.0,
        raw_source: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        platform = detect_platform(url)
        product_id = extract_product_id(url, platform)
        canonical_url = canonicalize_product_url(url, platform, product_id)

        return build_product_output(
            ProductRecognitionInput(
                source_platform=platform,
                input_source="link",
                original_url=url,
                canonical_url=canonical_url,
                product_id=product_id,
                product_name=product_name,
                product_category=product_category,
                current_price=current_price,
                original_price=original_price,
                coupon_price=coupon_price,
                promotion_text=promotion_text,
                shop_name=shop_name,
                shop_type=shop_type,
                main_image=main_image,
                sku_id=product_id if platform == "jd" else None,
                selected_specs=selected_specs or {},
                confidence=confidence,
                raw_source=raw_source or {},
            )
        )

    def parse_share_text(
        self,
        text: str,
        *,
        current_price: int | float | str | Decimal | None = None,
        product_category: str | None = None,
        live_metadata: dict[str, Any] | None = None,
        confidence: float = 0.5,
    ) -> dict[str, Any]:
        url = extract_first_url(text)
        if not url:
            raise ValueError("share text does not contain a product link")

        platform = detect_platform(url)
        product_id = extract_product_id(url, platform)
        product_name = extract_product_name(text)
        canonical_url = canonicalize_product_url(url, platform, product_id)
        live_metadata = normalize_live_metadata(live_metadata or {}, platform=platform)

        if live_metadata:
            product_id = live_metadata.get("product_id") or product_id
            canonical_url = live_metadata.get("canonical_url") or canonical_url
            current_price = live_metadata.get("current_price", current_price)
            product_category = live_metadata.get("product_category") or product_category
            product_name = live_metadata.get("product_name") or product_name
            original_price = live_metadata.get("original_price")
            coupon_price = live_metadata.get("coupon_price")
            promotion_stimuli = live_metadata.get("promotion_stimuli", [])
        else:
            original_price = None
            coupon_price = None
            promotion_stimuli = []
        main_image = live_metadata.get("main_image") if live_metadata else None
        shop_name = live_metadata.get("shop_name") if live_metadata else None
        shop_type = live_metadata.get("shop_type") if live_metadata else None
        confidence = max(
            confidence,
            _confidence_from_recovered_fields(
                product_name=product_name,
                product_id=product_id,
                current_price=current_price,
                product_category=product_category,
                main_image=main_image,
                shop_name=shop_name,
            ),
        )

        return build_product_output(
            ProductRecognitionInput(
                source_platform=platform,
                input_source="link",
                original_url=url,
                canonical_url=canonical_url,
                product_id=product_id,
                product_name=product_name,
                product_category=product_category,
                current_price=current_price,
                original_price=original_price,
                coupon_price=coupon_price,
                promotion_text=text,
                promotion_stimuli=promotion_stimuli,
                shop_name=shop_name,
                shop_type=shop_type,
                main_image=main_image,
                sku_id=product_id if platform == "jd" else None,
                confidence=confidence,
                raw_source={"share_text": text, "live_metadata": live_metadata or {}},
            ),
            allow_incomplete=True,
        )


def normalize_live_metadata(metadata: dict[str, Any], *, platform: str) -> dict[str, Any]:
    if not metadata:
        return {}
    normalized = dict(metadata)

    product_id = _first_present(
        metadata,
        "product_id",
        "item_id",
        "itemId",
        "itemNumId",
        "num_iid",
        "numIid",
        "goods_id",
        "goodsId",
        "sku_id",
        "skuId",
        "sku",
    )
    if product_id:
        normalized["product_id"] = str(product_id)
        normalized["canonical_url"] = normalized.get("canonical_url") or canonicalize_product_url(
            _canonical_base_url(platform, str(product_id)), platform, str(product_id)
        )

    product_name = _first_present(
        metadata,
        "product_name",
        "item_title",
        "itemTitle",
        "title",
        "short_title",
        "goods_name",
        "goodsName",
        "ware_name",
        "wareName",
        "name",
    )
    if product_name:
        normalized["product_name"] = str(product_name)

    current_price = _first_present(
        metadata,
        "current_price",
        "zk_final_price",
        "zkFinalPrice",
        "promotion_price",
        "sale_price",
        "min_group_price",
        "group_price",
        "price",
        "jd_price",
        "jdPrice",
    )
    if current_price is not None:
        normalized["current_price"] = _normalize_external_price(current_price, platform=platform)

    original_price = _first_present(
        metadata,
        "original_price",
        "reserve_price",
        "reservePrice",
        "market_price",
        "line_price",
        "origin_price",
    )
    if original_price is not None:
        normalized["original_price"] = _normalize_external_price(original_price, platform=platform)

    coupon_price = _first_present(
        metadata,
        "coupon_price",
        "coupon_discount_price",
        "coupon_after_price",
        "couponAfterPrice",
    )
    if coupon_price is not None:
        normalized["coupon_price"] = _normalize_external_price(coupon_price, platform=platform)

    product_category = _first_present(
        metadata,
        "product_category",
        "category_name",
        "categoryName",
        "cat_name",
        "catName",
        "root_cat_name",
        "rootCatName",
    )
    if product_category:
        normalized["product_category"] = str(product_category)

    main_image = _first_present(
        metadata,
        "main_image",
        "pict_url",
        "pictUrl",
        "pic_url",
        "picUrl",
        "white_image",
        "whiteImage",
        "hd_thumb_url",
        "thumb_url",
        "image",
        "image_url",
    )
    if main_image is None:
        main_image = _first_list_item(metadata, "small_images", "goods_gallery_urls", "image_urls", "images")
    if main_image:
        normalized["main_image"] = str(main_image)

    shop_name = _first_present(
        metadata,
        "shop_name",
        "shop_title",
        "shopTitle",
        "seller_nick",
        "sellerNick",
        "nick",
        "mall_name",
        "store_name",
        "shopName",
        "shop",
    )
    if shop_name:
        normalized["shop_name"] = str(shop_name)

    shop_type = _first_present(metadata, "shop_type", "store_type", "shopType")
    if shop_type:
        normalized["shop_type"] = str(shop_type)

    labels = _first_present(metadata, "promotion_stimuli", "promotion_labels", "promotionTags", "sales_tip")
    if labels:
        normalized["promotion_stimuli"] = _normalize_promotion_labels(labels)

    return normalized


def detect_platform(url: str) -> str:
    host = urlparse(url).netloc.lower()
    if "tmall.com" in host:
        return "tmall"
    if "taobao.com" in host or host == "e.tb.cn" or host.endswith(".tb.cn"):
        return "taobao"
    if "yangkeduo.com" in host or "pinduoduo.com" in host or "pdd" in host:
        return "pdd"
    if "jd.com" in host or host.endswith("3.cn"):
        return "jd"
    raise ValueError(f"unsupported product link platform: {host}")


def extract_product_id(url: str, platform: str) -> str | None:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)

    if platform in {"taobao", "tmall"}:
        return _first_query_value(query, "id", "item_id", "itemId")
    if platform == "pdd":
        return _first_query_value(query, "goods_id", "goodsId", "goodsid")
    if platform == "jd":
        match = re.search(r"/(\d+)\.html(?:$|[?#])", parsed.path)
        if match:
            return match.group(1)
        return _first_query_value(query, "sku", "skuId", "sku_id", "wareId")
    return None


def canonicalize_product_url(url: str, platform: str, product_id: str | None) -> str | None:
    if not product_id:
        return url
    if platform == "jd":
        return f"https://item.jd.com/{product_id}.html"
    if platform == "pdd":
        return f"https://mobile.yangkeduo.com/goods.html?goods_id={product_id}"
    if platform == "tmall":
        return f"https://detail.tmall.com/item.htm?id={product_id}"
    if platform == "taobao":
        return f"https://item.taobao.com/item.htm?id={product_id}"
    return _strip_tracking(url)


def extract_first_url(text: str) -> str | None:
    match = URL_PATTERN.search(text)
    return match.group(0) if match else None


def extract_quoted_product_name(text: str) -> str | None:
    match = CHINESE_TITLE_PATTERN.search(text)
    return _clean_text(match.group(1)) if match else None


def extract_product_name(text: str) -> str | None:
    """从分享文本提取商品名。优先「」引用；否则剥掉链接/平台标签/分享口令后取裸标题。

    淘宝口令常把商品名裸放在短码后面（无「」），例如：
        【淘宝】https://e.tb.cn/h.xxx?tk=yyy HU071 bob冷萃咖啡花魁袋泡咖啡
    引用法会漏掉这种，这里兜底：去掉 URL、【…】标签、纯字母数字短码，保留其余 token。
    """
    quoted = extract_quoted_product_name(text)
    if quoted:
        return quoted

    body = URL_PATTERN.sub(" ", text)
    body = _TAG_PATTERN.sub(" ", body)
    # 去掉分享口令短码，保留其余 token（含 iPhone/Pro 这类品牌型号；残留噪声交给下游 LLM 清洗）
    tokens = [t for t in body.split() if t and not SHARE_CODE_PATTERN.match(t)]
    return _clean_text(" ".join(tokens)) or None


def extract_redirect_metadata(original_url: str, *, final_url: str, html: str) -> dict[str, Any]:
    platform = detect_platform(original_url)
    urls_to_check = [final_url, *_extract_embedded_urls(html), *_extract_nested_redirect_urls(final_url)]
    product_id = None
    current_price = None

    for candidate in urls_to_check:
        candidate_id = extract_product_id(candidate, platform)
        if candidate_id:
            product_id = candidate_id
            if platform == "taobao":
                current_price = _extract_query_price(candidate)
            break

    canonical_url = canonicalize_product_url(original_url, platform, product_id)
    if product_id:
        canonical_url = canonicalize_product_url(_canonical_base_url(platform, product_id), platform, product_id)

    return {
        "product_id": product_id,
        "canonical_url": canonical_url,
        "current_price": current_price,
        "fetch_status": "resolved_from_redirect_html" if product_id and _extract_embedded_urls(html) else (
            "resolved_from_redirect_url" if product_id else "unresolved"
        ),
    }


def _extract_embedded_urls(html: str) -> list[str]:
    urls = []
    for match in re.finditer(r"""['"](https?://[^'"]+)['"]""", html):
        urls.append(match.group(1).replace("\\/", "/"))
    return urls


def _extract_nested_redirect_urls(url: str) -> list[str]:
    parsed = urlparse(url)
    query = parse_qs(parsed.query)
    nested = []
    for key in ("referer", "redirect_uri", "url"):
        for value in query.get(key, []):
            nested.append(unquote(value))
    return nested


def _extract_query_price(url: str) -> int | float | None:
    price = _first_query_value(parse_qs(urlparse(url).query), "price")
    return _normalize_optional_price(price)


def _canonical_base_url(platform: str, product_id: str) -> str:
    if platform == "jd":
        return f"https://item.jd.com/{product_id}.html"
    if platform == "pdd":
        return f"https://mobile.yangkeduo.com/goods.html?goods_id={product_id}"
    if platform == "tmall":
        return f"https://detail.tmall.com/item.htm?id={product_id}"
    return f"https://item.taobao.com/item.htm?id={product_id}"


def _strip_tracking(url: str) -> str:
    parsed = urlparse(url)
    kept_query = []
    for key, values in parse_qs(parsed.query).items():
        if key.lower() in {"id", "item_id", "itemid", "goods_id", "goodsid", "skuid", "sku", "wareid"}:
            kept_query.extend(f"{key}={value}" for value in values)
    return urlunparse((parsed.scheme, parsed.netloc, parsed.path, "", "&".join(kept_query), ""))


def _first_query_value(query: dict[str, list[str]], *keys: str) -> str | None:
    lowered = {key.lower(): values for key, values in query.items()}
    for key in keys:
        values = lowered.get(key.lower())
        if values and values[0]:
            return values[0]
    return None


def _first_present(metadata: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        if key in metadata and metadata[key] not in (None, ""):
            return metadata[key]
    return None


def _first_list_item(metadata: dict[str, Any], *keys: str) -> Any:
    for key in keys:
        value = metadata.get(key)
        if isinstance(value, list) and value:
            return value[0]
    return None


def _normalize_external_price(value: Any, *, platform: str) -> float | int:
    if platform == "pdd" and isinstance(value, int) and value >= 1000:
        return _normalize_price(Decimal(value) / Decimal("100"))
    return _normalize_price(value)


def _normalize_promotion_labels(value: Any) -> list[str]:
    if isinstance(value, str):
        return [value]
    if isinstance(value, list):
        return [str(item) for item in value if item]
    return []


def _validate_enum(value: str, allowed: set[str], field_name: str) -> None:
    if value not in allowed:
        raise ValueError(f"{field_name} must be one of {sorted(allowed)}")


def _clean_text(value: str | None) -> str | None:
    if value is None:
        return None
    value = value.strip()
    return value or None


def _normalize_optional_price(value: int | float | str | Decimal | None) -> float | int | None:
    if value is None or value == "":
        return None
    return _normalize_price(value)


def _normalize_price(value: int | float | str | Decimal) -> float | int:
    try:
        amount = Decimal(str(value).replace("¥", "").replace("￥", "").strip())
    except InvalidOperation as exc:
        raise ValueError(f"invalid price value: {value}") from exc

    if amount == amount.to_integral():
        return int(amount)
    return float(amount)


def _merge_promotions(explicit: list[str], text: str | None) -> list[str]:
    found = []
    for keyword in [*explicit, *PROMOTION_KEYWORDS]:
        if keyword in found:
            continue
        if keyword in explicit or (text and keyword in text):
            found.append(keyword)
    return found


def _infer_shop_type(shop_name: str | None) -> str:
    if not shop_name:
        return "unknown"
    if "自营" in shop_name:
        return "自营"
    if "旗舰" in shop_name:
        return "旗舰店"
    return "普通店铺"


def _missing_fields(
    *,
    product_name: str | None,
    current_price: float | int,
    product_id: str | None,
    product_category: str | None,
    canonical_url: str | None,
    original_url: str | None,
) -> list[str]:
    missing = []
    if not product_name:
        missing.append("product_name")
    if current_price is None:
        missing.append("price.current_price")
    if not original_url:
        missing.append("original_url")
    if not canonical_url:
        missing.append("canonical_url")
    if not product_id:
        missing.append("product_id")
    if not product_category:
        missing.append("product_category")
    return missing


def _confidence_from_recovered_fields(
    *,
    product_name: str | None,
    product_id: str | None,
    current_price: float | int | str | Decimal | None,
    product_category: str | None,
    main_image: str | None,
    shop_name: str | None,
) -> float:
    confidence = 0.35
    if product_name:
        confidence += 0.2
    if product_id:
        confidence += 0.15
    if current_price is not None:
        confidence += 0.2
    if product_category:
        confidence += 0.05
    if main_image:
        confidence += 0.05
    if shop_name:
        confidence += 0.05
    return round(min(confidence, 0.95), 2)
