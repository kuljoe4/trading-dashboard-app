from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.api import settings as settings_api
from app.api import session as session_api

app = FastAPI(title="Momentum Engine API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(settings_api.router, prefix="/api/settings", tags=["settings"])
app.include_router(session_api.router, prefix="/api/session", tags=["session"])

@app.get("/")
async def root():
    return {"status": "ok", "message": "Trading Dashboard API is running"}
