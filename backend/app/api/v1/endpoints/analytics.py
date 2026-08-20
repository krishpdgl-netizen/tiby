from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import Contact, Meeting, MeetingStatus, Task, TaskStatus
from app.services.ai_service import prioritize_tasks, generate_eod_summary

router = APIRouter(prefix='/analytics', tags=['analytics'])

@router.get('/summary')
async def summary(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    contacts = await db.scalar(select(func.count()).select_from(Contact).where(Contact.user_id == user.id))
    meetings = await db.scalar(select(func.count()).select_from(Meeting).where(Meeting.user_id == user.id, Meeting.status == MeetingStatus.done))
    pending = await db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user.id, Task.status == TaskStatus.pending))
    done = await db.scalar(select(func.count()).select_from(Task).where(Task.user_id == user.id, Task.status == TaskStatus.done))
    return {'contacts':contacts or 0,'meetings':meetings or 0,'tasks_pending':pending or 0,'tasks_done':done or 0}

@router.post('/prioritize')
async def prioritize(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai-prioritize', settings.AI_RATE_LIMIT_PER_MINUTE)
    q = await db.execute(select(Task).where(Task.user_id == user.id, Task.status == TaskStatus.pending).order_by(Task.created_at.asc()).limit(100))
    tasks = q.scalars().all()
    if not tasks: return {'priorities':[]}
    result = await prioritize_tasks([{'id':str(t.id),'title':t.title,'due':t.due_date,'owner':t.owner} for t in tasks])
    return {'priorities':result}

@router.post('/eod')
async def eod(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai-eod', settings.AI_RATE_LIMIT_PER_MINUTE)
    q = await db.execute(select(Task).where(Task.user_id == user.id).order_by(Task.created_at.desc()).limit(100))
    tasks = q.scalars().all()
    result = await generate_eod_summary([{'title':t.title,'status':t.status.value,'due':t.due_date,'owner':t.owner} for t in tasks])
    return {'status':'success', **result}
