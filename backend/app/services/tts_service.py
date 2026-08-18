"""
Text-to-speech — uses browser's native speechSynthesis on the frontend.
This backend module just returns the text as-is; the frontend speaks it.

No API key needed. No cost. Works on all modern browsers including mobile.

When you're ready to upgrade to a real voice (Google Cloud TTS / ElevenLabs),
swap the frontend hook in useWakeWord.js and this file together.
"""


async def email_to_speech(subject: str, body: str) -> dict:
    """
    Returns the text for the frontend to speak via speechSynthesis.
    Truncated to keep the spoken version concise.
    """
    text = f"Subject: {subject}. {body}"
    if len(text) > 800:
        text = text[:800] + "... The email continues. Would you like to send it?"
    return {"speak_text": text}
