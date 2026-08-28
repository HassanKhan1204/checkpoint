from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class OrganizerBase(BaseModel):
    name: str
    email: EmailStr
    role: Optional[str] = None


class OrganizerCreate(OrganizerBase):
    pass


class Organizer(OrganizerBase):
    id: int
    created_at: datetime


class MemberBase(BaseModel):
    organizer_id: int
    name: str
    group_name: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class MemberCreate(MemberBase):
    pass


class Member(MemberBase):
    id: int
    created_at: datetime


class EventIn(BaseModel):
    event_type: str
    member_id: int
    organizer_id: int
    value: Optional[float] = None
    metadata: Optional[str] = None


class QuietMember(BaseModel):
    member_id: int
    name: str
    organizer_id: int
    group_name: Optional[str] = None
    last_check_in: Optional[datetime] = None
    days_since_check_in: Optional[int] = None
