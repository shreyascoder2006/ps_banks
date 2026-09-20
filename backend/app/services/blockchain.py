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
        "gas": 200_000,
        "gasPrice": web3.to_wei("1", "gwei"),
    })
    signed = account.sign_transaction(tx)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)

    return {
        "status": "stored",
        "tx_hash": tx_hash.hex(),
        "block_number": receipt.blockNumber,
        "record_hash": payload_hash_hex,
        "contract_address": AUDIT_CONTRACT_ADDRESS,
    }


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
