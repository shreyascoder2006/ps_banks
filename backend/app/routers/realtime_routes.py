import asyncio

import jwt
from fastapi import APIRouter, Depends, Query, WebSocket, WebSocketDisconnect

from ..auth import User, get_current_user, require_admin
from ..config import JWT_ALGORITHM, JWT_SECRET
from ..services import events, simulator

router = APIRouter(tags=["realtime"])


def _verify_ws_token(token: str) -> bool:
    try:
        jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return True
    except jwt.InvalidTokenError:
        return False


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket, token: str = Query(default="")):
    if not _verify_ws_token(token):
        await websocket.close(code=4401)
        return
    await websocket.accept()
    events.bind_loop(asyncio.get_running_loop())
    queue = events.subscribe()
    try:
        await websocket.send_text(events.serialize({
            "type": "hello", "title": "connected", "severity": None, "ref": {}, "at": None,
            "data": {"simulation": simulator.status(), "recent": events.recent(20)},
        }))
        while True:
            try:
                event = await asyncio.wait_for(queue.get(), timeout=25)
                await websocket.send_text(events.serialize(event))
            except asyncio.TimeoutError:
                await websocket.send_text(events.serialize({"type": "ping", "title": "", "severity": None, "ref": {}, "data": {}, "at": None}))
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        events.unsubscribe(queue)


@router.get("/events/recent")
def recent_events(limit: int = 50, current_user: User = Depends(get_current_user)):
    return {"events": events.recent(limit)}


@router.get("/simulation/status")
def simulation_status(current_user: User = Depends(get_current_user)):
    return {**simulator.status(), "subscribers": events.subscriber_count()}


@router.post("/simulation/start")
async def simulation_start(speed: float = 1.0, current_user: User = Depends(get_current_user)):
    events.bind_loop(asyncio.get_running_loop())
    return simulator.start(speed)


@router.post("/simulation/stop")
async def simulation_stop(current_user: User = Depends(get_current_user)):
    return simulator.stop()
