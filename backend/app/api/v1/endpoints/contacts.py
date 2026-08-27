import uuid
from pydantic import BaseModel
import logging
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.models.models import Contact, EmailLog, Meeting, Task
from app.schemas.contacts import ConfirmContactRequest
from app.services.ai_service import extract_business_card
from app.services.storage_service import delete_file, get_signed_url, upload_card_image
from app.services.memory_service import remember, semantic_memory_search



class ContactUpdate(BaseModel):
    name: str | None = None
    email: str | None = None
    phone: str | None = None
    company: str | None = None
    role: str | None = None
    website: str | None = None
    address: str | None = None
    notes: str | None = None
    category: str | None = None

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
    await remember(
        db,
        user_id=user.id,
        source_type='contact',
        source_id=str(contact.id),
        contact_id=contact.id,
        title=contact.name or contact.email or 'Contact',
        content=' | '.join(x for x in [contact.name, contact.role, contact.company, contact.email, contact.phone, contact.notes] if x),
        metadata={'company': contact.company, 'role': contact.role},
        importance=70,
    )
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


@router.get("/{contact_id}/timeline")
async def contact_timeline(
    contact_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)
):
    q = await db.execute(select(Contact).where(Contact.id == contact_id, Contact.user_id == user.id))
    c = q.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")

    items = [{
        'type':'contact_created','id':str(c.id),'title':'Contact added',
        'summary':' · '.join(x for x in [c.role, c.company, c.email] if x),
        'created_at':c.created_at.isoformat(), 'source_id':str(c.id)
    }]

    eq = await db.execute(select(EmailLog).where(
        EmailLog.user_id == user.id,
        or_(EmailLog.contact_id == c.id, EmailLog.to_email == c.email if c.email else False)
    ).order_by(EmailLog.created_at.desc()).limit(100))
    for e in eq.scalars().all():
        items.append({'type':'email','id':str(e.id),'title':e.subject or 'Email sent',
                      'summary':(e.body or '')[:350],'created_at':e.created_at.isoformat(),
                      'source_id':str(e.id),'sent':bool(e.sent_at)})

    needles = [x for x in [c.name, c.email, c.company] if x and len(x.strip()) >= 3]
    if needles:
        clauses=[]
        for needle in needles:
            ptn=f'%{needle}%'
            clauses.extend([Meeting.title.ilike(ptn), Meeting.summary.ilike(ptn), Meeting.transcript.ilike(ptn), Meeting.mom.ilike(ptn)])
        mq = await db.execute(select(Meeting).where(Meeting.user_id == user.id, or_(*clauses))
                             .order_by(Meeting.created_at.desc()).limit(100))
        for m in mq.scalars().all():
            items.append({'type':'meeting','id':str(m.id),'title':m.title or 'Meeting',
                          'summary':(m.summary or m.transcript or '')[:350],
                          'created_at':m.created_at.isoformat(),'source_id':str(m.id)})

    memories = await semantic_memory_search(db, user.id, c.name or c.email or c.company or str(c.id), 30, c.id)
    for m in memories:
        items.append({'type':'memory','id':m['id'],'title':m.get('title') or 'Memory',
                      'summary':m.get('snippet','')[:350],'created_at':m.get('created_at'),
                      'source_id':m.get('source_id')})

    dedupe=set(); out=[]
    for item in sorted(items, key=lambda x:x.get('created_at') or '', reverse=True):
        key=(item['type'],item['source_id'])
        if key in dedupe: continue
        dedupe.add(key); out.append(item)
    return {'contact':_ser(c),'timeline':out}




@router.patch("/{contact_id}")
async def update_contact(contact_id: uuid.UUID, req: ContactUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Edit any field on an existing contact."""
    q = await db.execute(select(Contact).where(Contact.id == contact_id, Contact.user_id == user.id))
    c = q.scalar_one_or_none()
    if not c:
        raise HTTPException(404, "Contact not found")
    if req.name is not None: c.name = req.name
    if req.email is not None: c.email = req.email
    if req.phone is not None: c.phone = req.phone
    if req.company is not None: c.company = req.company
    if req.role is not None: c.role = req.role
    if req.website is not None: c.website = req.website
    if req.address is not None: c.address = req.address
    if req.notes is not None: c.notes = req.notes
    if req.category is not None: c.category = req.category
    await db.commit()
    await db.refresh(c)
    return {"success": True, "contact": _ser(c)}

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



@router.get("/export/csv")
async def export_csv(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """Export all contacts as CSV."""
    import csv, io
    from fastapi.responses import StreamingResponse
    q = await db.execute(select(Contact).where(Contact.user_id == user.id).order_by(Contact.created_at.desc()))
    contacts = q.scalars().all()
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(['Name', 'Email', 'Phone', 'Company', 'Role', 'Category', 'Website', 'Address', 'Notes', 'Added On'])
    for c in contacts:
        writer.writerow([
            c.name or '', c.email or '', c.phone or '', c.company or '',
            c.role or '', c.category or '', c.website or '', c.address or '',
            c.notes or '', c.created_at.strftime('%Y-%m-%d'),
        ])
    buf.seek(0)
    return StreamingResponse(
        iter([buf.getvalue()]),
        media_type='text/csv',
        headers={'Content-Disposition': 'attachment; filename="tiby-contacts.csv"'}
    )


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
        "category": c.category,
        "card_image_path": c.card_image_path,
        "created_at": c.created_at.isoformat(),
    }
