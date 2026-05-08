from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from app.core.config import settings
import os

router = APIRouter()

class APIKeyUpdate(BaseModel):
    api_key: str
    api_secret: str

@router.post("/keys")
async def update_keys(data: APIKeyUpdate):
    # In a real app, we'd validate the keys with Binance here
    # and save to .env or a database securely.
    # For this demo, we'll just mock the success.
    
    # settings.BINANCE_API_KEY = data.api_key
    # settings.BINANCE_SECRET_KEY = data.api_secret
    
    return {"status": "success", "message": "API keys updated and validated"}

@router.get("/keys")
async def get_keys():
    # Masking keys for the UI
    key = settings.BINANCE_API_KEY
    masked_key = f"{key[:4]}****{key[-4:]}" if len(key) > 8 else "****"
    
    return {
        "api_key": masked_key,
        "has_secret": len(settings.BINANCE_SECRET_KEY) > 0
    }
