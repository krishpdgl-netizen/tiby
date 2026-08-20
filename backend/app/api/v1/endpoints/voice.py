from fastapi import APIRouter, Depends, File, UploadFile, HTTPException
from app.core.auth import CurrentUser
from app.core.config import settings
from app.core.rate_limit import enforce_rate_limit
from app.services.stt_service import transcribe_audio

router = APIRouter(prefix='/voice', tags=['voice'])


@router.post('/transcribe')
async def transcribe(user: CurrentUser, file: UploadFile = File(...)):
    await enforce_rate_limit(str(user.id), 'voice', settings.AI_RATE_LIMIT_PER_MINUTE)
    allowed = {'audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/webm;codecs=opus'}
    ct = (file.content_type or '').split(';')[0].strip()
    if ct not in allowed and not ct.startswith('audio/'):
        raise HTTPException(400, f'Unsupported audio type: {file.content_type}')
    data = await file.read(settings.MAX_VOICE_BYTES + 1)
    if len(data) > settings.MAX_VOICE_BYTES:
        raise HTTPException(413, 'Audio file too large')
    result = await transcribe_audio(data)
    return {'transcript': result.get('transcript', ''), 'duration': result.get('duration')}
