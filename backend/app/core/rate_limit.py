import time
import redis.asyncio as redis
from fastapi import HTTPException
from app.core.config import settings

_client: redis.Redis | None = None


def _redis() -> redis.Redis:
    global _client
    if _client is None:
        _client = redis.from_url(settings.REDIS_URL, encoding='utf-8', decode_responses=True)
    return _client


async def enforce_rate_limit(user_id: str, bucket: str = 'default', limit: int | None = None):
    max_hits = limit or settings.RATE_LIMIT_PER_MINUTE
    minute = int(time.time() // 60)
    key = f'rl:{bucket}:{user_id}:{minute}'
    client = _redis()
    try:
        current = await client.incr(key)
        if current == 1:
            await client.expire(key, 70)
    except Exception:
        # Do not take the app down because Redis is briefly unavailable.
        return
    if current > max_hits:
        raise HTTPException(status_code=429, detail='Too many requests. Please try again shortly.')
