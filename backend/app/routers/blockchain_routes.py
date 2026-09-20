from fastapi import APIRouter, Depends
from pydantic import BaseModel

from ..auth import User, get_current_user, require_admin
from ..services.blockchain import get_latest_audit_record, list_audit_records, sha256_hex, store_audit_record

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


class AuditRequest(BaseModel):
    record_type: str
    description: str
    payload: str  # arbitrary text describing the action; server hashes it


@router.post("/audit")
def audit(body: AuditRequest, current_user: User = Depends(require_admin)):
    record_hash = sha256_hex(body.payload)
    return store_audit_record(body.record_type, body.description, record_hash)


@router.get("/audit/latest")
def audit_latest(current_user: User = Depends(get_current_user)):
    return get_latest_audit_record()


@router.get("/audit/records")
def audit_records(limit: int = 20, current_user: User = Depends(get_current_user)):
    return list_audit_records(limit=limit)
