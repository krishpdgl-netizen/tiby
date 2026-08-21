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


async def generate_mom(transcript: str, meeting_title: str | None = None) -> dict:
    if len(transcript) > 180_000:
        transcript = transcript[:180_000]
    prompt = f'''Analyze this meeting transcript and return ONLY JSON with keys: summary (string), mom_markdown (string), decisions (array of strings), action_items (array of objects with task, owner, due). Never invent decisions or action items.\nTitle: {meeting_title or 'Meeting'}\nTranscript:\n{transcript}'''
    data = _extract_json(await _generate(prompt, temperature=0.1))
    return {
        'summary': str(data.get('summary') or ''),
        'mom_markdown': str(data.get('mom_markdown') or ''),
        'decisions': data.get('decisions') if isinstance(data.get('decisions'), list) else [],
        'action_items': data.get('action_items') if isinstance(data.get('action_items'), list) else [],
    }


async def plan_agent(message: str, history: list[dict], context: dict) -> AgentPlan:
    schema = AgentPlan.model_json_schema()
    prompt = f'''You are Tiby, a smart AI personal assistant. Return ONLY valid JSON matching this schema:\n{json.dumps(schema)}

Allowed action types: navigate, add_task, complete_task, add_contact, update_contact.
Allowed navigation routes: /scan, /meetings, /contacts, /analytics, /settings.

RULES:
- Never claim an action succeeded unless you include the action so the server can execute it.
- For questions, advice, planning, or general chat — answer fully in the reply field with NO actions.
- For trip planning, travel advice, recommendations — give a detailed helpful answer in reply. Do NOT add tasks unless the user explicitly asks to.
- Only add tasks when the user explicitly says "add task", "remind me", "create a task", or similar.
- Use add_contact when user says "add contact", "save contact", "add [name] to my contacts", or gives contact details explicitly. Extract name, email, phone, company, role from what they say.
- Use update_contact when user wants to update a field on an EXISTING contact (e.g. "add his number", "update Rahul's email"). Set text to the contact name to find, and only set the fields being updated.
- NEVER create a new contact if one already exists with the same name — use update_contact instead.
- When asked about a contact's details, check the context carefully — phone, email, company, role are ALL provided. Never say a field is missing if it's in the context.
- Only navigate when the user explicitly asks to go somewhere in the app.
- Never invent urgency, deadlines, or priorities not mentioned by the user.
- Be conversational, warm, and genuinely helpful — not robotic.

User context: {json.dumps(context, default=str)[:12000]}
Conversation: {json.dumps(history[-20:], default=str)[:20000]}
User message: {message}'''
    raw = await _generate(prompt, temperature=0.3)
    try:
        plan = AgentPlan.model_validate(_extract_json(raw))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise RuntimeError('AI returned an invalid agent plan') from exc
    for action in plan.actions:
        if action.type == 'navigate' and action.route not in {'/scan', '/meetings', '/contacts', '/analytics', '/settings'}:
            action.route = None
    return plan

async def prioritize_tasks(tasks: list[dict]) -> list[dict]:
    prompt = f'''Prioritize these open tasks. Return ONLY a JSON array with one object per input task, in the SAME ORDER. Each object must have priority (high, medium, or low) and reason (max 12 words).
STRICT RULES:
- Only mark high if there is an EXPLICIT due date that is today or overdue, or the user explicitly said urgent.
- Do NOT invent deadlines or assume urgency from task titles alone.
- A task with no due date is at most medium priority.
- reason must be factual, max 12 words, no invented urgency.
Tasks: {json.dumps(tasks, default=str)}'''
    raw = await _generate(prompt, temperature=0.1)
    cleaned = re.sub(r'^```(?:json)?|```$', '', raw.strip(), flags=re.MULTILINE).strip()
    first,last=cleaned.find('['),cleaned.rfind(']')
    data=json.loads(cleaned[first:last+1]) if first>=0 and last>first else []
    out=[]
    for i,_ in enumerate(tasks):
        p=data[i] if i < len(data) and isinstance(data[i],dict) else {}
        priority=p.get('priority') if p.get('priority') in {'high','medium','low'} else 'medium'
        out.append({'priority':priority,'reason':str(p.get('reason') or '')[:160]})
    return out

async def generate_eod_summary(tasks: list[dict]) -> dict:
    prompt = f'''Create an end-of-day review from the user's tasks. Return ONLY JSON with today_summary and tomorrow_plan. Be concise, factual, and do not claim work happened unless a task is marked done. Tasks: {json.dumps(tasks, default=str)}'''
    data=_extract_json(await _generate(prompt, temperature=0.2))
    return {'today_summary':str(data.get('today_summary') or ''),'tomorrow_plan':str(data.get('tomorrow_plan') or '')}

async def extract_handwritten_notes(image_bytes: bytes, mime_type='image/jpeg') -> str:
    image_part={'inline_data':{'mime_type':mime_type,'data':base64.b64encode(image_bytes).decode()}}
    prompt='Transcribe these handwritten or printed meeting notes faithfully. Return plain text only. Do not add information that is not visible.'
    return (await _generate([prompt,image_part],settings.GEMINI_VISION_MODEL,0.0)).strip()
