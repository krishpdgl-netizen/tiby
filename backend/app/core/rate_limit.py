import logging
from app.core.config import settings

log = logging.getLogger('tiby')
_client = None

def _redis():
    global _client
    if _client is None:
        try:
            import redis.asyncio as redis
            _client = redis.from_url(
                settings.REDIS_URL,
                encoding='utf-8',
                decode_responses=True
            )
        except Exception as e:
            log.warning('Redis unavailable, rate limiting disabled: %s', e)
            return None
    return _client

async def enforce_rate_limit(user_id: str, endpoint: str, limit: int):
    client = _redis()
    if client is None:
        return  # Skip rate limiting if Redis not available
    try:
        key = f'rl:{user_id}:{endpoint}'
        count = await client.incr(key)
        if count == 1:
            await client.expire(key, 60)
        if count > limit:
            from fastapi import HTTPException
            raise HTTPException(429, 'Rate limit exceeded')
    except Exception as e:
        log.warning('Rate limit check failed: %s', e)
        return  # Fail open
