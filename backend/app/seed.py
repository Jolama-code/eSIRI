"""Demo data for NURU v2. Used on first start and by POST /api/demo/reset.

All people and addresses are fictional (domain mfano.go.tz). Times are relative to
"now" in NURU_TZ so the demo always has something coming up.
"""

from __future__ import annotations

from datetime import date, datetime, time, timedelta

from sqlmodel import Session as DBSession
from sqlmodel import SQLModel, delete, select

from .core import engine, from_local, hash_password, local_today, now_utc, signature, to_local, tz
from .models import (
    AuditRecord, KatibuJob, MailMessage, Notification, PdpEntry, Project, Reminder, ScheduledMeeting,
    ScheduleItem, Session, Task, User, WeeklyReport,
)
from .services import sync_item_reminder, sync_meeting_reminders, sync_task_reminder

DEMO_PASSWORD = "Demo@2026"

PEOPLE = [
    # id, username, display_name, title, role, email, supervisor, has_account
    (1, "jolama", "Jolama", "Afisa TEHAMA (ICT Officer)", "staff", "jolama@mfano.go.tz", 2, True),
    (2, "halima", "Dkt. Halima Said", "Msimamizi wa Idara (Head of Section)", "supervisor", "halima.said@mfano.go.tz", None, True),
    (3, "baraka", "Baraka Mollel", "Afisa Mifumo (Systems Officer)", "staff", "baraka.mollel@mfano.go.tz", 2, True),
    (4, "neema", "Neema Mwakalinga", "Mchambuzi Mkuu wa Mifumo (Principal Systems Analyst)", "staff", "neema.mwakalinga@mfano.go.tz", 2, False),
    (5, "juma", "Juma Hassan", "Afisa Mipango (Planning Officer)", "staff", "juma.hassan@mfano.go.tz", 2, False),
    (6, "zawadi", "Zawadi Kimaro", "Afisa Kumbukumbu (Records Officer)", "staff", "zawadi.kimaro@mfano.go.tz", 2, False),
    (7, "tehama", "Timu ya TEHAMA", "Kitengo cha TEHAMA (ICT team)", "staff", "tehama@mfano.go.tz", None, False),
    (8, "helpdesk", "Dawati la Msaada la TEHAMA", "ICT Helpdesk", "staff", "helpdesk@mfano.go.tz", None, False),
    (9, "mafunzo", "Kitengo cha Mafunzo", "Training Unit", "staff", "mafunzo@mfano.go.tz", None, False),
]

KAMATI_ROOM = "kamati-ya-bajeti-k7b2"
JOLAMA_ROOM = "jolamas-room-r7k2"


def _local(d: date, hh: int, mm: int = 0) -> datetime:
    return from_local(datetime.combine(d, time(hh, mm)).replace(tzinfo=tz()))


def _round_up(dt: datetime, minutes: int) -> datetime:
    base = dt.replace(second=0, microsecond=0)
    extra = (-base.minute) % minutes
    return base + timedelta(minutes=extra or 0)


def _later_today(now: datetime, hours: float, round_to: int = 15) -> datetime:
    """A time `hours` from now, kept on today's local date when possible."""
    cand = _round_up(now + timedelta(hours=hours), round_to)
    if to_local(cand).date() != to_local(now).date():
        cand = _round_up(now + timedelta(minutes=50), 5)
    return cand


def _next_weekday(d: date, weekday: int) -> date:
    """Next given weekday (0=Mon) strictly after d, or d itself if it is that day and still useful."""
    days = (weekday - d.weekday()) % 7
    return d + timedelta(days=days or 7)


def _upsert_people(db: DBSession) -> None:
    pw = hash_password(DEMO_PASSWORD)
    for pid, username, name, title, role, email, sup, acct in PEOPLE:
        u = db.get(User, pid)
        if u is None:
            u = User(id=pid, username=username, display_name=name, email=email)
        u.username = username
        u.display_name = name
        u.title = title
        u.role = role
        u.email = email
        u.supervisor_id = sup
        u.has_account = acct
        u.password_hash = pw if acct else ""
        u.language = "sw"
        u.voice_enabled = True
        u.reminder_lead_min = 5
        u.meeting_audio_source = "live"
        u.wake_word = False
        db.add(u)
    db.commit()


