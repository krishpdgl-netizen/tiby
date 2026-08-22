import logging
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.core.logging import configure_logging
from app.api.v1.endpoints import agent, analytics, contacts, emails, meetings, tasks, voice, profile

configure_logging()
log = logging.getLogger("tiby")

app = FastAPI(
    title="Tiby API",
    description="AI Personal Assistant",
    version="2.0.0",
    docs_url="/docs" if settings.APP_ENV != "production" else None,
    redoc_url=None,
)

_origins = settings.allowed_origins_list
if "https://tiby.vercel.app" not in _origins:
    _origins = ["https://tiby.vercel.app"] + _origins

app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type", "X-Request-ID"],
)


@app.middleware("http")
async def request_context(request: Request, call_next):
    rid = request.headers.get("X-Request-ID") or str(uuid.uuid4())
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception("request_failed request_id=%s path=%s", rid, request.url.path)
        raise
    response.headers["X-Request-ID"] = rid
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    response.headers["Permissions-Policy"] = "camera=(self), microphone=(self), geolocation=()"
    response.headers["Cache-Control"] = (
        "no-store" if request.url.path.startswith("/api/") else "no-cache"
    )
    ms = int((time.perf_counter() - start) * 1000)
    log.info(
        "request request_id=%s method=%s path=%s status=%s ms=%d",
        rid, request.method, request.url.path, response.status_code, ms,
    )
    return response


@app.on_event("startup")
async def startup():
    try:
        from sqlalchemy import text
        from app.core.database import _get_engine
        from app.models.models import Base
        engine = _get_engine()
        async with engine.begin() as conn:
            await conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE taskstatus AS ENUM ('pending', 'done', 'cancelled');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))
            await conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE meetingstatus AS ENUM ('recording', 'processing', 'done', 'failed');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))
            await conn.execute(text("""
                DO $$ BEGIN
                    CREATE TYPE agentrunstatus AS ENUM ('running', 'completed', 'failed');
                EXCEPTION WHEN duplicate_object THEN NULL;
                END $$;
            """))
            await conn.run_sync(Base.metadata.create_all)
        log.info("Database tables and enum types ready.")
    except Exception as e:
        log.error("Startup DB init failed: %s", e)


API_PREFIX = "/api/v1"

for router in (
    agent.router,
    analytics.router,
    contacts.router,
    emails.router,
    meetings.router,
    tasks.router,
    voice.router,
    profile.router,
):
    app.include_router(router, prefix=API_PREFIX)


@app.get("/healthz")
async def health():
    return {"status": "ok", "app": "Tiby API", "version": "2.0.0"}


@app.get("/")
async def root():
    return {"status": "ok", "app": "Tiby API", "version": "2.0.0"}
import httpx, asyncio

@app.on_event("startup")
async def keep_alive():
    async def ping():
        while True:
            await asyncio.sleep(800)  # every 10 min
            try:
                async with httpx.AsyncClient() as c:
                    await c.get("https://tiby.onrender.com/healthz", timeout=5)
            except: pass
    asyncio.create_task(ping())
