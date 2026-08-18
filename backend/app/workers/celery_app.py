"""
Celery app + tasks for background processing.
Main task: process a meeting recording after upload.
"""
import asyncio
from celery import Celery
from app.core.config import settings

celery_app = Celery(
    "tiby",
    broker=settings.REDIS_URL,
    backend=settings.REDIS_URL,
    include=["app.workers.tasks"],
)

celery_app.conf.update(
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],
    timezone="UTC",
    enable_utc=True,
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,  # one task at a time per worker (audio is heavy)
)


def run_async(coro):
    """Helper to run async functions inside sync Celery tasks."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()
