"""
Contacts API
POST /contacts/scan-card   — upload card image → extract → save contact
GET  /contacts             — list all contacts
GET  /contacts/{id}        — get one contact
"""
import uuid
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.core.database import get_db
from app.models.models import Contact, User
from app.services.ai_service import extract_business_card
from app.services.storage_service import upload_card_image

router = APIRouter(prefix="/contacts", tags=["contacts"])


def get_current_user_id() -> uuid.UUID:
    """Placeholder — replace with real Supabase JWT auth middleware."""
    return uuid.UUID("00000000-0000-0000-0000-000000000001")


@router.post("/scan-card")
async def scan_business_card(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Upload a business card image.
    Returns extracted contact info (not yet saved — let user confirm first).
    """
    if file.content_type not in ("image/jpeg", "image/png", "image/webp", "image/heic"):
        raise HTTPException(400, "Unsupported image type")

    image_bytes = await file.read()
    if len(image_bytes) > 10 * 1024 * 1024:  # 10 MB limit
        raise HTTPException(400, "Image too large (max 10MB)")

    # Run vision extraction
    extracted = await extract_business_card(image_bytes, mime_type=file.content_type)

    # Upload card image to R2
    image_url = await upload_card_image(image_bytes, mime_type=file.content_type)

    return {
        "extracted": extracted,
        "image_url": image_url,
        "message": "Review the extracted info and confirm to save",
    }


@router.post("/confirm")
async def confirm_contact(
    data: dict,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    """
    Save a confirmed (possibly edited) contact after card scan.
    Body: {extracted: {...}, image_url: "...", edits: {...}}
    """
    extracted = data.get("extracted", {})
    edits = data.get("edits", {})
    image_url = data.get("image_url")

    # Merge user edits on top of AI extraction
    final = {**extracted, **edits}

    contact = Contact(
        user_id=user_id,
        name=final.get("name"),
        email=final.get("email"),
        phone=final.get("phone"),
        company=final.get("company"),
        role=final.get("role"),
        website=final.get("website"),
        address=final.get("address"),
        raw_extraction=extracted,
        card_image_url=image_url,
    )
    db.add(contact)
    await db.commit()
    await db.refresh(contact)

    return {"id": str(contact.id), "contact": _serialize(contact)}


@router.get("/")
async def list_contacts(
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Contact).where(Contact.user_id == user_id).order_by(Contact.created_at.desc())
    )
    contacts = result.scalars().all()
    return [_serialize(c) for c in contacts]


@router.get("/{contact_id}")
async def get_contact(
    contact_id: uuid.UUID,
    db: AsyncSession = Depends(get_db),
    user_id: uuid.UUID = Depends(get_current_user_id),
):
    result = await db.execute(
        select(Contact).where(Contact.id == contact_id, Contact.user_id == user_id)
    )
    contact = result.scalar_one_or_none()
    if not contact:
        raise HTTPException(404, "Contact not found")
    return _serialize(contact)


def _serialize(c: Contact) -> dict:
    return {
        "id": str(c.id),
        "name": c.name,
        "email": c.email,
        "phone": c.phone,
        "company": c.company,
        "role": c.role,
        "website": c.website,
        "address": c.address,
        "card_image_url": c.card_image_url,
        "created_at": c.created_at.isoformat(),
    }
