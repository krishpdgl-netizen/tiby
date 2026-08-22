from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends
from sqlalchemy import select, func, or_
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import Contact, EmailLog, Meeting, Task
from app.services.ai_service import prioritize_tasks, generate_eod_summary

router = APIRouter(prefix='/analytics', tags=['analytics'])


@router.get('/summary')
async def summary(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    contacts = await db.scalar(
        select(func.count()).select_from(Contact).where(Contact.user_id == user.id)
    )
    meetings = await db.scalar(
        select(func.count()).select_from(Meeting)
        .where(Meeting.user_id == user.id, Meeting.status == 'done')
    )
    my_pending = await db.scalar(
        select(func.count()).select_from(Task)
        .where(Task.user_id == user.id, Task.status == 'pending')
    )
    my_done = await db.scalar(
        select(func.count()).select_from(Task)
        .where(Task.user_id == user.id, Task.status == 'done')
    )
    assigned_pending = await db.scalar(
        select(func.count()).select_from(Task)
        .where(Task.assigned_to_user_id == user.id, Task.user_id != user.id, Task.status == 'pending')
    )
    return {
        'contacts': contacts or 0,
        'meetings': meetings or 0,
        'tasks_pending': (my_pending or 0) + (assigned_pending or 0),
        'tasks_done': my_done or 0,
        'tasks_assigned_to_me': assigned_pending or 0,
    }


@router.get('/followups')
async def followups(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """
    Return contacts that haven't been emailed or interacted with in 7+ days.
    Used by ContactsPage to show follow-up nudges.
    """
    # Get all contacts
    q = await db.execute(
        select(Contact).where(Contact.user_id == user.id).order_by(Contact.created_at.desc())
    )
    contacts = q.scalars().all()

    # Get last email sent per contact
    eq = await db.execute(
        select(EmailLog.contact_id, func.max(EmailLog.sent_at).label('last_sent'))
        .where(EmailLog.user_id == user.id, EmailLog.contact_id.isnot(None))
        .group_by(EmailLog.contact_id)
    )
    last_email = {str(row.contact_id): row.last_sent for row in eq.all()}

    now = datetime.now(timezone.utc)
    nudge_after_days = 7
    result = []

    for c in contacts:
        if not c.email:
            continue
        cid = str(c.id)
        last = last_email.get(cid)

        if last:
            days_since = (now - last.replace(tzinfo=timezone.utc) if last.tzinfo is None else now - last).days
            if days_since >= nudge_after_days:
                result.append({
                    'id': cid,
                    'name': c.name,
                    'email': c.email,
                    'company': c.company,
                    'days_since_contact': days_since,
                    'reason': f'Last emailed {days_since} days ago',
                })
        else:
            # Never emailed — if contact is older than 3 days, nudge
            days_old = (now - c.created_at.replace(tzinfo=timezone.utc) if c.created_at.tzinfo is None else now - c.created_at).days
            if days_old >= 3:
                result.append({
                    'id': cid,
                    'name': c.name,
                    'email': c.email,
                    'company': c.company,
                    'days_since_contact': days_old,
                    'reason': 'Never followed up',
                })

    # Sort by longest since contact
    result.sort(key=lambda x: x['days_since_contact'], reverse=True)
    return result[:10]  # top 10 most overdue


@router.post('/prioritize')
async def prioritize(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai-prioritize', settings.AI_RATE_LIMIT_PER_MINUTE)
    q = await db.execute(
        select(Task)
        .where(or_(Task.user_id == user.id, Task.assigned_to_user_id == user.id), Task.status == 'pending')
        .order_by(Task.created_at.asc()).limit(100)
    )
    tasks = q.scalars().all()
    if not tasks:
        return {'priorities': []}
    result = await prioritize_tasks([
        {'id': str(t.id), 'title': t.title, 'due': t.due_date, 'owner': t.owner}
        for t in tasks
    ])
    return {'priorities': result}


@router.post('/eod')
async def eod(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai-eod', settings.AI_RATE_LIMIT_PER_MINUTE)
    q = await db.execute(
        select(Task)
        .where(or_(Task.user_id == user.id, Task.assigned_to_user_id == user.id))
        .order_by(Task.created_at.desc()).limit(100)
    )
    tasks = q.scalars().all()
    result = await generate_eod_summary([
        {'title': t.title, 'status': t.status if isinstance(t.status, str) else t.status.value, 'due': t.due_date, 'owner': t.owner}
        for t in tasks
    ])
    return {'status': 'success', **result}
