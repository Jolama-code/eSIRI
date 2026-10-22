"""Domain logic shared by the routes and the scheduler: notifications, reminders, the day view."""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any, Optional

from sqlmodel import Session as DBSession
from sqlmodel import select

from .core import broker, engine, first_name, iso, local_date_str, local_hm, now_utc, to_local
from .models import Notification, Reminder, ScheduledMeeting, ScheduleItem, Task, User

log = logging.getLogger("nuru.services")


# ---------------------------------------------------------------------------
# Notifications + events

def notify(
    db: DBSession,
    user_id: int,
    event_type: str,
    *,
    message_sw: str,
    message_en: str,
    title_sw: str = "",
    title_en: str = "",
    link: str = "",
    data: Optional[dict[str, Any]] = None,
    announce: bool = True,
    store: bool = True,
) -> None:
    """Store a Notification (the Hub's history of what NURU announced) and push the event."""
    note_id = None
    if store:
        n = Notification(
            user_id=user_id,
            kind=event_type,
            title_sw=title_sw or message_sw,
            title_en=title_en or message_en,
            body_sw=message_sw,
            body_en=message_en,
            link=link,
            created_at=now_utc(),
        )
        db.add(n)
        db.commit()
        db.refresh(n)
        note_id = n.id
    broker.publish(
        user_id,
        event_type,
        {
            "message_sw": message_sw,
            "message_en": message_en,
            "title_sw": title_sw or message_sw,
            "title_en": title_en or message_en,
            "link": link,
            "announce": announce,
            "notification_id": note_id,
            "data": data or {},
        },
    )


def push(user_id: int, event_type: str, data: Optional[dict[str, Any]] = None) -> None:
    """A silent refresh event (no announcement, not stored)."""
    broker.publish(user_id, event_type, {"announce": False, "message_sw": "", "message_en": "", "data": data or {}})


def day_updated(*user_ids: int) -> None:
    for uid in set(user_ids):
        push(uid, "day_updated")


# ---------------------------------------------------------------------------
# Reminders

def _upsert_reminder(db: DBSession, user_id: int, kind: str, ref_id: str, fire_at: datetime, source_start: datetime) -> None:
    r = db.exec(
        select(Reminder).where(Reminder.user_id == user_id, Reminder.kind == kind, Reminder.ref_id == ref_id)
    ).first()
    now = now_utc()
    stale = source_start <= now  # the thing already started: never remind about the past
    if r is None:
        r = Reminder(user_id=user_id, kind=kind, ref_id=ref_id, fire_at=fire_at)
        if stale:
            r.fired_at = now
        db.add(r)
    elif r.fire_at != fire_at:
        r.fire_at = fire_at
        r.snoozed_until = None
        if not stale and not r.dismissed:
            r.fired_at = None  # re-arm: the source moved
    db.commit()


def dismiss_reminders(db: DBSession, kind: str, ref_id: str, user_id: Optional[int] = None) -> None:
    q = select(Reminder).where(Reminder.kind == kind, Reminder.ref_id == ref_id)
    if user_id is not None:
        q = q.where(Reminder.user_id == user_id)
    for r in db.exec(q):
        r.dismissed = True
        db.add(r)
    db.commit()


def lead_for(db: DBSession, user_id: int) -> int:
    u = db.get(User, user_id)
    return u.reminder_lead_min if u else 5


def sync_meeting_reminders(db: DBSession, m: ScheduledMeeting) -> None:
    if m.status == "ended":
        dismiss_reminders(db, "meeting", str(m.id))
        return
    for uid in {m.organizer_id, *[int(i) for i in m.invitee_ids]}:
        u = db.get(User, uid)
        if not u or not u.has_account:
            continue
        _upsert_reminder(db, uid, "meeting", str(m.id), m.start_at - timedelta(minutes=u.reminder_lead_min), m.start_at)


def sync_task_reminder(db: DBSession, t: Task) -> None:
    if t.status == "done" or t.due_at is None:
        dismiss_reminders(db, "task", str(t.id))
        return
    _upsert_reminder(db, t.assigned_to_id, "task", str(t.id), t.due_at - timedelta(minutes=30), t.due_at)


