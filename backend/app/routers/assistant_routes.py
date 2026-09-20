from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, get_current_user
from ..services.policy_assistant import answer_query

router = APIRouter(prefix="/assistant", tags=["assistant"])


class Turn(BaseModel):
    role: str
    content: str


class QueryRequest(BaseModel):
    query: str
    history: list[Turn] | None = None


@router.post("/query")
def query(body: QueryRequest, current_user: User = Depends(get_current_user)):
    history = [t.model_dump() for t in body.history] if body.history else None
    return answer_query(body.query, history)
