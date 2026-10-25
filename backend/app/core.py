"""Shared backend plumbing: database, time, authentication and the SSE event broker."""

from __future__ import annotations

import asyncio
import json
import logging
import os
import secrets
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator, Optional
from zoneinfo import ZoneInfo

import bcrypt
from dotenv import load_dotenv
from fastapi import Depends, Header, HTTPException, Query
from sqlmodel import Session as DBSession
from sqlmodel import SQLModel, create_engine, select

from .models import Session, User

BACKEND_DIR = Path(__file__).resolve().parent.parent
PROJECT_ROOT = BACKEND_DIR.parent
load_dotenv(PROJECT_ROOT / ".env")

log = logging.getLogger("nuru")

DATA_DIR = BACKEND_DIR / "data"
DATA_DIR.mkdir(exist_ok=True)
DB_PATH = Path(os.getenv("NURU_DB", str(DATA_DIR / "nuru.db")))
engine = create_engine(f"sqlite:///{DB_PATH}", connect_args={"check_same_thread": False})

SESSION_DAYS = 7


def init_db() -> None:
    SQLModel.metadata.create_all(engine)
    _add_missing_columns()


def _add_missing_columns() -> None:
    """create_all never alters existing tables: add columns introduced after a database was created."""
    with engine.begin() as conn:
        for table in SQLModel.metadata.sorted_tables:
            have = {r[1] for r in conn.exec_driver_sql(f'PRAGMA table_info("{table.name}")')}
            for col in table.columns:
                if col.name in have:
                    continue
                ddl = col.type.compile(dialect=engine.dialect)
                default = "'{}'" if ddl == "JSON" else ("''" if "CHAR" in ddl else ("0" if ddl in ("INTEGER", "BOOLEAN", "FLOAT") else "NULL"))
                conn.exec_driver_sql(f'ALTER TABLE "{table.name}" ADD COLUMN "{col.name}" {ddl} DEFAULT {default}')


def get_db() -> Iterator[DBSession]:
    with DBSession(engine) as db:
        yield db


# ---------------------------------------------------------------------------
# Time

def tz() -> ZoneInfo:
    return ZoneInfo(os.getenv("NURU_TZ", "Africa/Dar_es_Salaam").split("#")[0].strip() or "Africa/Dar_es_Salaam")


def now_utc() -> datetime:
    """Naive UTC now (the storage format)."""
    return datetime.now(timezone.utc).replace(tzinfo=None, microsecond=0)


def to_local(dt: datetime) -> datetime:
    return dt.replace(tzinfo=timezone.utc).astimezone(tz())


