"""long-term memory + pgvector

Revision ID: 002_memory_search
Revises: 001
"""
from alembic import op

revision = '002_memory_search'
down_revision = '001'
branch_labels = None
depends_on = None


def upgrade():
    op.execute('CREATE EXTENSION IF NOT EXISTS vector')
    op.execute('''
        CREATE TABLE IF NOT EXISTS memories (
            id UUID PRIMARY KEY,
            user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            contact_id UUID REFERENCES contacts(id) ON DELETE SET NULL,
            meeting_id UUID REFERENCES meetings(id) ON DELETE CASCADE,
            email_log_id UUID REFERENCES email_logs(id) ON DELETE CASCADE,
            agent_run_id UUID REFERENCES agent_runs(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            source_type VARCHAR(50) NOT NULL,
            source_id VARCHAR(100),
            title VARCHAR(500),
            content TEXT NOT NULL,
            metadata_json JSON DEFAULT '{}'::json,
            importance INTEGER NOT NULL DEFAULT 50,
            embedding vector(768)
        )
    ''')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_user_created ON memories(user_id, created_at)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_user_source ON memories(user_id, source_type)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_user_contact ON memories(user_id, contact_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_source_id ON memories(source_id)')
    op.execute('CREATE INDEX IF NOT EXISTS ix_memories_embedding_hnsw ON memories USING hnsw (embedding vector_cosine_ops)')


def downgrade():
    op.execute('DROP TABLE IF EXISTS memories')
