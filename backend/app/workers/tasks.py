import uuid
from celery.exceptions import MaxRetriesExceededError
from sqlalchemy import select
from app.workers.celery_app import celery_app, run_async

@celery_app.task(bind=True, name='process_meeting', max_retries=3, autoretry_for=(), acks_late=True)
def process_meeting(self, meeting_id: str, user_id: str):
    try:
        return run_async(_process(meeting_id, user_id))
    except Exception as exc:
        countdown = min(60 * (2 ** self.request.retries), 900)
        try:
            raise self.retry(exc=exc, countdown=countdown)
        except MaxRetriesExceededError:
            raise exc

async def _process(meeting_id: str, user_id: str):
    from app.core.database import AsyncSessionLocal
    from app.core.config import settings
    from app.models.models import Meeting, Task, MeetingStatus, User
    from app.services.storage_service import download_private
    from app.services.stt_service import transcribe_audio
    from app.services.ai_service import generate_mom
    from app.services.gmail_service import send_mom_email
    async with AsyncSessionLocal() as db:
        q = await db.execute(select(Meeting).where(Meeting.id==uuid.UUID(meeting_id), Meeting.user_id==uuid.UUID(user_id)))
        m = q.scalar_one_or_none()
        if not m: return {'error':'Meeting not found'}
        uq = await db.execute(select(User).where(User.id==uuid.UUID(user_id))); user = uq.scalar_one_or_none()
        try:
            m.status=MeetingStatus.processing; await db.commit()
            audio = await download_private(settings.STORAGE_AUDIO_BUCKET, m.audio_path)
            stt = await transcribe_audio(audio, is_meeting=True)
            m.transcript=stt['transcript']; m.duration_seconds=int(stt.get('duration',0)); await db.commit()
            mom = await generate_mom(m.transcript, m.title)
            m.summary=mom['summary']; m.mom=mom['mom_markdown']; m.decisions=mom['decisions']; m.action_items=mom['action_items']; m.status=MeetingStatus.done
            for item in m.action_items or []:
                db.add(Task(user_id=m.user_id, meeting_id=m.id, title=str(item.get('task') or 'Unnamed task')[:500], owner=item.get('owner'), due_date=item.get('due'), source='meeting'))
            await db.commit()
            if user and user.gmail_connected:
                try:
                    gid=await send_mom_email(user,m.mom,m.title)
                    from datetime import datetime, timezone
                    m.mom_sent_at=datetime.now(timezone.utc); m.mom_sent_to=user.email; await db.commit()
                except Exception:
                    pass
            return {'status':'done','meeting_id':meeting_id}
        except Exception as exc:
            m.status=MeetingStatus.failed; m.processing_error=str(exc)[:4000]; await db.commit(); raise
