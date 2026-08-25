from functools import lru_cache
from pydantic import field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file='.env', extra='ignore', case_sensitive=True)

    APP_ENV: str = 'development'
    APP_NAME: str = 'Tiby API'
    FRONTEND_URL: str = 'http://localhost:5173'
    ALLOWED_ORIGINS: str = 'http://localhost:5173'

    # Neon PostgreSQL
    DATABASE_URL: str = ''
    ASYNC_DATABASE_URL: str = ''

    # Supabase
    SUPABASE_URL: str = ''
    SUPABASE_ANON_KEY: str = ''
    SUPABASE_SERVICE_KEY: str = ''

    # JWT verification — local (fast, no network call)
    # Get from: Supabase Dashboard → Settings → API → JWT Keys → ⋮ → Copy public key
    SUPABASE_JWT_PUBLIC_KEY: str = ''
    # Legacy HS256 fallback (older Supabase projects)
    SUPABASE_JWT_SECRET: str = ''

    # AI
    GEMINI_API_KEY: str = ''
    GEMINI_MODEL: str = 'gemini-3.1-flash-lite'
    GEMINI_VISION_MODEL: str = 'gemini-3.1-flash-lite'
    DEEPGRAM_API_KEY: str = ''

    # Redis (Upstash)
    REDIS_URL: str = 'redis://localhost:6379/0'
    RATE_LIMIT_PER_MINUTE: int = 60
    AI_RATE_LIMIT_PER_MINUTE: int = 15

    # Google OAuth
    GOOGLE_CLIENT_ID: str = ''
    GOOGLE_CLIENT_SECRET: str = ''
    GOOGLE_REDIRECT_URI: str = 'http://localhost:8000/api/v1/emails/auth/callback'
    TOKEN_ENCRYPTION_KEY: str = ''

    # Supabase Storage buckets
    STORAGE_CARD_BUCKET: str = 'cards'
    STORAGE_AUDIO_BUCKET: str = 'audio'
    SIGNED_URL_TTL_SECONDS: int = 300

    # Upload limits
    MAX_CARD_BYTES: int = 10 * 1024 * 1024
    MAX_VOICE_BYTES: int = 5 * 1024 * 1024
    MAX_MEETING_BYTES: int = 250 * 1024 * 1024

    LOG_LEVEL: str = 'INFO'

    # Memory / embeddings
    GEMINI_EMBEDDING_MODEL: str = 'models/embedding-001'
    MEMORY_EMBEDDING_DIMENSIONS: int = 768

    @property
    def allowed_origins_list(self) -> list[str]:
        return [x.strip().rstrip('/') for x in self.ALLOWED_ORIGINS.split(',') if x.strip()]

    @property
    def async_database_url(self) -> str:
        if self.ASYNC_DATABASE_URL:
            return self.ASYNC_DATABASE_URL
        if self.DATABASE_URL.startswith('postgresql://'):
            return self.DATABASE_URL.replace('postgresql://', 'postgresql+asyncpg://', 1)
        return self.DATABASE_URL

    @field_validator('APP_ENV')
    @classmethod
    def validate_env(cls, v: str) -> str:
        if v not in {'development', 'test', 'production'}:
            raise ValueError('APP_ENV must be development, test, or production')
        return v


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
