import logging
import time
import uuid
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from app.core.config import settings
from app.core.logging import configure_logging
from app.api.v1.endpoints import agent, analytics, contacts, emails, meetings, tasks, voice

configure_logging()
log = logging.getLogger('tiby')

app = FastAPI(
    title='Tiby API',
    description='AI Personal Assistant',
    version='2.0.0',
    # Hide docs in production
    docs_url='/docs' if settings.APP_ENV != 'production' else None,
    redoc_url=None,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.allowed_origins_list + ['https://tiby.vercel.app'],
    allow_credentials=True,
    allow_methods=['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allow_headers=['Authorization', 'Content-Type', 'X-Request-ID'],
)


@app.middleware('http')
async def request_context(request: Request, call_next):
    rid = request.headers.get('X-Request-ID') or str(uuid.uuid4())
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        log.exception('request_failed request_id=%s path=%s', rid, request.url.path)
        raise
    response.headers['X-Request-ID'] = rid
    response.headers['X-Content-Type-Options'] = 'nosniff'
    response.headers['Referrer-Policy'] = 'strict-origin-when-cross-origin'
    response.headers['Permissions-Policy'] = 'camera=(self), microphone=(self), geolocation=()'
    response.headers['Cache-Control'] = 'no-store' if request.url.path.startswith('/api/') else 'no-cache'
    ms = int((time.perf_counter() - start) * 1000)
    log.info('request request_id=%s method=%s path=%s status=%s ms=%d', rid, request.method, request.url.path, response.status_code, ms)
    return response


for router in (agent.router, analytics.router, contacts.router, emails.router, meetings.router, tasks.router, voice.router):
    app.include_router(router, prefix=settings.API_V1_PREFIX if hasattr(settings, 'API_V1_PREFIX') else '/api/v1')


@app.get('/healthz')
async def health():
    return {'status': 'ok', 'app': 'Tiby API', 'version': '2.0.0'}


@app.get('/')
async def root():
    return {'status': 'ok', 'app': 'Tiby API', 'version': '2.0.0'}
