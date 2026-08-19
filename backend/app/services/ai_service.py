"""
AI service — Gemini 2.5 Flash Lite for all LLM + vision tasks.
"""
import base64
import json
import re
import google.generativeai as genai
from app.core.config import settings

genai.configure(api_key=settings.GEMINI_API_KEY)

MODEL = "gemini-3.1-flash-lite"   # update to gemini-2.5-flash-lite when available in your region
VISION_MODEL = "gemini-2.0-flash-lite"


def _parse_json(text: str) -> dict:
    """Strip markdown fences and parse JSON from model output."""
    text = re.sub(r"```(?:json)?", "", text).strip().rstrip("```").strip()
    return json.loads(text)


async def extract_business_card(image_bytes: bytes, mime_type: str = "image/jpeg") -> dict:
    """
    Extract structured contact info from a business card image.
    Returns: {name, email, phone, company, role, website, address, raw_text}
    """
    model = genai.GenerativeModel(VISION_MODEL)
    image_part = {
        "inline_data": {
            "mime_type": mime_type,
            "data": base64.b64encode(image_bytes).decode()
        }
    }
    prompt = """Extract all contact information from this business card.
Return ONLY a JSON object with these exact keys (use null if not found):
{
  "name": "full name",
  "email": "email address",
  "phone": "phone number",
  "company": "company/organization name",
  "role": "job title or role",
  "website": "website URL",
  "address": "full address if present",
  "raw_text": "all text found on the card verbatim"
}
No explanation, just the JSON."""

    response = model.generate_content([prompt, image_part])
    return _parse_json(response.text)


async def draft_email(
    contact: dict,
    user_instruction: str,
    user_name: str | None = None,
) -> dict:
    """
    Draft an email to a contact based on user's voice instruction.
    Returns: {subject, body}
    """
    model = genai.GenerativeModel(MODEL)
    sender = f"from {user_name}" if user_name else ""

    prompt = f"""You are drafting a professional email {sender} to {contact.get('name', 'a contact')}.

Contact details:
- Name: {contact.get('name', 'Unknown')}
- Company: {contact.get('company', '')}
- Role: {contact.get('role', '')}
- Email: {contact.get('email', '')}

User instruction (what they want the email to say):
"{user_instruction}"

Write a professional, concise email. Return ONLY a JSON object:
{{
  "subject": "email subject line",
  "body": "full email body text (no HTML, plain text, include greeting and sign-off)"
}}
No explanation, just the JSON."""

    response = model.generate_content(prompt)
    return _parse_json(response.text)


async def generate_mom(transcript: str, meeting_title: str | None = None) -> dict:
    """
    Generate Minutes of Meeting from a transcript.
    Returns: {summary, mom_markdown, decisions, action_items}
    """
    model = genai.GenerativeModel(MODEL)
    title_hint = f'Meeting title: "{meeting_title}"' if meeting_title else ""

    prompt = f"""You are analyzing a meeting transcript to produce structured meeting minutes.
{title_hint}

TRANSCRIPT:
{transcript}

Return ONLY a JSON object with this structure:
{{
  "summary": "2-3 sentence executive summary of the meeting",
  "mom_markdown": "Full Minutes of Meeting in markdown format with sections: Attendees (if identifiable), Agenda/Topics Discussed, Key Discussions, Decisions Made, Action Items, Next Steps",
  "decisions": ["decision 1", "decision 2"],
  "action_items": [
    {{"task": "task description", "owner": "person name or 'TBD'", "due": "due date or 'TBD'"}}
  ]
}}
No explanation, just the JSON."""

    response = model.generate_content(prompt)
    return _parse_json(response.text)
