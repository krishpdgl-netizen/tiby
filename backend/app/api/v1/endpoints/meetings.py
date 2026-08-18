"""
Meetings API
POST /meetings/start         — create meeting record
POST /meetings/{id}/upload   — upload audio → trigger background processing
GET  /meetings               — list all meetings
GET  /meetings/{id}          — get meeting + MOM + tasks
"""
import uuid
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel

from app.core.database import get_db
from app.models.models import Meeting, Task, MeetingStatus
from app.services.storage_service import upload_meeting_audio
from app.workers.tasks import process_meeting

router = APIRouter(prefix="/meetings", tags=["meetings"])


def get_current_user_id() -> uuid.UUID:
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


class StartMeetingRequest(BaseModel):
    title: str | None = None


@router.post("/start")
async def start_meeting(
    req: StartMeetingRequest,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """Create a new meeting record. Frontend starts recording audio locally."""
    meeting = Meeting(
        user_id=user_id,
        title=req.title or "Meeting",
        status=MeetingStatus.recording,
    )
    db.add(meeting)
    await db.commit()
    await db.refresh(meeting)

    return {"meeting_id": str(meeting.id), "status": meeting.status}


@router.post("/{meeting_id}/upload")
async def upload_meeting_audio_file(
    meeting_id: uuid.UUID,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Upload recorded audio. Triggers background processing:
    STT → MOM → tasks → email.
    """
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(404, "Meeting not found")

    allowed_types = ("audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg")
    if file.content_type not in allowed_types:
        raise HTTPException(400, f"Unsupported audio type: {file.content_type}")

    audio_bytes = await file.read()
    if len(audio_bytes) > 500 * 1024 * 1024:  # 500 MB limit
        raise HTTPException(400, "Audio file too large (max 500MB)")

    # Upload to R2
    audio_url = await upload_meeting_audio(audio_bytes, mime_type=file.content_type)
    meeting.audio_url = audio_url
    meeting.status = MeetingStatus.processing
    await db.commit()

    # Kick off background job
    process_meeting.delay(str(meeting.id), str(user_id))

    return {
        "meeting_id": str(meeting.id),
        "status": "processing",
        "message": "Audio uploaded. Processing in background — you'll receive MOM via email when done.",
    }


@router.get("/")
async def list_meetings(
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Meeting).where(Meeting.user_id == user_id).order_by(Meeting.created_at.desc())
    )
    meetings = result.scalars().all()
    return [_serialize_meeting(m) for m in meetings]


@router.get("/{meeting_id}")
async def get_meeting(
    meeting_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user_id)
    )
    meeting = result.scalar_one_or_none()
    if not meeting:
        raise HTTPException(404, "Meeting not found")

    # Load tasks
    tasks_result = await db.execute(
        select(Task).where(Task.meeting_id == meeting_id)
    )
    tasks = tasks_result.scalars().all()

    data = _serialize_meeting(meeting)
    data["tasks"] = [
        {
            "id": str(t.id),
            "title": t.title,
            "owner": t.owner,
            "due_date": t.due_date,
            "status": t.status,
        }
        for t in tasks
    ]
    return data


def _serialize_meeting(m: Meeting) -> dict:
    return {
        "id": str(m.id),
        "title": m.title,
        "status": m.status,
        "summary": m.summary,
        "mom": m.mom,
        "decisions": m.decisions,
        "action_items": m.action_items,
        "duration_seconds": m.duration_seconds,
        "mom_sent_at": m.mom_sent_at.isoformat() if m.mom_sent_at else None,
        "created_at": m.created_at.isoformat(),
    }
