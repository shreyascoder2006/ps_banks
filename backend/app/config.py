import os
from pathlib import Path

from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-insecure-secret-change-me")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173").split(",") if o.strip()]

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")

GANACHE_RPC_URL = os.getenv("GANACHE_RPC_URL", "http://127.0.0.1:7545")
GANACHE_PRIVATE_KEY = os.getenv("GANACHE_PRIVATE_KEY", "")
AUDIT_CONTRACT_ADDRESS = os.getenv("AUDIT_CONTRACT_ADDRESS", "")
AUDIT_CONTRACT_ABI_PATH = os.getenv("AUDIT_CONTRACT_ABI_PATH", "blockchain/AuditTrail.abi.json")

DATA_DIR = BASE_DIR / "data"
CHURN_DATA_PATH = DATA_DIR / "churn_data.csv"
BANKCHURNERS_DATA_PATH = DATA_DIR / "BankChurners.csv"
DOCS_DIR = DATA_DIR / "docs"
MODEL_DIR = BASE_DIR / "app" / "_artifacts"
MODEL_DIR.mkdir(parents=True, exist_ok=True)
