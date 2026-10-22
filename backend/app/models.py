"""NURU v2 database tables (SQLModel on SQLite).

All datetimes are stored as naive UTC. Dates shown to people use NURU_TZ
(Africa/Dar_es_Salaam); see core.py for the helpers.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import NaiveDatetime as datetime
from sqlalchemy import JSON, Column
from sqlmodel import Field, SQLModel


def _json(default: Any = None) -> Any:
    factory = (lambda: []) if default is None else (lambda: default.copy())
    return Field(default_factory=factory, sa_column=Column(JSON))


class User(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    username: str = Field(index=True, unique=True)
    password_hash: str = ""
    has_account: bool = True  # False = directory-only person (cannot sign in)
    display_name: str
    title: str = ""
    role: str = "staff"  # supervisor | staff
    email: str = Field(index=True)
    language: str = "sw"
    voice_enabled: bool = True
    reminder_lead_min: int = 5
    meeting_audio_source: str = "live"  # live | sample
    wake_word: bool = False
    supervisor_id: Optional[int] = None


class Session(SQLModel, table=True):
    token: str = Field(primary_key=True)
    user_id: int = Field(index=True)
    created_at: datetime
    expires_at: datetime
    device_label: str = ""


class ScheduledMeeting(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    room_id: str
    title: str
    start_at: datetime
    end_at: datetime
    organizer_id: int
    invitee_ids: list = _json()
    status: str = "scheduled"  # scheduled | live | ended


class ScheduleItem(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    date: str  # YYYY-MM-DD, local
    start_at: datetime
    end_at: Optional[datetime] = None
    title: str
    kind: str = "other"  # meeting | task | call | personal | other
    source: str = "manual"  # briefing | mikutano | weris | manual
    ref_id: Optional[str] = None
    notes: str = ""
    done: bool = False


class Reminder(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    fire_at: datetime
    kind: str  # meeting | task | item
    ref_id: str
    message_sw: str = ""
    message_en: str = ""
    fired_at: Optional[datetime] = None
    snoozed_until: Optional[datetime] = None
    dismissed: bool = False


class Task(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    description: str = ""
    assigned_by_id: int
    assigned_to_id: int = Field(index=True)
    start_date: str = ""
    due_at: Optional[datetime] = None
    status: str = "assigned"  # assigned | in_progress | done
    created_at: datetime
    updated_at: datetime


class Notification(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    kind: str
    title_sw: str = ""
    title_en: str = ""
    body_sw: str = ""
    body_en: str = ""
    link: str = ""
    created_at: datetime
    read_at: Optional[datetime] = None


class MailMessage(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    owner_id: int = Field(index=True)
    folder: str = "inbox"  # inbox | drafts | sent | trash
    from_addr: str
    from_name: str
    to: list = _json()
    cc: list = _json()
    subject: str = ""
    body: str = ""
    sent_at: Optional[datetime] = None
    read: bool = False
    thread_id: str = ""
    in_reply_to: Optional[int] = None


class Project(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    title: str
    types: list = _json()  # AI/ML, WEB, MOBILE, SYSTEMS, ...
    leaders: list = _json()
    start_date: str = ""
    end_date: str = ""
    status: str = "On Development"
    maturity: str = "Idea"
    last_report_week: str = ""


class PdpEntry(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    tab: str = "pdp"  # pdp | projects | activities
    skill: str
    category: str = ""
    start_date: str = ""
    end_date: str = ""
    status: str = "In Progress"


class WeeklyReport(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    week: str  # 2026-W43
    start_date: str
    end_date: str
    status: str = "DRAFT"  # DRAFT | SUBMITTED
    submitted_at: Optional[datetime] = None
    reviewed_by: str = ""
    content: str = ""


class KatibuJob(SQLModel, table=True):
    id: Optional[int] = Field(default=None, primary_key=True)
    user_id: int = Field(index=True)
    room_id: str = ""
    title: str = ""
    scheduled_meeting_id: Optional[int] = None
    katibu_meeting_uid: str = ""
    audio_source: str = "sample"  # live | sample
    audio_note: str = ""
    status: str = "uploading"  # uploading | processing | ready | failed | sent
    progress: int = 0
    stage: str = ""
    error: dict = _json({})
    minutes_sw: dict = _json({})
    minutes_en: dict = _json({})
    documents: list = _json()
    deliveries: list = _json()
    created_at: datetime
    ready_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    recipients: list = _json()


class AuditRecord(SQLModel, table=True):
    id: str = Field(primary_key=True)
    user_id: Optional[int] = Field(default=None, index=True)
    system: str = "mikutano"  # hub | mikutano | gms | weris | katibu
    timestamp: str = ""
    outcome: str = ""
    request: str = ""
    record: dict = _json({})