def _mail(db: DBSession, owner: int, folder: str, frm: User | tuple[str, str], to: list[str], subject: str, body: str,
          sent_at: datetime, read: bool = True, cc: list[str] | None = None, thread: str = "") -> MailMessage:
    if isinstance(frm, User):
        from_addr, from_name = frm.email, frm.display_name
    else:
        from_addr, from_name = frm
    m = MailMessage(owner_id=owner, folder=folder, from_addr=from_addr, from_name=from_name, to=to, cc=cc or [],
                    subject=subject, body=body, sent_at=sent_at, read=read, thread_id=thread or subject)
    db.add(m)
    return m


def _seed_mail(db: DBSession, now: datetime) -> None:
    jol, hal, bar = db.get(User, 1), db.get(User, 2), db.get(User, 3)
    neema, juma = db.get(User, 4), db.get(User, 5)
    assert jol and hal and bar and neema and juma
    today = to_local(now).date()
    thursday = _next_weekday(today, 3) if today.weekday() != 3 else today
    thu_txt = thursday.strftime("%d/%m/%Y")

    def ago(hours: float) -> datetime:
        return now - timedelta(hours=hours)

    # ---- Jolama's inbox (6) ---------------------------------------------------
    _mail(db, 1, "inbox", hal, [jol.email], "Mapitio ya bajeti ya robo ya tatu",
          f"Habari Jolama,\n\nNatumaini u mzima. Kikao cha mapitio ya bajeti ya robo ya tatu kitafanyika Alhamisi, "
          f"tarehe {thu_txt}, saa 4:00 asubuhi, katika ukumbi wa mikutano wa ghorofa ya pili.\n\n"
          "Tafadhali thibitisha kama utahudhuria, na uje na takwimu zilizohuishwa za matumizi ya miradi ya TEHAMA "
          "hadi mwisho wa mwezi uliopita.\n\nAsante kwa ushirikiano wako.\n\n" + signature(hal),
          ago(1.5), read=False)
    _mail(db, 1, "inbox", ("helpdesk@mfano.go.tz", "Dawati la Msaada la TEHAMA"), [jol.email],
          "Matengenezo ya mfumo yaliyopangwa / Planned system maintenance",
          "Ndugu Mtumishi,\n\nTunapenda kukutaarifu kuwa kutakuwa na matengenezo ya mfumo wa barua pepe (GMS) "
          "Jumamosi hii kuanzia saa 2:00 usiku hadi saa 6:00 usiku. Katika muda huo huduma inaweza kukatika kwa muda mfupi.\n\n"
          "Dear colleague,\n\nPlease note that the Government Mailing System will undergo planned maintenance this Saturday "
          "from 20:00 to 24:00. The service may be briefly unavailable during this window.\n\n"
          "Kwa msaada / For support: helpdesk@mfano.go.tz\n\nDawati la Msaada la TEHAMA\nICT Helpdesk",
          ago(3), read=False)
    _mail(db, 1, "inbox", ("mafunzo@mfano.go.tz", "Kitengo cha Mafunzo"), [jol.email],
          "Mwaliko: Mafunzo ya Uelewa wa Usalama Mtandaoni (Cyber Security Awareness)",
          "Habari,\n\nUnaalikwa kushiriki mafunzo ya siku mbili ya Uelewa wa Usalama Mtandaoni yatakayofanyika "
          "kwa njia ya e-Mikutano wiki ijayo, Jumanne na Jumatano, kuanzia saa 3:00 asubuhi.\n\n"
          "Mada kuu: barua pepe za ulaghai (phishing), nywila imara, na ulinzi wa taarifa za Serikali.\n\n"
          "Tafadhali jisajili kupitia Kitengo cha Mafunzo kabla ya Ijumaa.\n\nKitengo cha Mafunzo\nTraining Unit",
          ago(5), read=False)
    _mail(db, 1, "inbox", bar, [jol.email], "Re: Seva ya majaribio ya e-Mikutano",
          "Jolama,\n\nSeva ya majaribio iko tayari. I have configured the new SSL certificate and the backups now run "
          "every night at 01:00. Tafadhali jaribu kuingia ukipata nafasi na unijulishe kama kuna tatizo.\n\n"
          "Asante,\n\n" + signature(bar), ago(22), read=True)
    _mail(db, 1, "inbox", neema, [jol.email], "Ombi la nyaraka za mfumo wa NURU",
          "Habari Jolama,\n\nNaomba unitumie nyaraka za usanifu (architecture) wa mfumo wa NURU pamoja na mwongozo wa "
          "mtumiaji, ili tuziweke kwenye hazina ya nyaraka za Kitengo.\n\nNashukuru.\n\n" + signature(neema),
          ago(28), read=True)
    _mail(db, 1, "inbox", juma, [jol.email], "Reminder: weekly ICT report submission",
          "Dear Jolama,\n\nThis is a friendly reminder to submit your weekly report in WERIS before Friday at 16:00, "
          "so that the section summary can be shared with management on Monday.\n\nRegards,\n\n" + signature(juma),
          ago(47), read=True)

    # ---- Jolama's sent (3), delivered to account holders ---------------------
    sent = [
        (hal, "Taarifa ya maendeleo ya wiki", "Habari Dkt. Halima,\n\nNakutumia taarifa fupi ya maendeleo ya wiki hii: "
              "majaribio ya NURU kwenye e-Mikutano yamekamilika na tumeanza kuandaa toleo la pili.\n\nWako,\n\n", 26),
        (bar, "Ratiba ya majaribio ya mfumo", "Habari Baraka,\n\nTafadhali tukutane Jumatatu saa 5:00 asubuhi kupitia "
              "e-Mikutano tupange ratiba ya majaribio ya mfumo.\n\nAsante,\n\n", 50),
        (db.get(User, 7), "Ombi la vifaa vya majaribio", "Habari timu ya TEHAMA,\n\nNaomba kompyuta mpakato mbili kwa ajili "
              "ya majaribio ya mfumo wa NURU kwa wiki mbili zijazo.\n\nAsante,\n\n", 74),
    ]
    for rcpt, subj, body, hrs in sent:
        assert rcpt
        full = body + signature(jol)
        _mail(db, 1, "sent", jol, [rcpt.email], subj, full, ago(hrs))
        if rcpt.has_account:
            _mail(db, rcpt.id, "inbox", jol, [rcpt.email], subj, full, ago(hrs), read=True)  # type: ignore[arg-type]

    # ---- a little for Halima and Baraka --------------------------------------
    _mail(db, 2, "inbox", juma, [hal.email], "Muhtasari wa ripoti za wiki za Idara",
          "Habari Dkt. Halima,\n\nRipoti nyingi za wiki zimewasilishwa. Ripoti ambazo bado hazijawasilishwa zitafuatiliwa "
          "kesho.\n\nWako,\n\n" + signature(juma), ago(4), read=False)
    _mail(db, 3, "inbox", ("helpdesk@mfano.go.tz", "Dawati la Msaada la TEHAMA"), [bar.email],
          "Matengenezo ya mfumo yaliyopangwa / Planned system maintenance",
          "Ndugu Mtumishi,\n\nKutakuwa na matengenezo ya mfumo wa GMS Jumamosi hii kuanzia saa 2:00 usiku.\n\n"
          "Dawati la Msaada la TEHAMA", ago(3), read=False)


