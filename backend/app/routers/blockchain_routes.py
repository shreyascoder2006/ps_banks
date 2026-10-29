from fastapi import APIRouter
from pydantic import BaseModel
from ..services.blockchain import get_latest_audit_record, list_audit_records, list_blocks, sha256_hex, store_audit_record

router = APIRouter(prefix="/blockchain", tags=["blockchain"])


class AuditRequest(BaseModel):
    record_type: str
    description: str
    payload: str  # arbitrary text describing the action; server hashes it


@router.post("/audit")
def audit(body: AuditRequest):
    record_hash = sha256_hex(body.payload)
    return store_audit_record(body.record_type, body.description, record_hash)


@router.get("/audit/latest")
def audit_latest():
    return get_latest_audit_record()


@router.get("/audit/records")
def audit_records(limit: int = 20):
    return list_audit_records(limit=limit)


@router.get("/blocks")
def blocks(limit: int = 12):
    return list_blocks(limit=limit)
