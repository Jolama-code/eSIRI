"""GMS mock API: folders, drafts, sending and delivery between demo users."""

from __future__ import annotations

import re
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session as DBSession
from sqlmodel import select

from .core import current_user, get_db, iso, now_utc, user_by_email
from .models import MailMessage, User
from .services import notify

router = APIRouter(prefix="/api/mail")

DOMAIN = "mfano.go.tz"
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _err(status: int, code: str, en: str, sw: str) -> HTTPException:
    return HTTPException(status_code=status, detail={"code": code, "error": en, "error_en": en, "error_sw": sw})


def _names(db: DBSession, addrs: list[str]) -> list[dict[str, str]]:
    out = []
    for a in addrs:
        u = user_by_email(db, a)
        out.append({"email": a, "name": u.display_name if u else a})
    return out


def view(db: DBSession, m: MailMessage, full: bool = True) -> dict[str, Any]:
    d: dict[str, Any] = {
        "id": m.id,
        "folder": m.folder,
        "from_addr": m.from_addr,
        "from_name": m.from_name,
        "to": _names(db, m.to),
        "cc": _names(db, m.cc),
        "subject": m.subject,
        "sent_at": iso(m.sent_at),
        "read": m.read,
        "in_reply_to": m.in_reply_to,
        "snippet": " ".join(m.body.split())[:140],
    }
    if full:
        d["body"] = m.body
    return d


def _own(db: DBSession, mid: int, user: User) -> MailMessage:
    m = db.get(MailMessage, mid)
    if not m or m.owner_id != user.id:
        raise _err(404, "not_found", "Message not found.", "Barua haikupatikana.")
    return m


@router.get("")
def list_mail(folder: Literal["inbox", "drafts", "sent", "trash", "junk"] = "inbox", db: DBSession = Depends(get_db),
              user: User = Depends(current_user)) -> dict[str, Any]:
    rows = list(db.exec(select(MailMessage).where(MailMessage.owner_id == user.id, MailMessage.folder == folder)))
    rows.sort(key=lambda m: (m.sent_at or now_utc()), reverse=True)
    all_inbox = db.exec(select(MailMessage).where(MailMessage.owner_id == user.id, MailMessage.folder == "inbox"))
    unread = sum(1 for m in all_inbox if not m.read)
    drafts = len(list(db.exec(select(MailMessage.id).where(MailMessage.owner_id == user.id, MailMessage.folder == "drafts"))))
    return {"folder": folder, "unread": unread, "drafts": drafts, "messages": [view(db, m, full=False) for m in rows]}


