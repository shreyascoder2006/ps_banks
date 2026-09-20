from fastapi import APIRouter, Depends, HTTPException

from ..auth import User, get_current_user
from ..services.complaints import analyze_complaint, draft_response, load_complaints

router = APIRouter(prefix="/complaints", tags=["complaints"])


def _find(complaint_id: str) -> dict:
    for c in load_complaints():
        if c["id"] == complaint_id:
            return c
    raise HTTPException(status_code=404, detail="Complaint not found")


@router.get("")
def list_complaints(current_user: User = Depends(get_current_user)):
    return {"complaints": load_complaints()}


@router.get("/{complaint_id}")
def get_complaint(complaint_id: str, current_user: User = Depends(get_current_user)):
    return _find(complaint_id)


@router.post("/{complaint_id}/analyze")
def analyze(complaint_id: str, current_user: User = Depends(get_current_user)):
    complaint = _find(complaint_id)
    return analyze_complaint(complaint)


@router.post("/{complaint_id}/draft-response")
def draft(complaint_id: str, current_user: User = Depends(get_current_user)):
    complaint = _find(complaint_id)
    return draft_response(complaint)
