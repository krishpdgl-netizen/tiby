import secrets
import uuid
import urllib.parse
from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from pydantic import BaseModel, EmailStr, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import redis.asyncio as redis
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import Contact, EmailLog, User
from app.services.ai_service import draft_email
from app.services.gmail_service import get_gmail_auth_url, exchange_code_for_tokens, store_tokens, send_email as gmail_send

router = APIRouter(prefix='/emails', tags=['emails'])

class DraftRequest(BaseModel):
    contact_id: uuid.UUID
    voice_instruction: str = Field(min_length=1, max_length=5000)
class QuickDraftRequest(BaseModel):
    contact: dict
    voice_instruction: str = Field(min_length=1, max_length=5000)
class SendRequest(BaseModel):
    contact_id: uuid.UUID
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50000)
    voice_instruction: str | None = None
class QuickSendRequest(BaseModel):
    to_email: EmailStr
    subject: str = Field(min_length=1, max_length=500)
    body: str = Field(min_length=1, max_length=50000)

async def _db_user(db: AsyncSession, user_id):
    q = await db.execute(select(User).where(User.id == user_id)); return q.scalar_one()

@router.post('/draft')
async def draft_for_contact(req: DraftRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai-email', settings.AI_RATE_LIMIT_PER_MINUTE)
    q = await db.execute(select(Contact).where(Contact.id == req.contact_id, Contact.user_id == user.id))
    c = q.scalar_one_or_none()
    if not c: raise HTTPException(404, 'Contact not found')
    d = await draft_email({'name':c.name,'email':c.email,'company':c.company,'role':c.role}, req.voice_instruction, user.name)
    u = await _db_user(db, user.id)
    return {**d, 'speak_text':f"Subject: {d['subject']}. {d['body']}", 'contact':{'name':c.name,'email':c.email}, 'gmail_connected':u.gmail_connected}

@router.post('/draft-quick')
async def draft_quick(req: QuickDraftRequest, user: CurrentUser):
    await enforce_rate_limit(str(user.id), 'ai-email', settings.AI_RATE_LIMIT_PER_MINUTE)
    d = await draft_email(req.contact, req.voice_instruction, user.name)
    return {**d, 'speak_text':f"Subject: {d['subject']}. {d['body']}"}

async def _send_or_mailto(db, u: User, to_email: str, subject: str, body: str, contact_id=None, voice_instruction=None):
    log = EmailLog(user_id=u.id, contact_id=contact_id, to_email=to_email, subject=subject, body=body, voice_instruction=voice_instruction)
    db.add(log)
    if u.gmail_connected:
        try:
            gid = await gmail_send(u, to_email, subject, body)
            log.gmail_message_id = gid; log.sent_at = datetime.now(timezone.utc)
            await db.commit()
            return {'success':True,'method':'gmail','gmail_message_id':gid}
        except Exception as exc:
            log.error = str(exc)[:2000]
            u.gmail_connected = False
    await db.commit()
    mailto = f"mailto:{to_email}?subject={urllib.parse.quote(subject)}&body={urllib.parse.quote(body)}"
    return {'success':False,'method':'manual','mailto':mailto,'to':to_email,'subject':subject,'body':body}

@router.post('/send')
async def send(req: SendRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Contact).where(Contact.id == req.contact_id, Contact.user_id == user.id))
    c = q.scalar_one_or_none()
    if not c or not c.email: raise HTTPException(404, 'Contact or contact email not found')
    return await _send_or_mailto(db, await _db_user(db,user.id), c.email, req.subject, req.body, c.id, req.voice_instruction)

@router.post('/send-quick')
async def send_quick(req: QuickSendRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    return await _send_or_mailto(db, await _db_user(db,user.id), str(req.to_email), req.subject, req.body)

@router.get('/auth/url')
async def gmail_auth_url(user: CurrentUser):
    if not settings.GOOGLE_CLIENT_ID: return {'auth_url':None,'message':'Google OAuth is not configured'}
    state = secrets.token_urlsafe(32)
    client = redis.from_url(settings.REDIS_URL, encoding='utf-8', decode_responses=True)
    await client.setex(f'oauth:gmail:{state}', 600, str(user.id))
    return {'auth_url':get_gmail_auth_url(state)}

@router.get('/auth/callback')
async def gmail_callback(code: str, state: str, db: AsyncSession = Depends(get_db)):
    client = redis.from_url(settings.REDIS_URL, encoding='utf-8', decode_responses=True)
    key = f'oauth:gmail:{state}'
    user_id = await client.get(key)
    if not user_id: raise HTTPException(400, 'Invalid or expired OAuth state')
    await client.delete(key)
    tokens = await exchange_code_for_tokens(code)
    q = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
    u = q.scalar_one_or_none()
    if not u: raise HTTPException(404, 'User not found')
    store_tokens(u, tokens); await db.commit()
    return RedirectResponse(url=f"{settings.FRONTEND_URL.rstrip('/')}/settings?gmail=connected", status_code=302)

@router.get('/auth/status')
async def gmail_status(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    u = await _db_user(db, user.id)
    return {'connected': bool(u.gmail_connected)}