def _seed_weris(db: DBSession) -> None:
    projects = [
        ("NURU — Msaidizi wa Kidijitali", ["AI/ML", "WEB"], ["Jolama", "Baraka Mollel"], "2026-08-01", "2026-12-31", "On Proof Of Concept", "Prototype"),
        ("e-Mikutano v5", ["WEB", "SYSTEMS"], ["Baraka Mollel"], "2026-02-10", "2026-11-30", "On Development", "Development"),
        ("KatibuAI Mobile", ["MOBILE", "AI/ML"], ["Neema Mwakalinga"], "2026-05-02", "2027-01-31", "On Pilot", "Pilot"),
        ("Daftari la Mali za Serikali", ["WEB"], ["Juma Hassan"], "2025-09-01", "2026-06-30", "On Production", "Production"),
        ("Tafsiri ya Mashine ya Kiswahili", ["AI/ML"], ["Neema Mwakalinga", "Jolama"], "2026-03-15", "2026-12-15", "On Development", "Development"),
        ("Lango la Takwimu Huria", ["WEB", "SYSTEMS"], ["Zawadi Kimaro"], "2026-01-20", "2026-09-30", "On Hold", "Idea"),
    ]
    cw = _iso_week(local_today())
    for i, (title, types, leaders, s, e, status, mat) in enumerate(projects):
        db.add(Project(title=title, types=types, leaders=leaders, start_date=s, end_date=e, status=status, maturity=mat,
                       last_report_week=cw if i % 2 == 0 else ""))
    # Jolama's internship projects: the "Projects" tab of his individual weekly report.
    for title, types, leaders, s, e, status, mat, _promise in INTERN_PROJECTS:
        db.add(Project(title=title, types=types, leaders=leaders, start_date=s, end_date=e, status=status, maturity=mat,
                       report_user_ids=[1]))
    db.flush()
    intern = {p.title: p.id for p in db.exec(select(Project)) if p.report_user_ids}
    pdp = [
        ("pdp", "Uhandisi wa maelekezo ya AI (Prompt engineering)", "Technical", "2026-07-01", "2026-12-31", "In Progress"),
        ("pdp", "Usimamizi wa miradi (PRINCE2 Foundation)", "Management", "2026-03-01", "2026-06-30", "Completed"),
        ("pdp", "Usalama wa mifumo ya wavuti (OWASP)", "Technical", "2026-09-01", "2027-02-28", "Not Started"),
        ("projects", "NURU — Msaidizi wa Kidijitali", "AI/ML", "2026-08-01", "2026-12-31", "In Progress"),
        ("projects", "Tafsiri ya Mashine ya Kiswahili", "AI/ML", "2026-03-15", "2026-12-15", "In Progress"),
        ("activities", "Kufundisha wenzangu matumizi ya e-Mikutano", "Mentoring", "2026-10-01", "2026-10-31", "In Progress"),
    ]
    for tab, skill, cat, s, e, st in pdp:
        db.add(PdpEntry(user_id=1, tab=tab, skill=skill, category=cat, start_date=s, end_date=e, status=st))
    today = local_today()
    monday = today - timedelta(days=today.weekday())
    for uid in (1, 3):
        for k in range(6, -1, -1):
            start = monday - timedelta(weeks=k)
            end = start + timedelta(days=6)
            wk = _iso_week(start)
            if k == 0:
                # This week's report starts as an empty DRAFT (the items are built when the form opens).
                db.add(WeeklyReport(user_id=uid, week=wk, start_date=start.isoformat(), end_date=end.isoformat(), status="DRAFT"))
            elif k == 3:
                db.add(WeeklyReport(user_id=uid, week=wk, start_date=start.isoformat(), end_date=end.isoformat(), status="DRAFT"))
            else:
                sub = from_local(datetime.combine(end - timedelta(days=2), time(19, 32)).replace(tzinfo=tz()))
                items = []
                if uid == 1 and k == 1:
                    # Last week's plans become this week's "LAST WEEK'S PROMISE".
                    items = [{"key": f"project-{intern[t]}", "kind": "project", "ref_id": intern[t], "name": t, "promise": "",
                              "outcome": "partial", "progress": "Work continued as planned.", "plan": promise, "blockers": "", "nuru": {}}
                             for t, *_rest, promise in INTERN_PROJECTS]
                db.add(WeeklyReport(user_id=uid, week=wk, start_date=start.isoformat(), end_date=end.isoformat(), status="SUBMITTED",
                                    submitted_at=sub, reviewed_by="Dkt. Halima Said" if k > 2 else "",
                                    content="Kazi za wiki zimekamilika kama ilivyopangwa.", items=items))


