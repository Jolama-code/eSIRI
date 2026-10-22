"""NURU Hub API: auth, profile, day, briefing, meetings, tasks, reminders, notifications, audit, events, demo."""

from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime, time, timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, Header, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field
from sqlmodel import Session as DBSession
from sqlmodel import select

from . import llm
from .core import (
    account_users, broker, check_password, engine, current_user, first_name, from_local, get_db, iso, local_today,
    new_session, now_utc, parse_dt, to_local, tz, user_for_token, user_from_query, user_full, user_public,
)
from .models import (
    AuditRecord, Notification, Reminder, ScheduledMeeting, ScheduleItem, Session, Task, User,
)
from .services import (
    day_items, day_updated, dismiss_reminders, fire_reminder, meeting_view, notify, push, resync_user_reminders,
    sync_item_reminder, sync_meeting_reminders, sync_task_reminder, task_view, user_meetings,
)

log = logging.getLogger("nuru.hub")
router = APIRouter(prefix="/api")


def bad(status: int, code: str, en: str, sw: str = "") -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "error": en, "error_en": en, "error_sw": sw or en})


# ---------------------------------------------------------------------------
# Auth and profile

class LoginBody(BaseModel):
    username: str = Field(min_length=1, max_length=120)
    password: str = Field(min_length=1, max_length=200)
    device_label: str = ""


@router.post("/auth/login")
def login(body: LoginBody, request: Request, db: DBSession = Depends(get_db)) -> dict[str, Any]:
    name = body.username.strip().lower()
    u = db.exec(select(User).where((User.username == name) | (User.email == name))).first()
    if not u or not u.has_account or not check_password(body.password, u.password_hash):
        raise bad(401, "invalid_credentials", "Wrong username or password.", "Jina la mtumiaji au nenosiri si sahihi.")
    label = body.device_label or request.headers.get("user-agent", "")[:120]
    s = new_session(db, u, label)
    return {"token": s.token, "user": user_full(u)}


@router.post("/auth/logout")
def logout(request: Request, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    token = request.headers.get("authorization", "")[7:].strip()
    s = db.get(Session, token)
    if s:
        db.delete(s)
        db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(current_user)) -> dict[str, Any]:
    return user_full(user)


class MePatch(BaseModel):
    language: Optional[Literal["sw", "en"]] = None
    voice_enabled: Optional[bool] = None
    reminder_lead_min: Optional[Literal[2, 5, 10, 15]] = None
    meeting_audio_source: Optional[Literal["live", "sample"]] = None
    wake_word: Optional[bool] = None


