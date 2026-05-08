from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    BINANCE_API_KEY: str = ""
    BINANCE_SECRET_KEY: str = ""
    BINANCE_TESTNET: bool = True
    
    class Config:
        env_file = ".env"

settings = Settings()
