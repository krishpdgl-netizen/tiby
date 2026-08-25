import asyncio
import base64
import json
import re
from datetime import date as _date
from pydantic import ValidationError
import google.generativeai as genai
from app.core.config import settings
from app.schemas.agent import AgentPlan
from app.schemas.contacts import CardExtraction


genai.configure(api_key=settings.GEMINI_API_KEY)

# Models
_AGENT_MODEL  = 'gemini-3.6-flash'   # latest flash — supports Google Search grounding
_VISION_MODEL = settings.GEMINI_VISION_MODEL if hasattr(settings, 'GEMINI_VISION_MODEL') else 'gemini-3.6-flash'
_FAST_MODEL   = settings.GEMINI_MODEL  # gemini-3.1-flash-lite for cheap tasks


def _extract_json(text: str) -> dict:
    cleaned = re.sub(r'^```(?:json)?|```$', '', text.strip(), flags=re.MULTILINE).strip()
    first, last = cleaned.find('{'), cleaned.rfind('}')
    if first >= 0 and last > first:
        cleaned = cleaned[first:last + 1]
    return json.loads(cleaned)


async def _generate(prompt_parts, model_name: str | None = None, temperature: float = 0.2, tools=None) -> str:
    model = genai.GenerativeModel(model_name or _FAST_MODEL)
    kwargs = {'generation_config': {'temperature': temperature, 'max_output_tokens': 1400}}
    if tools:
        kwargs['tools'] = tools
    response = await asyncio.to_thread(model.generate_content, prompt_parts, **kwargs)
    if not getattr(response, 'text', None):
        raise RuntimeError('AI returned an empty response')
    return response.text


async def extract_business_card(image_bytes: bytes, mime_type='image/jpeg') -> dict:
    schema = CardExtraction.model_json_schema()
    prompt = f'''Extract business-card contact information. Return ONLY valid JSON matching this schema:\n{json.dumps(schema)}\nUse null when unknown. Do not invent data.'''
    image_part = {'inline_data': {'mime_type': mime_type, 'data': base64.b64encode(image_bytes).decode()}}
    raw = await _generate([prompt, image_part], _VISION_MODEL, 0.0)
    return CardExtraction.model_validate(_extract_json(raw)).model_dump(mode='json')


async def draft_email(contact: dict, user_instruction: str, user_name: str | None = None) -> dict:
    name    = contact.get('name') or 'there'
    company = contact.get('company') or ''
    role    = contact.get('role') or ''
    to_line = name
    if role and company:
        to_line = f'{name} ({role} at {company})'
    elif company:
        to_line = f'{name} ({company})'
    first_name = name.split()[0] if name != 'there' else 'there'

    prompt = f'''You are drafting a professional business email on behalf of {user_name or 'the sender'}.

Recipient: {to_line}
Instruction from sender: {user_instruction}

Rules:
- Address the recipient by first name only (e.g. "Dear {first_name},")
- Keep the body concise and focused ONLY on what the instruction says — do not add unrelated content
- Use a professional but warm tone
- Sign off with "Best regards,\\n{user_name or ''}"
- Plain text only, no markdown

Return ONLY valid JSON with exactly two keys: "subject" and "body".'''

    data = _extract_json(await _generate(prompt, temperature=0.2))
    subject = str(data.get('subject') or '').strip()[:500]
    body = str(data.get('body') or '').strip()
    if not subject or not body:
        raise RuntimeError('AI produced an incomplete email draft')
    return {'subject': subject, 'body': body}


async def transcribe_and_generate_mom(audio_bytes: bytes, mime_type: str, meeting_title: str | None = None) -> dict:
    """Send audio directly to Gemini — transcribes + generates MOM in one call."""
    if not audio_bytes:
        return {'transcript': '', 'summary': 'No audio provided.', 'mom_markdown': '', 'decisions': [], 'action_items': []}

    prompt = f'''You are analyzing a meeting recording.
Title: {meeting_title or 'Meeting'}

Do two things:
1. Transcribe the audio faithfully
2. Analyze the transcript and generate meeting minutes

Return ONLY valid JSON with these keys:
- transcript (string): full transcription
- summary (string): 2-3 sentence summary
- mom_markdown (string): full minutes in markdown
- decisions (array of strings): key decisions, empty if none
- action_items (array of objects with task, owner, due):
  IMPORTANT: Only set owner if the transcript EXPLICITLY assigns the task using words like
  "will", "should", "needs to", "is responsible for". If a name is merely mentioned in
  context, do NOT set them as owner. Default owner to "Me" if unclear.

Never invent content that was not said.'''

    audio_part = {'inline_data': {'mime_type': mime_type, 'data': base64.b64encode(audio_bytes).decode()}}

    try:
        model = genai.GenerativeModel(_AGENT_MODEL)
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