INTERN_PROJECTS = [
    ("SGRFasta", ["AI/ML", "WEB"], ["Jolama", "Zawadi Kimaro"], "2026-07-01", "2026-12-31", "On Development", "Development",
     "improving the AI engine"),
    ("FAKE PRODUCT DETECTOR", ["AI/ML", "MOBILE"], ["Jolama"], "2026-08-15", "2027-01-31", "On Proof Of Concept", "Prototype",
     "testing the image-matching model on more product photos"),
    ("GoPost", ["WEB"], ["Jolama", "Baraka Mollel"], "2026-06-01", "2026-11-30", "On Development", "Development",
     "understanding why it has been hard to integrate the TikTok APIs"),
    ("MuhtasariAI", ["AI/ML"], ["Jolama", "Neema Mwakalinga"], "2026-05-10", "2026-12-15", "On Pilot", "Pilot",
     "improving the AI services of the project"),
    ("MtotoCare", ["MOBILE", "SYSTEMS"], ["Jolama", "Juma Hassan"], "2026-09-01", "2027-03-31", "On Development", "Development",
     "continuing with the backend implementation of the project"),
    ("Swahili sentiment Analysis Tool", ["AI/ML"], ["Jolama"], "2026-04-01", "2026-12-31", "On Development", "Development",
     "improving the AI engine"),
]


def _iso_week(d: date) -> str:
    y, w, _ = d.isocalendar()
    return f"{y}-W{w:02d}"