def sync_item_reminder(db: DBSession, it: ScheduleItem) -> None:
    if it.done:
        dismiss_reminders(db, "item", str(it.id))
        return
    _upsert_reminder(db, it.user_id, "item", str(it.id), it.start_at - timedelta(minutes=lead_for(db, it.user_id)), it.start_at)


def resync_user_reminders(db: DBSession, user_id: int) -> None:
    """After the lead time changes."""
    for m in db.exec(select(ScheduledMeeting).where(ScheduledMeeting.status != "ended")):
        if m.organizer_id == user_id or user_id in [int(i) for i in m.invitee_ids]:
            sync_meeting_reminders(db, m)
    for it in db.exec(select(ScheduleItem).where(ScheduleItem.user_id == user_id, ScheduleItem.done == False)):  # noqa: E712
        sync_item_reminder(db, it)


def _minutes_until(start: datetime) -> int:
    return max(1, round((start - now_utc()).total_seconds() / 60))


def reminder_payload(db: DBSession, r: Reminder) -> Optional[dict[str, Any]]:
    """Build the bilingual message and the data the client needs, from the reminder's source."""
    u = db.get(User, r.user_id)
    if not u:
        return None
    name = first_name(u.display_name)
    data: dict[str, Any] = {"reminder_id": r.id, "kind": r.kind, "ref_id": r.ref_id}
    if r.kind == "meeting":
        m = db.get(ScheduledMeeting, int(r.ref_id))
        if not m or m.status == "ended":
            return None
        n = _minutes_until(m.start_at)
        organizer = m.organizer_id == u.id
        if organizer:
            sw = f"{name}, una {m.title} baada ya dakika {n}. Niuanzishe kwa niaba yako?"
            en = f"{name}, you have {m.title} in {n} minutes. Shall I start it for you?"
        else:
            sw = f"{name}, una {m.title} baada ya dakika {n}. Ungependa nikuunganishe?"
            en = f"{name}, you have {m.title} in {n} minutes. Would you like me to connect you?"
        data.update(
            title=m.title, room_id=m.room_id, meeting_id=m.id, organizer=organizer, start_at=iso(m.start_at),
            minutes=n, live=m.status == "live",
        )
    elif r.kind == "task":
        t = db.get(Task, int(r.ref_id))
        if not t or t.status == "done" or not t.due_at:
            return None
        n = _minutes_until(t.due_at)
        sw = f"{name}, kazi \"{t.title}\" inatakiwa iwe tayari baada ya dakika {n}."
        en = f"{name}, the task \"{t.title}\" is due in {n} minutes."
        data.update(title=t.title, task_id=t.id, due_at=iso(t.due_at), minutes=n)
    else:
        it = db.get(ScheduleItem, int(r.ref_id))
        if not it or it.done:
            return None
        n = _minutes_until(it.start_at)
        sw = f"{name}, baada ya dakika {n}: {it.title}."
        en = f"{name}, in {n} minutes: {it.title}."
        data.update(title=it.title, item_id=it.id, start_at=iso(it.start_at), minutes=n, item_kind=it.kind)
    return {"message_sw": sw, "message_en": en, "data": data}


def fire_reminder(db: DBSession, r: Reminder) -> bool:
    payload = reminder_payload(db, r)
    r.fired_at = now_utc()
    r.snoozed_until = None
    if payload is None:
        r.dismissed = True
        db.add(r)
        db.commit()
        return False
    r.message_sw = payload["message_sw"]
    r.message_en = payload["message_en"]
    db.add(r)
    db.commit()
    link = "/hub/tasks" if r.kind == "task" else "/hub"
    notify(
        db,
        r.user_id,
        "reminder",
        message_sw=r.message_sw,
        message_en=r.message_en,
        title_sw="Kikumbusho",
        title_en="Reminder",
        link=link,
        data=payload["data"],
    )
    return True


def due_reminders(db: DBSession) -> list[Reminder]:
    now = now_utc()
    rows = db.exec(
        select(Reminder).where(Reminder.fired_at == None, Reminder.dismissed == False, Reminder.fire_at <= now)  # noqa: E711,E712
    )
    return list(rows)


