import unittest

from app.integrations.linkparser.parser import (
    ProductParser,
    ProductRecognitionInput,
    build_product_output,
    detect_platform,
    extract_redirect_metadata,
)


class ProductParserTests(unittest.TestCase):
    def setUp(self):
        self.parser = ProductParser()

    def test_parses_jd_item_url_into_unified_product_output(self):
        product = self.parser.parse_link(
            "https://item.jd.com/100012043978.html",
            product_name="Logitech MX Master 3S",
            current_price=499,
            product_category="mouse",
            shop_name="京东自营",
            promotion_text="限时券后价 满减",
        )

        self.assertEqual(product["source_platform"], "jd")
        self.assertEqual(product["input_source"], "link")
        self.assertEqual(product["product_id"], "100012043978")
        self.assertEqual(product["canonical_url"], "https://item.jd.com/100012043978.html")
        self.assertEqual(product["price"]["current_price"], 499)
        self.assertEqual(product["price"]["currency"], "CNY")
        self.assertEqual(product["shop"]["shop_type"], "自营")
        self.assertEqual(product["promotion_stimuli"], ["限时", "满减", "券后价"])
        self.assertFalse(product["recognition"]["needs_user_confirmation"])

    def test_parses_tmall_and_taobao_item_ids(self):
        taobao = self.parser.parse_link(
            "https://item.taobao.com/item.htm?id=88990011",
            product_name="Canvas Tote Bag",
            current_price="39.9",
        )
        tmall = self.parser.parse_link(
            "https://detail.tmall.com/item.htm?id=11223344",
            product_name="Noise Cancelling Headphones",
            current_price=699,
        )

        self.assertEqual(taobao["source_platform"], "taobao")
        self.assertEqual(taobao["product_id"], "88990011")
        self.assertEqual(tmall["source_platform"], "tmall")
        self.assertEqual(tmall["product_id"], "11223344")

    def test_parses_pdd_goods_id_from_url(self):
        product = self.parser.parse_link(
            "https://mobile.yangkeduo.com/goods.html?goods_id=1234567890",
            product_name="Portable Fan",
            current_price=29.9,
            promotion_text="百亿补贴 低库存",
        )

        self.assertEqual(product["source_platform"], "pdd")
        self.assertEqual(product["product_id"], "1234567890")
        self.assertEqual(product["promotion_stimuli"], ["补贴", "低库存"])

    def test_missing_optional_and_recommended_fields_are_reported_without_fabrication(self):
        product = build_product_output(
            ProductRecognitionInput(
                source_platform="taobao",
                input_source="link",
                product_name="Mechanical Keyboard",
                current_price=199,
            )
        )

        self.assertIn("product_id", product["recognition"]["missing_fields"])
        self.assertIn("product_category", product["recognition"]["missing_fields"])
        self.assertIsNone(product["product_id"])
        self.assertEqual(product["promotion_stimuli"], [])
        self.assertEqual(product["shop"]["shop_type"], "unknown")

    def test_screenshot_low_confidence_requires_user_confirmation(self):
        product = build_product_output(
            ProductRecognitionInput(
                source_platform="jd",
                input_source="screenshot",
                product_name="",
                current_price=88,
                confidence=0.42,
                promotion_text="秒杀 直播价",
            )
        )

        self.assertTrue(product["recognition"]["needs_user_confirmation"])
        self.assertIn("product_name", product["recognition"]["missing_fields"])
        self.assertEqual(product["promotion_stimuli"], ["秒杀", "直播价"])

    def test_missing_current_price_rejects_complete_product_output(self):
        with self.assertRaises(ValueError):
            build_product_output(
                ProductRecognitionInput(
                    source_platform="pdd",
                    input_source="screenshot",
                    product_name="Snack Box",
                    current_price=None,
                )
            )

    def test_detects_taobao_short_link_platform(self):
        self.assertEqual(
            detect_platform("https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To"),
            "taobao",
        )

    def test_parses_taobao_share_text_as_incomplete_product_draft(self):
        text = (
            "【淘宝】大促价保 https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To CZ321 "
            "「X影驰RTX5060TI/5070TI/5080/5090名人堂台式机电脑独立游戏显卡」"
        )

        product = self.parser.parse_share_text(text)

        self.assertEqual(product["source_platform"], "taobao")
        self.assertEqual(product["input_source"], "link")
        self.assertEqual(product["original_url"], "https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To")
        self.assertEqual(product["canonical_url"], "https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To")
        self.assertEqual(product["product_name"], "X影驰RTX5060TI/5070TI/5080/5090名人堂台式机电脑独立游戏显卡")
        self.assertIn("大促", product["promotion_stimuli"])
        self.assertIn("价保", product["promotion_stimuli"])
        self.assertIn("product_id", product["recognition"]["missing_fields"])
        self.assertIn("price.current_price", product["recognition"]["missing_fields"])
        self.assertTrue(product["recognition"]["needs_user_confirmation"])

    def test_parses_jd_share_text_with_short_link_and_title(self):
        text = "【京东】https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@ MF8555 「Apple/苹果 AirPods 4」"

        product = self.parser.parse_share_text(text)

        self.assertEqual(product["source_platform"], "jd")
        self.assertEqual(product["original_url"], "https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@")
        self.assertEqual(product["canonical_url"], "https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@")
        self.assertEqual(product["product_name"], "Apple/苹果 AirPods 4")
        self.assertIsNone(product["product_id"])
        self.assertIn("price.current_price", product["recognition"]["missing_fields"])

    def test_parses_pdd_ps_link_as_incomplete_product_draft(self):
        product = self.parser.parse_share_text("https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia")

        self.assertEqual(product["source_platform"], "pdd")
        self.assertEqual(product["original_url"], "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia")
        self.assertEqual(product["canonical_url"], "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia")
        self.assertIsNone(product["product_id"])
        self.assertIn("product_name", product["recognition"]["missing_fields"])
        self.assertIn("price.current_price", product["recognition"]["missing_fields"])

    def test_extracts_taobao_item_id_and_price_from_shortlink_html(self):
        html = (
            "var url = 'https://item.taobao.com/item.htm?id=1057177970429"
            "&sourceType=item&price=23737&shareurl=true';"
        )

        metadata = extract_redirect_metadata(
            "https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To",
            final_url="https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To",
            html=html,
        )

        self.assertEqual(metadata["product_id"], "1057177970429")
        self.assertEqual(metadata["canonical_url"], "https://item.taobao.com/item.htm?id=1057177970429")
        self.assertEqual(metadata["current_price"], 23737)
        self.assertEqual(metadata["fetch_status"], "resolved_from_redirect_html")

    def test_extracts_jd_sku_from_limit_referer_url(self):
        final_url = (
            "https://trade.m.jd.com/common/limit.html?module=detail_m1&referer="
            "http://item.m.jd.com/product/100142621566.html?utm_source=iosapp"
        )

        metadata = extract_redirect_metadata(
            "https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@",
            final_url=final_url,
            html="<title>多快好省，购物上京东</title>",
        )

        self.assertEqual(metadata["product_id"], "100142621566")
        self.assertEqual(metadata["canonical_url"], "https://item.jd.com/100142621566.html")
        self.assertEqual(metadata["fetch_status"], "resolved_from_redirect_url")

    def test_extracts_pdd_goods_id_from_wechat_redirect_url(self):
        final_url = (
            "https://open.weixin.qq.com/connect/oauth2/authorize?redirect_uri="
            "https%3A%2F%2Fmobile.yangkeduo.com%2Fgoods.html%3Fgoods_id%3D944921625367%26foo%3Dbar"
        )

        metadata = extract_redirect_metadata(
            "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia",
            final_url=final_url,
            html="",
        )

        self.assertEqual(metadata["product_id"], "944921625367")
        self.assertEqual(metadata["canonical_url"], "https://mobile.yangkeduo.com/goods.html?goods_id=944921625367")
        self.assertEqual(metadata["fetch_status"], "resolved_from_redirect_url")

    def test_parse_share_text_applies_live_price_and_image_metadata(self):
        product = self.parser.parse_share_text(
            "【京东】https://3.cn/2S-KRZ0i?jkl=@P1t2B3MTzq@ MF8555 「Apple/苹果 AirPods 4」",
            live_metadata={
                "product_id": "100142621566",
                "canonical_url": "https://item.jd.com/100142621566.html",
                "current_price": 776,
                "product_category": "数码/影音娱乐/蓝牙耳机",
                "main_image": "https://example.com/airpods.png",
                "shop_name": "Apple产品京东自营旗舰店",
                "shop_type": "自营",
                "fetch_status": "resolved_from_browser_render",
            },
        )

        self.assertEqual(product["product_id"], "100142621566")
        self.assertEqual(product["price"]["current_price"], 776)
        self.assertEqual(product["product_category"], "数码/影音娱乐/蓝牙耳机")
        self.assertEqual(product["images"]["main_image"], "https://example.com/airpods.png")
        self.assertEqual(product["shop"]["shop_name"], "Apple产品京东自营旗舰店")
        self.assertEqual(product["shop"]["shop_type"], "自营")
        self.assertEqual(product["raw_source"]["live_metadata"]["fetch_status"], "resolved_from_browser_render")
        self.assertFalse(product["recognition"]["needs_user_confirmation"])

    def test_parse_share_text_preserves_fetch_blocker_for_login_required_platform(self):
        product = self.parser.parse_share_text(
            "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia",
            live_metadata={
                "product_id": "944921625367",
                "canonical_url": "https://mobile.yangkeduo.com/goods.html?goods_id=944921625367",
                "fetch_status": "login_required",
                "blocking_reason": "拼多多未登录页面不会下发商品名、价格和主图",
                "required_resolution": "使用已登录浏览器态、官方多多进宝/开放平台接口，或用户截图补齐商品字段",
            },
        )

        self.assertEqual(product["product_id"], "944921625367")
        self.assertIn("product_name", product["recognition"]["missing_fields"])
        self.assertTrue(product["recognition"]["needs_user_confirmation"])
        self.assertEqual(product["raw_source"]["live_metadata"]["fetch_status"], "login_required")
        self.assertIn("required_resolution", product["raw_source"]["live_metadata"])

    def test_parse_share_text_accepts_pdd_api_style_live_metadata(self):
        product = self.parser.parse_share_text(
            "https://mobile.yangkeduo.com/goods.html?ps=b2Ul9nQRia",
            live_metadata={
                "goods_id": "944921625367",
                "goods_name": "拼多多登录态返回的商品",
                "min_group_price": 12990,
                "market_price": 19990,
                "goods_gallery_urls": ["https://example.com/pdd-main.jpg"],
                "mall_name": "示例店铺",
                "category_name": "数码配件",
                "promotion_labels": ["百亿补贴", "限时"],
                "fetch_status": "resolved_from_logged_in_browser",
            },
        )

        self.assertEqual(product["product_id"], "944921625367")
        self.assertEqual(product["canonical_url"], "https://mobile.yangkeduo.com/goods.html?goods_id=944921625367")
        self.assertEqual(product["product_name"], "拼多多登录态返回的商品")
        self.assertEqual(product["price"]["current_price"], 129.9)
        self.assertEqual(product["price"]["original_price"], 199.9)
        self.assertEqual(product["product_category"], "数码配件")
        self.assertEqual(product["images"]["main_image"], "https://example.com/pdd-main.jpg")
        self.assertEqual(product["shop"]["shop_name"], "示例店铺")
        self.assertIn("百亿补贴", product["promotion_stimuli"])
        self.assertIn("限时", product["promotion_stimuli"])
        self.assertFalse(product["recognition"]["needs_user_confirmation"])

    def test_parse_share_text_accepts_taobao_api_style_live_metadata(self):
        product = self.parser.parse_share_text(
            "【淘宝】大促价保 https://e.tb.cn/h.RLiCrsU28uLGSKX?tk=ejKGgT8h0To CZ321",
            live_metadata={
                "item_id": "1057177970429",
                "item_title": "淘宝接口返回的显卡商品",
                "zk_final_price": "23737",
                "reserve_price": "25999",
                "category_name": "电脑硬件/显卡",
                "pict_url": "https://img.alicdn.com/example/taobao-main.jpg",
                "shop_title": "影驰旗舰店",
                "promotion_labels": ["大促", "价保"],
                "fetch_status": "resolved_from_taobao_api",
            },
        )

        self.assertEqual(product["source_platform"], "taobao")
        self.assertEqual(product["product_id"], "1057177970429")
        self.assertEqual(product["canonical_url"], "https://item.taobao.com/item.htm?id=1057177970429")
        self.assertEqual(product["product_name"], "淘宝接口返回的显卡商品")
        self.assertEqual(product["price"]["current_price"], 23737)
        self.assertEqual(product["price"]["original_price"], 25999)
        self.assertEqual(product["product_category"], "电脑硬件/显卡")
        self.assertEqual(product["images"]["main_image"], "https://img.alicdn.com/example/taobao-main.jpg")
        self.assertEqual(product["shop"]["shop_name"], "影驰旗舰店")
        self.assertEqual(product["shop"]["shop_type"], "旗舰店")
        self.assertIn("大促", product["promotion_stimuli"])
        self.assertIn("价保", product["promotion_stimuli"])
        self.assertFalse(product["recognition"]["needs_user_confirmation"])


if __name__ == "__main__":
    unittest.main()
