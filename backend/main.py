from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints import contacts, emails, meetings, voice

app = FastAPI(
    title="Tiby API",
    description="AI Personal Assistant — Phase 1",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(contacts.router, prefix="/api/v1")
app.include_router(emails.router, prefix="/api/v1")
app.include_router(meetings.router, prefix="/api/v1")
app.include_router(voice.router, prefix="/api/v1")


@app.get("/")
async def health():
    return {"status": "ok", "app": "Tiby API", "version": "1.0.0"}


@app.get("/api/v1/health")
async def api_health():
    return {"status": "ok"}
