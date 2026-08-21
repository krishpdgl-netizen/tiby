import uuid
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.database import get_db
from app.models.models import Task

router = APIRouter(prefix='/tasks', tags=['tasks'])


class TaskCreate(BaseModel):
    title: str = Field(min_length=1, max_length=500)
    due_date: str | None = None
    owner: str | None = None
    description: str | None = None


@router.get('/')
async def list_tasks(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(
        select(Task).where(Task.user_id == user.id).order_by(Task.created_at.desc())
    )
    return [
        {
            'id': str(t.id),
            'title': t.title,
            'description': t.description,
            'due_date': t.due_date,
            'owner': t.owner,
            'status': t.status if isinstance(t.status, str) else t.status.value,
            'source': t.source,
            'created_at': t.created_at.isoformat(),
        }
        for t in q.scalars().all()
    ]


@router.post('/')
async def create_task(req: TaskCreate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    t = Task(
        user_id=user.id,
        title=req.title,
        due_date=req.due_date,
        owner=req.owner or 'Me',
        description=req.description,
        source='manual',
        status='pending',
    )
    db.add(t)
    await db.commit()
    await db.refresh(t)
    return {'id': str(t.id), 'status': 'pending'}


@router.patch('/{task_id}/complete')
async def complete_task(task_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    t = q.scalar_one_or_none()
    if not t:
        raise HTTPException(404, 'Task not found')
    t.status = 'done'
    await db.commit()
    return {'success': True}


@router.patch('/{task_id}/reopen')
async def reopen_task(task_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Task).where(Task.id == task_id, Task.user_id == user.id))
    t = q.scalar_one_or_none()
    if not t:
        raise HTTPException(404, 'Task not found')
    t.status = 'pending'
    await db.commit()
    return {'success': True}
