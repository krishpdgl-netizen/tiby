from datetime import datetime, timezone
from fastapi import APIRouter, Depends
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import AgentRun, AgentRunStatus, AgentStep, Contact, Task
from app.schemas.agent import AgentChatRequest, AgentChatResponse
from app.services.ai_service import plan_agent

router = APIRouter(prefix='/agent', tags=['agent'])


@router.post('/chat', response_model=AgentChatResponse)
async def chat(req: AgentChatRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    await enforce_rate_limit(str(user.id), 'ai', settings.AI_RATE_LIMIT_PER_MINUTE)

    run = AgentRun(
        user_id=user.id,
        prompt=req.message,
        status=AgentRunStatus.running,
        model=settings.GEMINI_MODEL,
    )
    db.add(run)
    await db.commit()
    await db.refresh(run)

    try:
        contacts_result = await db.execute(
            select(Contact)
            .where(Contact.user_id == user.id)
            .order_by(Contact.created_at.desc())
            .limit(10)
        )

        # Use string literal for status to avoid enum cast issue
        tasks_result = await db.execute(
            select(Task)
            .where(Task.user_id == user.id, Task.status == 'pending')
            .order_by(Task.created_at.desc())
            .limit(20)
        )

        context = {
            'name': user.name,
            'email': user.email,
            'recent_contacts': [
                {'name': c.name, 'company': c.company, 'email': c.email}
                for c in contacts_result.scalars().all()
            ],
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
                task = Task(
                    user_id=user.id,
                    title=action.title[:500],
                    due_date=action.due,
                    owner=action.owner or 'Me',
                    source='agent',
                )
                db.add(task)
                await db.flush()
                result = {'ok': True, 'task_id': str(task.id), 'title': task.title}

            elif action.type == 'complete_task' and action.text:
                q = await db.execute(
                    select(Task)
                    .where(Task.user_id == user.id, Task.status == 'pending')
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

        run.status = AgentRunStatus.completed
        run.final_response = plan.reply
        run.finished_at = datetime.now(timezone.utc)
        await db.commit()

        return AgentChatResponse(run_id=str(run.id), reply=plan.reply, actions=outputs)

    except Exception as exc:
        await db.rollback()
        try:
            run.status = AgentRunStatus.failed
            run.error = str(exc)[:4000]
            run.finished_at = datetime.now(timezone.utc)
            await db.commit()
        except Exception:
            await db.rollback()
        raise
