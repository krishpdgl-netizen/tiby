from pydantic import BaseModel, EmailStr


class CardExtraction(BaseModel):
    name: str | None = None
    email: EmailStr | None = None
    phone: str | None = None
    company: str | None = None
    role: str | None = None
    website: str | None = None
    address: str | None = None
    raw_text: str | None = None


class ConfirmContactRequest(BaseModel):
    extracted: dict
    image_path: str | None = None
    image_url: str | None = None
    edits: dict = {}
    category: str | None = None
