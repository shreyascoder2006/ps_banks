import asyncio

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from ..services import events, simulator

router = APIRouter(tags=["realtime"])


@router.websocket("/ws/events")
async def ws_events(websocket: WebSocket):
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
def recent_events(limit: int = 50):
    return {"events": events.recent(limit)}


@router.get("/simulation/status")
def simulation_status():
    return {**simulator.status(), "subscribers": events.subscriber_count()}


@router.post("/simulation/start")
async def simulation_start(speed: float = 1.0):
    events.bind_loop(asyncio.get_running_loop())
    return simulator.start(speed)


@router.post("/simulation/stop")
async def simulation_stop():
    return simulator.stop()
