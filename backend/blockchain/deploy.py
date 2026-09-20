"""Compiles and deploys AuditTrail.sol to a local Ganache instance for demo
purposes. Adapted from the original Outliers `blockchain/deploy.py`.

Usage (with Ganache running on http://127.0.0.1:7545):
    pip install py-solc-x
    export GANACHE_PRIVATE_KEY="0x..."   # a Ganache dev account's private key
    python blockchain/deploy.py
"""
import json
import os
from pathlib import Path

from solcx import compile_source, install_solc
from web3 import Web3

BASE_DIR = Path(__file__).resolve().parent


def compile_contract() -> dict:
    install_solc("0.8.0")
    source = (BASE_DIR / "AuditTrail.sol").read_text()
    compiled = compile_source(source, output_values=["abi", "bin"], solc_version="0.8.0")
    contract_id, contract_interface = next(iter(compiled.items()))
    return contract_interface


def deploy(rpc_url: str, private_key: str) -> dict:
    interface = compile_contract()
    abi = interface["abi"]
    bytecode = interface["bin"]

    web3 = Web3(Web3.HTTPProvider(rpc_url))
    if not web3.is_connected():
        raise RuntimeError(f"Unable to connect to node at {rpc_url}. Is Ganache running?")

    account = web3.eth.account.from_key(private_key)
    Contract = web3.eth.contract(abi=abi, bytecode=bytecode)

    tx = Contract.constructor().build_transaction({
        "from": account.address,
        "nonce": web3.eth.get_transaction_count(account.address),
        "gas": 3_000_000,
        "gasPrice": web3.to_wei("1", "gwei"),
    })
    signed = account.sign_transaction(tx)
    tx_hash = web3.eth.send_raw_transaction(signed.raw_transaction)
    receipt = web3.eth.wait_for_transaction_receipt(tx_hash)

    (BASE_DIR / "AuditTrail.abi.json").write_text(json.dumps(abi, indent=2))

    return {"contract_address": receipt.contractAddress, "abi_path": str(BASE_DIR / "AuditTrail.abi.json")}


if __name__ == "__main__":
    rpc = os.getenv("GANACHE_RPC_URL", "http://127.0.0.1:7545")
    key = os.getenv("GANACHE_PRIVATE_KEY", "")
    if not key:
        raise SystemExit("Set GANACHE_PRIVATE_KEY (a Ganache dev account key) before deploying.")
    result = deploy(rpc, key)
    print("Deployed:", result)
    print("Add these to backend/.env:")
    print(f"  AUDIT_CONTRACT_ADDRESS={result['contract_address']}")
    print(f"  AUDIT_CONTRACT_ABI_PATH={result['abi_path']}")
