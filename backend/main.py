from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints import contacts, emails, meetings, voice, quick_email

app = FastAPI(
    title="Tiby API",
    description="AI Personal Assistant — Phase 1",
    version="1.0.0",
)

origins = [o.strip() for o in settings.ALLOWED_ORIGINS.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

app.include_router(contacts.router,    prefix="/api/v1")
app.include_router(emails.router,      prefix="/api/v1")
app.include_router(quick_email.router, prefix="/api/v1")
app.include_router(meetings.router,    prefix="/api/v1")
app.include_router(voice.router,       prefix="/api/v1")


@app.get("/")
async def health():
    return {"status": "ok", "app": "Tiby API", "version": "1.0.0"}
