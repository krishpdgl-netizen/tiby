"""
Quick email endpoints — draft and send without a stored DB contact.
Used when contact comes from Apps Script (Sheets/Drive) not our DB.
"""
from fastapi import APIRouter
from pydantic import BaseModel
from app.services.ai_service import draft_email
from app.services.tts_service import email_to_speech

router = APIRouter(prefix="/emails", tags=["emails"])


class QuickDraftRequest(BaseModel):
    contact: dict          # {name, email, company, role, ...}
    voice_instruction: str


class QuickSendRequest(BaseModel):
    to_email: str
    subject: str
    body: str


@router.post("/draft-quick")
async def draft_quick(req: QuickDraftRequest):
    """Draft email from contact dict + voice instruction. No DB needed."""
    draft = await draft_email(
        contact=req.contact,
        user_instruction=req.voice_instruction,
        user_name=None,
    )
    tts = await email_to_speech(draft["subject"], draft["body"])
    return {
        "subject": draft["subject"],
        "body": draft["body"],
        "speak_text": tts["speak_text"],
    }


@router.post("/send-quick")
async def send_quick(req: QuickSendRequest):
    """
    Send email. Gmail not set up yet — returns mailto link as fallback.
    When Gmail is configured, this will send directly.
    """
    import urllib.parse
    mailto = (
        f"mailto:{req.to_email}"
        f"?subject={urllib.parse.quote(req.subject)}"
        f"&body={urllib.parse.quote(req.body)}"
    )
    return {
        "success": False,
        "method": "manual",
        "mailto": mailto,
        "to": req.to_email,
        "subject": req.subject,
        "body": req.body,
    }
