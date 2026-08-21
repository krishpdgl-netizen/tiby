async def generate_mom(transcript: str, meeting_title: str | None = None) -> dict:
    if not transcript or not transcript.strip():
        return {
            'summary': 'No speech detected in the recording.',
            'mom_markdown': 'No content to summarize.',
            'decisions': [],
            'action_items': [],
        }

    if len(transcript) > 180_000:
        transcript = transcript[:180_000]

    prompt = f'''Analyze this meeting transcript and return ONLY valid JSON with keys: summary (string), mom_markdown (string), decisions (array of strings), action_items (array of objects with task, owner, due). Never invent decisions or action items. If the transcript is too short or unclear, return your best effort.
Title: {meeting_title or 'Meeting'}
Transcript:
{transcript}'''

    try:
        raw = await _generate(prompt, temperature=0.1)
        if not raw or not raw.strip():
            raise ValueError('Empty response from AI')
        data = _extract_json(raw)
    except Exception:
        return {
            'summary': 'Could not generate summary — transcript may be too short.',
            'mom_markdown': f'Transcript:\n{transcript[:2000]}',
            'decisions': [],
            'action_items': [],
        }

    return {
        'summary': str(data.get('summary') or ''),
        'mom_markdown': str(data.get('mom_markdown') or ''),
        'decisions': data.get('decisions') if isinstance(data.get('decisions'), list) else [],
        'action_items': data.get('action_items') if isinstance(data.get('action_items'), list) else [],
    }