@router.patch("/me")
def patch_me(body: MePatch, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    lead_changed = body.reminder_lead_min is not None and body.reminder_lead_min != user.reminder_lead_min
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(user, k, v)
    db.add(user)
    db.commit()
    db.refresh(user)
    if lead_changed:
        resync_user_reminders(db, user.id)  # type: ignore[arg-type]
    return user_full(user)


@router.get("/users")
def users(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    return [user_public(u) for u in db.exec(select(User).order_by(User.id))]


# ---------------------------------------------------------------------------
# Day

@router.get("/day")
def get_day(date: str = "", db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    day = date or local_today().isoformat()
    return {"date": day, "now": iso(now_utc()), "items": day_items(db, user, day)}


def _local_time_today(hhmm: str) -> datetime:
    h, m = [int(x) for x in hhmm.strip().split(":")[:2]]
    if not (0 <= h <= 23 and 0 <= m <= 59):
        raise ValueError("bad time")
    return from_local(datetime.combine(local_today(), time(h, m)).replace(tzinfo=tz()))


def _when(value: str) -> datetime:
    """'14:00' (today, local) or an ISO date-time."""
    v = (value or "").strip()
    try:
        if len(v) <= 5 and ":" in v:
            return _local_time_today(v)
        dt = parse_dt(v)
        if dt is None:
            raise ValueError
        return dt
    except ValueError:
        raise bad(422, "bad_time", f"Could not understand the time '{value}'. Use HH:MM or an ISO date-time.",
                  f"Sikuelewa muda '{value}'. Tumia SS:DD.")


class ItemBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    at: str = Field(min_length=1, description="HH:MM today, or ISO date-time")
    end: Optional[str] = None
    kind: Literal["meeting", "task", "call", "personal", "other"] = "other"
    notes: str = ""
    source: Literal["briefing", "mikutano", "weris", "manual"] = "manual"


def _create_item(db: DBSession, user: User, body: ItemBody) -> ScheduleItem:
    start = _when(body.at)
    end = _when(body.end) if body.end else None
    it = ScheduleItem(user_id=user.id, date=to_local(start).date().isoformat(), start_at=start, end_at=end,  # type: ignore[arg-type]
                      title=body.title.strip(), kind=body.kind, source=body.source, notes=body.notes)
    db.add(it)
    db.commit()
    db.refresh(it)
    sync_item_reminder(db, it)
    return it


def _item_view(it: ScheduleItem) -> dict[str, Any]:
    return {"id": it.id, "title": it.title, "kind": it.kind, "source": it.source, "date": it.date,
            "start_at": iso(it.start_at), "end_at": iso(it.end_at), "time": to_local(it.start_at).strftime("%H:%M"),
            "done": it.done, "notes": it.notes}


@router.post("/day/items")
def add_item(body: ItemBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    it = _create_item(db, user, body)
    day_updated(user.id)  # type: ignore[arg-type]
    return _item_view(it)


class ItemPatch(BaseModel):
    title: Optional[str] = None
    at: Optional[str] = None
    done: Optional[bool] = None
    notes: Optional[str] = None


@router.patch("/day/items/{item_id}")
def patch_item(item_id: int, body: ItemPatch, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    it = db.get(ScheduleItem, item_id)
    if not it or it.user_id != user.id:
        raise bad(404, "not_found", "Item not found.", "Jambo halikupatikana.")
    if body.title is not None:
        it.title = body.title.strip() or it.title
    if body.at is not None:
        it.start_at = _when(body.at)
        it.date = to_local(it.start_at).date().isoformat()
    if body.done is not None:
        it.done = body.done
    if body.notes is not None:
        it.notes = body.notes
    db.add(it)
    db.commit()
    sync_item_reminder(db, it)
    day_updated(user.id)  # type: ignore[arg-type]
    return _item_view(it)


@router.delete("/day/items/{item_id}")
def delete_item(item_id: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    it = db.get(ScheduleItem, item_id)
    if not it or it.user_id != user.id:
        raise bad(404, "not_found", "Item not found.", "Jambo halikupatikana.")
    dismiss_reminders(db, "item", str(it.id))
    db.delete(it)
    db.commit()
    day_updated(user.id)  # type: ignore[arg-type]
    return {"ok": True}


# ---------------------------------------------------------------------------
# Morning briefing

BRIEFING_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "items": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string", "description": "Short title in the user's own language and words"},
                    "spoken_time": {"type": "string", "description": "The exact words the user used for this item's time, copied from the transcript (e.g. 'saa kumi jioni', 'saa nne na nusu asubuhi', '4 pm'), or an empty string"},
                    "start": {"type": "string", "description": "Start time HH:MM, 24-hour, local time"},
                    "end": {"type": ["string", "null"], "description": "End time HH:MM or null"},
                    "duration_min": {"type": ["integer", "null"]},
                    "kind": {"type": "string", "enum": ["meeting", "task", "call", "personal", "other"]},
                    "notes": {"type": "string"},
                },
                "required": ["title", "spoken_time", "start", "end", "duration_min", "kind", "notes"],
                "additionalProperties": False,
            },
        },
        "questions": {"type": "array", "items": {"type": "string"}},
    },
    "required": ["items", "questions"],
    "additionalProperties": False,
}

BRIEFING_PROMPT = """You turn a government official's spoken description of their day into a timetable.
Today is {weekday} {date}; the local time now is {now} (Africa/Dar_es_Salaam).
Rules:
- Use ONLY what the user said. Never invent items, people, places or times.
- Keep each title short and in the user's own language and wording (Swahili stays Swahili, English stays English).
- spoken_time: copy the user's exact words for the time ("saa kumi jioni", "4 pm"); the app converts them.
- start is HH:MM in 24-hour local time. Swahili time counts from 06:00: "saa nne asubuhi" = 10:00, "saa nane mchana" = 14:00,
  "saa tatu usiku" = 21:00, "saa mbili asubuhi" = 08:00, "saa saba mchana" = 13:00, "saa kumi jioni" = 16:00.
- If a time is vague ("after lunch", "baada ya chakula cha mchana", "jioni"), pick a sensible time
  (after lunch = 14:00, morning = 09:00, evening = 17:00) AND add one short question asking the user to confirm it.
- If an item has no time at all, place it after the previous item and add a question.
- kind: meeting (kikao, mkutano), call (simu, kupiga simu), task (work to do), personal, other.
- These items are ALREADY on the user's day; do NOT repeat them: {existing}
- questions are short, in {lang_name}.
Return items in time order."""


class BriefingParse(BaseModel):
    transcript: str = Field(min_length=1, max_length=6000)
    language: Literal["sw", "en"] = "sw"


@router.post("/briefing/parse")
async def briefing_parse(body: BriefingParse, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    if not llm.api_key():
        raise bad(400, "no_key", "OPENAI_API_KEY is not set.")
    today = local_today()
    existing = day_items(db, user, today.isoformat())
    existing_txt = "; ".join(f"{e['time']} {e['title']}" for e in existing) or "(none)"
    prompt = BRIEFING_PROMPT.format(
        weekday=llm.EN_DAYS[today.weekday()], date=today.isoformat(), now=datetime.now(tz()).strftime("%H:%M"),
        existing=existing_txt, lang_name="Swahili" if body.language == "sw" else "English",
    )
    try:
        resp = await llm.client().chat.completions.create(
            model=llm.model_name(),
            temperature=0.1,
            messages=[{"role": "system", "content": prompt}, {"role": "user", "content": body.transcript}],
            response_format={"type": "json_schema", "json_schema": {"name": "timetable", "strict": True, "schema": BRIEFING_SCHEMA}},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001
        log.error("briefing parse failed: %s", exc)
        raise bad(502, "llm_failed", f"Could not prepare the plan: {exc}", "Sikuweza kuandaa mpango. Jaribu tena.")
    items = []
    for it in data.get("items", []):
        # Times are converted in code from the user's own words (the model mis-reads Swahili clock time).
        fixed = llm.parse_spoken_time(it.pop("spoken_time", "") or "")
        if fixed:
            if it.get("end") and it.get("start"):
                try:
                    delta = _local_time_today(it["end"]) - _local_time_today(it["start"])
                    it["end"] = (datetime.combine(local_today(), time(*map(int, fixed.split(":")))) + delta).strftime("%H:%M")
                except (ValueError, KeyError):
                    it["end"] = None
            it["start"] = fixed
        try:
            _local_time_today(it["start"])
        except (ValueError, KeyError):
            continue
        items.append(it)
    items.sort(key=lambda x: x["start"])
    return {"items": items, "questions": data.get("questions", []), "existing": existing}


class BriefingItem(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    start: str
    end: Optional[str] = None
    duration_min: Optional[int] = None
    kind: Literal["meeting", "task", "call", "personal", "other"] = "other"
    notes: str = ""


class BriefingSave(BaseModel):
    items: list[BriefingItem]


@router.post("/briefing/save")
def briefing_save(body: BriefingSave, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    created = []
    for b in body.items:
        end = b.end
        if not end and b.duration_min:
            st = _local_time_today(b.start) + timedelta(minutes=b.duration_min)
            end = iso(st)
        it = _create_item(db, user, ItemBody(title=b.title, at=b.start, end=end, kind=b.kind, notes=b.notes, source="briefing"))
        created.append(_item_view(it))
    day_updated(user.id)  # type: ignore[arg-type]
    return {"created": created}


# ---------------------------------------------------------------------------
# Scheduled meetings

@router.get("/meetings")
def list_meetings(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    return [meeting_view(db, m, user.id) for m in user_meetings(db, user.id)]  # type: ignore[arg-type]


class MeetingBody(BaseModel):
    room_id: str = Field(min_length=1, max_length=120)
    title: str = Field(min_length=1, max_length=200)
    start_at: str
    duration_min: int = Field(default=45, ge=5, le=600)
    invitee_ids: list[int] = []


def _involved(m: ScheduledMeeting) -> list[int]:
    return [m.organizer_id, *[int(i) for i in m.invitee_ids]]


@router.post("/meetings")
def create_meeting(body: MeetingBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    start = _when(body.start_at)
    m = ScheduledMeeting(room_id=body.room_id, title=body.title.strip(), start_at=start,
                         end_at=start + timedelta(minutes=body.duration_min), organizer_id=user.id,  # type: ignore[arg-type]
                         invitee_ids=[i for i in body.invitee_ids if i != user.id])
    db.add(m)
    db.commit()
    db.refresh(m)
    sync_meeting_reminders(db, m)
    day_updated(*_involved(m))
    return meeting_view(db, m, user.id)  # type: ignore[arg-type]


class MeetingPatch(BaseModel):
    status: Optional[Literal["scheduled", "live", "ended"]] = None
    title: Optional[str] = None
    start_at: Optional[str] = None


@router.patch("/meetings/{meeting_id}")
def patch_meeting(meeting_id: int, body: MeetingPatch, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    m = db.get(ScheduledMeeting, meeting_id)
    if not m or user.id not in _involved(m):
        raise bad(404, "not_found", "Meeting not found.", "Kikao hakikupatikana.")
    if body.title:
        m.title = body.title.strip()
    if body.start_at:
        dur = m.end_at - m.start_at
        m.start_at = _when(body.start_at)
        m.end_at = m.start_at + dur
    if body.status:
        m.status = body.status
    db.add(m)
    db.commit()
    sync_meeting_reminders(db, m)
    if m.status == "live":
        dismiss_reminders(db, "meeting", str(m.id), user.id)
        for r in db.exec(select(Reminder).where(Reminder.kind == "meeting", Reminder.ref_id == str(m.id), Reminder.user_id == user.id)):
            push(user.id, "reminder_closed", {"reminder_id": r.id})  # type: ignore[arg-type]
    day_updated(*_involved(m))
    return meeting_view(db, m, user.id)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# Tasks (WERIS special tasks)

@router.get("/tasks")
def list_tasks(scope: Literal["mine", "assigned_by_me", "all"] = "mine", db: DBSession = Depends(get_db),
               user: User = Depends(current_user)) -> list[dict[str, Any]]:
    q = select(Task).order_by(Task.created_at.desc())  # type: ignore[union-attr]
    rows = list(db.exec(q))
    if scope == "mine":
        rows = [t for t in rows if t.assigned_to_id == user.id]
    elif scope == "assigned_by_me":
        rows = [t for t in rows if t.assigned_by_id == user.id and t.assigned_to_id != user.id]
    else:
        rows = [t for t in rows if user.id in (t.assigned_to_id, t.assigned_by_id)]
    return [task_view(db, t) for t in rows]


class TaskBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    description: str = ""
    assigned_to_id: int
    start_date: str = ""
    due_at: Optional[str] = None


def _due_phrase(t: Task) -> tuple[str, str]:
    if not t.due_at:
        return "", ""
    return llm.sw_when(t.due_at), llm.en_when(t.due_at)


@router.post("/tasks")
def create_task(body: TaskBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    to = db.get(User, body.assigned_to_id)
    if not to:
        raise bad(422, "bad_assignee", "Unknown assignee.", "Mhusika hajulikani.")
    now = now_utc()
    due = _when(body.due_at) if body.due_at else None
    t = Task(title=body.title.strip(), description=body.description.strip(), assigned_by_id=user.id,  # type: ignore[arg-type]
             assigned_to_id=to.id, start_date=body.start_date or local_today().isoformat(), due_at=due,  # type: ignore[arg-type]
             status="assigned", created_at=now, updated_at=now)
    db.add(t)
    db.commit()
    db.refresh(t)
    sync_task_reminder(db, t)
    view = task_view(db, t)
    if to.id != user.id and to.has_account:
        due_sw, due_en = _due_phrase(t)
        fn = first_name(to.display_name)
        sw = f"{fn}, umepewa kazi mpya na {user.display_name}: {t.title}" + (f", iwe tayari {due_sw}." if due_sw else ".")
        en = f"{fn}, you have a new task from {user.display_name}: {t.title}" + (f", due {due_en}." if due_en else ".")
        notify(db, to.id, "task_assigned", message_sw=sw, message_en=en, title_sw="Kazi mpya", title_en="New task",  # type: ignore[arg-type]
               link="/hub/tasks", data={"task": view})
        day_updated(to.id)  # type: ignore[arg-type]
    push(user.id, "task_updated", {"task": view})  # type: ignore[arg-type]
    return view


class TaskPatch(BaseModel):
    status: Optional[Literal["assigned", "in_progress", "done"]] = None
    title: Optional[str] = None
    description: Optional[str] = None
    due_at: Optional[str] = None


@router.patch("/tasks/{task_id}")
def patch_task(task_id: int, body: TaskPatch, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    t = db.get(Task, task_id)
    if not t or user.id not in (t.assigned_to_id, t.assigned_by_id):
        raise bad(404, "not_found", "Task not found.", "Kazi haikupatikana.")
    old_status = t.status
    if body.title:
        t.title = body.title.strip()
    if body.description is not None:
        t.description = body.description
    if body.due_at is not None:
        t.due_at = _when(body.due_at) if body.due_at else None
    if body.status:
        t.status = body.status
    t.updated_at = now_utc()
    db.add(t)
    db.commit()
    db.refresh(t)
    sync_task_reminder(db, t)
    view = task_view(db, t)
    other = t.assigned_by_id if user.id == t.assigned_to_id else t.assigned_to_id
    push(user.id, "task_updated", {"task": view})  # type: ignore[arg-type]
    other_user = db.get(User, other)
    if other != user.id and other_user and other_user.has_account:
        if user.id == t.assigned_to_id and t.status != old_status and t.status in ("in_progress", "done"):
            fn = first_name(other_user.display_name)
            me_name = first_name(user.display_name)
            if t.status == "done":
                sw = f"{fn}, {me_name} amekamilisha kazi: {t.title}."
                en = f"{fn}, {me_name} has completed the task: {t.title}."
            else:
                sw = f"{fn}, {me_name} ameanza kazi: {t.title}."
                en = f"{fn}, {me_name} has started the task: {t.title}."
            notify(db, other, "task_updated", message_sw=sw, message_en=en, title_sw="Hali ya kazi", title_en="Task update",
                   link="/hub/tasks", data={"task": view})
        else:
            push(other, "task_updated", {"task": view})
        day_updated(other)
    day_updated(user.id)  # type: ignore[arg-type]
    return view


# ---------------------------------------------------------------------------
# Reminders

def _reminder_view(db: DBSession, r: Reminder) -> dict[str, Any]:
    from .services import reminder_payload

    p = reminder_payload(db, r) if not r.dismissed else None
    return {
        "id": r.id, "kind": r.kind, "ref_id": r.ref_id, "fire_at": iso(r.fire_at), "fired_at": iso(r.fired_at),
        "dismissed": r.dismissed, "message_sw": r.message_sw or (p or {}).get("message_sw", ""),
        "message_en": r.message_en or (p or {}).get("message_en", ""), "data": (p or {}).get("data", {}),
    }


@router.get("/reminders")
def list_reminders(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    rows = list(db.exec(select(Reminder).where(Reminder.user_id == user.id, Reminder.dismissed == False)  # noqa: E712
                        .order_by(Reminder.fire_at)))
    recent = now_utc() - timedelta(minutes=30)
    open_now = [r for r in rows if r.fired_at and r.fired_at >= recent]
    upcoming = [r for r in rows if not r.fired_at]
    return {"open": [_reminder_view(db, r) for r in open_now], "upcoming": [_reminder_view(db, r) for r in upcoming]}


class SnoozeBody(BaseModel):
    minutes: int = Field(default=5, ge=1, le=120)


def _own_reminder(db: DBSession, rid: int, user: User) -> Reminder:
    r = db.get(Reminder, rid)
    if not r or r.user_id != user.id:
        raise bad(404, "not_found", "Reminder not found.", "Kikumbusho hakikupatikana.")
    return r


@router.post("/reminders/{rid}/snooze")
def snooze(rid: int, body: SnoozeBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    r = _own_reminder(db, rid, user)
    r.fire_at = now_utc() + timedelta(minutes=body.minutes)
    r.snoozed_until = r.fire_at
    r.fired_at = None
    r.dismissed = False
    db.add(r)
    db.commit()
    push(user.id, "reminder_closed", {"reminder_id": r.id, "reason": "snoozed"})  # type: ignore[arg-type]
    return {"ok": True, "fire_at": iso(r.fire_at)}


@router.post("/reminders/{rid}/dismiss")
def dismiss(rid: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    r = _own_reminder(db, rid, user)
    r.dismissed = True
    db.add(r)
    db.commit()
    push(user.id, "reminder_closed", {"reminder_id": r.id, "reason": "dismissed"})  # type: ignore[arg-type]
    return {"ok": True}


# ---------------------------------------------------------------------------
# Notifications

@router.get("/notifications")
def notifications(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    rows = db.exec(select(Notification).where(Notification.user_id == user.id)
                   .order_by(Notification.created_at.desc(), Notification.id.desc()).limit(200))  # type: ignore[union-attr]
    return [{
        "id": n.id, "kind": n.kind, "title_sw": n.title_sw, "title_en": n.title_en, "body_sw": n.body_sw,
        "body_en": n.body_en, "link": n.link, "created_at": iso(n.created_at), "read": n.read_at is not None,
    } for n in rows]


@router.post("/notifications/{nid}/read")
def read_notification(nid: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    n = db.get(Notification, nid)
    if n and n.user_id == user.id and not n.read_at:
        n.read_at = now_utc()
        db.add(n)
        db.commit()
    return {"ok": True}


@router.post("/notifications/read-all")
def read_all(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    for n in db.exec(select(Notification).where(Notification.user_id == user.id, Notification.read_at == None)):  # noqa: E711
        n.read_at = now_utc()
        db.add(n)
    db.commit()
    return {"ok": True}


# ---------------------------------------------------------------------------
# Audit (server copy of every NURU task)

@router.post("/audit")
def post_audit(record: dict[str, Any], db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    rid = str(record.get("id") or f"srv-{now_utc().timestamp()}")[:120]
    row = db.get(AuditRecord, rid) or AuditRecord(id=rid)
    row.user_id = user.id
    row.system = str(record.get("system") or "mikutano")[:20]
    row.timestamp = str(record.get("timestamp") or iso(now_utc()))
    row.outcome = str(record.get("outcome") or "")
    row.request = str(record.get("request") or "")[:500]
    row.record = {**record, "user": record.get("user") or user.display_name}
    db.add(row)
    db.commit()
    return {"ok": True}


@router.get("/audit")
def get_audit(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    rows = db.exec(select(AuditRecord).where(AuditRecord.user_id == user.id).order_by(AuditRecord.timestamp.desc()).limit(500))  # type: ignore[union-attr]
    return [{**r.record, "id": r.id, "system": r.system} for r in rows]


# ---------------------------------------------------------------------------
# Server-Sent Events

@router.get("/events")
async def events(request: Request, user: User = Depends(user_from_query)) -> StreamingResponse:
    uid: int = user.id  # type: ignore[assignment]
    q = broker.subscribe(uid)

    async def stream():
        try:
            # 2 KB comment first: proxies and tunnels (Cloudflare) flush the stream once it has some bytes.
            yield ":" + " " * 2048 + "\n\n"
            yield "retry: 3000\n\n"
            yield f"event: hello\ndata: {json.dumps({'type': 'hello', 'user_id': uid, 'now': iso(now_utc())})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    msg = await asyncio.wait_for(q.get(), timeout=15)
                    yield msg
                except asyncio.TimeoutError:
                    yield ": ping\n\n"
        finally:
            broker.unsubscribe(uid, q)

    return StreamingResponse(
        stream(),
        # Exactly "text/event-stream" (no charset): cloudflared only streams that type without buffering.
        headers={"Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@router.get("/events/poll")
async def events_poll(after: int = -1, user: User = Depends(user_from_query)) -> dict[str, Any]:
    """Long-poll fallback for /events (some tunnels buffer event streams). after=-1 returns the current position."""
    uid: int = user.id  # type: ignore[assignment]
    if after < 0 or after > broker.latest():  # first call, or the server restarted
        return {"seq": broker.latest(), "events": [], "reset": after >= 0}
    events = await broker.wait(uid, after, timeout=20)
    return {"seq": max([after, *[e["seq"] for e in events]]), "events": events}


# ---------------------------------------------------------------------------
# Demo controls

@router.post("/demo/reset")
def demo_reset(user: User = Depends(current_user)) -> dict[str, Any]:
    from .seed import reset_all

    reset_all()
    with DBSession(engine) as db:
        for u in account_users(db):
            push(u.id, "demo_reset")  # type: ignore[arg-type]
    return {"ok": True}


class SoonBody(BaseModel):
    minutes: int = Field(default=2, ge=1, le=60)


@router.post("/demo/meeting-soon")
def demo_meeting_soon(body: SoonBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    others = [u.id for u in account_users(db) if u.id != user.id] + [4, 5]
    start = now_utc().replace(second=0) + timedelta(minutes=body.minutes)
    m = ScheduledMeeting(room_id="kamati-ya-bajeti-k7b2", title="Kikao cha Kamati ya Bajeti", start_at=start,
                         end_at=start + timedelta(minutes=45), organizer_id=user.id, invitee_ids=others)  # type: ignore[arg-type]
    db.add(m)
    db.commit()
    db.refresh(m)
    sync_meeting_reminders(db, m)
    # Fire the organizer's reminder right away (the presenter should not wait for the next tick).
    r = db.exec(select(Reminder).where(Reminder.kind == "meeting", Reminder.ref_id == str(m.id), Reminder.user_id == user.id)).first()
    if r and not r.fired_at and r.fire_at <= now_utc():
        fire_reminder(db, r)
    day_updated(*_involved(m))
    return meeting_view(db, m, user.id)  # type: ignore[arg-type]


@router.post("/demo/fire-next-reminder")
def demo_fire_next(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    rows = db.exec(select(Reminder).where(Reminder.user_id == user.id, Reminder.fired_at == None,  # noqa: E711
                                          Reminder.dismissed == False).order_by(Reminder.fire_at))  # noqa: E712
    for r in rows:
        if fire_reminder(db, r):
            return {"ok": True, "reminder_id": r.id, "message_sw": r.message_sw, "message_en": r.message_en}
    return {"ok": False, "error": "No upcoming reminder."}


@router.post("/demo/briefing-prompt")
def demo_briefing(user: User = Depends(current_user)) -> dict[str, Any]:
    push(user.id, "briefing_prompt")  # type: ignore[arg-type]
    return {"ok": True}
