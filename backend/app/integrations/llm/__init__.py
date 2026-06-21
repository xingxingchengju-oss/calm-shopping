"""
统一 LLM 客户端（OpenAI 兼容接口）。当前接通义 qwen3.7-plus，默认值仍为 DeepSeek。key/base/model 走环境变量：
    LLM_API_KEY / LLM_BASE_URL(默认 https://api.deepseek.com) / LLM_MODEL(默认 deepseek-chat)
base 已含 /v1（如 DashScope compatible-mode/v1）时只补 /chat/completions，否则补 /v1/chat/completions。
未配置 key 时 available() 为 False，上层走规则兜底。供「智能查询词提取」「好坏提炼」「五问/报告」共用。
"""
from __future__ import annotations

import json
import logging
import os
import re
from typing import Any, Dict, List, Optional

import requests

LOGGER = logging.getLogger("llm")


def available() -> bool:
    return bool(os.environ.get("LLM_API_KEY"))


def _cfg():
    return (
        os.environ.get("LLM_API_KEY"),
        os.environ.get("LLM_BASE_URL", "https://api.deepseek.com").rstrip("/"),
        os.environ.get("LLM_MODEL", "deepseek-chat"),
    )


def _body(model, messages, max_tokens, temperature):
    body = {"model": model, "messages": messages, "max_tokens": max_tokens, "temperature": temperature}
    # 通义 qwen3 默认开「思考链」，结构化抽取慢约 8x（实测 21s→3s）；我们不需要推理过程，默认关掉求快。
    # 想开回来：LLM_ENABLE_THINKING=1。对 DeepSeek/其它 provider 不加此字段（无副作用）。
    if "qwen" in model.lower():
        body["enable_thinking"] = os.environ.get("LLM_ENABLE_THINKING", "").lower() in ("1", "true", "yes")
    return body


def chat(
    prompt: str,
    *,
    system: Optional[str] = None,
    max_tokens: int = 800,
    temperature: float = 0.3,
    timeout: int = 40,
) -> Optional[str]:
    """单轮对话，返回文本；失败/未配置返回 None（不抛异常，便于优雅降级）。"""
    key, base, model = _cfg()
    if not key:
        return None
    messages: List[Dict[str, str]] = []
    if system:
        messages.append({"role": "system", "content": system})
    messages.append({"role": "user", "content": prompt})
    endpoint = base + ("/chat/completions" if base.endswith("/v1") else "/v1/chat/completions")
    try:
        resp = requests.post(
            endpoint,
            headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
            json=_body(model, messages, max_tokens, temperature),
            timeout=timeout,
        )
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]
    except Exception as exc:
        LOGGER.warning("LLM chat failed: %s", exc)
        return None


def chat_json(prompt: str, *, system: Optional[str] = None, **kw) -> Optional[Any]:
    """要求模型输出 JSON，解析后返回；解析失败返回 None。"""
    raw = chat(prompt, system=system, **kw)
    if not raw:
        return None
    m = re.search(r"[\{\[].*[\}\]]", raw, re.S)
    try:
        return json.loads(m.group(0) if m else raw)
    except Exception:
        return None
