"""WERIS mock API: dashboard, projects, PDP and weekly reports (special tasks use /api/tasks)."""

from __future__ import annotations

import json
import logging
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session as DBSession
from sqlmodel import select

from . import llm
from .core import current_user, first_name, from_local, get_db, iso, local_today, now_utc, to_local, tz
from .models import AuditRecord, PdpEntry, Project, Task, User, WeeklyReport
from .services import notify

log = logging.getLogger("nuru.weris")
router = APIRouter(prefix="/api/weris")

STATUSES = ["On Development", "On Proof Of Concept", "On Hold", "On Pilot", "On Production"]
CATEGORIES = ["AI/ML", "AR/VR", "DESKTOP", "IOT", "MOBILE", "SYSTEMS", "WEB"]


def current_week() -> str:
    y, w, _ = local_today().isocalendar()
    return f"{y}-W{w:02d}"


def project_view(p: Project) -> dict[str, Any]:
    return {"id": p.id, "title": p.title, "types": p.types, "leaders": p.leaders, "start_date": p.start_date,
            "end_date": p.end_date, "status": p.status, "maturity": p.maturity, "reported_this_week": p.last_report_week == current_week()}


@router.get("/dashboard")
def dashboard(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    projects = list(db.exec(select(Project)))
    by_status = Counter(p.status for p in projects)
    by_cat: Counter[str] = Counter()
    for p in projects:
        for t in p.types:
            by_cat[t] += 1
    return {
        "total": len(projects),
        "by_status": {s: by_status.get(s, 0) for s in STATUSES},
        "by_category": {c: by_cat.get(c, 0) for c in CATEGORIES},
        "not_reported": [p.title for p in projects if p.last_report_week != current_week()],
        "week": current_week(),
    }


@router.get("/projects")
def projects(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    return [project_view(p) for p in db.exec(select(Project).order_by(Project.id))]


class ProjectBody(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    types: list[str] = []
    leaders: list[str] = []
    start_date: str = ""
    end_date: str = ""
    status: str = "On Development"
    maturity: str = "Idea"


@router.post("/projects")
def add_project(body: ProjectBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    p = Project(**body.model_dump())
    if not p.leaders:
        p.leaders = [user.display_name]
    db.add(p)
    db.commit()
    db.refresh(p)
    return project_view(p)


def pdp_view(e: PdpEntry) -> dict[str, Any]:
    return {"id": e.id, "tab": e.tab, "skill": e.skill, "category": e.category, "start_date": e.start_date,
            "end_date": e.end_date, "status": e.status}


@router.get("/pdp")
def pdp(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    return [pdp_view(e) for e in db.exec(select(PdpEntry).where(PdpEntry.user_id == user.id).order_by(PdpEntry.id))]


class PdpBody(BaseModel):
    tab: Literal["pdp", "projects", "activities"] = "pdp"
    skill: str = Field(min_length=1, max_length=200)
    category: str = ""
    start_date: str = ""
    end_date: str = ""
    status: str = "Not Started"


@router.post("/pdp")
def add_pdp(body: PdpBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    e = PdpEntry(user_id=user.id, **body.model_dump())  # type: ignore[arg-type]
    db.add(e)
    db.commit()
    db.refresh(e)
    return pdp_view(e)


def report_view(r: WeeklyReport) -> dict[str, Any]:
    return {"id": r.id, "week": r.week, "start_date": r.start_date, "end_date": r.end_date, "status": r.status,
            "submitted_at": iso(r.submitted_at), "reviewed_by": r.reviewed_by, "content": r.content}


@router.get("/reports")
def reports(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    rows = list(db.exec(select(WeeklyReport).where(WeeklyReport.user_id == user.id)))
    rows.sort(key=lambda r: r.week, reverse=True)
    cw = current_week()
    cur = next((r for r in rows if r.week == cw), None)
    return {
        "current_week": cw,
        "current": report_view(cur) if cur else None,
        "total_submitted": sum(1 for r in rows if r.status == "SUBMITTED"),
        "pending_revisions": 0,
        "reports": [report_view(r) for r in rows],
    }


# ---------------------------------------------------------------------------
# Individual (interns) weekly report: Projects / Assignments / PDPs

OUTCOMES = ("done", "partial", "not_done")


def _week_bounds(week_start: str) -> tuple[datetime, datetime]:
    start = from_local(datetime.combine(date.fromisoformat(week_start), time(0, 0)).replace(tzinfo=tz()))
    return start, start + timedelta(days=7)


def current_report(db: DBSession, user: User) -> WeeklyReport:
    cw = current_week()
    r = db.exec(select(WeeklyReport).where(WeeklyReport.user_id == user.id, WeeklyReport.week == cw)).first()
    if r is None:
        today = local_today()
        start = today - timedelta(days=today.weekday())
        r = WeeklyReport(user_id=user.id, week=cw, start_date=start.isoformat(), end_date=(start + timedelta(days=6)).isoformat())  # type: ignore[arg-type]
        db.add(r)
        db.commit()
        db.refresh(r)
    return r


def report_items(db: DBSession, user: User, r: WeeklyReport) -> list[dict[str, Any]]:
    """This week's items (projects, special tasks, PDPs) merged with what was saved; frozen once submitted."""
    if r.status == "SUBMITTED":
        return list(r.items or [])
    prev = [x for x in db.exec(select(WeeklyReport).where(WeeklyReport.user_id == user.id, WeeklyReport.status == "SUBMITTED"))
            if x.week < r.week and x.items]
    prev.sort(key=lambda x: x.week, reverse=True)
    promises = {it["key"]: it.get("plan", "") for it in (prev[0].items if prev else [])}
    week_start, _ = _week_bounds(r.start_date)
    base: list[dict[str, Any]] = []
    for p in db.exec(select(Project).order_by(Project.id)):
        if user.id in (p.report_user_ids or []):
            base.append({"key": f"project-{p.id}", "kind": "project", "ref_id": p.id, "name": p.title, "detail": ", ".join(p.types)})
    for t in db.exec(select(Task).where(Task.assigned_to_id == user.id).order_by(Task.id)):
        if t.status != "done" or t.updated_at >= week_start:
            due = to_local(t.due_at).strftime("%Y-%m-%d %H:%M") if t.due_at else ""
            base.append({"key": f"task-{t.id}", "kind": "assignment", "ref_id": t.id, "name": t.title,
                         "detail": t.description, "due": due, "task_status": t.status})
    for e in db.exec(select(PdpEntry).where(PdpEntry.user_id == user.id, PdpEntry.tab == "pdp").order_by(PdpEntry.id)):
        if e.status in ("In Progress", "Not Started"):
            base.append({"key": f"pdp-{e.id}", "kind": "pdp", "ref_id": e.id, "name": e.skill,
                         "detail": f"{e.category} · {e.start_date} → {e.end_date} · {e.status}"})
    saved = {it["key"]: it for it in (r.items or [])}
    out = []
    for b in base:
        sv = saved.get(b["key"], {})
        out.append({**b, "promise": promises.get(b["key"], ""), "outcome": sv.get("outcome", ""), "progress": sv.get("progress", ""),
                    "plan": sv.get("plan", ""), "blockers": sv.get("blockers", ""), "nuru": sv.get("nuru", {})})
    return out


def _complete(it: dict[str, Any]) -> bool:
    return bool(str(it.get("progress", "")).strip() and str(it.get("plan", "")).strip())


def full_report_view(db: DBSession, user: User, r: WeeklyReport) -> dict[str, Any]:
    items = report_items(db, user, r)
    counts = {k: {"done": sum(1 for i in items if i["kind"] == k and _complete(i)), "total": sum(1 for i in items if i["kind"] == k)}
              for k in ("project", "assignment", "pdp")}
    return {**report_view(r), "items": items, "counts": counts, "incomplete": sum(1 for i in items if not _complete(i))}


@router.get("/reports/current")
def get_current_report(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    return full_report_view(db, user, current_report(db, user))


class ItemBody(BaseModel):
    key: str
    outcome: Literal["", "done", "partial", "not_done"] = ""
    progress: str = Field(default="", max_length=4000)
    plan: str = Field(default="", max_length=4000)
    blockers: str = Field(default="", max_length=4000)
    nuru: dict[str, str] = {}


class ReportSave(BaseModel):
    items: list[ItemBody] = []
    submit: bool = False


@router.put("/reports/current")
def save_current_report(body: ReportSave, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    r = current_report(db, user)
    if r.status == "SUBMITTED":
        raise HTTPException(409, {"code": "submitted", "error": "This week's report was already submitted.",
                                  "error_sw": "Ripoti ya wiki hii imeshawasilishwa."})
    current = {it["key"]: it for it in report_items(db, user, r)}
    for b in body.items:
        if b.key in current:
            current[b.key].update(b.model_dump(exclude={"key"}))
    items = list(current.values())
    if body.submit:
        missing = [i["name"] for i in items if not _complete(i)]
        if missing:
            raise HTTPException(422, {"code": "incomplete", "error": f"{len(missing)} items need progress before you can submit.",
                                      "error_sw": f"Vipengele {len(missing)} vinahitaji maendeleo kabla ya kuwasilisha.", "items": missing})
        r.status, r.submitted_at = "SUBMITTED", now_utc()
    r.items = [{k: v for k, v in i.items() if k not in ("detail", "due", "task_status")} | {"promise": i.get("promise", "")} for i in items]
    db.add(r)
    db.commit()
    db.refresh(r)
    if body.submit:
        for p in db.exec(select(Project)):
            if user.id in (p.report_user_ids or []):
                p.last_report_week = r.week
                db.add(p)
        db.commit()
        sup = db.get(User, user.supervisor_id) if user.supervisor_id else None
        if sup:
            notify(db, sup.id, "weris_report",  # type: ignore[arg-type]
                   message_sw=f"{first_name(user.display_name)} amewasilisha ripoti ya wiki {r.week}.",
                   message_en=f"{first_name(user.display_name)} has submitted the weekly report for {r.week}.",
                   title_sw="Ripoti ya wiki", title_en="Weekly report", link="/weris/reports")
    return full_report_view(db, user, r)


# -- NURU fills the report: one structured LLM call ---------------------------

FILL_PROMPT = """You fill in an intern's WERIS individual weekly report for {name} (week {week}, {start} to {end}).
The report text is ALWAYS written in clear, professional ENGLISH, whatever language the user speaks (often Swahili).

For each item return:
- outcome: how last week's promise went: "done", "partial" or "not_done"; "none" if there was no promise and nothing says.
- progress: what was accomplished this week (1-2 sentences, first person, past tense).
- plan: the plan for next week (1 sentence, first person).
- blockers: blockers or risks, or "" if none were mentioned.
- source: "user" when the user's words describe this item, "data" when this week's real data below describes it, otherwise "generic".
- needs_review: true when source is "generic" (or when you had to guess), else false.

Rules:
- NEVER invent concrete achievements: no numbers, percentages, dates, completed features, results or names that are not in the
  user's words or the data. Generic wording stays modest and non-specific, built on last week's promise
  (for example "Continued work on improving the AI engine; refinements are ongoing."). Generic wording assumes the work
  continued: never say it was not done, and use outcome "partial" for it.
- Translate the user's meaning faithfully into English; do not exaggerate it. "Inaendelea vizuri" means work is progressing well.
- Items not mentioned by the user but covered by "the rest"/"mengine yote" in their words get that meaning (source "user"),
  written specifically for each item.
- EVERY item you return has a non-empty progress and plan written specifically about THAT item: mention its own work
  (from its last week's promise or details). Never write "other projects" or "all projects".
- When the user says they are stuck or struggling with something, also name that difficulty in blockers.
- {scope_rule}
- Use the exact item keys given.

Items (key | kind | name | last week's promise | details | current values):
{items}

This week's real data for {name}:
{data}
"""

SCOPE_ALL = "Return EVERY item listed."
SCOPE_MENTIONED = ("Return only the items the user's request concerns (by name, or 'the rest'/'all'). For an edit of one field "
                   "(e.g. 'change the plan of X'), return that item with the other fields kept from its current values.")

FILL_SCHEMA = {
    "type": "object", "additionalProperties": False, "required": ["items"],
    "properties": {"items": {"type": "array", "items": {
        "type": "object", "additionalProperties": False,
        "required": ["key", "outcome", "progress", "plan", "blockers", "source", "needs_review"],
        "properties": {
            "key": {"type": "string"}, "outcome": {"type": "string", "enum": ["done", "partial", "not_done", "none"]},
            "progress": {"type": "string"}, "plan": {"type": "string"}, "blockers": {"type": "string"},
            "source": {"type": "string", "enum": ["user", "data", "generic"]}, "needs_review": {"type": "boolean"},
        }}}},
}


def week_data(db: DBSession, user: User, r: WeeklyReport) -> str:
    """Real activity this week: special tasks, PDP entries and NURU's activity log."""
    start, end = _week_bounds(r.start_date)
    lines = []
    for t in db.exec(select(Task).where(Task.assigned_to_id == user.id)):
        if t.updated_at >= start or t.status != "done":
            state = {"assigned": "assigned, not started yet", "in_progress": "in progress", "done": "done"}.get(t.status, t.status)
            lines.append(f"- Special task '{t.title}': {state}" + (" (updated this week)" if t.updated_at >= start else ""))
    for e in db.exec(select(PdpEntry).where(PdpEntry.user_id == user.id)):
        if e.status == "In Progress":
            lines.append(f"- PDP ({e.tab}) '{e.skill}': {e.status}")
    for a in db.exec(select(AuditRecord).where(AuditRecord.user_id == user.id)):
        try:
            ts = datetime.fromisoformat(a.timestamp.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
        except ValueError:
            continue
        if start <= ts < end and a.outcome == "Completed" and a.system != "weris":
            lines.append(f"- NURU activity ({a.system}): {a.request[:160]}")
    return "\n".join(lines[:40]) or "(nothing recorded)"


class FillBody(BaseModel):
    request: str = Field(default="", max_length=6000)
    scope: Literal["all", "mentioned"] = "mentioned"
    keys: list[str] = []


@router.post("/reports/current/fill")
async def fill_report(body: FillBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    """Drafts report items with ONE structured LLM call. Nothing is saved: NURU fills the form visibly, then saves the draft."""
    if not llm.api_key():
        raise HTTPException(400, {"code": "no_key", "error": "OPENAI_API_KEY is not set.", "error_sw": "Ufunguo wa OpenAI haupo."})
    r = current_report(db, user)
    if r.status == "SUBMITTED":
        raise HTTPException(409, {"code": "submitted", "error": "This week's report was already submitted.",
                                  "error_sw": "Ripoti ya wiki hii imeshawasilishwa."})
    items = report_items(db, user, r)
    if body.keys:
        items = [i for i in items if i["key"] in body.keys]
    rows = "\n".join(
        f"{i['key']} | {i['kind']} | {i['name']} | {i['promise'] or '-'} | {(i.get('detail') or '-')[:160]} | "
        f"outcome={i['outcome'] or '-'}; progress={i['progress'] or '-'}; plan={i['plan'] or '-'}; blockers={i['blockers'] or '-'}"
        for i in items)
    prompt = FILL_PROMPT.format(name=first_name(user.display_name), week=r.week, start=r.start_date, end=r.end_date, items=rows,
                                data=week_data(db, user, r), scope_rule=SCOPE_ALL if body.scope == "all" or body.keys else SCOPE_MENTIONED)
    try:
        resp = await llm.client().chat.completions.create(
            model=llm.model_name(), temperature=0.2,
            messages=[{"role": "system", "content": prompt},
                      {"role": "user", "content": body.request or "Write every item for me from last week's promises and this week's data."}],
            response_format={"type": "json_schema", "json_schema": {"name": "weekly_report", "strict": True, "schema": FILL_SCHEMA}},
        )
        data = json.loads(resp.choices[0].message.content or "{}")
    except Exception as exc:  # noqa: BLE001
        log.error("report fill failed: %s", exc)
        raise HTTPException(502, {"code": "llm_failed", "error": f"Could not draft the report: {exc}",
                                  "error_sw": "Sikuweza kuandaa ripoti. Jaribu tena."})
    known = {i["key"]: i for i in items}
    out = []
    for it in data.get("items", []):
        if it.get("key") not in known:
            continue
        it["outcome"] = "" if it.get("outcome") == "none" else it.get("outcome", "")
        it["needs_review"] = bool(it.get("needs_review")) or it.get("source") == "generic"
        it["name"] = known[it["key"]]["name"]
        out.append(it)
    return {"items": out, "week": r.week}
