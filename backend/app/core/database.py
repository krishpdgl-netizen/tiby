from sqlalchemy.ext.asyncio import create_async_engine, AsyncSession, async_sessionmaker
from sqlalchemy.orm import DeclarativeBase


class Base(DeclarativeBase):
    pass


_engine = None
_AsyncSessionLocal = None


def _get_engine():
    global _engine
    if _engine is None:
        from app.core.config import settings
        _engine = create_async_engine(
            settings.DATABASE_URL,
            echo=settings.APP_ENV == "development",
            pool_pre_ping=True,
            pool_size=10,
            max_overflow=20,
        )
    return _engine


def _get_session_factory():
    global _AsyncSessionLocal
    if _AsyncSessionLocal is None:
        _AsyncSessionLocal = async_sessionmaker(
            _get_engine(), class_=AsyncSession, expire_on_commit=False
        )
    return _AsyncSessionLocal


class AsyncSessionLocal:
    def __new__(cls):
        return _get_session_factory()()


async def get_db():
    async with _get_session_factory()() as session:
        try:
            yield session
        finally:
            await session.close()
