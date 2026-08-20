import asyncio
import base64
from datetime import datetime, timezone, timedelta
from email.mime.text import MIMEText
import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from app.core.config import settings
from app.core.crypto import decrypt_secret, encrypt_secret
from app.models.models import User

SCOPES = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly',
    'openid',
    'https://www.googleapis.com/auth/userinfo.email',
]


def get_gmail_auth_url(state: str) -> str:
    from google_auth_oauthlib.flow import Flow
    flow = Flow.from_client_config({'web': {
        'client_id': settings.GOOGLE_CLIENT_ID,
        'client_secret': settings.GOOGLE_CLIENT_SECRET,
        'auth_uri': 'https://accounts.google.com/o/oauth2/auth',
        'token_uri': 'https://oauth2.googleapis.com/token',
        'redirect_uris': [settings.GOOGLE_REDIRECT_URI],
    }}, scopes=SCOPES)
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    url, _ = flow.authorization_url(access_type='offline', include_granted_scopes='true', state=state, prompt='consent')
    return url


async def exchange_code_for_tokens(code: str) -> dict:
    async with httpx.AsyncClient(timeout=20.0) as client:
        r = await client.post('https://oauth2.googleapis.com/token', data={
            'code': code,
            'client_id': settings.GOOGLE_CLIENT_ID,
            'client_secret': settings.GOOGLE_CLIENT_SECRET,
            'redirect_uri': settings.GOOGLE_REDIRECT_URI,
            'grant_type': 'authorization_code',
        })
        r.raise_for_status()
        return r.json()


def store_tokens(user: User, tokens: dict) -> None:
    if tokens.get('access_token'):
        user.gmail_access_token = encrypt_secret(tokens['access_token'])
    if tokens.get('refresh_token'):
        user.gmail_refresh_token = encrypt_secret(tokens['refresh_token'])
    expires = int(tokens.get('expires_in', 3600))
    user.gmail_token_expiry = datetime.now(timezone.utc).replace(microsecond=0) + timedelta(seconds=expires)
    user.gmail_connected = True


def _service(user: User):
    creds = Credentials(
        token=decrypt_secret(user.gmail_access_token),
        refresh_token=decrypt_secret(user.gmail_refresh_token),
        token_uri='https://oauth2.googleapis.com/token',
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
        user.gmail_access_token = encrypt_secret(creds.token)
    return build('gmail', 'v1', credentials=creds, cache_discovery=False)


async def send_email(user: User, to: str, subject: str, body: str) -> str:
    def _send():
        svc = _service(user)
        message = MIMEText(body)
        message['to'] = to
        message['subject'] = subject
        raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
        return svc.users().messages().send(userId='me', body={'raw': raw}).execute()['id']
    return await asyncio.to_thread(_send)


async def send_mom_email(user: User, mom_markdown: str, meeting_title: str | None = None) -> str:
    title = meeting_title or 'Meeting'
    body = f"Hi {user.name or 'there'},\n\nHere are the minutes from your recent meeting.\n\n{mom_markdown}\n\n---\nSent by Tiby AI"
    return await send_email(user, user.email, f'Minutes of Meeting — {title}', body)
