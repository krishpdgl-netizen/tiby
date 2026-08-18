"""
Background task: process a meeting recording end-to-end.
Flow: download audio → STT → LLM MOM → save → send email → create tasks
"""
from app.workers.celery_app import celery_app, run_async


@celery_app.task(bind=True, name="process_meeting", max_retries=2)
def process_meeting(self, meeting_id: str, user_id: str):
    """
    Full pipeline for a meeting recording:
    1. Download audio from R2
    2. Transcribe with Deepgram
    3. Generate MOM with Gemini
    4. Save to DB
    5. Create tasks from action items
    6. Send MOM email to user
    """
    return run_async(_process_meeting_async(meeting_id, user_id))


async def _process_meeting_async(meeting_id: str, user_id: str):
    from sqlalchemy import select
    from app.core.database import AsyncSessionLocal
    from app.models.models import Meeting, Task, MeetingStatus
    from app.services.stt_service import transcribe_audio
    from app.services.ai_service import generate_mom
    from app.services.gmail_service import send_mom_email
    from app.services.storage_service import download_file
    import uuid

    async with AsyncSessionLocal() as db:
        # Load meeting
        result = await db.execute(select(Meeting).where(Meeting.id == uuid.UUID(meeting_id)))
        meeting = result.scalar_one_or_none()
        if not meeting:
            return {"error": "Meeting not found"}

        # Load user
        from app.models.models import User
        user_result = await db.execute(select(User).where(User.id == uuid.UUID(user_id)))
        user = user_result.scalar_one_or_none()

        try:
            meeting.status = MeetingStatus.processing
            await db.commit()

            # 1. Download audio
            audio_bytes = await download_file(meeting.audio_url)

            # 2. Transcribe
            stt_result = await transcribe_audio(audio_bytes, is_meeting=True)
            meeting.transcript = stt_result["transcript"]
            meeting.duration_seconds = int(stt_result.get("duration", 0))
            await db.commit()

            # 3. Generate MOM
            mom_data = await generate_mom(
                transcript=meeting.transcript,
                meeting_title=meeting.title,
            )
            meeting.summary = mom_data["summary"]
            meeting.mom = mom_data["mom_markdown"]
            meeting.decisions = mom_data.get("decisions", [])
            meeting.action_items = mom_data.get("action_items", [])
            meeting.status = MeetingStatus.done
            await db.commit()

            # 4. Create Task records
            for item in meeting.action_items or []:
                task = Task(
                    user_id=uuid.UUID(user_id),
                    meeting_id=meeting.id,
                    title=item.get("task", "Unnamed task"),
                    owner=item.get("owner"),
                    due_date=item.get("due"),
                )
                db.add(task)
            await db.commit()

            # 5. Send MOM email
            if user and user.gmail_connected:
                from datetime import datetime
                gmail_id = await send_mom_email(user, meeting.mom, meeting.title)
                meeting.mom_sent_at = datetime.utcnow()
                meeting.mom_sent_to = user.email
                await db.commit()

            return {"status": "done", "meeting_id": meeting_id}

        except Exception as e:
            meeting.status = MeetingStatus.failed
            await db.commit()
            raise
