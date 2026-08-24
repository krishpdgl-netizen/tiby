from fastapi import APIRouter, Depends, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.database import get_db
from app.models.models import Memory, Contact, Meeting, EmailLog, AgentRun
from app.services.memory_service import semantic_memory_search, remember, find_contacts_in_text

router = APIRouter(prefix='/memory', tags=['memory'])

@router.get('/search')
async def search_memory(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    q: str = Query(min_length=1, max_length=500),
    limit: int = Query(default=10, ge=1, le=50),
):
    return await semantic_memory_search(db, user.id, q, limit)

@router.get('/recent')
async def recent_memory(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    limit: int = Query(default=20, ge=1, le=100),
):
    rows = await db.execute(
        select(Memory).where(Memory.user_id == user.id)
        .order_by(Memory.created_at.desc()).limit(limit)
    )
    return [{
        'id': str(m.id), 'source_type': m.source_type, 'source_id': m.source_id,
        'title': m.title, 'content': m.content, 'importance': m.importance,
        'contact_id': str(m.contact_id) if m.contact_id else None,
        'created_at': m.created_at.isoformat(),
    } for m in rows.scalars().all()]


@router.post('/backfill')
async def backfill_memory(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """One-time/idempotent indexing of the user's existing Tiby data."""
    added = 0

    contacts = (await db.execute(select(Contact).where(Contact.user_id == user.id))).scalars().all()
    for c in contacts:
        rows = await remember(db, user_id=user.id, source_type='contact', source_id=str(c.id), contact_id=c.id,
                              title=c.name or c.email or 'Contact',
                              content=' | '.join(x for x in [c.name,c.role,c.company,c.email,c.phone,c.notes] if x),
                              metadata={'company':c.company,'role':c.role}, importance=70)
        added += len(rows)

    meetings = (await db.execute(select(Meeting).where(Meeting.user_id == user.id))).scalars().all()
    for m in meetings:
        content='\n\n'.join(x for x in [m.summary,m.mom,m.transcript] if x)
        if not content: continue
        linked = await find_contacts_in_text(db, user.id, content)
        if linked:
            for c in linked:
                rows = await remember(db,user_id=user.id,source_type='meeting',source_id=f'{m.id}:{c.id}',
                                      meeting_id=m.id,contact_id=c.id,title=m.title or 'Meeting',content=content,
                                      metadata={'contact_name':c.name},importance=80)
                added += len(rows)
        else:
            rows = await remember(db,user_id=user.id,source_type='meeting',source_id=str(m.id),meeting_id=m.id,
                                  title=m.title or 'Meeting',content=content,importance=75)
            added += len(rows)

    emails = (await db.execute(select(EmailLog).where(EmailLog.user_id == user.id))).scalars().all()
    for e in emails:
        rows = await remember(db,user_id=user.id,source_type='email',source_id=str(e.id),email_log_id=e.id,
                              contact_id=e.contact_id,title=e.subject,
                              content=f'To: {e.to_email}\nSubject: {e.subject}\n\n{e.body}',importance=65)
        added += len(rows)

    runs = (await db.execute(select(AgentRun).where(AgentRun.user_id == user.id, AgentRun.final_response.isnot(None)))).scalars().all()
    for r in runs:
        rows = await remember(db,user_id=user.id,source_type='conversation',source_id=str(r.id),agent_run_id=r.id,
                              title='Conversation with Tiby',content=f'User: {r.prompt}\nTiby: {r.final_response}',importance=45)
        added += len(rows)

    await db.commit()
    return {'success':True,'memories_added':added}
