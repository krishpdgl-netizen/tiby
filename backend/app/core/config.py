from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-change-in-production"
    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173", "http://localhost:8081"]

    # Neon PostgreSQL
    DATABASE_URL: str = ""

    # Supabase (auth + storage)
    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    # AI
    GEMINI_API_KEY: str = ""
    DEEPGRAM_API_KEY: str = ""

    # Redis (Upstash)
    REDIS_URL: str = "redis://localhost:6379"

    # Google OAuth — leave blank until Google Cloud Console is set up
    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/gmail/callback"

    class Config:
        env_file = ".env"


settings = Settings()
