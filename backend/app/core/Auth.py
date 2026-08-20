import uuid
from dataclasses import dataclass
from typing import Annotated
import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.config import settings
from app.core.database import get_db
from app.models.models import User


@dataclass(slots=True)
class AuthUser:
    id: uuid.UUID
    email: str
    name: str | None = None


async def _verify_with_supabase(token: str) -> dict:
    # Supabase's Auth endpoint is authoritative and handles both legacy and asymmetric signing.
    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        'Authorization': f'Bearer {token}',
        'apikey': settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_KEY,
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        response = await client.get(url, headers=headers)
    if response.status_code != 200:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail='Invalid or expired session')
    return response.json()


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing bearer token')
    token = authorization.split(' ', 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail='Missing bearer token')

    payload = await _verify_with_supabase(token)
    try:
        user_id = uuid.UUID(payload['id'])
    except Exception as exc:
        raise HTTPException(status_code=401, detail='Invalid user identifier') from exc

    email = payload.get('email') or ''
    metadata = payload.get('user_metadata') or {}
    name = metadata.get('full_name') or metadata.get('name')

    result = await db.execute(select(User).where(User.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        user = User(id=user_id, email=email, name=name)
        db.add(user)
        await db.commit()
    else:
        changed = False
        if email and user.email != email:
            user.email = email; changed = True
        if name and user.name != name:
            user.name = name; changed = True
        if changed:
            await db.commit()

    return AuthUser(id=user_id, email=email, name=name)


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
