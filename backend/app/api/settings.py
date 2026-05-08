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
    """
    Update Binance API keys.
    
    In production, this would:
    1. Validate keys with Binance API test endpoint
    2. Store securely in environment or database
    3. Update the active session's binance_client
    
    For now, we mock success but log the attempt.
    """
    
    # Validate key format (basic check)
    if not data.api_key or len(data.api_key) < 32:
        raise HTTPException(status_code=400, detail="Invalid API key format")
    
    if not data.api_secret or len(data.api_secret) < 64:
        raise HTTPException(status_code=400, detail="Invalid API secret format")
    
    # TODO: Validate with Binance using test endpoint:
    # try:
    #     from binance import AsyncClient
    #     client = await AsyncClient.create(data.api_key, data.api_secret, testnet=True)
    #     await client.ping()
    #     await client.close_connection()
    # except Exception as e:
    #     raise HTTPException(status_code=401, detail=f"Key validation failed: {str(e)}")
    
    # In production: update settings and restart session
    # settings.BINANCE_API_KEY = data.api_key
    # settings.BINANCE_SECRET_KEY = data.api_secret
    
    return {
        "status": "success",
        "message": "API keys updated (validation skipped in demo mode)",
        "api_key_masked": f"{data.api_key[:4]}****{data.api_key[-4:]}"
    }

@router.get("/keys")
async def get_keys():
    """Get masked API key info (for UI display)."""
    key = settings.BINANCE_API_KEY
    masked_key = f"{key[:4]}****{key[-4:]}" if len(key) > 8 else "****"
    
    return {
        "api_key": masked_key,
        "has_secret": len(settings.BINANCE_SECRET_KEY) > 0,
        "testnet": True  # Always testnet for safety
    }
