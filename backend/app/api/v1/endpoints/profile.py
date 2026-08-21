from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.database import get_db
from app.models.models import User

router = APIRouter(prefix="/profile", tags=["profile"])


class ProfileUpdate(BaseModel):
    name: str | None = None
    mobile: str | None = None
    organisation: str | None = None
    role: str | None = None


@router.get("/")
async def get_profile(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(User).where(User.id == user.id))
    u = q.scalar_one_or_none()
    if not u:
        return {"email": user.email, "name": user.name, "mobile": "", "organisation": "", "role": ""}
    prefs = u.preferences or {}
    return {
        "email": u.email,
        "name": u.name or "",
        "mobile": prefs.get("mobile", ""),
        "organisation": prefs.get("organisation", ""),
        "role": prefs.get("role", ""),
    }


@router.patch("/")
async def update_profile(req: ProfileUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(User).where(User.id == user.id))
    u = q.scalar_one_or_none()
    if not u:
        raise HTTPException(404, "User not found")
    if req.name is not None:
        u.name = req.name
    prefs = dict(u.preferences or {})
    if req.mobile is not None:
        prefs["mobile"] = req.mobile
    if req.organisation is not None:
        prefs["organisation"] = req.organisation
    if req.role is not None:
        prefs["role"] = req.role
    u.preferences = prefs
    await db.commit()
    return {
        "success": True,
        "name": u.name,
        "mobile": prefs.get("mobile", ""),
        "organisation": prefs.get("organisation", ""),
        "role": prefs.get("role", ""),
    }