def seed(db: DBSession) -> None:
    now = now_utc()
    today = to_local(now).date()
    _upsert_people(db)

    # Meetings
    m1 = ScheduledMeeting(room_id=KAMATI_ROOM, title="Kikao cha Kamati ya Bajeti", start_at=_round_up(now + timedelta(minutes=12), 1),
                          end_at=_round_up(now + timedelta(minutes=57), 1), organizer_id=1, invitee_ids=[2, 3, 4, 5])
    m2_start = _later_today(now, 3, 30)
    m2 = ScheduledMeeting(room_id=JOLAMA_ROOM, title="Mapitio ya Mradi wa NURU", start_at=m2_start,
                          end_at=m2_start + timedelta(minutes=30), organizer_id=1, invitee_ids=[3, 4])
    tomorrow = today + timedelta(days=1)
    m3 = ScheduledMeeting(room_id=KAMATI_ROOM, title="Kikao cha Wiki cha Idara", start_at=_local(tomorrow, 10),
                          end_at=_local(tomorrow, 11), organizer_id=2, invitee_ids=[1, 3, 6])
    for m in (m1, m2, m3):
        db.add(m)
    db.commit()
    for m in (m1, m2, m3):
        db.refresh(m)
        sync_meeting_reminders(db, m)

    # Tasks
    due_today = _local(today, 16)
    if due_today <= now + timedelta(minutes=45):
        due_today = _later_today(now, 4, 30)
    friday = today + timedelta(days=(4 - today.weekday()) % 7 or 7)
    monday_next = today + timedelta(days=(7 - today.weekday()) or 7)
    tasks = [
        Task(title="Kuandaa taarifa ya maendeleo ya mfumo wa e-Mikutano", description="Taarifa fupi ya maendeleo ya wiki kwa ajili ya kikao cha Idara.",
             assigned_by_id=2, assigned_to_id=1, start_date=today.isoformat(), due_at=due_today, status="in_progress", created_at=now, updated_at=now),
        Task(title="Kuhuisha mpango kazi wa robo ya pili", description="Hakikisha shughuli zote za robo ya pili zina tarehe na wahusika.",
             assigned_by_id=2, assigned_to_id=1, start_date=today.isoformat(), due_at=_local(friday, 14), status="assigned", created_at=now, updated_at=now),
        Task(title="Kukagua usalama wa seva za majaribio", description="Ukaguzi wa viraka vya usalama na kumbukumbu za kuingia.",
             assigned_by_id=2, assigned_to_id=3, start_date=today.isoformat(), due_at=_local(monday_next, 12), status="assigned", created_at=now, updated_at=now),
    ]
    for t in tasks:
        db.add(t)
    db.commit()
    for t in tasks:
        db.refresh(t)
        sync_task_reminder(db, t)

    # Briefing-style items for Jolama
    t1 = _later_today(now, 1.75, 15)
    t2 = _later_today(now, 4.5, 15)
    items = [
        ScheduleItem(user_id=1, date=to_local(t1).date().isoformat(), start_at=t1, end_at=t1 + timedelta(minutes=45),
                     title="Kupitia ripoti ya mfumo", kind="task", source="briefing"),
        ScheduleItem(user_id=1, date=to_local(t2).date().isoformat(), start_at=t2, title="Kumpigia simu msambazaji wa vifaa",
                     kind="call", source="briefing"),
    ]
    for it in items:
        db.add(it)
    db.commit()
    for it in items:
        db.refresh(it)
        sync_item_reminder(db, it)

    _seed_mail(db, now)
    _seed_weris(db)
    db.commit()


def reset_all() -> None:
    """Wipe all demo data (but keep sign-in sessions, so devices stay signed in) and seed again."""
    with DBSession(engine) as db:
        for model in (ScheduledMeeting, ScheduleItem, Reminder, Task, Notification, MailMessage, Project, PdpEntry,
                      WeeklyReport, KatibuJob, AuditRecord):
            db.exec(delete(model))  # type: ignore[call-overload]
        db.commit()
        seed(db)


def seed_if_empty() -> None:
    SQLModel.metadata.create_all(engine)
    with DBSession(engine) as db:
        if db.exec(select(User)).first() is None:
            seed(db)
        else:
            # keep sessions table tidy
            for s in db.exec(select(Session).where(Session.expires_at < now_utc())):
                db.delete(s)
            db.commit()
