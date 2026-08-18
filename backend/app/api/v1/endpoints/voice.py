"""
Voice API — short audio clips → text transcription.
Used for: voice commands when drafting emails (what does the user want to say?)
"""
from fastapi import APIRouter, File, UploadFile, HTTPException
from app.services.stt_service import transcribe_audio

router = APIRouter(prefix="/voice", tags=["voice"])


@router.post("/transcribe")
async def transcribe_voice(
    file: UploadFile = File(...),
):
    """
    Transcribe a short voice clip (user's email instruction or command).
    Returns: {transcript, confidence}
    Max 5 MB, under 30 seconds recommended for commands.
    """
    allowed = ("audio/webm", "audio/mp4", "audio/mpeg", "audio/wav", "audio/ogg")
    if file.content_type not in allowed:
        raise HTTPException(400, f"Unsupported audio type: {file.content_type}")

    audio_bytes = await file.read()
    if len(audio_bytes) > 5 * 1024 * 1024:
        raise HTTPException(400, "Voice clip too large (max 5MB)")

    result = await transcribe_audio(audio_bytes, mime_type=file.content_type, is_meeting=False)

    return {
        "transcript": result["transcript"],
        "confidence": result["confidence"],
    }
