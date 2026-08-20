import uuid
from urllib.parse import quote
import httpx
from app.core.config import settings


def _headers(content_type: str | None = None) -> dict:
    h = {
        'Authorization': f'Bearer {settings.SUPABASE_SERVICE_KEY}',
        'apikey': settings.SUPABASE_SERVICE_KEY,
    }
    if content_type:
        h['Content-Type'] = content_type
    return h


async def upload_private(file_bytes: bytes, bucket: str, path: str, content_type: str) -> str:
    url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{quote(path)}"
    async with httpx.AsyncClient(timeout=120.0) as client:
        r = await client.post(url, content=file_bytes, headers={**_headers(content_type), 'x-upsert': 'false'})
        r.raise_for_status()
    return path


async def signed_url(bucket: str, path: str, expires_in: int | None = None) -> str:
    ttl = expires_in or settings.SIGNED_URL_TTL_SECONDS
    url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/sign/{bucket}/{quote(path)}"
    async with httpx.AsyncClient(timeout=15.0) as client:
        r = await client.post(url, json={'expiresIn': ttl}, headers=_headers('application/json'))
        r.raise_for_status()
        data = r.json()
    signed = data.get('signedURL') or data.get('signedUrl')
    if not signed:
        raise RuntimeError('Storage did not return a signed URL')
    return f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1{signed}"


async def download_private(bucket: str, path: str) -> bytes:
    url = f"{settings.SUPABASE_URL.rstrip('/')}/storage/v1/object/{bucket}/{quote(path)}"
    async with httpx.AsyncClient(timeout=180.0) as client:
        r = await client.get(url, headers=_headers())
        r.raise_for_status()
        return r.content


async def upload_card_image(image_bytes: bytes, user_id: str, mime_type='image/jpeg') -> str:
    ext = mime_type.split('/')[-1].replace('jpeg', 'jpg')
    path = f'users/{user_id}/cards/{uuid.uuid4()}.{ext}'
    return await upload_private(image_bytes, settings.STORAGE_CARD_BUCKET, path, mime_type)


async def upload_meeting_audio(audio_bytes: bytes, user_id: str, meeting_id: str, mime_type='audio/webm') -> str:
    ext = mime_type.split('/')[-1].replace('mpeg', 'mp3')
    path = f'users/{user_id}/meetings/{meeting_id}/{uuid.uuid4()}.{ext}'
    return await upload_private(audio_bytes, settings.STORAGE_AUDIO_BUCKET, path, mime_type)