@router.get("/{mid}")
def get_mail(mid: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    return view(db, _own(db, mid, user))


@router.post("/{mid}/read")
def mark_read(mid: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    m = _own(db, mid, user)
    if not m.read:
        m.read = True
        db.add(m)
        db.commit()
    return {"ok": True}


@router.delete("/{mid}")
def delete_mail(mid: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    m = _own(db, mid, user)
    if m.folder == "trash":
        db.delete(m)
    else:
        m.folder = "trash"
        db.add(m)
    db.commit()
    return {"ok": True}


class DraftBody(BaseModel):
    to: list[str] = []
    cc: list[str] = []
    subject: str = Field(default="", max_length=300)
    body: str = Field(default="", max_length=20000)
    in_reply_to: Optional[int] = None


def _clean(addrs: list[str]) -> list[str]:
    out = []
    for a in addrs:
        for part in re.split(r"[,;\s]+", a or ""):
            p = part.strip().strip("<>").lower()
            if p and p not in out:
                out.append(p)
    return out


@router.post("/drafts")
def create_draft(body: DraftBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    m = MailMessage(owner_id=user.id, folder="drafts", from_addr=user.email, from_name=user.display_name,  # type: ignore[arg-type]
                    to=_clean(body.to), cc=_clean(body.cc), subject=body.subject, body=body.body, sent_at=now_utc(),
                    read=True, in_reply_to=body.in_reply_to, thread_id=body.subject)
    db.add(m)
    db.commit()
    db.refresh(m)
    return view(db, m)


@router.patch("/drafts/{mid}")
def update_draft(mid: int, body: DraftBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    m = _own(db, mid, user)
    if m.folder != "drafts":
        raise _err(409, "not_draft", "This message is no longer a draft.", "Barua hii si rasimu tena.")
    m.to, m.cc, m.subject, m.body = _clean(body.to), _clean(body.cc), body.subject, body.body
    m.in_reply_to = body.in_reply_to
    m.sent_at = now_utc()
    db.add(m)
    db.commit()
    return view(db, m)


class SendBody(BaseModel):
    draft_id: Optional[int] = None
    to: list[str] = []
    cc: list[str] = []
    subject: str = ""
    body: str = ""
    in_reply_to: Optional[int] = None


def validate_recipients(to: list[str], cc: list[str]) -> None:
    if not to:
        raise _err(422, "no_recipient", "Add at least one recipient.", "Weka angalau mpokeaji mmoja.")
    for a in [*to, *cc]:
        if not EMAIL_RE.match(a):
            raise _err(422, "bad_address", f"'{a}' is not a valid e-mail address.", f"'{a}' si anwani sahihi ya barua pepe.")
        if not a.endswith("@" + DOMAIN):
            raise _err(422, "external_recipient",
                       "Sending outside the system is disabled in this demo.",
                       "Kutuma nje ya mfumo kumezimwa katika onyesho hili.")


def deliver(db: DBSession, sender: User | None, from_addr: str, from_name: str, to: list[str], cc: list[str], subject: str,
            body: str, owner_copy_id: Optional[int] = None) -> list[int]:
    """Drop a copy in each demo user's inbox and announce it. Returns the recipient user ids."""
    delivered = []
    for addr in dict.fromkeys([*to, *cc]):
        u = user_by_email(db, addr)
        if not u or not u.has_account:
            continue
        copy = MailMessage(owner_id=u.id, folder="inbox", from_addr=from_addr, from_name=from_name, to=to, cc=cc,  # type: ignore[arg-type]
                           subject=subject, body=body, sent_at=now_utc(), read=False, thread_id=subject)
        db.add(copy)
        db.commit()
        db.refresh(copy)
        notify(
            db, u.id, "mail_received",  # type: ignore[arg-type]
            message_sw=f"Umepokea barua pepe mpya kutoka kwa {from_name}: {subject}.",
            message_en=f"You have a new e-mail from {from_name}: {subject}.",
            title_sw="Barua pepe mpya", title_en="New e-mail", link=f"/gms/inbox/{copy.id}",
            data={"mail_id": copy.id, "from_name": from_name, "subject": subject},
        )
        delivered.append(u.id)
    return delivered  # type: ignore[return-value]


@router.post("/send")
def send(body: SendBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    if body.draft_id is not None:
        m = _own(db, body.draft_id, user)
        if m.folder != "drafts":
            raise _err(409, "not_draft", "This message was already sent.", "Barua hii imeshatumwa.")
        if body.to or body.subject or body.body:
            m.to, m.cc, m.subject, m.body = _clean(body.to), _clean(body.cc), body.subject, body.body
            m.in_reply_to = body.in_reply_to if body.in_reply_to is not None else m.in_reply_to
    else:
        m = MailMessage(owner_id=user.id, folder="drafts", from_addr=user.email, from_name=user.display_name,  # type: ignore[arg-type]
                        to=_clean(body.to), cc=_clean(body.cc), subject=body.subject, body=body.body, read=True,
                        in_reply_to=body.in_reply_to)
    validate_recipients(m.to, m.cc)
    if not m.subject.strip():
        raise _err(422, "no_subject", "Add a subject.", "Weka kichwa cha barua.")
    m.folder = "sent"
    m.sent_at = now_utc()
    m.read = True
    m.thread_id = m.subject
    db.add(m)
    db.commit()
    db.refresh(m)
    delivered = deliver(db, user, user.email, user.display_name, m.to, m.cc, m.subject, m.body, m.id)
    return {"ok": True, "message": view(db, m), "delivered_to": delivered}
