from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response
from pydantic import BaseModel
from sqlmodel import Session, select

from ..auth import User, get_current_user
from ..db import get_session
from ..models import Complaint, ComplaintMessage
from ..services.complaint_insights import create_complaint, regulatory_export, related_complaints, trends
from ..services.complaints import add_message, analyze_complaint, draft_response, to_dict, update_status

router = APIRouter(prefix="/complaints", tags=["complaints"])


def _get(session: Session, complaint_id: str) -> Complaint:
    c = session.get(Complaint, complaint_id)
    if not c:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return c


class ComplaintCreate(BaseModel):
    customer_id: int
    subject: str
    body: str
    channel: str = "portal"
    severity: Optional[str] = None
    category: Optional[str] = None


class StatusUpdate(BaseModel):
    status: str
    note: Optional[str] = None


class AssignUpdate(BaseModel):
    assignee: str


class MessageCreate(BaseModel):
    body: str


# --- collection-level routes (must precede /{complaint_id}) ---

@router.get("")
def list_complaints(
    status: Optional[str] = None,
    customer_id: Optional[int] = None,
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    stmt = select(Complaint)
    if status:
        stmt = stmt.where(Complaint.status == status)
    if customer_id is not None:
        stmt = stmt.where(Complaint.customer_id == customer_id)
    stmt = stmt.order_by(Complaint.created_at.desc())
    return {"complaints": [to_dict(c) for c in session.exec(stmt).all()]}


@router.post("", status_code=201)
def ingest(body: ComplaintCreate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        return create_complaint(session, body.customer_id, body.subject, body.body, body.channel, body.severity, body.category)
    except KeyError:
        raise HTTPException(status_code=404, detail="Customer not found")


@router.get("/trends")
def get_trends(session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return trends(session)


@router.get("/regulatory-export")
def get_regulatory_export(
    format: str = "json",
    session: Session = Depends(get_session),
    current_user: User = Depends(get_current_user),
):
    result = regulatory_export(session, current_user.username)
    if format == "csv":
        return Response(
            content=result["csv"],
            media_type="text/csv",
            headers={"Content-Disposition": f'attachment; filename="regulatory_export_{result["generated_at"][:10]}.csv"'},
        )
    return result


# --- item-level routes ---

@router.get("/{complaint_id}")
def get_complaint(complaint_id: str, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    c = _get(session, complaint_id)
    messages = session.exec(
        select(ComplaintMessage).where(ComplaintMessage.complaint_id == complaint_id).order_by(ComplaintMessage.created_at)
    ).all()
    return {
        **to_dict(c),
        "messages": [{"id": m.id, "author": m.author, "body": m.body, "createdAt": m.created_at.isoformat() + "Z"} for m in messages],
        "related": related_complaints(session, complaint_id),
    }


@router.post("/{complaint_id}/analyze")
def analyze(complaint_id: str, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return analyze_complaint(session, _get(session, complaint_id))


@router.post("/{complaint_id}/draft-response")
def draft(complaint_id: str, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    return draft_response(session, _get(session, complaint_id))


@router.patch("/{complaint_id}/status")
def set_status(complaint_id: str, body: StatusUpdate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    try:
        return update_status(session, _get(session, complaint_id), body.status, current_user.username, body.note)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@router.patch("/{complaint_id}/assign")
def assign(complaint_id: str, body: AssignUpdate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    c = _get(session, complaint_id)
    c.assignee = body.assignee
    if c.status == "open":
        c.status = "in_progress"
    session.add(c)
    session.add(ComplaintMessage(complaint_id=c.id, author="system", body=f"Assigned to {body.assignee} by {current_user.username}"))
    session.commit()
    session.refresh(c)
    return to_dict(c)


@router.post("/{complaint_id}/messages")
def post_message(complaint_id: str, body: MessageCreate, session: Session = Depends(get_session), current_user: User = Depends(get_current_user)):
    msg = add_message(session, _get(session, complaint_id), "agent", body.body)
    return {"id": msg.id, "author": msg.author, "body": msg.body, "createdAt": msg.created_at.isoformat() + "Z"}
