"""
Object storage via Supabase Storage (free tier, no credit card needed).
Stores card images and meeting audio files.

Setup:
  1. Go to supabase.com → your project → Storage
  2. Create two buckets: "cards" and "audio" — both public
  3. Add SUPABASE_URL and SUPABASE_SERVICE_KEY to .env
"""
import uuid
import httpx
from app.core.config import settings


def _headers():
    return {
        "Authorization": f"Bearer {settings.SUPABASE_SERVICE_KEY}",
        "apikey": settings.SUPABASE_SERVICE_KEY,
    }


def _public_url(bucket: str, path: str) -> str:
    return f"{settings.SUPABASE_URL}/storage/v1/object/public/{bucket}/{path}"


async def upload_file(file_bytes: bytes, bucket: str, extension: str, content_type: str) -> str:
    """Upload bytes to Supabase Storage. Returns public URL."""
    path = f"{uuid.uuid4()}.{extension}"
    url = f"{settings.SUPABASE_URL}/storage/v1/object/{bucket}/{path}"

    async with httpx.AsyncClient(timeout=60.0) as client:
        response = await client.post(
            url,
            content=file_bytes,
            headers={**_headers(), "Content-Type": content_type},
        )
        response.raise_for_status()

    return _public_url(bucket, path)


async def upload_card_image(image_bytes: bytes, mime_type: str = "image/jpeg") -> str:
    ext = mime_type.split("/")[-1].replace("jpeg", "jpg")
    return await upload_file(image_bytes, "cards", ext, mime_type)


async def upload_meeting_audio(audio_bytes: bytes, mime_type: str = "audio/webm") -> str:
    ext = mime_type.split("/")[-1]
    return await upload_file(audio_bytes, "audio", ext, mime_type)


async def download_file(url: str) -> bytes:
    """Download a file from Supabase Storage by public URL."""
    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.get(url, headers=_headers())
        response.raise_for_status()
        return response.content
