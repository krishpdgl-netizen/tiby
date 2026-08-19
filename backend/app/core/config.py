from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    APP_ENV: str = "development"
    SECRET_KEY: str = "dev-secret-change-in-production"
    ALLOWED_ORIGINS: str = "http://localhost:5173"

    DATABASE_URL: str = ""
    ASYNC_DATABASE_URL: str = ""

    SUPABASE_URL: str = ""
    SUPABASE_SERVICE_KEY: str = ""

    GEMINI_API_KEY: str = ""
    DEEPGRAM_API_KEY: str = ""

    REDIS_URL: str = "redis://localhost:6379"

    GOOGLE_CLIENT_ID: str = ""
    GOOGLE_CLIENT_SECRET: str = ""
    GOOGLE_REDIRECT_URI: str = "http://localhost:8000/api/v1/auth/gmail/callback"

    class Config:
        env_file = ".env"


settings = Settings()
