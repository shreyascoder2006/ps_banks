from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session
from ..db import get_session
from ..services.churn import retrain_with_feedback
from ..services.outreach import CHANNEL_LABELS, effectiveness, list_actions, recommend, record_outcome, trigger

router = APIRouter(prefix="/outreach", tags=["outreach"])


class TriggerRequest(BaseModel):
    customer_id: int
    channel: Optional[str] = None
    message: Optional[str] = None


class OutcomeRequest(BaseModel):
    outcome: str
    notes: Optional[str] = None


@router.get("/channels")
def channels():
    return {"channels": [{"value": k, "label": v} for k, v in CHANNEL_LABELS.items()]}


@router.get("/recommend/{customer_id}")
def get_recommendation(customer_id: int, session: Session = Depends(get_session)):
    try:
        return recommend(session, customer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.post("/trigger")
def post_trigger(body: TriggerRequest, session: Session = Depends(get_session)):
    try:
        return trigger(session, body.customer_id, "staff", body.channel, body.message)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.post("/{action_id}/outcome")
def post_outcome(action_id: int, body: OutcomeRequest, session: Session = Depends(get_session)):
    try:
        return record_outcome(session, action_id, body.outcome, body.notes)
    except KeyError:
        raise HTTPException(status_code=404, detail="Outreach action not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/actions")
def get_actions(customer_id: Optional[int] = None, session: Session = Depends(get_session)):
    return {"actions": list_actions(session, customer_id)}


@router.get("/effectiveness")
def get_effectiveness(session: Session = Depends(get_session)):
    return effectiveness(session)


@router.post("/retrain")
def post_retrain():
    return retrain_with_feedback()
