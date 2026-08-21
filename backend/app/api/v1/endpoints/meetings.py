import asyncio
import logging
import uuid
from fastapi import APIRouter, BackgroundTasks, Depends, File, UploadFile, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db, _get_session_factory
from app.models.models import Meeting, Task, MeetingStatus
from app.services.storage_service import upload_meeting_audio, download_private

log = logging.getLogger("tiby")
router = APIRouter(prefix="/meetings", tags=["meetings"])


class StartMeetingRequest(BaseModel):
    title: str | None = Field(default=None, max_length=500)


@router.post("/start")
async def start(req: StartMeetingRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    m = Meeting(user_id=user.id, title=req.title or "Meeting", status=MeetingStatus.recording)
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"meeting_id": str(m.id), "status": m.status.value}


async def _process_meeting_bg(meeting_id: str, user_id: str):
    """Run STT + MOM generation in the background using FastAPI BackgroundTasks."""
    from app.services.stt_service import transcribe_audio
    from app.services.ai_service import generate_mom

    async with _get_session_factory()() as db:
        try:
            q = await db.execute(
                select(Meeting).where(
                    Meeting.id == uuid.UUID(meeting_id),
                    Meeting.user_id == uuid.UUID(user_id)
                )
            )
            m = q.scalar_one_or_none()
            if not m:
                log.error("Meeting not found: %s", meeting_id)
                return

            m.status = MeetingStatus.processing
            await db.commit()

            # Download audio from Supabase Storage
            audio = await download_private(settings.STORAGE_AUDIO_BUCKET, m.audio_path)

            # Transcribe
            stt = await transcribe_audio(audio, is_meeting=True)
            m.transcript = stt["transcript"]
            m.duration_seconds = int(stt.get("duration", 0))
            await db.commit()

            # Generate MOM
            mom = await generate_mom(m.transcript, m.title)
            m.summary = mom["summary"]
            m.mom = mom["mom_markdown"]
            m.decisions = mom["decisions"]
            m.action_items = mom["action_items"]
            m.status = MeetingStatus.done

            # Create tasks from action items
            for item in m.action_items or []:
                db.add(Task(
                    user_id=m.user_id,
                    meeting_id=m.id,
                    title=str(item.get("task") or "Unnamed task")[:500],
                    owner=item.get("owner"),
                    due_date=item.get("due"),
                    source="meeting",
                ))

            await db.commit()
            log.info("Meeting %s processed successfully", meeting_id)

        except Exception as exc:
            log.exception("Meeting processing failed: %s", meeting_id)
            try:
                m.status = MeetingStatus.failed
                m.processing_error = str(exc)[:4000]
                await db.commit()
            except Exception:
                pass


@router.post("/{meeting_id}/upload")
async def upload(
    meeting_id: uuid.UUID,
    user: CurrentUser,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    q = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user.id)
    )
    m = q.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Meeting not found")

    ct = (file.content_type or "").split(";")[0].strip()
    if not ct.startswith("audio/"):
        raise HTTPException(400, f"Unsupported audio type: {file.content_type}")

    data = await file.read(settings.MAX_MEETING_BYTES + 1)
    if len(data) > settings.MAX_MEETING_BYTES:
        raise HTTPException(413, "Meeting recording too large (max 250 MB)")

    path = await upload_meeting_audio(data, str(user.id), str(m.id), ct or "audio/webm")
    m.audio_path = path
    m.status = MeetingStatus.processing
    m.processing_error = None
    await db.commit()

    # Process in background — no Celery/Redis needed
    background_tasks.add_task(_process_meeting_bg, str(m.id), str(user.id))

    return {"meeting_id": str(m.id), "status": "processing"}


@router.post("/notes")
async def process_notes(
    user: CurrentUser,
    title: str = "Meeting",
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    from app.services.ai_service import extract_handwritten_notes, generate_mom

    ct = (file.content_type or "").split(";")[0].strip()
    if ct not in {"image/jpeg", "image/png", "image/webp", "image/heic"}:
        raise HTTPException(400, "Unsupported image type")

    data = await file.read(settings.MAX_CARD_BYTES + 1)
    if len(data) > settings.MAX_CARD_BYTES:
        raise HTTPException(413, "Notes image too large (max 10 MB)")

    transcript = await extract_handwritten_notes(data, ct or "image/jpeg")
    mom = await generate_mom(transcript, title)

    m = Meeting(
        user_id=user.id,
        title=title or "Meeting",
        status=MeetingStatus.done,
        transcript=transcript,
        summary=mom["summary"],
        mom=mom["mom_markdown"],
        decisions=mom["decisions"],
        action_items=mom["action_items"],
    )
    db.add(m)
    await db.flush()

    for item in m.action_items or []:
        db.add(Task(
            user_id=user.id,
            meeting_id=m.id,
            title=str(item.get("task") or "Unnamed task")[:500],
            owner=item.get("owner"),
            due_date=item.get("due"),
            source="meeting_notes",
        ))

    await db.commit()
    await db.refresh(m)
    return _ser(m)


@router.get("/")
async def listing(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(
        select(Meeting).where(Meeting.user_id == user.id).order_by(Meeting.created_at.desc())
    )
    return [_ser(m) for m in q.scalars().all()]


@router.get("/{meeting_id}")
async def get(meeting_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(
        select(Meeting).where(Meeting.id == meeting_id, Meeting.user_id == user.id)
    )
    m = q.scalar_one_or_none()
    if not m:
        raise HTTPException(404, "Meeting not found")

    tq = await db.execute(
        select(Task).where(Task.meeting_id == m.id, Task.user_id == user.id)
    )
    d = _ser(m)
    d["tasks"] = [
        {"id": str(t.id), "title": t.title, "owner": t.owner, "due_date": t.due_date, "status": t.status.value}
        for t in tq.scalars().all()
    ]
    return d


def _ser(m: Meeting) -> dict:
    return {
        "id": str(m.id),
        "title": m.title,
        "status": m.status.value,
        "summary": m.summary,
        "mom": m.mom,
        "decisions": m.decisions,
        "action_items": m.action_items,
        "duration_seconds": m.duration_seconds,
        "processing_error": m.processing_error,
        "mom_sent_at": m.mom_sent_at.isoformat() if m.mom_sent_at else None,
        "created_at": m.created_at.isoformat(),
    }