async def scheduler_loop(stop: asyncio.Event) -> None:
    """Every 10 seconds: fire due reminders (each exactly once)."""
    while not stop.is_set():
        try:
            with DBSession(engine) as db:
                for r in due_reminders(db):
                    fire_reminder(db, r)
        except Exception as exc:  # noqa: BLE001
            log.error("scheduler tick failed: %s", exc)
        try:
            await asyncio.wait_for(stop.wait(), timeout=10)
        except asyncio.TimeoutError:
            pass


# ---------------------------------------------------------------------------
# The day view

def meeting_view(db: DBSession, m: ScheduledMeeting, viewer_id: int) -> dict[str, Any]:
    org = db.get(User, m.organizer_id)
    invitees = [db.get(User, int(i)) for i in m.invitee_ids]
    return {
        "id": m.id,
        "room_id": m.room_id,
        "title": m.title,
        "start_at": iso(m.start_at),
        "end_at": iso(m.end_at),
        "status": m.status,
        "organizer": {"id": org.id, "display_name": org.display_name} if org else None,
        "is_organizer": m.organizer_id == viewer_id,
        "invitees": [{"id": u.id, "display_name": u.display_name, "email": u.email, "has_account": u.has_account} for u in invitees if u],
    }


def task_view(db: DBSession, t: Task) -> dict[str, Any]:
    by = db.get(User, t.assigned_by_id)
    to = db.get(User, t.assigned_to_id)
    return {
        "id": t.id,
        "title": t.title,
        "description": t.description,
        "assigned_by": {"id": by.id, "display_name": by.display_name} if by else None,
        "assigned_to": {"id": to.id, "display_name": to.display_name} if to else None,
        "start_date": t.start_date,
        "due_at": iso(t.due_at),
        "due_local": to_local(t.due_at).strftime("%Y-%m-%d %H:%M") if t.due_at else "",
        "status": t.status,
        "created_at": iso(t.created_at),
        "updated_at": iso(t.updated_at),
    }


def user_meetings(db: DBSession, user_id: int) -> list[ScheduledMeeting]:
    out = []
    for m in db.exec(select(ScheduledMeeting).order_by(ScheduledMeeting.start_at)):
        if m.organizer_id == user_id or user_id in [int(i) for i in m.invitee_ids]:
            out.append(m)
    return out


def day_items(db: DBSession, user: User, day: str) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for it in db.exec(select(ScheduleItem).where(ScheduleItem.user_id == user.id, ScheduleItem.date == day)):
        items.append({
            "key": f"item-{it.id}",
            "id": it.id,
            "type": "item",
            "kind": it.kind,
            "source": it.source,
            "title": it.title,
            "start_at": iso(it.start_at),
            "end_at": iso(it.end_at),
            "time": local_hm(it.start_at),
            "notes": it.notes,
            "done": it.done,
        })
    for m in user_meetings(db, user.id):  # type: ignore[arg-type]
        if local_date_str(m.start_at) != day:
            continue
        items.append({
            "key": f"meeting-{m.id}",
            "id": m.id,
            "type": "meeting",
            "kind": "meeting",
            "source": "mikutano",
            "title": m.title,
            "start_at": iso(m.start_at),
            "end_at": iso(m.end_at),
            "time": local_hm(m.start_at),
            "room_id": m.room_id,
            "status": m.status,
            "is_organizer": m.organizer_id == user.id,
            "done": m.status == "ended",
        })
    for t in db.exec(select(Task).where(Task.assigned_to_id == user.id)):
        if not t.due_at or local_date_str(t.due_at) != day:
            continue
        items.append({
            "key": f"task-{t.id}",
            "id": t.id,
            "type": "task",
            "kind": "task",
            "source": "weris",
            "title": t.title,
            "start_at": iso(t.due_at),
            "end_at": None,
            "time": local_hm(t.due_at),
            "status": t.status,
            "done": t.status == "done",
        })
    items.sort(key=lambda x: (x["start_at"] or "", x["title"]))
    return items
