import asyncio
from app.core.database import engine, Base
from app.models import models  # noqa: registers all models

async def main():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("Tables created successfully")

asyncio.run(main())
