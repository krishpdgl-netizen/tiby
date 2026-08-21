import logging
import uuid
from supabase import create_client, Client
from app.core.config import settings

log = logging.getLogger('tiby')
_client: Client | None = None


def _supabase() -> Client:
    global _client
    if _client is None:
        _client = create_client(settings.SUPABASE_URL, settings.SUPABASE_SERVICE_KEY)
    return _client


async def upload_card_image(image_bytes: bytes, user_id: str, mime_type: str = 'image/jpeg') -> str:
    path = f'users/{user_id}/cards/{uuid.uuid4()}.jpg'
    try:
        sb = _supabase()
        sb.storage.from_(settings.STORAGE_CARD_BUCKET).upload(
            path,
            image_bytes,
            {'content-type': mime_type, 'upsert': 'false'},
        )
        return path
    except Exception as e:
        log.error('Storage upload failed: %s', e)
        raise


async def upload_audio(audio_bytes: bytes, user_id: str, meeting_id: str, mime_type: str = 'audio/webm') -> str:
    ext = 'mp4' if 'mp4' in mime_type else 'webm'
    path = f'users/{user_id}/meetings/{meeting_id}.{ext}'
    try:
        sb = _supabase()
        sb.storage.from_(settings.STORAGE_AUDIO_BUCKET).upload(
            path,
            audio_bytes,
            {'content-type': mime_type, 'upsert': 'true'},
        )
        return path
    except Exception as e:
        log.error('Audio upload failed: %s', e)
        raise


async def get_signed_url(bucket: str, path: str, expires_in: int = 300) -> str:
    try:
        sb = _supabase()
        result = sb.storage.from_(bucket).create_signed_url(path, expires_in)
        return result.get('signedURL') or result.get('signedUrl', '')
    except Exception as e:
        log.error('Signed URL failed: %s', e)
        return ''


async def delete_file(bucket: str, path: str) -> None:
    try:
        _supabase().storage.from_(bucket).remove([path])
    except Exception as e:
        log.warning('Storage delete failed: %s', e)
