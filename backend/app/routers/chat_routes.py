import json
from typing import Optional

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from ..auth import User, get_current_user
from ..config import OLLAMA_MODEL
from ..services.chatbot import ollama_client
from ..services.chatbot.agent import run_chat

router = APIRouter(prefix="/chat", tags=["chat"])


class Turn(BaseModel):
    role: str
    content: str


class ChatRequest(BaseModel):
    message: str
    history: Optional[list[Turn]] = None


@router.get("/status")
def status(current_user: User = Depends(get_current_user)):
    models = ollama_client.installed_models()
    return {"ollama": bool(models) or ollama_client.is_available(), "model": OLLAMA_MODEL,
            "modelInstalled": OLLAMA_MODEL in models}


@router.post("")
def chat(body: ChatRequest, current_user: User = Depends(get_current_user)):
    history = [t.model_dump() for t in body.history] if body.history else []

    def events():
        for ev in run_chat(body.message.strip()[:2000], history):
            yield f"data: {json.dumps(ev)}\n\n"

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/warmup")
def warmup(current_user: User = Depends(get_current_user)):
    """Build the knowledge index and load the model into memory ahead of the first question."""
    from ..services.chatbot.knowledge import get_index
    n = len(get_index().chunks)
    return {"chunks": n}
