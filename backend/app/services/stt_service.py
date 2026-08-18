"""
Speech-to-text using Deepgram Nova-2.
Handles both live voice commands (short audio) and meeting recordings (long audio).
"""
import httpx
from app.core.config import settings

DEEPGRAM_URL = "https://api.deepgram.com/v1/listen"


async def transcribe_audio(
    audio_bytes: bytes,
    mime_type: str = "audio/webm",
    language: str = "en",
    is_meeting: bool = False,
) -> dict:
    """
    Transcribe audio bytes via Deepgram Nova-2.
    Returns: {transcript, confidence, words, duration}
    """
    params = {
        "model": "nova-2",
        "language": language,
        "punctuate": "true",
        "diarize": "true" if is_meeting else "false",  # speaker labels for meetings
        "smart_format": "true",
        "utterances": "true" if is_meeting else "false",
    }

    headers = {
        "Authorization": f"Token {settings.DEEPGRAM_API_KEY}",
        "Content-Type": mime_type,
    }

    async with httpx.AsyncClient(timeout=120.0) as client:
        response = await client.post(
            DEEPGRAM_URL,
            content=audio_bytes,
            headers=headers,
            params=params,
        )
        response.raise_for_status()
        data = response.json()

    result = data["results"]["channels"][0]["alternatives"][0]
    transcript = result.get("transcript", "")
    confidence = result.get("confidence", 0)

    # For meetings with diarization, build speaker-labeled transcript
    speaker_transcript = None
    if is_meeting and "utterances" in data.get("results", {}):
        utterances = data["results"]["utterances"]
        lines = []
        for u in utterances:
            speaker = f"Speaker {u.get('speaker', '?')}"
            lines.append(f"[{speaker}]: {u['transcript']}")
        speaker_transcript = "\n".join(lines)

    return {
        "transcript": speaker_transcript or transcript,
        "raw_transcript": transcript,
        "confidence": confidence,
        "duration": data.get("metadata", {}).get("duration", 0),
    }
