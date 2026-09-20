"""Real signed-JWT auth (replaces the base64-only "token" from the original
Outliers backend and the no-backend-at-all approach in the original Aurus
frontend). Tokens are signed with JWT_SECRET and verified server-side on
every request; nothing about the role/identity is client-trusted.
"""
from datetime import datetime, timedelta, timezone
from typing import Optional

import jwt
from fastapi import Depends, Header, HTTPException
from passlib.context import CryptContext
from pydantic import BaseModel

from .config import JWT_ALGORITHM, JWT_EXPIRE_MINUTES, JWT_SECRET

pwd_context = CryptContext(schemes=["pbkdf2_sha256"], deprecated="auto")


class User(BaseModel):
    username: str
    role: str
    branch: str


# Demo user directory. In a real deployment this would be a database table;
# passwords are bcrypt-hashed even for this demo so nothing is stored in
# plaintext.
_DEMO_USERS = {
    "agent": {
        "password_hash": pwd_context.hash("agent123"),
        "role": "agent",
        "branch": "Mumbai Main",
    },
    "admin": {
        "password_hash": pwd_context.hash("admin123"),
        "role": "admin",
        "branch": "Head Office",
    },
}


def authenticate(username: str, password: str) -> Optional[User]:
    record = _DEMO_USERS.get(username)
    if not record or not pwd_context.verify(password, record["password_hash"]):
        return None
    return User(username=username, role=record["role"], branch=record["branch"])


def create_access_token(user: User) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": user.username,
        "role": user.role,
        "branch": user.branch,
        "iat": now,
        "exp": now + timedelta(minutes=JWT_EXPIRE_MINUTES),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def get_current_user(authorization: str = Header(default="")) -> User:
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid authentication token")

    username = payload.get("sub")
    role = payload.get("role")
    branch = payload.get("branch", "")
    if not username or not role:
        raise HTTPException(status_code=401, detail="Malformed token")
    return User(username=username, role=role, branch=branch)


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin privileges required")
    return current_user
