from typing import Literal
from pydantic import BaseModel, Field


class ChatMessage(BaseModel):
    role: Literal['user', 'assistant']
    content: str = Field(min_length=1, max_length=8000)


class AgentAction(BaseModel):
    type: Literal['navigate', 'add_task', 'complete_task']
    route: str | None = None
    title: str | None = None
    due: str | None = None
    owner: str | None = None
    text: str | None = None


class AgentPlan(BaseModel):
    reply: str
    actions: list[AgentAction] = []


class AgentChatRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    history: list[ChatMessage] = Field(default_factory=list, max_length=30)


class AgentChatResponse(BaseModel):
    run_id: str
    reply: str
    actions: list[dict]
email-validator==2.2.0
