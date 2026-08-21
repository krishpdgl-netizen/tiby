import asyncio
import base64
import json
import re
from pydantic import BaseModel, ValidationError
import google.generativeai as genai
from app.core.config import settings
from app.schemas.agent import AgentPlan
from app.schemas.contacts import CardExtraction


genai.configure(api_key=settings.GEMINI_API_KEY)


def _extract_json(text: str) -> dict:
    cleaned = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.MULTILINE).strip()
    first, last = cleaned.find('{'), cleaned.rfind('}')
    if first >= 0 and last > first:
        cleaned = cleaned[first:last + 1]
    return json.loads(cleaned)


async def _generate(prompt_parts, model_name: str | None = None, temperature: float = 0.2) -> str:
    model = genai.GenerativeModel(model_name or settings.GEMINI_MODEL)
    response = await asyncio.to_thread(
        model.generate_content,
        prompt_parts,
        generation_config={'temperature': temperature, 'max_output_tokens': 1400},
    )
    if not getattr(response, 'text', None):
        raise RuntimeError('AI returned an empty response')
    return response.text


async def extract_business_card(image_bytes: bytes, mime_type='image/jpeg') -> dict:
    schema = CardExtraction.model_json_schema()
    prompt = f'''Extract business-card contact information. Return ONLY valid JSON matching this schema:\n{json.dumps(schema)}\nUse null when unknown. Do not invent data.'''
    image_part = {'inline_data': {'mime_type': mime_type, 'data': base64.b64encode(image_bytes).decode()}}
    raw = await _generate([prompt, image_part], settings.GEMINI_VISION_MODEL, 0.0)
    return CardExtraction.model_validate(_extract_json(raw)).model_dump(mode='json')


async def draft_email(contact: dict, user_instruction: str, user_name: str | None = None) -> dict:
    prompt = f'''Draft a concise professional plain-text email. Return ONLY JSON with keys subject and body.\nSender: {user_name or 'the user'}\nContact: {json.dumps(contact)}\nInstruction: {user_instruction}'''
    data = _extract_json(await _generate(prompt, temperature=0.3))
    subject = str(data.get('subject') or '').strip()[:500]
    body = str(data.get('body') or '').strip()
    if not subject or not body:
        raise RuntimeError('AI produced an incomplete email draft')
    return {'subject': subject, 'body': body}


async def transcribe_and_generate_mom(audio_bytes: bytes, mime_type: str, meeting_title: str | None = None) -> dict:
    """Send audio directly to Gemini — transcribes + generates MOM in one call. No Deepgram needed."""
    prompt = f'''You are analyzing a meeting recording.
Title: {meeting_title or 'Meeting'}

Do two things:
1. Transcribe the audio faithfully
2. Analyze the transcript and generate meeting minutes

Return ONLY valid JSON with these keys:
- transcript (string): full transcription of the audio
- summary (string): 2-3 sentence summary of the meeting
- mom_markdown (string): full minutes of meeting in markdown format
- decisions (array of strings): key decisions made, empty array if none
- action_items (array of objects): each with task, owner, due fields. Empty array if none.

If audio is too short or unclear, still return valid JSON with whatever you could capture.
Never invent content that wasn't said.'''

    audio_part = {
        'inline_data': {
            'mime_type': mime_type,
            'data': base64.b64encode(audio_bytes).decode()
        }
    }

    try:
        model = genai.GenerativeModel(settings.GEMINI_MODEL)
        response = await asyncio.to_thread(
            model.generate_content,
            [prompt, audio_part],
            generation_config={'temperature': 0.1, 'max_output_tokens': 4000},
        )
        raw = getattr(response, 'text', '') or ''
        if not raw.strip():
            raise ValueError('Empty response from Gemini')
        data = _extract_json(raw)
    except Exception as exc:
        return {
            'transcript': '',
            'summary': f'Could not process audio: {str(exc)[:200]}',
            'mom_markdown': 'Audio processing failed.',
            'decisions': [],
            'action_items': [],
        }

    return {
        'transcript': str(data.get('transcript') or ''),
        'summary': str(data.get('summary') or ''),
        'mom_markdown': str(data.get('mom_markdown') or ''),
        'decisions': data.get('decisions') if isinstance(data.get('decisions'), list) else [],
        'action_items': data.get('action_items') if isinstance(data.get('action_items'), list) else [],
    }


async def plan_agent(message: str, history: list[dict], context: dict) -> AgentPlan:
    schema = AgentPlan.model_json_schema()
    prompt = f'''You are Tiby, a concise personal assistant. Return ONLY valid JSON matching this schema:\n{json.dumps(schema)}\nAllowed action types: navigate, add_task, complete_task.\nAllowed navigation routes: /scan, /meetings, /contacts, /analytics, /settings.\nNever claim an action succeeded unless you include the action so the server can execute it.\nFor anything outside available actions, answer helpfully without an action.\nUser context: {json.dumps(context, default=str)[:12000]}\nConversation: {json.dumps(history[-20:], default=str)[:20000]}\nUser message: {message}'''
    raw = await _generate(prompt, temperature=0.25)
    try:
        plan = AgentPlan.model_validate(_extract_json(raw))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise RuntimeError('AI returned an invalid agent plan') from exc
    for action in plan.actions:
        if action.type == 'navigate' and action.route not in {'/scan', '/meetings', '/contacts', '/analytics', '/settings'}:
            action.route = None
    return plan


async def prioritize_tasks(tasks: list[dict]) -> list[dict]:
    prompt = f'''Prioritize these open tasks. Return ONLY a JSON array with one object per input task, in the SAME ORDER. Each object must have priority (high, medium, or low) and reason (max 12 words). Consider explicit due dates and urgency, but do not invent deadlines. Tasks: {json.dumps(tasks, default=str)}'''
    raw = await _generate(prompt, temperature=0.1)
    cleaned = re.sub(r'^```(?:json)?|```$', '', raw.strip(), flags=re.MULTILINE).strip()
    first, last = cleaned.find('['), cleaned.rfind(']')
    data = json.loads(cleaned[first:last + 1]) if first >= 0 and last > first else []
    out = []
    for i, _ in enumerate(tasks):
        p = data[i] if i < len(data) and isinstance(data[i], dict) else {}
        priority = p.get('priority') if p.get('priority') in {'high', 'medium', 'low'} else 'medium'
        out.append({'priority': priority, 'reason': str(p.get('reason') or '')[:160]})
    return out


async def generate_eod_summary(tasks: list[dict]) -> dict:
    prompt = f'''Create an end-of-day review from the user's tasks. Return ONLY JSON with today_summary and tomorrow_plan. Be concise, factual, and do not claim work happened unless a task is marked done. Tasks: {json.dumps(tasks, default=str)}'''
    data = _extract_json(await _generate(prompt, temperature=0.2))
    return {
        'today_summary': str(data.get('today_summary') or ''),
        'tomorrow_plan': str(data.get('tomorrow_plan') or ''),
    }


async def extract_handwritten_notes(image_bytes: bytes, mime_type='image/jpeg') -> str:
    image_part = {'inline_data': {'mime_type': mime_type, 'data': base64.b64encode(image_bytes).decode()}}
    prompt = 'Transcribe these handwritten or printed meeting notes faithfully. Return plain text only. Do not add information that is not visible.'
    return (await _generate([prompt, image_part], settings.GEMINI_VISION_MODEL, 0.0)).strip()
