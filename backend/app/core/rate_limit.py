import logging
from app.core.config import settings

log = logging.getLogger('tiby')
_client = None

def _redis():
    global _client
    if _client is None:
        try:
            import redis.asyncio as redis
            import ssl as _ssl
            url = settings.REDIS_URL or ''
            # Upstash and most managed Redis use rediss:// (TLS)
            # redis.asyncio needs ssl_cert_reqs=None to accept their certs
            if url.startswith('rediss://'):
                ssl_ctx = _ssl.create_default_context()
                ssl_ctx.check_hostname = False
                ssl_ctx.verify_mode = _ssl.CERT_NONE
                _client = redis.from_url(
                    url,
                    encoding='utf-8',
                    decode_responses=True,
                    ssl_cert_reqs=None,
                )
            else:
                _client = redis.from_url(
                    url,
                    encoding='utf-8',
                    decode_responses=True,
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
