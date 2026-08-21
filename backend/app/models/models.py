import enum
import uuid
from datetime import datetime, timezone
from sqlalchemy import String, Text, Boolean, DateTime, ForeignKey, JSON, Integer, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class TaskStatus(str, enum.Enum):
    pending = 'pending'
    done = 'done'
    cancelled = 'cancelled'


class MeetingStatus(str, enum.Enum):
    recording = 'recording'
    processing = 'processing'
    done = 'done'
    failed = 'failed'


class AgentRunStatus(str, enum.Enum):
    running = 'running'
    completed = 'completed'
    failed = 'failed'


class User(Base):
    __tablename__ = 'users'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True)  # comes from Supabase, no default
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    gmail_access_token: Mapped[str | None] = mapped_column(Text)   # encrypted with Fernet
    gmail_refresh_token: Mapped[str | None] = mapped_column(Text)  # encrypted with Fernet
    gmail_token_expiry: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    gmail_connected: Mapped[bool] = mapped_column(Boolean, default=False)
    preferences: Mapped[dict | None] = mapped_column(JSON, default=dict)

    contacts: Mapped[list['Contact']] = relationship(back_populates='user', cascade='all, delete-orphan')
    meetings: Mapped[list['Meeting']] = relationship(back_populates='user', cascade='all, delete-orphan')


class Contact(Base):
    __tablename__ = 'contacts'
    __table_args__ = (Index('ix_contacts_user_email', 'user_id', 'email'),)
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(100))
    company: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(500))
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)
    raw_extraction: Mapped[dict | None] = mapped_column(JSON)
    # Changed from card_image_url (public Drive URL) to card_image_path (private Supabase Storage)
    card_image_path: Mapped[str | None] = mapped_column(String(1000))

    user: Mapped['User'] = relationship(back_populates='contacts')
    emails_sent: Mapped[list['EmailLog']] = relationship(back_populates='contact')


class EmailLog(Base):
    __tablename__ = 'email_logs'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('contacts.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    to_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    gmail_message_id: Mapped[str | None] = mapped_column(String(255))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    voice_instruction: Mapped[str | None] = mapped_column(Text)
    error: Mapped[str | None] = mapped_column(Text)

    contact: Mapped['Contact | None'] = relationship(back_populates='emails_sent')


class Meeting(Base):
    __tablename__ = 'meetings'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    title: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[str] = mapped_column(String(50), default='recording')
    # Changed from audio_url (public) to audio_path (private Supabase Storage)
    audio_path: Mapped[str | None] = mapped_column(String(1000))
    duration_seconds: Mapped[int | None] = mapped_column(Integer)
    transcript: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    mom: Mapped[str | None] = mapped_column(Text)
    decisions: Mapped[list | None] = mapped_column(JSON)
    action_items: Mapped[list | None] = mapped_column(JSON)
    mom_sent_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    mom_sent_to: Mapped[str | None] = mapped_column(String(255))
    processing_error: Mapped[str | None] = mapped_column(Text)

    user: Mapped['User'] = relationship(back_populates='meetings')
    tasks: Mapped[list['Task']] = relationship(back_populates='meeting')


class Task(Base):
    __tablename__ = 'tasks'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey('meetings.id', ondelete='SET NULL'))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[str] = mapped_column(String(50), default='pending')
    source: Mapped[str | None] = mapped_column(String(50))  # 'meeting', 'agent', 'manual', 'meeting_notes'

    meeting: Mapped['Meeting | None'] = relationship(back_populates='tasks')


class AgentRun(Base):
    __tablename__ = 'agent_runs'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('users.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    finished_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    prompt: Mapped[str] = mapped_column(Text)
    final_response: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default='running')
    model: Mapped[str | None] = mapped_column(String(100))
    error: Mapped[str | None] = mapped_column(Text)

    steps: Mapped[list['AgentStep']] = relationship(back_populates='run', cascade='all, delete-orphan')


class AgentStep(Base):
    __tablename__ = 'agent_steps'
    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    run_id: Mapped[uuid.UUID] = mapped_column(ForeignKey('agent_runs.id', ondelete='CASCADE'), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow)
    step_number: Mapped[int] = mapped_column(Integer)
    tool: Mapped[str] = mapped_column(String(100))
    arguments: Mapped[dict | None] = mapped_column(JSON)
    result: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(50), default='completed')

    run: Mapped['AgentRun'] = relationship(back_populates='steps')
