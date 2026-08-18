import uuid
from datetime import datetime
from sqlalchemy import (
    String, Text, Boolean, DateTime, ForeignKey,
    JSON, Enum as SAEnum
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.dialects.postgresql import UUID
from app.core.database import Base
import enum


class TaskStatus(str, enum.Enum):
    pending = "pending"
    done = "done"
    cancelled = "cancelled"


class MeetingStatus(str, enum.Enum):
    recording = "recording"
    processing = "processing"
    done = "done"
    failed = "failed"


class User(Base):
    __tablename__ = "users"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False)
    name: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Gmail OAuth tokens (stored encrypted in production)
    gmail_access_token: Mapped[str | None] = mapped_column(Text)
    gmail_refresh_token: Mapped[str | None] = mapped_column(Text)
    gmail_token_expiry: Mapped[datetime | None] = mapped_column(DateTime)
    gmail_connected: Mapped[bool] = mapped_column(Boolean, default=False)

    contacts: Mapped[list["Contact"]] = relationship(back_populates="user")
    meetings: Mapped[list["Meeting"]] = relationship(back_populates="user")


class Contact(Base):
    __tablename__ = "contacts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    # Extracted from card
    name: Mapped[str | None] = mapped_column(String(255))
    email: Mapped[str | None] = mapped_column(String(255))
    phone: Mapped[str | None] = mapped_column(String(100))
    company: Mapped[str | None] = mapped_column(String(255))
    role: Mapped[str | None] = mapped_column(String(255))
    website: Mapped[str | None] = mapped_column(String(500))
    address: Mapped[str | None] = mapped_column(Text)
    notes: Mapped[str | None] = mapped_column(Text)

    # Raw extraction data + card image URL
    raw_extraction: Mapped[dict | None] = mapped_column(JSON)
    card_image_url: Mapped[str | None] = mapped_column(String(1000))

    user: Mapped["User"] = relationship(back_populates="contacts")
    emails_sent: Mapped[list["EmailLog"]] = relationship(back_populates="contact")


class EmailLog(Base):
    __tablename__ = "email_logs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    contact_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("contacts.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    to_email: Mapped[str] = mapped_column(String(255))
    subject: Mapped[str] = mapped_column(String(500))
    body: Mapped[str] = mapped_column(Text)
    gmail_message_id: Mapped[str | None] = mapped_column(String(255))
    sent_at: Mapped[datetime | None] = mapped_column(DateTime)

    # What the user said (voice instruction)
    voice_instruction: Mapped[str | None] = mapped_column(Text)

    contact: Mapped["Contact | None"] = relationship(back_populates="emails_sent")


class Meeting(Base):
    __tablename__ = "meetings"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    title: Mapped[str | None] = mapped_column(String(500))
    status: Mapped[MeetingStatus] = mapped_column(SAEnum(MeetingStatus), default=MeetingStatus.recording)

    # Audio file
    audio_url: Mapped[str | None] = mapped_column(String(1000))
    duration_seconds: Mapped[int | None] = mapped_column()

    # Processed outputs
    transcript: Mapped[str | None] = mapped_column(Text)
    summary: Mapped[str | None] = mapped_column(Text)
    mom: Mapped[str | None] = mapped_column(Text)          # Minutes of Meeting (markdown)
    decisions: Mapped[list | None] = mapped_column(JSON)   # list of strings
    action_items: Mapped[list | None] = mapped_column(JSON) # list of {task, owner, due}

    # Delivery
    mom_sent_at: Mapped[datetime | None] = mapped_column(DateTime)
    mom_sent_to: Mapped[str | None] = mapped_column(String(255))

    user: Mapped["User"] = relationship(back_populates="meetings")
    tasks: Mapped[list["Task"]] = relationship(back_populates="meeting")


class Task(Base):
    __tablename__ = "tasks"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"))
    meeting_id: Mapped[uuid.UUID | None] = mapped_column(ForeignKey("meetings.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)

    title: Mapped[str] = mapped_column(String(500))
    description: Mapped[str | None] = mapped_column(Text)
    owner: Mapped[str | None] = mapped_column(String(255))
    due_date: Mapped[str | None] = mapped_column(String(100))
    status: Mapped[TaskStatus] = mapped_column(SAEnum(TaskStatus), default=TaskStatus.pending)

    meeting: Mapped["Meeting | None"] = relationship(back_populates="tasks")
