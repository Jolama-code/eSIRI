"""WERIS mock API: dashboard, projects, PDP and weekly reports (special tasks use /api/tasks)."""

from __future__ import annotations

from collections import Counter
from datetime import timedelta
from typing import Any, Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlmodel import Session as DBSession
from sqlmodel import select

from .core import current_user, get_db, iso, local_today, now_utc
from .models import PdpEntry, Project, User, WeeklyReport

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


class ReportBody(BaseModel):
    content: str = Field(default="", max_length=10000)
    submit: bool = False


@router.post("/reports")
def save_report(body: ReportBody, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    cw = current_week()
    r = db.exec(select(WeeklyReport).where(WeeklyReport.user_id == user.id, WeeklyReport.week == cw)).first()
    if r is None:
        today = local_today()
        start = today - timedelta(days=today.weekday())
        r = WeeklyReport(user_id=user.id, week=cw, start_date=start.isoformat(), end_date=(start + timedelta(days=6)).isoformat())  # type: ignore[arg-type]
    if r.status == "SUBMITTED":
        raise HTTPException(409, {"code": "submitted", "error": "This week's report was already submitted."})
    r.content = body.content
    if body.submit:
        r.status = "SUBMITTED"
        r.submitted_at = now_utc()
    db.add(r)
    db.commit()
    db.refresh(r)
    return report_view(r)
