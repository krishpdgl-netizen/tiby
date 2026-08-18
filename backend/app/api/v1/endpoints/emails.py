"""
Email API
POST /emails/draft      — voice instruction → AI draft → text for TTS
POST /emails/send       — (Gmail not set up yet) returns email content for manual send
GET  /emails/auth/url   — placeholder until Google Cloud is configured
GET  /emails/auth/callback
"""
import uuid
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import RedirectResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.models.models import Contact, EmailLog, User
from app.services.ai_service import draft_email
from app.services.tts_service import email_to_speech

router = APIRouter(prefix="/emails", tags=["emails"])


def get_current_user_id() -> uuid.UUID:
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


class DraftRequest(BaseModel):
    contact_id: uuid.UUID
    voice_instruction: str


class SendRequest(BaseModel):
    contact_id: uuid.UUID
    subject: str
    body: str
    voice_instruction: str | None = None


@router.post("/draft")
async def draft_email_for_contact(
    req: DraftRequest,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    1. Load contact
    2. Draft email with Gemini
    3. Return draft + text for browser TTS
    """
    result = await db.execute(
        select(Contact).where(Contact.id == req.contact_id, Contact.user_id == user_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(404, "Contact not found")

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    contact_dict = {
        "name": contact.name,
        "email": contact.email,
        "company": contact.company,
        "role": contact.role,
    }
    draft = await draft_email(
        contact=contact_dict,
        user_instruction=req.voice_instruction,
        user_name=user.name if user else None,
    )

    # Get text for browser to speak aloud
    tts = await email_to_speech(draft["subject"], draft["body"])

    return {
        "subject": draft["subject"],
        "body": draft["body"],
        "speak_text": tts["speak_text"],    # frontend calls speechSynthesis with this
        "contact": {"name": contact.name, "email": contact.email},
        "gmail_connected": user.gmail_connected if user else False,
    }


@router.post("/send")
async def send_approved_email(
    req: SendRequest,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    If Gmail is connected → send via Gmail API.
    If not → return the draft for the user to send manually.
    """
    result = await db.execute(
        select(Contact).where(Contact.id == req.contact_id, Contact.user_id == user_id)
    )
    contact = result.scalar_one_or_none()
    if not contact or not contact.email:
        raise HTTPException(404, "Contact or contact email not found")

    user_result = await db.execute(select(User).where(User.id == user_id))
    user = user_result.scalar_one_or_none()

    # Log the draft regardless
    from datetime import datetime
    log = EmailLog(
        user_id=user_id,
        contact_id=contact.id,
        to_email=contact.email,
        subject=req.subject,
        body=req.body,
        voice_instruction=req.voice_instruction,
    )

    if user and user.gmail_connected:
        # Gmail path (active once Google Cloud is set up)
        try:
            from app.services.gmail_service import send_email as gmail_send
            gmail_id = await gmail_send(user, contact.email, req.subject, req.body)
            log.gmail_message_id = gmail_id
            log.sent_at = datetime.utcnow()
            db.add(log)
            await db.commit()
            return {"success": True, "method": "gmail", "gmail_message_id": gmail_id}
        except Exception as e:
            # Fall through to manual if Gmail fails
            pass

    # Manual send fallback — return mailto link + draft
    db.add(log)
    await db.commit()

    import urllib.parse
    mailto = (
        f"mailto:{contact.email}"
        f"?subject={urllib.parse.quote(req.subject)}"
        f"&body={urllib.parse.quote(req.body)}"
    )
    return {
        "success": False,
        "method": "manual",
        "mailto": mailto,
        "to": contact.email,
        "subject": req.subject,
        "body": req.body,
        "message": "Gmail not connected yet. Use the mailto link or copy the draft.",
    }


@router.get("/auth/url")
async def gmail_auth_url(user_id: uuid.UUID = Depends(get_current_user_id)):
    """Returns Gmail OAuth URL. Only works once Google Cloud Console is set up."""
    from app.core.config import settings
    if not settings.GOOGLE_CLIENT_ID:
        return {
            "auth_url": None,
            "message": "Google Cloud Console not configured yet. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.",
        }
    from app.services.gmail_service import get_gmail_auth_url
    url = get_gmail_auth_url(state=str(user_id))
    return {"auth_url": url}


@router.get("/auth/callback")
async def gmail_callback(code: str, state: str, db: AsyncSession = Depends(get_db)):
    """OAuth callback — saves tokens after Google Cloud is configured."""
    from app.services.gmail_service import exchange_code_for_tokens
    from datetime import datetime, timedelta

    tokens = await exchange_code_for_tokens(code)
    user_id = uuid.UUID(state)

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(404, "User not found")

    user.gmail_access_token = tokens["access_token"]
    user.gmail_refresh_token = tokens.get("refresh_token", user.gmail_refresh_token)
    user.gmail_token_expiry = datetime.utcnow() + timedelta(seconds=tokens.get("expires_in", 3600))
    user.gmail_connected = True
    await db.commit()

    return RedirectResponse(url="http://localhost:5173/settings?gmail=connected")
