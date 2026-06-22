"""
冷静购 后端 + 河湾村原型页托管。
GET  /              → 河湾村原型页（项目根 web/，静态托管，与 /api 同源）
GET  /legacy        → 旧极简试用页（app/web/index.html，保留参考）
POST /api/recognize → {text} 或 {image(base64 data URL)} → 识别商品 + 真实口碑 + 行情 + 生成五问
POST /api/report    → {session_id, answers:[{id,value}]} → 冷静报告

注：session 用内存字典，仅供单机试用；沉淀池/河币由前端 localStorage 持久化。
"""
from __future__ import annotations

import os
import uuid
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

from app.services.insight import build_report
from app.services.pricing import assess_price
from app.services.questionnaire import Answer, generate_questionnaire, generate_report, score_answer
from app.services.recognition import recognize_link, recognize_screenshot, review_query

app = FastAPI(title="冷静购 · 试用")

# 前后端分开起服务时（如静态服务器跑前端、本服务跑 API）才需要；同源托管不依赖它。
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_methods=["*"], allow_headers=["*"], allow_credentials=False,
)

_WEB = os.path.join(os.path.dirname(__file__), "web")               # 旧极简试用页（/legacy）
_ROOT_WEB = os.path.join(os.path.dirname(__file__), "..", "..", "web")  # 河湾村原型页（首页）
_SESSIONS: Dict[str, Dict[str, Any]] = {}


class RecognizeBody(BaseModel):
    text: Optional[str] = None
    image: Optional[str] = None   # base64 data URL（截图识别）


class AnswerItem(BaseModel):
    id: str
    value: Any


class ReportBody(BaseModel):
    session_id: str
    answers: List[AnswerItem]


@app.get("/legacy")
def legacy_index():
    """旧的极简试用页，保留作参考。"""
    return FileResponse(os.path.join(_WEB, "index.html"))


@app.post("/api/recognize")
def api_recognize(body: RecognizeBody) -> Dict[str, Any]:
    text = (body.text or "").strip()
    image = (body.image or "").strip()
    if not text and not image:
        raise HTTPException(400, "请粘贴商品链接/分享文本，或上传一张商品截图")

    if image:
        product = recognize_screenshot(image)
        fail_msg = "这张截图没认出商品名，换一张更清楚的商品页截图，或改用链接/分享文案试试。"
    else:
        product = recognize_link(text)
        fail_msg = "没识别出商品名（如拼多多无标题）→ 换淘宝/京东链接、分享文案，或上传商品截图试试。"

    query = review_query(product)
    if not query:
        return {"ok": False, "message": fail_msg, "product": _product_view(product)}

    insight = build_report(query, use_search=True, allow_sample=True)
    pricing = assess_price(product)
    quiz = generate_questionnaire(product, insight, pricing)

    sid = uuid.uuid4().hex
    _SESSIONS[sid] = {"product": product, "insight": insight, "pricing": pricing, "quiz": quiz}

    return {
        "ok": True,
        "session_id": sid,
        "product": _product_view(product),
        "review": {"pros": insight.pros, "cons": insight.cons, "verdict": insight.verdict,
                   "sources": insight.sources_summary},
        "pricing": None if pricing is None else
            {"verdict": pricing.verdict, "trend": pricing.trend, "assessment": pricing.assessment},
        "questionnaire": quiz.to_dict(),
    }


@app.post("/api/report")
def api_report(body: ReportBody) -> Dict[str, Any]:
    sess = _SESSIONS.get(body.session_id)
    if not sess:
        raise HTTPException(404, "会话已过期，请重新识别商品")
    by_id = {q.id: q for q in sess["quiz"].questions}
    answers: List[Answer] = []
    for a in body.answers:
        q = by_id.get(a.id)
        if not q:
            continue
        answers.append(Answer(q.score_key, q.dimension, a.value, score_answer(q.id, a.value)))
    report = generate_report(sess["product"], sess["insight"], sess["pricing"], answers)
    return report.to_dict()


def _product_view(product: Dict[str, Any]) -> Dict[str, Any]:
    u = product.get("understanding") or {}
    return {
        "name": product.get("product_name"),
        "platform": product.get("source_platform"),
        "price": (product.get("price") or {}).get("current_price"),
        "category": product.get("product_category"),
        "promotion": product.get("promotion_stimuli") or [],
        "core_query": u.get("core_query"),
    }


# 必须放在所有 /api 路由之后：把河湾村原型页(项目根 web/)挂为首页，与 /api 同源。
# html=True 时 "/" 自动返回 web/index.html，并托管 css/js/assets。
app.mount("/", StaticFiles(directory=_ROOT_WEB, html=True), name="web")
