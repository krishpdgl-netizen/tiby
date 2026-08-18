"""Initial schema — Phase 1

Revision ID: 001
Revises: 
Create Date: 2026-01-01
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID
import uuid

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "users",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("email", sa.String(255), nullable=False, unique=True),
        sa.Column("name", sa.String(255)),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("gmail_access_token", sa.Text),
        sa.Column("gmail_refresh_token", sa.Text),
        sa.Column("gmail_token_expiry", sa.DateTime),
        sa.Column("gmail_connected", sa.Boolean, default=False),
    )

    op.create_table(
        "contacts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("name", sa.String(255)),
        sa.Column("email", sa.String(255)),
        sa.Column("phone", sa.String(100)),
        sa.Column("company", sa.String(255)),
        sa.Column("role", sa.String(255)),
        sa.Column("website", sa.String(500)),
        sa.Column("address", sa.Text),
        sa.Column("notes", sa.Text),
        sa.Column("raw_extraction", sa.JSON),
        sa.Column("card_image_url", sa.String(1000)),
    )
    op.create_index("ix_contacts_user_id", "contacts", ["user_id"])

    op.create_table(
        "email_logs",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("contact_id", UUID(as_uuid=True), sa.ForeignKey("contacts.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("to_email", sa.String(255), nullable=False),
        sa.Column("subject", sa.String(500), nullable=False),
        sa.Column("body", sa.Text, nullable=False),
        sa.Column("gmail_message_id", sa.String(255)),
        sa.Column("sent_at", sa.DateTime),
        sa.Column("voice_instruction", sa.Text),
    )

    op.create_table(
        "meetings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("title", sa.String(500)),
        sa.Column("status", sa.String(50), nullable=False, default="recording"),
        sa.Column("audio_url", sa.String(1000)),
        sa.Column("duration_seconds", sa.Integer),
        sa.Column("transcript", sa.Text),
        sa.Column("summary", sa.Text),
        sa.Column("mom", sa.Text),
        sa.Column("decisions", sa.JSON),
        sa.Column("action_items", sa.JSON),
        sa.Column("mom_sent_at", sa.DateTime),
        sa.Column("mom_sent_to", sa.String(255)),
    )
    op.create_index("ix_meetings_user_id", "meetings", ["user_id"])

    op.create_table(
        "tasks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True),
        sa.Column("user_id", UUID(as_uuid=True), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("meeting_id", UUID(as_uuid=True), sa.ForeignKey("meetings.id", ondelete="SET NULL")),
        sa.Column("created_at", sa.DateTime, nullable=False),
        sa.Column("title", sa.String(500), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("owner", sa.String(255)),
        sa.Column("due_date", sa.String(100)),
        sa.Column("status", sa.String(50), nullable=False, default="pending"),
    )


def downgrade():
    op.drop_table("tasks")
    op.drop_table("meetings")
    op.drop_table("email_logs")
    op.drop_table("contacts")
    op.drop_table("users")
