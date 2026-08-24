import asyncio
import logging
import re
import uuid
from typing import Iterable

import google.generativeai as genai
from sqlalchemy import select, or_, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.models.models import Contact, Memory

log = logging.getLogger('tiby')


def _clean(value: str | None) -> str:
    return re.sub(r'\s+', ' ', value or '').strip()


def _chunks(text_value: str, max_chars: int = 1800, overlap: int = 180) -> list[str]:
    text_value = _clean(text_value)
    if not text_value:
        return []
    if len(text_value) <= max_chars:
        return [text_value]
    out, start = [], 0
    while start < len(text_value):
        end = min(len(text_value), start + max_chars)
        chunk = text_value[start:end]
        if end < len(text_value):
            split = max(chunk.rfind('. '), chunk.rfind('\n'))
            if split > max_chars // 2:
                end = start + split + 1
                chunk = text_value[start:end]
        out.append(chunk.strip())
        if end >= len(text_value):
            break
        start = max(start + 1, end - overlap)
    return [x for x in out if x]


async def embed_text(content: str) -> list[float] | None:
    """Generate a Gemini embedding. Memory still works lexically if this fails."""
    if not settings.GEMINI_API_KEY or not content.strip():
        return None
    try:
        result = await asyncio.to_thread(
            genai.embed_content,
            model=settings.GEMINI_EMBEDDING_MODEL,
            content=content[:12000],
            task_type='retrieval_document',
        )
        vec = result.get('embedding') if isinstance(result, dict) else None
        if vec and len(vec) == settings.MEMORY_EMBEDDING_DIMENSIONS:
            return [float(x) for x in vec]
        log.warning('Embedding dimension mismatch: expected=%s got=%s', settings.MEMORY_EMBEDDING_DIMENSIONS, len(vec or []))
    except Exception as exc:
        log.warning('Embedding generation failed; lexical memory remains available: %s', exc)
    return None


async def embed_query(content: str) -> list[float] | None:
    if not settings.GEMINI_API_KEY or not content.strip():
        return None
    try:
        result = await asyncio.to_thread(
            genai.embed_content,
            model=settings.GEMINI_EMBEDDING_MODEL,
            content=content[:12000],
            task_type='retrieval_query',
        )
        vec = result.get('embedding') if isinstance(result, dict) else None
        if vec and len(vec) == settings.MEMORY_EMBEDDING_DIMENSIONS:
            return [float(x) for x in vec]
    except Exception as exc:
        log.warning('Query embedding failed; using lexical search: %s', exc)
    return None


async def remember(
    db: AsyncSession,
    *,
    user_id,
    source_type: str,
    content: str,
    title: str | None = None,
    source_id: str | None = None,
    contact_id=None,
    meeting_id=None,
    email_log_id=None,
    agent_run_id=None,
    metadata: dict | None = None,
    importance: int = 50,
    dedupe: bool = True,
) -> list[Memory]:
    pieces = _chunks(content)
    created = []
    for i, piece in enumerate(pieces):
        sid = f'{source_id}:{i}' if source_id and len(pieces) > 1 else source_id
        if dedupe and sid:
            q = await db.execute(select(Memory.id).where(
                Memory.user_id == user_id,
                Memory.source_type == source_type,
                Memory.source_id == sid,
            ).limit(1))
            if q.scalar_one_or_none():
                continue
        memory = Memory(
            user_id=user_id,
            contact_id=contact_id,
            meeting_id=meeting_id,
            email_log_id=email_log_id,
            agent_run_id=agent_run_id,
            source_type=source_type,
            source_id=sid,
            title=title,
            content=piece,
            metadata_json={**(metadata or {}), 'chunk': i, 'chunks': len(pieces)},
            importance=max(0, min(100, importance)),
            embedding=await embed_text(piece),
        )
        db.add(memory)
        created.append(memory)
    return created


async def find_contacts_in_text(db: AsyncSession, user_id, content: str) -> list[Contact]:
    content_l = (content or '').lower()
    if not content_l:
        return []
    q = await db.execute(select(Contact).where(Contact.user_id == user_id))
    matches = []
    for c in q.scalars().all():
        candidates = [c.email, c.phone]
        if c.name and len(c.name.strip()) >= 3:
            candidates.append(c.name)
        if any(x and x.lower() in content_l for x in candidates):
            matches.append(c)
    return matches


async def semantic_memory_search(db: AsyncSession, user_id, query: str, limit: int = 10, contact_id=None) -> list[dict]:
    """Hybrid search: vector candidates when available + lexical candidates, merged/deduped."""
    query = _clean(query)
    if not query:
        return []

    found: dict[str, dict] = {}
    qvec = await embed_query(query)

    if qvec:
        try:
            filters = ['user_id = :uid', 'embedding IS NOT NULL']
            params = {'uid': str(user_id), 'qvec': str(qvec), 'lim': max(limit * 2, 12)}
            if contact_id:
                filters.append('contact_id = :cid')
                params['cid'] = str(contact_id)
            sql = text(f'''
                SELECT id, source_type, source_id, title, content, created_at, contact_id,
                       1 - (embedding <=> CAST(:qvec AS vector)) AS score
                FROM memories
                WHERE {' AND '.join(filters)}
                ORDER BY embedding <=> CAST(:qvec AS vector)
                LIMIT :lim
            ''')
            rows = (await db.execute(sql, params)).mappings().all()
            for r in rows:
                found[str(r['id'])] = {
                    'id': str(r['id']), 'type': 'memory', 'source_type': r['source_type'],
                    'source_id': r['source_id'], 'title': r['title'], 'snippet': r['content'][:500],
                    'created_at': r['created_at'].isoformat() if r['created_at'] else None,
                    'contact_id': str(r['contact_id']) if r['contact_id'] else None,
                    'score': round(float(r['score'] or 0), 4), 'match': 'semantic',
                }
        except Exception as exc:
            log.warning('Vector memory search failed; using lexical search: %s', exc)

    pattern = f'%{query}%'
    stmt = select(Memory).where(
        Memory.user_id == user_id,
        or_(Memory.content.ilike(pattern), Memory.title.ilike(pattern)),
    )
    if contact_id:
        stmt = stmt.where(Memory.contact_id == contact_id)
    lex = await db.execute(stmt.order_by(Memory.created_at.desc()).limit(max(limit * 2, 12)))
    for m in lex.scalars().all():
        key = str(m.id)
        if key not in found:
            found[key] = {
                'id': key, 'type': 'memory', 'source_type': m.source_type,
                'source_id': m.source_id, 'title': m.title, 'snippet': m.content[:500],
                'created_at': m.created_at.isoformat(),
                'contact_id': str(m.contact_id) if m.contact_id else None,
                'score': 0.65, 'match': 'keyword',
            }
        elif found[key]['match'] == 'semantic':
            found[key]['score'] = min(1.0, found[key]['score'] + 0.08)
            found[key]['match'] = 'hybrid'

    return sorted(found.values(), key=lambda x: (x.get('score') or 0, x.get('created_at') or ''), reverse=True)[:limit]
