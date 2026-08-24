from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.database import get_db
from app.models.models import Contact, Meeting, Task, EmailLog
from app.services.memory_service import semantic_memory_search

router = APIRouter(prefix='/search', tags=['search'])

@router.get('/')
async def universal_search(
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
    q: str = Query(min_length=1, max_length=500),
    limit: int = Query(default=30, ge=1, le=100),
):
    pattern = f'%{q.strip()}%'
    per = max(5, min(15, limit // 3))
    out = []

    cq = await db.execute(select(Contact).where(
        Contact.user_id == user.id,
        or_(Contact.name.ilike(pattern), Contact.email.ilike(pattern), Contact.phone.ilike(pattern),
            Contact.company.ilike(pattern), Contact.role.ilike(pattern), Contact.notes.ilike(pattern))
    ).order_by(Contact.updated_at.desc()).limit(per))
    for c in cq.scalars().all():
        out.append({'type':'contact','id':str(c.id),'title':c.name or c.email or 'Contact',
                    'subtitle':' · '.join(x for x in [c.role,c.company] if x),
                    'snippet':c.email or c.phone or c.notes or '', 'created_at':c.updated_at.isoformat(), 'score':0.95})

    mq = await db.execute(select(Meeting).where(
        Meeting.user_id == user.id,
        or_(Meeting.title.ilike(pattern), Meeting.summary.ilike(pattern), Meeting.transcript.ilike(pattern), Meeting.mom.ilike(pattern))
    ).order_by(Meeting.created_at.desc()).limit(per))
    for m in mq.scalars().all():
        out.append({'type':'meeting','id':str(m.id),'title':m.title or 'Meeting','subtitle':'Meeting',
                    'snippet':(m.summary or m.transcript or '')[:500], 'created_at':m.created_at.isoformat(), 'score':0.9})

    tq = await db.execute(select(Task).where(
        Task.user_id == user.id,
        or_(Task.title.ilike(pattern), Task.description.ilike(pattern), Task.owner.ilike(pattern), Task.due_date.ilike(pattern))
    ).order_by(Task.created_at.desc()).limit(per))
    for t in tq.scalars().all():
        out.append({'type':'task','id':str(t.id),'title':t.title,'subtitle':f'{t.status} · {t.owner or "Me"}',
                    'snippet':t.description or t.due_date or '', 'created_at':t.created_at.isoformat(), 'score':0.88})

    eq = await db.execute(select(EmailLog).where(
        EmailLog.user_id == user.id,
        or_(EmailLog.to_email.ilike(pattern), EmailLog.subject.ilike(pattern), EmailLog.body.ilike(pattern))
    ).order_by(EmailLog.created_at.desc()).limit(per))
    for e in eq.scalars().all():
        out.append({'type':'email','id':str(e.id),'title':e.subject or 'Email','subtitle':e.to_email,
                    'snippet':(e.body or '')[:500], 'created_at':e.created_at.isoformat(), 'score':0.87})

    memories = await semantic_memory_search(db, user.id, q, per)
    for m in memories:
        out.append({'type':'memory','id':m['id'],'title':m.get('title') or m.get('source_type','Memory').title(),
                    'subtitle':m.get('source_type','memory'),'snippet':m.get('snippet',''),
                    'created_at':m.get('created_at'),'score':m.get('score',0.5), 'contact_id':m.get('contact_id')})

    seen=set(); merged=[]
    for item in sorted(out, key=lambda x:(x.get('score',0), x.get('created_at') or ''), reverse=True):
        key=(item['type'],item['id'])
        if key in seen: continue
        seen.add(key); merged.append(item)
        if len(merged)>=limit: break
    return {'query':q,'count':len(merged),'results':merged}
