"""Demo Ganache blockchain integration for the audit trail.

Security fix vs. the original Outliers backend: the original exposed
`GET /blockchain/store_forecast?...&private_key=Z` - a wallet private key
as a URL query parameter, which ends up in server access logs and browser
history. Here the RPC URL, private key, and contract address are all
server-side configuration (backend/.env) and are never accepted as request
parameters from the client at all.
"""
import hashlib
import json
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Optional

from web3 import Web3

from ..config import AUDIT_CONTRACT_ABI_PATH, AUDIT_CONTRACT_ADDRESS, GANACHE_PRIVATE_KEY, GANACHE_RPC_URL


def sha256_hex(data: str) -> str:
    return hashlib.sha256(data.encode("utf-8")).hexdigest()


def _configured() -> bool:
    return bool(GANACHE_PRIVATE_KEY and AUDIT_CONTRACT_ADDRESS and Path(AUDIT_CONTRACT_ABI_PATH).exists())


@lru_cache(maxsize=1)
def _contract():
    web3 = Web3(Web3.HTTPProvider(GANACHE_RPC_URL))
    abi = json.loads(Path(AUDIT_CONTRACT_ABI_PATH).read_text())
    contract = web3.eth.contract(address=web3.to_checksum_address(AUDIT_CONTRACT_ADDRESS), abi=abi)
    return web3, contract


def store_audit_record(record_type: str, description: str, payload_hash_hex: str) -> Dict[str, Any]:
    """Store a hash of an audit-worthy action (churn intervention taken,
    complaint marked resolved, forecast snapshot) immutably on the demo
    chain. Falls back to a clearly-labelled local-only stub if Ganache /
    the contract isn't configured, instead of silently pretending success.
    """
    if not _configured():
        return {
            "status": "not_configured",
            "detail": "Ganache/AuditTrail contract not configured on the server (see backend/.env). "
                      "This action was NOT written to the chain.",
            "record_hash": payload_hash_hex,
        }

    web3, contract = _contract()
    account = web3.eth.account.from_key(GANACHE_PRIVATE_KEY)
    record_hash_bytes = bytes.fromhex(payload_hash_hex[:64].ljust(64, "0"))

    tx = contract.functions.addRecord(record_hash_bytes, record_type, description).build_transaction({
        "from": account.address,
        "nonce": web3.eth.get_transaction_count(account.address),
        "gas": 500_000,
        "gasPrice": web3.to_wei("1", "gwei"),
    })
    signed = account.sign_transaction(tx)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)

    if receipt.status != 1:
        return {
            "status": "failed",
            "detail": "Transaction reverted on-chain - see tx_hash for the failed receipt.",
            "tx_hash": tx_hash.hex(),
            "block_number": receipt.blockNumber,
            "record_hash": payload_hash_hex,
        }

    return {
        "status": "stored",
        "tx_hash": tx_hash.hex(),
        "block_number": receipt.blockNumber,
        "record_hash": payload_hash_hex,
        "contract_address": AUDIT_CONTRACT_ADDRESS,
    }


def record_event(record_type: str, description: str, payload: str) -> Dict[str, Any]:
    """Fire-and-forget audit write for application events (complaint
    resolved, outreach triggered). Never raises - a chain hiccup must not
    fail the business action - but always returns the real outcome so the
    caller can persist status/tx_hash instead of assuming success."""
    try:
        return store_audit_record(record_type, description, sha256_hex(payload))
    except Exception as exc:
        return {"status": "error", "detail": str(exc), "record_hash": sha256_hex(payload)}


def list_audit_records(limit: int = 20) -> Dict[str, Any]:
    if not _configured():
        return {"status": "not_configured", "records": []}
    try:
        _, contract = _contract()
        total = contract.functions.totalRecords().call()
        start = max(0, total - limit)
        records = []
        for i in range(total - 1, start - 1, -1):
            record_hash, record_type, description, timestamp, stored_by = contract.functions.getRecord(i).call()
            records.append({
                "index": i,
                "record_hash": record_hash.hex(),
                "record_type": record_type,
                "description": description,
                "timestamp": timestamp,
                "stored_by": stored_by,
            })
        return {"status": "ok", "total_records": total, "records": records}
    except Exception as exc:
        return {"status": "error", "detail": str(exc), "records": []}


def get_latest_audit_record() -> Dict[str, Any]:
    if not _configured():
        return {"status": "not_configured", "detail": "Ganache/AuditTrail contract not configured on the server."}
    try:
        _, contract = _contract()
        record_hash, record_type, description, timestamp, stored_by = contract.functions.getLatestRecord().call()
        total = contract.functions.totalRecords().call()
        return {
            "status": "ok",
            "record_hash": record_hash.hex(),
            "record_type": record_type,
            "description": description,
            "timestamp": timestamp,
            "stored_by": stored_by,
            "total_records": total,
        }
    except Exception as exc:
        return {"status": "error", "detail": str(exc)}
