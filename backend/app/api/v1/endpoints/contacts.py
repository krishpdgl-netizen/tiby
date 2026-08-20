import uuid
from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.database import get_db
from app.core.rate_limit import enforce_rate_limit
from app.models.models import Contact
from app.schemas.contacts import ConfirmContactRequest
from app.services.ai_service import extract_business_card
from app.services.storage_service import upload_card_image, signed_url

router = APIRouter(prefix='/contacts', tags=['contacts'])

@router.post('/scan-card')
async def scan_business_card(user: CurrentUser, file: UploadFile = File(...)):
    await enforce_rate_limit(str(user.id), 'card-scan', 10)
    allowed = {'image/jpeg','image/png','image/webp','image/heic'}
    if file.content_type not in allowed: raise HTTPException(400, 'Unsupported image type')
    data = await file.read(settings.MAX_CARD_BYTES + 1)
    if len(data) > settings.MAX_CARD_BYTES: raise HTTPException(413, 'Image too large')
    extracted = await extract_business_card(data, file.content_type)
    path = await upload_card_image(data, str(user.id), file.content_type)
    preview = await signed_url(settings.STORAGE_CARD_BUCKET, path)
    return {'extracted':extracted,'image_path':path,'image_url':preview,'message':'Review the extracted info and confirm to save'}

@router.post('/confirm')
async def confirm_contact(req: ConfirmContactRequest, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    final = {**req.extracted, **req.edits}
    c = Contact(user_id=user.id, name=final.get('name'), email=final.get('email'), phone=final.get('phone'), company=final.get('company'), role=final.get('role'), website=final.get('website'), address=final.get('address'), raw_extraction=req.extracted, card_image_path=req.image_path)
    db.add(c); await db.commit(); await db.refresh(c)
    return {'id':str(c.id),'contact':await _serialize(c)}

@router.get('/')
async def list_contacts(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Contact).where(Contact.user_id == user.id).order_by(Contact.created_at.desc()))
    return [await _serialize(c) for c in q.scalars().all()]

@router.get('/{contact_id}')
async def get_contact(contact_id: uuid.UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    q = await db.execute(select(Contact).where(Contact.id == contact_id, Contact.user_id == user.id))
    c = q.scalar_one_or_none()
    if not c: raise HTTPException(404, 'Contact not found')
    return await _serialize(c)

async def _serialize(c: Contact):
    image_url = await signed_url(settings.STORAGE_CARD_BUCKET, c.card_image_path) if c.card_image_path else None
    return {'id':str(c.id),'name':c.name,'email':c.email,'phone':c.phone,'company':c.company,'role':c.role,'website':c.website,'address':c.address,'card_image_url':image_url,'created_at':c.created_at.isoformat()}
