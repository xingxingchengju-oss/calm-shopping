"""
多模态视觉客户端（OpenAI 兼容，截图识别用）。默认接通义千问；走环境变量：
    VISION_API_KEY / VISION_BASE_URL(默认 DashScope compatible-mode) / VISION_MODEL(默认 qwen3.7-plus)

⚠️ 必须用「能识图」的模型（qwen3.7-plus 旗舰多模态 / qwen3-vl-plus 等）；
   纯文本模型（如 deepseek-chat、qwen3.7-max）会拒绝 image 输入。
未配置 key 时 available() 为 False，截图功能优雅关闭（不影响链接/文本识别）。
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
from typing import Any, Optional

import requests

LOGGER = logging.getLogger("vision")


def available() -> bool:
    return bool(os.environ.get("VISION_API_KEY"))


def _cfg():
    return (
        os.environ.get("VISION_API_KEY"),
        os.environ.get("VISION_BASE_URL", "https://dashscope.aliyuncs.com/compatible-mode/v1").rstrip("/"),
        os.environ.get("VISION_MODEL", "qwen3.7-plus"),
    )


def _to_data_url(image: Any) -> Optional[str]:
    """把入参规整成 image_url 可用的字符串：http(s) 链接 / data URL 原样；bytes→base64 data URL。"""
    if isinstance(image, (bytes, bytearray)):
        b64 = base64.b64encode(bytes(image)).decode()
        return "data:image/png;base64," + b64
    if isinstance(image, str):
        s = image.strip()
        if s.startswith("http://") or s.startswith("https://") or s.startswith("data:"):
            return s
        # 裸 base64 → 当作 PNG 包成 data URL
        if s:
            return "data:image/png;base64," + s
    return None


def look(
    image: Any,
    prompt: str,
    *,
    system: Optional[str] = None,
    max_tokens: int = 600,
    temperature: float = 0.0,
    timeout: int = 60,
) -> Optional[str]:
    """对一张图提问，返回文本；失败/未配置返回 None（不抛异常，便于优雅降级）。

    image 接受：bytes / base64 字符串 / data URL / http(s) 图片链接。
    """
    key, base, model = _cfg()
    if not key:
        return None
    url = _to_data_url(image)
    if not url:
        LOGGER.warning("vision.look: unsupported image input")
        return None

    messages: list = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({
        "role": "user",
        "content": [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": url}},
        ],
    })
    payload = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    if "qwen" in model.lower():  # 关思考链求快（同文本侧），识图只需直出结果
        payload["enable_thinking"] = os.environ.get("LLM_ENABLE_THINKING", "").lower() in ("1", "true", "yes")
    try:
        resp = requests.post(
            base + "/chat/completions",
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=payload,
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        LOGGER.warning("vision.look failed: %s", exc)
        return None


def look_json(image: Any, prompt: str, *, system: Optional[str] = None, **kw) -> Optional[Any]:
    """要求模型输出 JSON，解析后返回；解析失败返回 None。"""
    raw = look(image, prompt, system=system, **kw)
    if not raw:
        return None
    m = re.search(r"[\{\[].*[\}\]]", raw, re.S)
    try:
        return json.loads(m.group(0) if m else raw)
    except Exception:
        return None
