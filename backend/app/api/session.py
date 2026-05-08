from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from app.engine.trading_session import TradingSession
from app.models.session_config import SessionConfig
from app.core.config import settings
import uuid
import asyncio
import logging

logger = logging.getLogger(__name__)
router = APIRouter()

# Global session state (single user for demo)
active_session = None
session_lock = asyncio.Lock()

@router.post("/start")
async def start_session(config: SessionConfig):
    global active_session
    async with session_lock:
        if active_session and active_session.running:
            raise HTTPException(status_code=400, detail="Session already running")
        
        strategy_id = str(uuid.uuid4())[:8]
        active_session = TradingSession(user_id="default_user", strategy_id=strategy_id, config=config)
        
        # In a real app, we'd initialize the Binance client here
        # from binance import AsyncClient
        # client = await AsyncClient.create(settings.BINANCE_API_KEY, settings.BINANCE_SECRET_KEY)
        
        await active_session.start()
        return {"status": "success", "strategy_id": strategy_id}

@router.post("/stop")
async def stop_session():
    global active_session
    logger.info("Stop session requested")
    async with session_lock:
        logger.info("Stop session lock acquired")
        if not active_session or not active_session.running:
            logger.warning("Stop session failed: No session running or active_session is None")
            raise HTTPException(status_code=400, detail="No session running")
        
        await active_session.stop()
        logger.info("Session stopped successfully")
        return {"status": "success"}

@router.get("/status")
async def get_status():
    if not active_session:
        return {"running": False}
    return active_session.get_status()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    logger.info("WebSocket connected")
    
    async def broadcaster(data):
        try:
            await websocket.send_json(data)
        except Exception as e:
            logger.error(f"WS send error: {e}")

    if active_session:
        active_session.set_ws_broadcaster(broadcaster)
    
    try:
        while True:
            # Wait for any message or just keep it open
            await websocket.receive_text()
    except WebSocketDisconnect:
        logger.info("WebSocket disconnected")
        if active_session:
            active_session.set_ws_broadcaster(None)
    except Exception as e:
        logger.error(f"WS error: {e}")
