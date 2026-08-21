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
from app.models.models import Contact, Meeting, Task, User
from app.services.storage_service import upload_meeting_audio, download_private

log = logging.getLogger("tiby")
router = APIRouter(prefix="/meetings", tags=["meetings"])


class StartMeetingRequest(BaseModel):
    title: str | None = Field(default=None, max_length=500)


async def _resolve_assignee(owner_name: str, creator_user_id: uuid.UUID, db) -> uuid.UUID | None:
    """Look up a contact by name, find their email, check if they have a Tiby account."""
    if not owner_name or owner_name.lower() in ('me', 'tbd', ''):
        return None
    # Find contact with matching name
    q = await db.execute(
        select(Contact).where(
            Contact.user_id == creator_user_id,
            Contact.name.ilike(f'%{owner_name}%'),
            Contact.email.isnot(None),
        ).limit(1)
    )
    contact = q.scalar_one_or_none()
    if not contact or not contact.email:
        return None
    # Check if that email is a registered Tiby user
    uq = await db.execute(
        select(User).where(User.email == contact.email.lower()).limit(1)
    )
    assignee = uq.scalar_one_or_none()
    return assignee.id if assignee and assignee.id != creator_user_id else None


@router.post("/start")
async def start(req: StartMeetingRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    m = Meeting(user_id=user.id, title=req.title or "Meeting", status='recording')
    db.add(m)
    await db.commit()
    await db.refresh(m)
    return {"meeting_id": str(m.id), "status": m.status}


async def _process_meeting_bg(meeting_id: str, user_id: str):
    async with _get_session_factory()() as db:
        try:
            q = await db.execute(
                select(Meeting).where(
                    Meeting.id == uuid.UUID(meeting_id),
                    Meeting.user_id == uuid.UUID(user_id),
                )
            )
            m = q.scalar_one_or_none()
            if not m:
                return

            m.status = 'processing'
            await db.commit()

            audio = await download_private(settings.STORAGE_AUDIO_BUCKET, m.audio_path)
            mime_type = 'audio/mp4' if m.audio_path.endswith('.mp4') else 'audio/webm'

            from app.services.ai_service import transcribe_and_generate_mom
            result = await transcribe_and_generate_mom(audio, mime_type, m.title)

            m.transcript = result['transcript']
            m.summary = result['summary']
            m.mom = result['mom_markdown']
            m.decisions = result['decisions']
            m.action_items = result['action_items']
            m.status = 'done'

            creator_id = uuid.UUID(user_id)

            for item in m.action_items or []:
                owner_name = item.get('owner') or ''
                assigned_to = await _resolve_assignee(owner_name, creator_id, db)
                db.add(Task(
                    user_id=creator_id,
                    assigned_to_user_id=assigned_to,
                    meeting_id=m.id,
                    title=str(item.get('task') or 'Unnamed task')[:500],
                    owner=owner_name or 'Me',
                    due_date=item.get('due'),
                    source='meeting',
                    status='pending',
                ))

            await db.commit()
            log.info("Meeting %s processed, tasks created with cross-assignment", meeting_id)

        except Exception as exc:
            log.exception("Meeting processing failed: %s", meeting_id)
            try:
                m.status = 'failed'
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
    m.status = 'processing'
    m.processing_error = None
    await db.commit()

    background_tasks.add_task(_process_meeting_bg, str(m.id), str(user.id))
    return {"meeting_id": str(m.id), "status": "processing"}


@router.post("/notes")
async def process_notes(
    user: CurrentUser,
    title: str = "Meeting",
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
):
    ct = (file.content_type or "").split(";")[0].strip()
    if ct not in {"image/jpeg", "image/png", "image/webp", "image/heic"}:
        raise HTTPException(400, "Unsupported image type")

    data = await file.read(settings.MAX_CARD_BYTES + 1)
    if len(data) > settings.MAX_CARD_BYTES:
        raise HTTPException(413, "Notes image too large (max 10 MB)")

    from app.services.ai_service import extract_handwritten_notes
    transcript = await extract_handwritten_notes(data, ct or "image/jpeg")
    mom = await _mom_from_text(transcript, title)

    m = Meeting(
        user_id=user.id,
        title=title or "Meeting",
        status='done',
        transcript=transcript,
        summary=mom['summary'],
        mom=mom['mom_markdown'],
        decisions=mom['decisions'],
        action_items=mom['action_items'],
    )
    db.add(m)
    await db.flush()

    creator_id = user.id
    for item in m.action_items or []:
        owner_name = item.get('owner') or ''
        assigned_to = await _resolve_assignee(owner_name, creator_id, db)
        db.add(Task(
            user_id=creator_id,
            assigned_to_user_id=assigned_to,
            meeting_id=m.id,
            title=str(item.get('task') or 'Unnamed task')[:500],
            owner=owner_name or 'Me',
            due_date=item.get('due'),
            source='meeting_notes',
            status='pending',
        ))

    await db.commit()
    await db.refresh(m)
    return _ser(m)


async def _mom_from_text(transcript: str, title: str) -> dict:
    from app.services.ai_service import _generate, _extract_json
    if not transcript or not transcript.strip():
        return {'summary': 'No content found.', 'mom_markdown': '', 'decisions': [], 'action_items': []}
    prompt = f'''Analyze this meeting transcript and return ONLY valid JSON with keys: summary (string), mom_markdown (string), decisions (array of strings), action_items (array of objects with task, owner, due).
Title: {title}
Transcript:
{transcript}'''
    try:
        raw = await _generate(prompt, temperature=0.1)
        data = _extract_json(raw)
    except Exception:
        return {'summary': transcript[:300], 'mom_markdown': transcript, 'decisions': [], 'action_items': []}
    return {
        'summary': str(data.get('summary') or ''),
        'mom_markdown': str(data.get('mom_markdown') or ''),
        'decisions': data.get('decisions') if isinstance(data.get('decisions'), list) else [],
        'action_items': data.get('action_items') if isinstance(data.get('action_items'), list) else [],
    }


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
        {
            "id": str(t.id),
            "title": t.title,
            "owner": t.owner,
            "due_date": t.due_date,
            "status": t.status,
            "assigned_to_user_id": str(t.assigned_to_user_id) if t.assigned_to_user_id else None,
        }
        for t in tq.scalars().all()
    ]
    return d


def _ser(m: Meeting) -> dict:
    return {
        "id": str(m.id),
        "title": m.title,
        "status": m.status,
        "summary": m.summary,
        "mom": m.mom,
        "decisions": m.decisions,
        "action_items": m.action_items,
        "duration_seconds": m.duration_seconds,
        "processing_error": m.processing_error,
        "mom_sent_at": m.mom_sent_at.isoformat() if m.mom_sent_at else None,
        "created_at": m.created_at.isoformat(),
    }