async def generate_mom(transcript: str, meeting_title: str | None = None) -> dict:
    if not transcript or not transcript.strip():
        return {'summary': 'No speech detected.', 'mom_markdown': '', 'decisions': [], 'action_items': []}
    if len(transcript) > 180_000:
        transcript = transcript[:180_000]
    prompt = f'''Today is {_date.today().isoformat()}. Analyze this meeting transcript and return ONLY JSON with keys: summary, mom_markdown, decisions (array), action_items (array with task/owner/due). Only assign owner if explicitly stated.\nTitle: {meeting_title or 'Meeting'}\nTranscript:\n{transcript}'''
    try:
        data = _extract_json(await _generate(prompt, temperature=0.1))
    except Exception:
        return {'summary': transcript[:300], 'mom_markdown': transcript, 'decisions': [], 'action_items': []}
    return {
        'summary': str(data.get('summary') or ''),
        'mom_markdown': str(data.get('mom_markdown') or ''),
        'decisions': data.get('decisions') if isinstance(data.get('decisions'), list) else [],
        'action_items': data.get('action_items') if isinstance(data.get('action_items'), list) else [],
    }


async def _reason_about_message(message: str, history: list[dict], context: dict) -> str:
    """Step 1: Free-form reasoning pass. Figures out what the user ACTUALLY means before we produce JSON."""
    recent = history[-6:] if history else []
    hist_text = ""
    for m in recent:
        role = "User" if m.get("role") == "user" else "Tiby"
        hist_text += f"{role}: {m.get('content', '')}\n"

    reasoning_prompt = f'''You are analyzing a conversation to understand what the user ACTUALLY means.

Recent conversation:
{hist_text}
User just said: "{message}"

Answer these questions briefly (2-3 sentences total):
1. Is this a NEW request or a FOLLOW-UP/CLARIFICATION to the previous message? (Look for words like "then", "also", "but", "so", "he", "she", "it", "that")
2. If follow-up: what is the user adding or correcting from their last message?
3. What does the user actually want right now, in plain English?

Be specific. Do not produce JSON.'''

    try:
        model = genai.GenerativeModel(_AGENT_MODEL)
        resp = await asyncio.to_thread(
            model.generate_content, reasoning_prompt,
            generation_config={'temperature': 0.1, 'max_output_tokens': 300}
        )
        return getattr(resp, 'text', '') or ''
    except Exception:
        return ''


