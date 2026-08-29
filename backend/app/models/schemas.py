from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, EmailStr, Field


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
    student_id: int
    teacher_id: int
    fluency_score: float = Field(..., ge=0, description="Words correct per minute")
    accuracy_pct: float = Field(..., ge=0, le=100)
    error_tags: list[str] = Field(default_factory=list, description='e.g. "decoding", "comprehension", "fluency"')


class AssessmentPoint(BaseModel):
    event_time: datetime
    fluency_score: float
    accuracy_pct: float
    error_tags: list[str]


class DecliningStudent(BaseModel):
    student_id: int
    name: str
    teacher_id: int
    group_name: Optional[str] = None
    status: Literal["declining", "insufficient_data"]
    history: list[AssessmentPoint]
    average_previous_score: Optional[float] = None


class OutreachDraft(DecliningStudent):
    draft: Optional[str] = None
