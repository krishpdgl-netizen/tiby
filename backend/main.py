from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings
from app.api.v1.endpoints import contacts, emails, meetings, voice, quick_email

app = FastAPI(
    title="Tiby API",
    description="AI Personal Assistant — Phase 1",
    version="1.0.0",
)

# ── CORS — handle OPTIONS at middleware level before routing ──────────────────
@app.middleware("http")
async def cors_handler(request: Request, call_next):
    if request.method == "OPTIONS":
        return JSONResponse(
            content={},
            headers={
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS, PATCH",
                "Access-Control-Allow-Headers": "*",
                "Access-Control-Max-Age": "86400",
            }
        )
    response = await call_next(request)
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Headers"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, PUT, DELETE, OPTIONS, PATCH"
    return response

app.include_router(contacts.router,    prefix="/api/v1")
app.include_router(emails.router,      prefix="/api/v1")
app.include_router(quick_email.router, prefix="/api/v1")
app.include_router(meetings.router,    prefix="/api/v1")
app.include_router(voice.router,       prefix="/api/v1")


@app.get("/")
async def health():
    return {"status": "ok", "app": "Tiby API", "version": "1.0.0"}