async def plan_agent(message: str, history: list[dict], context: dict) -> AgentPlan:
    schema = AgentPlan.model_json_schema()

    # ── Step 1: Reason first, act second ──────────────────────────────────────
    reasoning = await _reason_about_message(message, history, context)

    # ── Step 2: Produce action JSON informed by the reasoning ─────────────────
    prompt = f'''You are Tiby, a smart AI personal assistant with access to Google Search.
Today's date is {_date.today().isoformat()}.
Return ONLY valid JSON matching this schema:\n{json.dumps(schema)}

Allowed action types: navigate, add_task, complete_task, add_contact, update_contact, call_contact, whatsapp_contact, email_contact.
Allowed navigation routes: /scan, /meetings, /contacts, /analytics, /settings.

══ YOUR REASONING (trust this — you already worked this out) ══
{reasoning}

══ RULES ══
- You have Google Search — use it for current events, prices, weather, facts, real-time info. Search before answering such questions.
- Never claim an action succeeded unless you include the action so the server can execute it.
- For questions, advice, chat — answer fully in reply with NO actions. Be direct and actually helpful.
- Only add tasks when user explicitly says "add task", "remind me", "create a task".
- Use add_contact when user says "add contact", "save contact", or gives contact details explicitly.
- Use update_contact when user wants to update a field on an EXISTING contact. Set text to the contact name.
- Use call_contact when user says "call [name]" or "ring [name]". Set contact_name to the person's name.
- Use whatsapp_contact when user says "whatsapp [name]", "message [name] on whatsapp". Set contact_name and optionally message.
- Use email_contact when: user says "email [name]", "write a mail to [name/email]", "draft a mail to", "compose an email", OR confirms a pending email ("do it", "send it", "go ahead", "yes") — look back in history for recipient. Also when a clarification changes email content (re-draft with same recipient + updated instruction). Set message to the COMPLETE instruction including all clarifications from history.
- CRITICAL: You CANNOT send emails. The system generates a button the user taps to open their mail client. NEVER say "I have sent the email". Always say "I've drafted that — tap the button to open it in your mail app."
- NEVER create a new contact if one already exists — use update_contact.
- Never invent urgency, deadlines, or priorities not mentioned by the user.
- Be concise, warm, and genuinely useful. Don't pad replies.

User context: {json.dumps(context, default=str)[:10000]}
Conversation history: {json.dumps(history[-20:], default=str)[:18000]}
Current user message: {message}'''

    # Use gemini-2.0-flash with Google Search grounding
    try:
        model = genai.GenerativeModel(_AGENT_MODEL)
        google_search_tool = genai.protos.Tool(
            google_search=genai.protos.GoogleSearch()
        )
        response = await asyncio.to_thread(
            model.generate_content,
            prompt,
            tools=[google_search_tool],
            generation_config={'temperature': 0.2, 'max_output_tokens': 2000},
        )
        raw = getattr(response, 'text', '') or ''
        if not raw.strip():
            raise ValueError('Empty agent response')
    except Exception:
        # Fallback: same model, just without Search grounding
        raw = await _generate(prompt, _AGENT_MODEL, temperature=0.2)

    try:
        plan = AgentPlan.model_validate(_extract_json(raw))
    except (ValidationError, json.JSONDecodeError) as exc:
        raise RuntimeError('AI returned an invalid agent plan') from exc

    for action in plan.actions:
        if action.type == 'navigate' and action.route not in {'/scan', '/meetings', '/contacts', '/analytics', '/settings'}:
            action.route = None
    return plan


async def prioritize_tasks(tasks: list[dict]) -> list[dict]:
    today = _date.today().isoformat()
    prompt = f'''Today is {today}. Prioritize these open tasks. Return ONLY a JSON array with one object per input task, in the SAME ORDER. Each object must have priority (high, medium, or low) and reason (max 10 words).
STRICT RULES:
- Only mark high if there is an EXPLICIT due date that is today or overdue, or the user explicitly said urgent.
- Do NOT invent deadlines or assume urgency from task titles alone.
- A task with no due date is at most medium priority.
- reason: describe WHY it is that priority based on the task title. Never say "no due date" or "TBD" — that is not useful. Say something like "Financial obligation" or "Long-term planning" instead.
- Max 10 words per reason.
Tasks: {json.dumps(tasks, default=str)}'''
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
    done_tasks = [t for t in tasks if t.get('status') == 'done']
    pending_tasks = [t for t in tasks if t.get('status') != 'done']
    today = _date.today().isoformat()
    prompt = f'''Today is {today}. Create an end-of-day review. Return ONLY JSON with today_summary and tomorrow_plan.
STRICT RULES:
- today_summary: ONLY mention tasks with status="done". If none are done, say "No tasks completed today." NEVER claim a pending task was completed.
- tomorrow_plan: list up to 3 pending tasks. Use their exact titles. Do not invent urgency or deadlines not in the data.
- Be factual. Never hallucinate.
Done tasks: {json.dumps(done_tasks, default=str)}
Pending tasks: {json.dumps(pending_tasks, default=str)}'''
    data = _extract_json(await _generate(prompt, temperature=0.1))
    return {
        'today_summary': str(data.get('today_summary') or ''),
        'tomorrow_plan': str(data.get('tomorrow_plan') or ''),
    }


async def extract_handwritten_notes(image_bytes: bytes, mime_type='image/jpeg') -> str:
    image_part = {'inline_data': {'mime_type': mime_type, 'data': base64.b64encode(image_bytes).decode()}}
    prompt = 'Transcribe these handwritten or printed meeting notes faithfully. Return plain text only. Do not add information that is not visible.'
    return (await _generate([prompt, image_part], _VISION_MODEL, 0.0)).strip()
