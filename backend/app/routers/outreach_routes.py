from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlmodel import Session

from ..auth import User, get_current_user, require_admin
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
def channels(current_user: User = Depends(get_current_user)):
    return {"channels": [{"value": k, "label": v} for k, v in CHANNEL_LABELS.items()]}


@router.get("/recommend/{customer_id}")
def get_recommendation(customer_id: int, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        return recommend(session, customer_id)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.post("/trigger")
def post_trigger(body: TriggerRequest, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    # Same safeguards as the workbench: consent, cooldown, frequency cap.
    from ..services.retention.actions import check_constraints
    from ..services.outreach import recommend as _rec
    try:
        ch = body.channel or _rec(session, body.customer_id)["channel"]
        blocks = check_constraints(session, body.customer_id, ch)
        if blocks:
            raise HTTPException(status_code=409, detail={"message": "Blocked by outreach safeguards", "constraints": blocks})
        return trigger(session, body.customer_id, current_user.username, body.channel, body.message)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.post("/{action_id}/outcome")
def post_outcome(action_id: int, body: OutcomeRequest, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        return record_outcome(session, action_id, body.outcome, body.notes, source="manual", observed=True, recorded_by=current_user.username)
    except KeyError:
        raise HTTPException(status_code=404, detail="Outreach action not found")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.get("/actions")
def get_actions(customer_id: Optional[int] = None, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return {"actions": list_actions(session, customer_id)}


@router.get("/effectiveness")
def get_effectiveness(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return effectiveness(session)


@router.post("/retrain")
def post_retrain(session: Session = Depends(get_session), current_user: User = Depends(require_admin)):
    from ..services.churn import get_model_metrics
    from ..services.retention.event_store import audit
    before = get_model_metrics()["metrics"]
    result = retrain_with_feedback()
    after = result["metrics"]
    audit(session, current_user.username, "model_retrained", after.get("model_version", "model"), {
        "before": {k: before.get(k) for k in ("model_version", "auc", "feedback_rows_used", "n_train")},
        "after": {k: after.get(k) for k in ("model_version", "auc", "feedback_rows_used", "n_train")},
        "note": "feedback rows are demo-scale; metric changes are not evidence of improvement"})
    session.commit()
    return result
