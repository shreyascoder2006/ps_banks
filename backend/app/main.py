from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import CORS_ORIGINS
from .db import init_db, session_scope
from .routers import (
    activity_routes,
    realtime_routes,
    assistant_routes,
    auth_routes,
    blockchain_routes,
    complaints_routes,
    customers,
    forecast_routes,
    outreach_routes,
    segments,
    sentiment_routes,
    trends_routes,
)
from .services.churn import get_model_bundle
from .services.complaints import seed_complaints_if_empty


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Train (or load a cached) churn model once at startup instead of on
    # first request, so the first API call isn't slow.
    from .services import events
    import asyncio
    events.bind_loop(asyncio.get_running_loop())
    init_db()
    get_model_bundle()
    with session_scope() as session:
        seed_complaints_if_empty(session)
    yield


app = FastAPI(title="ps_banks API", version="0.1.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_routes.router)
app.include_router(customers.router)
app.include_router(segments.router)
app.include_router(forecast_routes.router)
app.include_router(trends_routes.router)
app.include_router(sentiment_routes.router)
app.include_router(complaints_routes.router)
app.include_router(outreach_routes.router)
app.include_router(activity_routes.router)
app.include_router(realtime_routes.router)
app.include_router(assistant_routes.router)
app.include_router(blockchain_routes.router)


@app.get("/")
def root():
    return {"service": "ps_banks API", "status": "ok"}
