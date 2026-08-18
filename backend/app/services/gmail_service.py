"""
Gmail service — OAuth 2.0 connect + send emails on behalf of user.
"""
import base64
import email as email_lib
from email.mime.text import MIMEText
from datetime import datetime, timedelta

import httpx
from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build

from app.core.config import settings
from app.models.models import User

SCOPES = [
    "https://www.googleapis.com/auth/gmail.send",
    "https://www.googleapis.com/auth/gmail.readonly",
    "openid",
    "https://www.googleapis.com/auth/userinfo.email",
]


def get_gmail_auth_url(state: str) -> str:
    """Generate Google OAuth URL to connect Gmail."""
    from google_auth_oauthlib.flow import Flow

    flow = Flow.from_client_config(
        {
            "web": {
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "redirect_uris": [settings.GOOGLE_REDIRECT_URI],
            }
        },
        scopes=SCOPES,
    )
    flow.redirect_uri = settings.GOOGLE_REDIRECT_URI
    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        state=state,
        prompt="consent",
    )
    return auth_url


async def exchange_code_for_tokens(code: str) -> dict:
    """Exchange auth code for access + refresh tokens."""
    async with httpx.AsyncClient() as client:
        response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "code": code,
                "client_id": settings.GOOGLE_CLIENT_ID,
                "client_secret": settings.GOOGLE_CLIENT_SECRET,
                "redirect_uri": settings.GOOGLE_REDIRECT_URI,
                "grant_type": "authorization_code",
            },
        )
        response.raise_for_status()
        return response.json()


def _build_gmail_service(user: User):
    """Build authenticated Gmail API service for a user."""
    creds = Credentials(
        token=user.gmail_access_token,
        refresh_token=user.gmail_refresh_token,
        token_uri="https://oauth2.googleapis.com/token",
        client_id=settings.GOOGLE_CLIENT_ID,
        client_secret=settings.GOOGLE_CLIENT_SECRET,
        scopes=SCOPES,
    )
    # Refresh if expired
    if creds.expired and creds.refresh_token:
        creds.refresh(Request())
    return build("gmail", "v1", credentials=creds)


async def send_email(user: User, to: str, subject: str, body: str) -> str:
    """
    Send an email via Gmail API.
    Returns Gmail message ID.
    """
    service = _build_gmail_service(user)

    message = MIMEText(body)
    message["to"] = to
    message["subject"] = subject

    raw = base64.urlsafe_b64encode(message.as_bytes()).decode()
    result = service.users().messages().send(
        userId="me", body={"raw": raw}
    ).execute()

    return result["id"]


async def send_mom_email(user: User, mom_markdown: str, meeting_title: str | None = None) -> str:
    """Send MOM to the user's own email."""
    title = meeting_title or "Meeting"
    subject = f"Minutes of Meeting — {title}"
    body = f"""Hi {user.name or 'there'},

Here are the minutes from your recent meeting.

{mom_markdown}

---
Sent by Tiby AI
"""
    return await send_email(user, user.email, subject, body)
