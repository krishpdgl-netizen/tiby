from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import AgentRun, AgentStep, Contact, Task, User
from app.schemas.agent import AgentChatRequest, AgentChatResponse
from app.services.ai_service import plan_agent

router = APIRouter(prefix='/agent', tags=['agent'])


async def _resolve_assignee(owner_name: str, creator_user_id, all_contacts: list, db) -> str | None:
    if not owner_name or owner_name.lower() in ('me', 'tbd', ''):
        return None
    needle = owner_name.lower()
    # Exact name match only — partial match risks wrong assignment
    matches = [c for c in all_contacts if (c.get('name') or '').lower() == needle]
    # If multiple contacts share the same name — skip (ambiguous)
    if len(matches) != 1:
        return None
    contact = matches[0]
    if not contact.get('email'):
        return None
    uq = await db.execute(
        select(User).where(User.email == contact['email'].lower()).limit(1)
    )
    assignee = uq.scalar_one_or_none()
    if assignee and str(assignee.id) != str(creator_user_id):
        return str(assignee.id)
    return None


@router.post('/chat', response_model=AgentChatResponse)
async def chat(req: AgentChatRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai', settings.AI_RATE_LIMIT_PER_MINUTE)

    run = AgentRun(
        user_id=user.id,
        prompt=req.message,
        status='running',
        model=settings.GEMINI_MODEL,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    try:
        contacts_result = await db.execute(
            select(Contact).where(Contact.user_id == user.id)
            .order_by(Contact.created_at.desc()).limit(50)
        )
        all_contacts_orm = contacts_result.scalars().all()
        all_contacts = [
            {'id': str(c.id), 'name': c.name, 'email': c.email,
             'phone': c.phone, 'company': c.company, 'role': c.role}
            for c in all_contacts_orm
        ]

        tasks_result = await db.execute(
            select(Task).where(Task.user_id == user.id, Task.status == 'pending')
            .order_by(Task.created_at.desc()).limit(20)
        )

        context = {
            'name': user.name,
            'email': user.email,
            'recent_contacts': all_contacts,
            'open_tasks': [
                {'id': str(t.id), 'title': t.title, 'due': t.due_date, 'owner': t.owner}
                for t in tasks_result.scalars().all()
            ],
        }

        plan = await plan_agent(req.message, [m.model_dump() for m in req.history], context)

        outputs = []
        step_no = 1

        for action in plan.actions[:8]:
            result = {'ok': False}

            if action.type == 'navigate' and action.route:
                result = {'ok': True, 'route': action.route}

            elif action.type == 'add_task' and action.title:
                owner_name = action.owner or 'Me'
                assigned_to = await _resolve_assignee(owner_name, user.id, all_contacts, db)
                task = Task(
                    user_id=user.id,
                    assigned_to_user_id=assigned_to,
                    title=action.title[:500],
                    due_date=action.due,
                    owner=owner_name,
                    source='agent',
                    status='pending',
                )
                db.add(task)
                await db.flush()
                result = {'ok': True, 'task_id': str(task.id), 'title': task.title, 'assigned_to': assigned_to}

            elif action.type == 'complete_task' and action.text:
                q = await db.execute(
                    select(Task).where(Task.user_id == user.id, Task.status == 'pending')
                    .order_by(Task.created_at.desc())
                )
                candidates = q.scalars().all()
                needle = action.text.lower()
                match = next(
                    (t for t in candidates if needle in t.title.lower() or t.title.lower() in needle),
                    None,
                )
                if match:
                    match.status = 'done'
                    result = {'ok': True, 'task_id': str(match.id), 'title': match.title}
                else:
                    result = {'ok': False, 'reason': 'No matching open task found'}

            elif action.type == 'add_contact' and action.name:
                needle = action.name.lower()
                existing = next(
                    (c for c in all_contacts_orm if (c.name or '').lower() == needle),
                    None,
                )
                if existing:
                    if action.phone: existing.phone = action.phone
                    if action.email: existing.email = action.email
                    if action.company: existing.company = action.company
                    if action.role: existing.role = action.role
                    result = {'ok': True, 'contact_id': str(existing.id), 'name': existing.name, 'action': 'updated'}
                else:
                    contact = Contact(
                        user_id=user.id,
                        name=action.name,
                        email=action.email,
                        phone=action.phone,
                        company=action.company,
                        role=action.role,
                    )
                    db.add(contact)
                    await db.flush()
                    result = {'ok': True, 'contact_id': str(contact.id), 'name': contact.name, 'action': 'created'}

            elif action.type == 'update_contact' and action.text:
                needle = action.text.lower()
                match_c = next(
                    (c for c in all_contacts_orm if needle in (c.name or '').lower() or (c.name or '').lower() in needle),
                    None,
                )
                if match_c:
                    if action.phone: match_c.phone = action.phone
                    if action.email: match_c.email = action.email
                    if action.company: match_c.company = action.company
                    if action.role: match_c.role = action.role
                    result = {'ok': True, 'contact_id': str(match_c.id), 'name': match_c.name}
                else:
                    result = {'ok': False, 'reason': 'No matching contact found'}

            db.add(AgentStep(
                run_id=run.id,
                step_number=step_no,
                tool=action.type,
                arguments=action.model_dump(exclude_none=True),
                result=result,
                status='completed' if result.get('ok') else 'skipped',
            ))
            outputs.append({'type': action.type, **result})
            step_no += 1

        run.status = 'completed'
        run.final_response = plan.reply
        run.finished_at = datetime.now(timezone.utc)
        await db.commit()

        return AgentChatResponse(run_id=str(run.id), reply=plan.reply, actions=outputs)

    except Exception as exc:
        await db.rollback()
        try:
            run.status = 'failed'
            run.error = str(exc)[:4000]
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception:
            await db.rollback()
        raise
