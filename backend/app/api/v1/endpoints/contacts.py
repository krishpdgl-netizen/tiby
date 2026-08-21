import uuid
import logging
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.models.models import Contact
from app.schemas.contacts import ConfirmContactRequest
from app.services.ai_service import extract_business_card
from app.services.storage_service import delete_file, get_signed_url, upload_card_image

log = logging.getLogger("tiby")
router = APIRouter(prefix="/contacts", tags=["contacts"])


@router.post("/scan-card")
async def scan_card(
    user: CurrentUser,
    file: UploadFile = File(...),
):
    allowed = {"image/jpeg", "image/png", "image/webp", "image/heic"}
    ct = (file.content_type or "").split(";")[0].strip()
    if ct not in allowed:
        raise HTTPException(400, f"Unsupported image type: {file.content_type}")

    data = await file.read(settings.MAX_CARD_BYTES + 1)
    if len(data) > settings.MAX_CARD_BYTES:
        raise HTTPException(413, "Image too large (max 10 MB)")

    image_path = await upload_card_image(data, str(user.id), ct or "image/jpeg")
    image_url = await get_signed_url(
        settings.STORAGE_CARD_BUCKET, image_path, settings.SIGNED_URL_TTL_SECONDS
    )

    try:
        extracted = await extract_business_card(data, ct or "image/jpeg")
    except Exception as exc:
        log.warning("Card extraction failed: %s", exc)
        extracted = {}

    return {"extracted": extracted, "image_path": image_path, "image_url": image_url}


@router.post("/confirm")
async def confirm_contact(
    req: ConfirmContactRequest,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    ext = req.extracted or {}
    edits = req.edits or {}
    merged = {**ext, **edits}

    contact = Contact(
        user_id=user.id,
        name=merged.get("name"),
        email=merged.get("email"),
        phone=merged.get("phone"),
        company=merged.get("company"),
        role=merged.get("role"),
        website=merged.get("website"),
        address=merged.get("address"),
        notes=merged.get("notes"),
        raw_extraction=ext,
        card_image_path=req.image_path,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)
    return {"id": str(contact.id), "contact": _ser(contact)}


@router.get("/")
async def list_contacts(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(
        select(Contact).where(Contact.user_id == user.id).order_by(Contact.created_at.desc())
    )
    return [_ser(c) for c in q.scalars().all()]


@router.get("/{contact_id}")
async def get_contact(
    contact_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
):
    q = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.user_id == user.id)
    )
    c = q.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")
    result = _ser(c)
    if c.card_image_path:
        result["card_image_url"] = await get_signed_url(
            settings.STORAGE_CARD_BUCKET, c.card_image_path, settings.SIGNED_URL_TTL_SECONDS
        )
    return result


@router.delete("/{contact_id}")
async def delete_contact(
    contact_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
):
    q = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.user_id == user.id)
    )
    c = q.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")
    if c.card_image_path:
        await delete_file(settings.STORAGE_CARD_BUCKET, c.card_image_path)
    await db.delete(c)
    await db.commit()
    return {"success": True}


def _ser(c: Contact) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "company": c.company,
        "role": c.role,
        "website": c.website,
        "address": c.address,
        "notes": c.notes,
        "card_image_path": c.card_image_path,
        "created_at": c.created_at.isoformat(),
    }