def from_local(dt: datetime) -> datetime:
    """Local (naive or aware) → naive UTC."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=tz())
    return dt.astimezone(timezone.utc).replace(tzinfo=None)


def local_today() -> date:
    return datetime.now(tz()).date()


def local_date_str(dt: datetime) -> str:
    return to_local(dt).date().isoformat()


def iso(dt: Optional[datetime]) -> Optional[str]:
    if dt is None:
        return None
    return dt.replace(microsecond=0).isoformat() + "Z"


def parse_dt(value: Any) -> Optional[datetime]:
    """Accept ISO strings (with Z/offset → UTC; naive → local) and return naive UTC."""
    if value in (None, ""):
        return None
    if isinstance(value, datetime):
        return from_local(value) if value.tzinfo else value
    s = str(value).strip().replace("Z", "+00:00")
    dt = datetime.fromisoformat(s)
    return from_local(dt)


def local_hm(dt: Optional[datetime]) -> str:
    return to_local(dt).strftime("%H:%M") if dt else ""


# ---------------------------------------------------------------------------
# Users and authentication

def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode(), bcrypt.gensalt(rounds=10)).decode()


def check_password(pw: str, hashed: str) -> bool:
    if not hashed:
        return False
    try:
        return bcrypt.checkpw(pw.encode(), hashed.encode())
    except ValueError:
        return False


def first_name(display_name: str) -> str:
    """'Dkt. Halima Said' → 'Dkt. Halima', 'Baraka Mollel' → 'Baraka'."""
    parts = display_name.split()
    if not parts:
        return display_name
    if parts[0].rstrip(".").lower() in {"dkt", "dr", "prof", "bw", "bi", "mhe", "eng"} and len(parts) > 1:
        return f"{parts[0]} {parts[1]}"
    return parts[0]


def signature(u: User) -> str:
    return (
        f"{u.display_name}\n{u.title}\n"
        "Mamlaka ya Serikali Mtandao (mfano) | e-Government Authority (demo)\n"
        f"Barua pepe: {u.email}"
    )


def user_public(u: User) -> dict[str, Any]:
    return {
        "id": u.id,
        "username": u.username if u.has_account else None,
        "display_name": u.display_name,
        "first_name": first_name(u.display_name),
        "title": u.title,
        "role": u.role,
        "email": u.email,
        "has_account": u.has_account,
    }


def user_full(u: User) -> dict[str, Any]:
    return {
        **user_public(u),
        "language": u.language,
        "voice_enabled": u.voice_enabled,
        "reminder_lead_min": u.reminder_lead_min,
        "meeting_audio_source": u.meeting_audio_source,
        "wake_word": u.wake_word,
        "supervisor_id": u.supervisor_id,
        "signature": signature(u),
    }


def new_session(db: DBSession, user: User, device_label: str) -> Session:
    s = Session(
        token=secrets.token_urlsafe(32),
        user_id=user.id,  # type: ignore[arg-type]
        created_at=now_utc(),
        expires_at=now_utc() + timedelta(days=SESSION_DAYS),
        device_label=device_label[:120],
    )
    db.add(s)
    db.commit()
    return s


def user_for_token(db: DBSession, token: str) -> Optional[User]:
    if not token:
        return None
    s = db.get(Session, token)
    if not s or s.expires_at < now_utc():
        return None
    u = db.get(User, s.user_id)
    return u if u and u.has_account else None


def bearer(authorization: str = Header(default="")) -> str:
    if authorization.lower().startswith("bearer "):
        return authorization[7:].strip()
    return ""


def current_user(token: str = Depends(bearer), db: DBSession = Depends(get_db)) -> User:
    u = user_for_token(db, token)
    if not u:
        raise HTTPException(status_code=401, detail={"code": "unauthenticated", "error": "Please sign in to NURU."})
    return u


def user_from_query(token: str = Query(default=""), db: DBSession = Depends(get_db)) -> User:
    u = user_for_token(db, token)
    if not u:
        raise HTTPException(status_code=401, detail={"code": "unauthenticated", "error": "Please sign in to NURU."})
    return u


def account_users(db: DBSession) -> list[User]:
    return list(db.exec(select(User).where(User.has_account == True)))  # noqa: E712


def user_by_email(db: DBSession, email: str) -> Optional[User]:
    return db.exec(select(User).where(User.email == email.strip().lower())).first()


# ---------------------------------------------------------------------------
# Server-Sent Events broker (in memory, one queue per connected device)

class Broker:
    """Pushes events to SSE streams and keeps a short per-user history for long-polling clients
    (the fallback when a proxy or tunnel buffers event streams)."""

    def __init__(self) -> None:
        self._queues: dict[int, set[asyncio.Queue[str]]] = {}
        self._seq = 0
        self._history: dict[int, deque[tuple[int, dict[str, Any]]]] = {}
        self._waiters: dict[int, asyncio.Event] = {}

    def subscribe(self, user_id: int) -> asyncio.Queue[str]:
        q: asyncio.Queue[str] = asyncio.Queue(maxsize=500)
        self._queues.setdefault(user_id, set()).add(q)
        return q

    def unsubscribe(self, user_id: int, q: asyncio.Queue[str]) -> None:
        qs = self._queues.get(user_id)
        if qs:
            qs.discard(q)
            if not qs:
                self._queues.pop(user_id, None)

    def devices(self, user_id: int) -> int:
        return len(self._queues.get(user_id, ()))

    def latest(self) -> int:
        return self._seq

    def since(self, user_id: int, after: int) -> list[dict[str, Any]]:
        return [{"seq": n, **ev} for n, ev in self._history.get(user_id, ()) if n > after]

    async def wait(self, user_id: int, after: int, timeout: float) -> list[dict[str, Any]]:
        evs = self.since(user_id, after)
        if evs:
            return evs
        ev = self._waiters.setdefault(user_id, asyncio.Event())
        try:
            await asyncio.wait_for(ev.wait(), timeout=timeout)
        except asyncio.TimeoutError:
            pass
        return self.since(user_id, after)

    def publish(self, user_id: int, event_type: str, data: dict[str, Any]) -> None:
        self._seq += 1
        hist = self._history.setdefault(user_id, deque(maxlen=200))
        hist.append((self._seq, json.loads(json.dumps({"type": event_type, **data}, ensure_ascii=False, default=str))))
        waiter = self._waiters.pop(user_id, None)
        if waiter:
            waiter.set()
        payload = json.dumps({"type": event_type, **data}, ensure_ascii=False, default=str)
        msg = f"event: {event_type}\ndata: {payload}\n\n"
        for q in list(self._queues.get(user_id, ())):
            try:
                q.put_nowait(msg)
            except asyncio.QueueFull:
                log.warning("SSE queue full for user %s; dropping event %s", user_id, event_type)


broker = Broker()


def test_mode(header_value: Optional[str] = None) -> bool:
    """Automated tests: Katibu e-mails go only to KATIBU_TEST_RECIPIENT."""
    return os.getenv("NURU_TEST_MODE", "").strip() in {"1", "true", "yes"} or (header_value or "").strip() == "1"
