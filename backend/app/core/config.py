CREATE INDEX IF NOT EXISTS ix_agent_steps_run_id ON agent_steps(run_id);
 
-- Index for contacts user+email lookup
CREATE INDEX IF NOT EXISTS ix_contacts_user_email ON contacts(user_id, email);
"""
 
print("Copy the SQL above and run it in your Neon SQL editor.")
print("Or run: alembic upgrade head")
