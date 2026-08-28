from datetime import datetime
from typing import Optional

from pydantic import BaseModel, EmailStr


class TeacherBase(BaseModel):
    name: str
    email: EmailStr
    role: Optional[str] = None


class TeacherCreate(TeacherBase):
    pass


class Teacher(TeacherBase):
    id: int
    created_at: datetime


class StudentBase(BaseModel):
    teacher_id: int
    name: str
    group_name: Optional[str] = None
    contact: Optional[str] = None
    notes: Optional[str] = None


class StudentCreate(StudentBase):
    pass


class Student(StudentBase):
    id: int
    created_at: datetime


class EventIn(BaseModel):
    event_type: str
    student_id: int
    teacher_id: int
    value: Optional[float] = None
    metadata: Optional[str] = None


class QuietStudent(BaseModel):
    student_id: int
    name: str
    teacher_id: int
    group_name: Optional[str] = None
    last_check_in: Optional[datetime] = None
    days_since_check_in: Optional[int] = None


class OutreachDraft(QuietStudent):
    draft: str
