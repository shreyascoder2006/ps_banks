from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..auth import User, get_current_user
from ..services.multilingual import GLOSSARY, LANGUAGES, PROCESS_GUIDES, guide, summarize, translate
from ..services.policy_assistant import answer_query

router = APIRouter(prefix="/assistant", tags=["assistant"])


class Turn(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    query: str
    history: list[Turn] | None = None


class TranslateRequest(BaseModel):
    text: str
    source_lang: str
    target_lang: str
    speaker: str = "customer"


class SummaryTurn(BaseModel):
    speaker: str
    original: str
    translated: Optional[str] = None
    lang: Optional[str] = None


class SummaryRequest(BaseModel):
    turns: list[SummaryTurn]
    customer_lang: str
    staff_lang: str = "en-IN"


@router.post("/query")
def query(body: QueryRequest, current_user: User = Depends(get_current_user)):
    history = [t.model_dump() for t in body.history] if body.history else None
    return answer_query(body.query, history)


@router.get("/languages")
def languages(current_user: User = Depends(get_current_user)):
    return {"languages": [{"code": k, "label": v} for k, v in LANGUAGES.items()], "glossary": GLOSSARY}


@router.post("/translate")
def post_translate(body: TranslateRequest, current_user: User = Depends(get_current_user)):
    if not body.text.strip():
        raise HTTPException(status_code=400, detail="Empty text")
    return translate(body.text.strip(), body.source_lang, body.target_lang, body.speaker)


@router.get("/guides")
def list_guides(current_user: User = Depends(get_current_user)):
    return {"guides": [{"id": k, "title": v["title"], "steps": len(v["steps"])} for k, v in PROCESS_GUIDES.items()]}


@router.get("/guides/{guide_id}")
def get_guide(guide_id: str, lang: str = "en-IN", current_user: User = Depends(get_current_user)):
    if guide_id not in PROCESS_GUIDES:
        raise HTTPException(status_code=404, detail="Guide not found")
    return guide(guide_id, lang)


@router.post("/summary")
def post_summary(body: SummaryRequest, current_user: User = Depends(get_current_user)):
    return summarize([t.model_dump() for t in body.turns], body.customer_lang, body.staff_lang)
