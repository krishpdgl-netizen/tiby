import uuid
from dataclasses import dataclass
from functools import lru_cache
from typing import Annotated

import httpx
from fastapi import Depends, Header, HTTPException, status
from jose import jwt, JWTError
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.database import get_db
from app.models.models import User

# ── In-memory user cache — avoids DB lookup on every request ─────────────────
# Keyed by user_id string, stores (AuthUser, timestamp)
import time as _time
_user_cache: dict[str, tuple] = {}
_CACHE_TTL = 60  # seconds


@dataclass(slots=True)
class AuthUser:
    id: uuid.UUID
    email: str
    name: str | None = None


async def _verify_token(token: str) -> dict:
    """
    Try local JWT verification first (0ms).
    Fall back to Supabase network call only if no key is configured.
    """
    pub_key = (getattr(settings, 'SUPABASE_JWT_PUBLIC_KEY', '') or '').strip()
    legacy  = (getattr(settings, 'SUPABASE_JWT_SECRET', '') or '').strip()

    # ── Local verification (fast path) ───────────────────────────────────────
    if pub_key.startswith('-----BEGIN') or legacy:
        try:
            key  = pub_key if pub_key.startswith('-----BEGIN') else legacy
            algo = 'ES256' if pub_key.startswith('-----BEGIN') else 'HS256'
            return jwt.decode(token, key, algorithms=[algo], options={'verify_aud': False})
        except JWTError as exc:
            raise HTTPException(status_code=401, detail='Invalid or expired token') from exc

    # ── Supabase network fallback (slow path — only if no key set) ───────────
    url = f"{settings.SUPABASE_URL.rstrip('/')}/auth/v1/user"
    headers = {
        'Authorization': f'Bearer {token}',
        'apikey': settings.SUPABASE_ANON_KEY or settings.SUPABASE_SERVICE_KEY,
    }
    async with httpx.AsyncClient(timeout=8.0) as client:
        r = await client.get(url, headers=headers)
    if r.status_code != 200:
        raise HTTPException(status_code=401, detail='Invalid or expired session')
    return r.json()


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
    db: AsyncSession = Depends(get_db),
) -> AuthUser:
    if not authorization or not authorization.lower().startswith('bearer '):
        raise HTTPException(status_code=401, detail='Missing bearer token')

    token = authorization.split(' ', 1)[1].strip()
    if not token:
        raise HTTPException(status_code=401, detail='Missing bearer token')

    payload = await _verify_token(token)

    try:
        user_id = uuid.UUID(payload.get('sub') or payload.get('id'))
    except Exception as exc:
        raise HTTPException(status_code=401, detail='Invalid user identifier') from exc

    uid_str  = str(user_id)
    email    = payload.get('email') or ''
    metadata = payload.get('user_metadata') or {}
    name     = metadata.get('full_name') or metadata.get('name')

    # ── Check in-memory cache ─────────────────────────────────────────────────
    cached = _user_cache.get(uid_str)
    if cached and (_time.time() - cached[1]) < _CACHE_TTL:
        return cached[0]

    # ── DB upsert ─────────────────────────────────────────────────────────────
    result = await db.execute(select(User).where(User.id == user_id))
    user   = result.scalar_one_or_none()

    if not user:
        user = User(id=user_id, email=email, name=name)
        db.add(user)
        await db.commit()
    else:
        changed = False
        if email and user.email != email:
            user.email = email; changed = True
        # Only set name from JWT if user hasn't saved a custom name yet
        if name and not user.name:
            user.name = name; changed = True
        if changed:
            await db.commit()

    auth_user = AuthUser(id=user_id, email=email, name=name)
    _user_cache[uid_str] = (auth_user, _time.time())
    return auth_user


CurrentUser = Annotated[AuthUser, Depends(get_current_user)]
