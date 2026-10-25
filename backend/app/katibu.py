"""KatibuAI integration (real backend, HTTP API only).

Follows ../KATIBU-AI/INTEGRATION_GUIDE.md §3, §6–§8. Every GraphQL operation below was checked against
katibuAI-backend/docs/schema.graphql (getProcessingStatus, getMeetingMinutes, getMeetingDocuments,
getMeetingDeliveries, createMeeting(input: MeetingInput!), approveAndSendMinutes).

Flow: createMeeting (UNSTRUCTURED, UPLOAD, MIXED) → POST /api/audio/uploads/ → PUT chunks → POST complete
→ poll getProcessingStatus every 3 s (max 10 min) → read minutes SW + EN and documents → (after the user's
approval) approveAndSendMinutes → getMeetingDeliveries.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import os
import re
import shutil
import subprocess
import time
import uuid
import wave
from array import array
from pathlib import Path
from typing import Any, Optional

import httpx
from fastapi import APIRouter, Depends, File, Form, Header, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel
from sqlmodel import Session as DBSession
from sqlmodel import select

from .core import BACKEND_DIR, DATA_DIR, PROJECT_ROOT, current_user, engine, first_name, get_db, iso, now_utc, test_mode
from .models import KatibuJob, MailMessage, ScheduledMeeting, User
from .services import notify, push

log = logging.getLogger("nuru.katibu")
router = APIRouter(prefix="/api/katibu")

SUCCESS = 9001
POLL_SECONDS = 3
POLL_LIMIT_SECONDS = 600
MIN_LIVE_SECONDS = 20
SILENCE_DB = -50.0  # mean volume below this = effectively silent

REC_DIR = DATA_DIR / "recordings"
REC_DIR.mkdir(exist_ok=True)
ASSET_SAMPLE = BACKEND_DIR / "assets" / "sample_meeting.wav"
REFERENCE_SAMPLE = PROJECT_ROOT / "reference" / "nuru-v2" / "sample-meeting.wav"

STAGE_LABELS = {
    "ASSEMBLE_AUDIO": ("Kuandaa sauti", "Preparing the audio"),
    "TRANSCRIBE": ("Kunukuu mazungumzo", "Transcribing"),
    "IDENTIFY_SPEAKERS": ("Kutambua wazungumzaji", "Identifying speakers"),
    "ALIGN_AGENDA": ("Kupanga ajenda", "Aligning the agenda"),
    "WRITE_MINUTES": ("Kuandika kumbukumbu", "Writing the minutes"),
    "TRANSLATE_MINUTES": ("Kutafsiri kumbukumbu", "Translating the minutes"),
    "RENDER_DOCUMENTS": ("Kutengeneza nyaraka", "Rendering documents"),
    "DONE": ("Imekamilika", "Done"),
    "UPLOADING": ("Kupakia rekodi", "Uploading the recording"),
}

Q_CREATE = """mutation CreateMeeting($input: MeetingInput!) {
  createMeeting(input: $input) { status code message data { uid status title } }
}"""
Q_STATUS = """query Status($uid: UUID!) {
  getProcessingStatus(meetingUid: $uid) {
    status code message
    data { status stage progress error waiting warnings jobStatus attempts stages { key state } }
  }
}"""
Q_MINUTES = """query Minutes($uid: UUID!, $lang: MinutesLanguageChoices!) {
  getMeetingMinutes(meetingUid: $uid, language: $lang) { status code message data { uid version status language content } }
}"""
Q_DOCS = """query Docs($uid: UUID!) {
  getMeetingDocuments(meetingUid: $uid) {
    status code message dataList { uid language format fileName size pageCount approved downloadUrl }
  }
}"""
Q_SEND = """mutation Send($uid: UUID!, $langs: [MinutesLanguageChoices], $formats: [DocumentFormatChoices],
                       $rcpt: [String], $extra: [String]) {
  approveAndSendMinutes(meetingUid: $uid, languages: $langs, formats: $formats, recipientEmails: $rcpt, extraEmails: $extra) {
    status code message dataList { uid email displayName status sentAt error attempts }
  }
}"""
Q_TRANSCRIPT = """query Transcript($uid: UUID!) {
  exportMeetingTranscript(meetingUid: $uid) { status code message data { fileName text } }
}"""
Q_DELIVERIES = """query Deliveries($uid: UUID!) {
  getMeetingDeliveries(meetingUid: $uid) {
    status code message dataList { uid email displayName status sentAt error attempts attachmentsSent }
  }
}"""


class KatibuError(Exception):
    def __init__(self, en: str, sw: str = "") -> None:
        super().__init__(en)
        self.en = en
        self.sw = sw or en


def _env(name: str, default: str = "") -> str:
    return os.getenv(name, default).split(" #")[0].strip()


class KatibuClient:
    def __init__(self) -> None:
        self.token = ""
        self.refresh_token = ""
        self.expires_at = 0.0
        self.last_error = ""
        self.last_ok: Optional[float] = None
        self._lock = asyncio.Lock()

    @property
    def base(self) -> str:
        return _env("KATIBU_BASE_URL", "http://localhost:8000").rstrip("/")

    def configured(self) -> bool:
        return bool(self.base and _env("KATIBU_USERNAME") and _env("KATIBU_PASSWORD"))

    def _http(self, timeout: float = 60) -> httpx.AsyncClient:
        return httpx.AsyncClient(timeout=timeout)

    async def _grant(self, data: dict[str, str]) -> None:
        async with self._http(30) as http:
            r = await http.post(f"{self.base}/oauth2/access_token", data={**data, "client_id": _env("KATIBU_CLIENT_ID", "katibuai-android")})
        try:
            j = r.json()
        except ValueError:
            j = {}
        if r.status_code != 200 or not j.get("access_token"):
            raise KatibuError(f"KatibuAI sign-in failed (HTTP {r.status_code}, code {j.get('code')}).",
                              "Kuingia KatibuAI kumeshindikana.")
        self.token = j["access_token"]
        self.refresh_token = j.get("refresh_token", "")
        self.expires_at = time.time() + float(j.get("expires_in") or 3600)

    async def login(self) -> None:
        if not self.configured():
            raise KatibuError("KatibuAI is not configured (KATIBU_* in .env).", "KatibuAI haijawekwa kwenye mipangilio.")
        await self._grant({"grant_type": "password", "username": _env("KATIBU_USERNAME"), "password": _env("KATIBU_PASSWORD")})

    async def access_token(self, force: bool = False) -> str:
        async with self._lock:
            if force or not self.token:
                await self.login()
            elif time.time() > self.expires_at - 120:
                try:
                    await self._grant({"grant_type": "refresh_token", "refresh_token": self.refresh_token})
                except KatibuError:
                    await self.login()
            return self.token

    async def request(self, method: str, path: str, *, timeout: float = 120, **kw: Any) -> httpx.Response:
        url = path if path.startswith("http") else f"{self.base}{path}"
        for attempt in range(2):
            token = await self.access_token(force=attempt == 1)
            headers = {**kw.pop("headers", {}), "Authorization": f"Bearer {token}", "Accept-Language": "sw"}
            try:
                async with self._http(timeout) as http:
                    r = await http.request(method, url, headers=headers, **kw)
            except httpx.HTTPError as exc:
                self.last_error = f"KatibuAI is not reachable: {exc}"
                raise KatibuError(self.last_error, "KatibuAI haipatikani kwa sasa.")
            if r.status_code == 401 and attempt == 0:
                continue
            return r
        return r

    async def gql(self, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        r = await self.request("POST", "/graphql", json={"query": query, "variables": variables})
        try:
            j = r.json()
        except ValueError:
            raise KatibuError(f"KatibuAI GraphQL returned HTTP {r.status_code}.")
        if r.status_code != 200 or j.get("errors"):
            msg = "; ".join(e.get("message", "") for e in j.get("errors", [])) or f"HTTP {r.status_code}"
            self.last_error = f"GraphQL error: {msg}"
            raise KatibuError(self.last_error, "KatibuAI imekataa ombi.")
        data = j.get("data") or {}
        op = next(iter(data.values()), None) or {}
        if op.get("code") != SUCCESS:
            self.last_error = f"KatibuAI: {op.get('message') or 'error'} (code {op.get('code')})"
            raise KatibuError(self.last_error, f"KatibuAI: {op.get('message') or 'hitilafu'}")
        self.last_ok = time.time()
        self.last_error = ""
        return op

    # -- upload flow ---------------------------------------------------------
    async def upload(self, meeting_uid: str, wav: Path, on_chunk: Optional[Any] = None) -> None:
        raw = wav.read_bytes()
        sha = hashlib.sha256(raw).hexdigest()
        r = await self.request("POST", "/api/audio/uploads/", json={
            "meeting_uid": meeting_uid, "kind": "UPLOAD", "file_name": wav.name, "total_bytes": len(raw), "sha256": sha,
        })
        j = _json(r)
        if r.status_code not in (200, 201) or not j.get("success"):
            raise KatibuError(f"Upload could not start: {j.get('message') or r.status_code}", "Kupakia rekodi kumeshindikana.")
        upload_uid, size = j["upload_uid"], int(j["chunk_size"])
        count = int(j.get("chunk_count") or math.ceil(len(raw) / size))
        done = set(j.get("received_chunks") or [])
        if on_chunk:
            on_chunk(len(done), count)
        for i in range(count):
            if i in done:
                continue
            chunk = raw[i * size:(i + 1) * size]
            rc = await self.request("PUT", f"/api/audio/uploads/{upload_uid}/chunks/{i}", content=chunk,
                                    headers={"Content-Type": "application/octet-stream"})
            if rc.status_code not in (200, 201) or not _json(rc).get("success"):
                raise KatibuError(f"Chunk {i} upload failed: {_json(rc).get('message') or rc.status_code}", "Kupakia rekodi kumeshindikana.")
            done.add(i)
            if on_chunk:
                on_chunk(len(done), count)
        rc = await self.request("POST", f"/api/audio/uploads/{upload_uid}/complete", timeout=300)
        jc = _json(rc)
        if rc.status_code not in (200, 201) or not jc.get("success"):
            raise KatibuError(f"Upload could not be completed: {jc.get('message') or rc.status_code}", "Kukamilisha upakiaji kumeshindikana.")


def _json(r: httpx.Response) -> dict[str, Any]:
    try:
        j = r.json()
        return j if isinstance(j, dict) else {}
    except ValueError:
        return {}


katibu = KatibuClient()


# ---------------------------------------------------------------------------
# Audio preparation

def _run(args: list[str], timeout: int = 180) -> subprocess.CompletedProcess[str]:
    return subprocess.run(args, capture_output=True, text=True, timeout=timeout)


def to_wav16k(src: Path, dst: Path) -> None:
    p = _run(["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-i", str(src), "-ac", "1", "-ar", "16000", "-c:a", "pcm_s16le", str(dst)])
    if p.returncode != 0 or not dst.exists():
        raise KatibuError(f"ffmpeg could not convert the recording: {p.stderr.strip()[:200]}", "Rekodi haikuweza kubadilishwa.")


def duration_s(path: Path) -> float:
    p = _run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path)])
    try:
        return float(p.stdout.strip())
    except ValueError:
        return 0.0


def mean_volume_db(path: Path) -> float:
    p = _run(["ffmpeg", "-hide_banner", "-i", str(path), "-af", "volumedetect", "-f", "null", "-"])
    m = re.search(r"mean_volume:\s*(-?[\d.]+|-inf) dB", p.stderr)
    if not m or m.group(1) == "-inf":
        return -120.0
    return float(m.group(1))


def sample_source() -> Path:
    if ASSET_SAMPLE.exists():
        return ASSET_SAMPLE
    if REFERENCE_SAMPLE.exists():
        ASSET_SAMPLE.parent.mkdir(exist_ok=True)
        shutil.copyfile(REFERENCE_SAMPLE, ASSET_SAMPLE)
        return ASSET_SAMPLE
    raise KatibuError("The sample recording is missing (backend/assets/sample_meeting.wav).", "Rekodi ya mfano haipo.")


def sample_wav16k() -> Path:
    out = DATA_DIR / "sample_meeting_16k.wav"
    if not out.exists():
        to_wav16k(sample_source(), out)
    return out


def check_live(upload: Optional[Path], wav: Path) -> tuple[str, float, float]:
    """Converts the live recording to 16 kHz WAV. Returns (problem or '', seconds, mean dB)."""
    if upload is None or not upload.exists() or upload.stat().st_size == 0:
        return "no_recording", 0.0, -120.0
    try:
        to_wav16k(upload, wav)
    except KatibuError:
        return "unreadable", 0.0, -120.0
    secs = duration_s(wav)
    if secs < MIN_LIVE_SECONDS:
        return "too_short", secs, -120.0
    db = mean_volume_db(wav)
    if db < SILENCE_DB:
        return "silent", secs, db
    return "", secs, db


def prepare_audio(stem: str, upload: Optional[Path], prefer_sample: bool, allow_sample: bool) -> tuple[Optional[Path], str, str, float]:
    """Returns (wav path or None, source 'live'|'sample', note, live seconds).

    Live mode never falls back to the sample silently: a missing, short, silent or unreadable recording
    returns (None, 'live', problem, secs) unless the user already agreed to the sample (allow_sample)."""
    if prefer_sample:
        return sample_wav16k(), "sample", "setting", 0.0
    wav = REC_DIR / f"{stem}.wav"
    problem, secs, _db = check_live(upload, wav)
    if not problem:
        return wav, "live", "", secs
    if allow_sample:
        return sample_wav16k(), "sample", problem, secs
    return None, "live", problem, secs


def waveform(wav: Path, bars: int = 120) -> list[float]:
    """Peak level per bar (0..1) of a 16-bit mono WAV, for the journey panel."""
    try:
        with wave.open(str(wav), "rb") as w:
            if w.getsampwidth() != 2:
                return []
            data = array("h", w.readframes(w.getnframes()))
    except (OSError, wave.Error, EOFError):
        return []
    if not data:
        return []
    step = max(1, len(data) // bars)
    peaks = [max(max(data[i:i + step]), -min(data[i:i + step])) for i in range(0, step * bars, step) if i < len(data)]
    top = max(peaks) or 1
    return [round(p / top, 3) for p in peaks]


def recording_info(wav: Path, source: str, note: str) -> dict[str, Any]:
    return {"source": source, "note": note, "seconds": round(duration_s(wav), 1), "bytes": wav.stat().st_size,
            "peaks": waveform(wav), "file": wav.name, "at": iso(now_utc())}


# ---------------------------------------------------------------------------
# Jobs

def job_view(j: KatibuJob) -> dict[str, Any]:
    return {
        "id": j.id, "room_id": j.room_id, "title": j.title, "scheduled_meeting_id": j.scheduled_meeting_id,
        "katibu_meeting_uid": j.katibu_meeting_uid, "audio_source": j.audio_source, "audio_note": j.audio_note,
        "status": j.status, "progress": j.progress, "stage": j.stage,
        "stage_sw": STAGE_LABELS.get(j.stage, (j.stage, j.stage))[0], "stage_en": STAGE_LABELS.get(j.stage, (j.stage, j.stage))[1],
        "error": j.error, "minutes_sw": j.minutes_sw, "minutes_en": j.minutes_en,
        "documents": [{k: d.get(k) for k in ("language", "format", "fileName", "size", "pageCount", "approved")} for d in j.documents],
        "deliveries": j.deliveries, "recipients": j.recipients,
        "created_at": iso(j.created_at), "ready_at": iso(j.ready_at), "sent_at": iso(j.sent_at),
        "processing_seconds": int((j.ready_at - j.created_at).total_seconds()) if j.ready_at else None,
        "default_recipients": default_recipients(),
        "journey": {k: ({kk: vv for kk, vv in v.items() if kk != "file"} if k == "recording" and isinstance(v, dict) else v)
                    for k, v in (j.journey or {}).items()},
    }


def _journey(job: KatibuJob, section: str, **values: Any) -> None:
    """Merges values into one section of the job's journey (reassigned so SQLAlchemy sees the change)."""
    jr = dict(job.journey or {})
    jr[section] = {**(jr.get(section) or {}), **values}
    job.journey = jr


def default_recipients() -> list[str]:
    if test_mode():
        return [r for r in [_env("KATIBU_TEST_RECIPIENT")] if r]
    return [r.strip() for r in _env("MINUTES_RECIPIENTS", "jolama0001@gmail.com").split(",") if r.strip()]


def _save(job: KatibuJob) -> KatibuJob:
    with DBSession(engine) as db:
        db.add(job)
        db.commit()
        db.refresh(job)
        return job


class JobGone(Exception):
    """The job was deleted (e.g. by a demo reset) while it was running."""


def _load(job_id: int) -> KatibuJob:
    with DBSession(engine) as db:
        j = db.get(KatibuJob, job_id)
        if j is None:
            raise JobGone(job_id)
        return j


def _progress(job: KatibuJob) -> None:
    push(job.user_id, "katibu_progress", {"job": job_view(job)})


def _fail(job: KatibuJob, en: str, sw: str) -> None:
    job.status = "failed"
    job.error = {"en": en, "sw": sw}
    _save(job)
    with DBSession(engine) as db:
        notify(db, job.user_id, "katibu_failed",
               message_sw=f"Samahani, Katibu hakuweza kuandaa kumbukumbu za {job.title}. {sw}",
               message_en=f"Sorry, Katibu could not prepare the minutes of {job.title}. {en}",
               title_sw="Kumbukumbu hazikukamilika", title_en="Minutes failed", link=f"/hub/minutes/{job.id}",
               data={"job": job_view(job)})


_tasks: set[asyncio.Task[Any]] = set()


def _spawn(coro: Any) -> None:
    t = asyncio.create_task(coro)
    _tasks.add(t)
    t.add_done_callback(_tasks.discard)


async def run_job(job_id: int, wav: Path) -> None:
    job = _load(job_id)
    try:
        with DBSession(engine) as db:
            owner = db.get(User, job.user_id)
            sm = db.get(ScheduledMeeting, job.scheduled_meeting_id) if job.scheduled_meeting_id else None
            names = [owner.display_name] if owner else []
            if sm:
                for uid in [sm.organizer_id, *sm.invitee_ids]:
                    u = db.get(User, int(uid))
                    if u and u.display_name not in names:
                        names.append(u.display_name)
        job.stage, job.progress = "UPLOADING", 2
        _save(job)
        _progress(job)
        op = await katibu.gql(Q_CREATE, {"input": {
            "title": job.title, "meetingType": "UNSTRUCTURED", "source": "UPLOAD", "spokenLanguage": "MIXED",
            "scheduledAt": iso(job.created_at), "chairName": owner.display_name if owner else "", "attendeeNames": names,
        }})
        job.katibu_meeting_uid = op["data"]["uid"]
        _journey(job, "upload", katibu_uid=job.katibu_meeting_uid, started_at=iso(now_utc()), chunks_sent=0, chunks_total=0)
        _save(job)
        _progress(job)

        def on_chunk(sent: int, total: int) -> None:
            j = _load(job_id)
            _journey(j, "upload", chunks_sent=sent, chunks_total=total)
            _save(j)
            _progress(j)

        await katibu.upload(job.katibu_meeting_uid, wav, on_chunk)
        job = _load(job_id)
        job.status, job.progress, job.stage = "processing", 5, "ASSEMBLE_AUDIO"
        _journey(job, "upload", done_at=iso(now_utc()))
        _save(job)
        _progress(job)
        await poll_job(job.id)  # type: ignore[arg-type]
    except JobGone:
        log.info("katibu job %s was deleted while running; stopping", job_id)
    except KatibuError as exc:
        try:
            _fail(_load(job_id), exc.en, exc.sw)
        except JobGone:
            pass
    except Exception as exc:  # noqa: BLE001
        log.exception("katibu job %s failed", job_id)
        try:
            _fail(_load(job_id), str(exc), "Hitilafu isiyotarajiwa.")
        except JobGone:
            pass


async def poll_job(job_id: int) -> None:
    job = _load(job_id)
    deadline = time.time() + POLL_LIMIT_SECONDS
    last = ("", -1)
    while time.time() < deadline:
        try:
            op = await katibu.gql(Q_STATUS, {"uid": job.katibu_meeting_uid})
        except KatibuError as exc:
            log.warning("status poll failed: %s", exc.en)
            await asyncio.sleep(POLL_SECONDS)
            continue
        d = op.get("data") or {}
        status, stage, progress = d.get("status"), d.get("stage") or job.stage, int(d.get("progress") or 0)
        if (stage, progress) != last:
            job = _load(job_id)
            if stage != last[0] and stage not in (job.journey.get("stages_at") or {}):
                _journey(job, "stages_at", **{stage: iso(now_utc())})
            last = (stage, progress)
            job.stage, job.progress = stage, max(5, progress)
            _journey(job, "katibu", stages=d.get("stages") or [], attempts=d.get("attempts"), job_status=d.get("jobStatus"))
            _save(job)
            _progress(job)
        if status in ("READY", "APPROVED"):
            await _on_ready(job_id)
            return
        if status == "FAILED":
            err = d.get("error") or {}
            _fail(_load(job_id), err.get("en") or "Processing failed.", err.get("sw") or "Uchakataji umeshindikana.")
            return
        await asyncio.sleep(POLL_SECONDS)
    _fail(_load(job_id), "KatibuAI did not finish within 10 minutes.", "KatibuAI haikukamilisha ndani ya dakika 10.")


async def _fetch_docs(uid: str) -> list[dict[str, Any]]:
    op = await katibu.gql(Q_DOCS, {"uid": uid})
    return op.get("dataList") or []


async def _on_ready(job_id: int) -> None:
    job = _load(job_id)
    sw = await katibu.gql(Q_MINUTES, {"uid": job.katibu_meeting_uid, "lang": "SW"})
    en = await katibu.gql(Q_MINUTES, {"uid": job.katibu_meeting_uid, "lang": "EN"})
    job.minutes_sw = (sw.get("data") or {}).get("content") or {}
    job.minutes_en = (en.get("data") or {}).get("content") or {}
    job.documents = await _fetch_docs(job.katibu_meeting_uid)
    try:
        tr = await katibu.gql(Q_TRANSCRIPT, {"uid": job.katibu_meeting_uid})
        text = ((tr.get("data") or {}).get("text") or "").strip()
        _journey(job, "transcript", excerpt=text[:1500], chars=len(text))
    except KatibuError as exc:
        _journey(job, "transcript", error=exc.en)
    _journey(job, "stages_at", DONE=iso(now_utc()))
    job.status, job.stage, job.progress, job.ready_at = "ready", "DONE", 100, now_utc()
    _save(job)
    with DBSession(engine) as db:
        notify(db, job.user_id, "katibu_ready",
               message_sw=f"Kumbukumbu za {job.title} ziko tayari. Ungependa kuziona?",
               message_en=f"The minutes of {job.title} are ready. Would you like to see them?",
               title_sw="Kumbukumbu ziko tayari", title_en="Minutes ready", link=f"/hub/minutes/{job.id}",
               data={"job": job_view(job)})


async def _poll_safely(job_id: int) -> None:
    try:
        await poll_job(job_id)
    except JobGone:
        log.info("katibu job %s was deleted while polling; stopping", job_id)


def resume_jobs() -> None:
    with DBSession(engine) as db:
        rows = list(db.exec(select(KatibuJob).where(KatibuJob.status.in_(["processing", "uploading"]))))  # type: ignore[attr-defined]
    for j in rows:
        if j.katibu_meeting_uid and j.status == "processing":
            _spawn(_poll_safely(j.id))  # type: ignore[arg-type]
        else:
            j.status, j.error = "failed", {"en": "Interrupted by a restart.", "sw": "Ilikatizwa na kuanzishwa upya kwa mfumo."}
            _save(j)


# ---------------------------------------------------------------------------
# Routes

@router.get("/status")
async def status(user: User = Depends(current_user)) -> dict[str, Any]:
    signed_in = False
    err = katibu.last_error
    if katibu.configured():
        try:
            await katibu.access_token()
            signed_in = True
        except KatibuError as exc:
            err = exc.en
    return {"configured": katibu.configured(), "signed_in": signed_in, "last_error": err, "base_url": katibu.base}


@router.post("/jobs")
async def create_job(
    room_id: str = Form(""),
    title: str = Form(""),
    scheduled_meeting_id: Optional[int] = Form(None),
    use_sample: bool = Form(False),
    allow_sample: bool = Form(False),
    audio: Optional[UploadFile] = File(None),
    user: User = Depends(current_user),
) -> Any:
    prefer_sample = use_sample or user.meeting_audio_source == "sample"
    stem = f"rec-{uuid.uuid4().hex[:12]}"
    upload_path: Optional[Path] = None
    if audio is not None:
        upload_path = REC_DIR / f"{stem}.upload"
        with upload_path.open("wb") as fh:
            while chunk := await audio.read(1024 * 1024):
                fh.write(chunk)
    try:
        wav, source, note, live_secs = await asyncio.to_thread(prepare_audio, stem, upload_path, prefer_sample, allow_sample)
    except KatibuError as exc:
        return JSONResponse({"code": "audio_error", "error": exc.en, "error_sw": exc.sw}, status_code=422)
    if wav is None:
        # The live recording can't be used: the client asks the user whether to use the sample instead.
        return JSONResponse({"code": "live_unusable", "reason": note, "seconds": round(live_secs, 1),
                             "error": f"The live recording can't be used ({note}).", "error_sw": "Rekodi halisi haiwezi kutumika."},
                            status_code=422)
    with DBSession(engine) as db:
        sm = db.get(ScheduledMeeting, scheduled_meeting_id) if scheduled_meeting_id else None
        if sm is None and room_id:
            # the user's most recent scheduled meeting in this room (today)
            cands = [m for m in db.exec(select(ScheduledMeeting).where(ScheduledMeeting.room_id == room_id))
                     if user.id in [m.organizer_id, *[int(i) for i in m.invitee_ids]]]
            cands.sort(key=lambda m: abs((m.start_at - now_utc()).total_seconds()))
            sm = cands[0] if cands else None
        job = KatibuJob(user_id=user.id, room_id=room_id, title=title or (sm.title if sm else "Kikao cha e-Mikutano"),  # type: ignore[arg-type]
                        scheduled_meeting_id=sm.id if sm else None, created_at=now_utc(), status="uploading")
        job.audio_source, job.audio_note = source, note
        db.add(job)
        db.commit()
        db.refresh(job)
    info = await asyncio.to_thread(recording_info, wav, source, note)
    if source == "live" and live_secs:
        info["seconds"] = round(live_secs, 1)
    _journey(job, "recording", **info)
    _save(job)
    _spawn(run_job(job.id, wav))  # type: ignore[arg-type]
    return job_view(job)


@router.get("/sample")
def sample_audio(user: User = Depends(current_user)) -> FileResponse:
    """The sample meeting, played aloud in the room in sample mode (the same recording goes to KatibuAI)."""
    try:
        return FileResponse(sample_wav16k(), media_type="audio/wav")
    except KatibuError as exc:
        raise HTTPException(404, {"code": "not_found", "error": exc.en, "error_sw": exc.sw})


@router.get("/jobs/{job_id}/audio")
def job_audio(job_id: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> FileResponse:
    """The exact audio file that was sent to KatibuAI (16 kHz mono WAV)."""
    j = _own_job(db, job_id, user)
    rec = (j.journey or {}).get("recording") or {}
    path = sample_wav16k() if rec.get("source") == "sample" else REC_DIR / str(rec.get("file") or "")
    if not rec or not path.is_file():
        raise HTTPException(404, {"code": "not_found", "error": "The recording is no longer available.", "error_sw": "Rekodi haipatikani tena."})
    return FileResponse(path, media_type="audio/wav")


@router.get("/jobs")
def list_jobs(db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> list[dict[str, Any]]:
    rows = db.exec(select(KatibuJob).where(KatibuJob.user_id == user.id).order_by(KatibuJob.created_at.desc()))  # type: ignore[union-attr]
    return [job_view(j) for j in rows]


def _own_job(db: DBSession, job_id: int, user: User) -> KatibuJob:
    j = db.get(KatibuJob, job_id)
    if not j or j.user_id != user.id:
        raise HTTPException(404, {"code": "not_found", "error": "Minutes job not found.", "error_sw": "Kazi ya kumbukumbu haikupatikana."})
    return j


@router.get("/jobs/{job_id}")
def get_job(job_id: int, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> dict[str, Any]:
    return job_view(_own_job(db, job_id, user))


class SendBody(BaseModel):
    recipients: Optional[list[str]] = None


def minutes_recipients(requested: Optional[list[str]], header: Optional[str]) -> list[str]:
    if test_mode(header):
        rcpt = _env("KATIBU_TEST_RECIPIENT")
        if not rcpt:
            raise HTTPException(400, {"code": "no_test_recipient", "error": "KATIBU_TEST_RECIPIENT is not set."})
        return [rcpt]
    if requested:
        return [r.strip() for r in requested if r.strip()]
    env = _env("MINUTES_RECIPIENTS", "jolama0001@gmail.com")
    return [r.strip() for r in env.split(",") if r.strip()]


def _minutes_mail_body(job: KatibuJob) -> str:
    m = job.minutes_sw or job.minutes_en or {}
    lines = [f"Kumbukumbu za kikao: {job.title}", ""]
    if m.get("summary"):
        lines += ["MUHTASARI", m["summary"], ""]
    decisions = [d.get("text", "") for d in m.get("decisions") or [] if isinstance(d, dict)]
    if decisions:
        lines += ["MAAMUZI", *[f"- {d}" for d in decisions], ""]
    actions = m.get("action_items") or []
    if actions:
        lines.append("HATUA ZA KUCHUKUA")
        for a in actions:
            extra = ", ".join(x for x in [a.get("owner") or "", a.get("due") or ""] if x)
            lines.append(f"{a.get('number', '')}. {a.get('task', '')}" + (f" ({extra})" if extra else ""))
        lines.append("")
    lines += ["Imeandaliwa na KatibuAI kwa ombi la NURU.", "Prepared by KatibuAI at NURU's request."]
    return "\n".join(lines)


async def _track_deliveries(job_id: int) -> None:
    try:
        await _track_deliveries_inner(job_id)
    except JobGone:
        pass


async def _track_deliveries_inner(job_id: int) -> None:
    for _ in range(20):
        await asyncio.sleep(3)
        job = _load(job_id)
        try:
            op = await katibu.gql(Q_DELIVERIES, {"uid": job.katibu_meeting_uid})
        except KatibuError:
            continue
        rows = op.get("dataList") or []
        job.deliveries = rows
        _save(job)
        _progress(job)
        if rows and all(r.get("status") != "QUEUED" for r in rows):
            break
    job = _load(job_id)
    try:
        job.documents = await _fetch_docs(job.katibu_meeting_uid)
        _save(job)
    except KatibuError:
        pass
    sent = sum(1 for r in job.deliveries if r.get("status") == "SENT")
    failed = sum(1 for r in job.deliveries if r.get("status") == "FAILED")
    push(job.user_id, "katibu_delivery", {"job": job_view(job), "sent": sent, "failed": failed})


@router.post("/jobs/{job_id}/send")
async def send_job(job_id: int, body: SendBody, x_nuru_test: Optional[str] = Header(default=None),
                   user: User = Depends(current_user)) -> dict[str, Any]:
    with DBSession(engine) as db:
        job = _own_job(db, job_id, user)
    if job.status not in ("ready", "sent"):
        raise HTTPException(409, {"code": "not_ready", "error": "The minutes are not ready yet.", "error_sw": "Kumbukumbu bado hazijawa tayari."})
    recipients = minutes_recipients(body.recipients, x_nuru_test)
    try:
        op = await katibu.gql(Q_SEND, {"uid": job.katibu_meeting_uid, "langs": ["SW", "EN"], "formats": ["PDF"],
                                       "rcpt": [], "extra": recipients})
    except KatibuError as exc:
        raise HTTPException(502, {"code": "katibu_error", "error": exc.en, "error_sw": exc.sw})
    job.deliveries = op.get("dataList") or []
    job.recipients = recipients
    job.status, job.sent_at = "sent", now_utc()
    _save(job)

    # GMS copies for the demo users who took part
    delivered_users: list[int] = []
    with DBSession(engine) as db:
        ids = {job.user_id}
        sm = db.get(ScheduledMeeting, job.scheduled_meeting_id) if job.scheduled_meeting_id else None
        if sm:
            ids |= {sm.organizer_id, *[int(i) for i in sm.invitee_ids]}
        body_txt = _minutes_mail_body(job)
        subject = f"Kumbukumbu za kikao: {job.title}"
        for uid in sorted(ids):
            u = db.get(User, uid)
            if not u or not u.has_account:
                continue
            mail = MailMessage(owner_id=u.id, folder="inbox", from_addr="katibu@mfano.go.tz", from_name="KatibuAI",  # type: ignore[arg-type]
                               to=[u.email], subject=subject, body=body_txt, sent_at=now_utc(), read=False, thread_id=subject)
            db.add(mail)
            db.commit()
            db.refresh(mail)
            delivered_users.append(u.id)  # type: ignore[arg-type]
            notify(db, u.id, "mail_received",  # type: ignore[arg-type]
                   message_sw=f"Umepokea barua pepe mpya kutoka kwa KatibuAI: {subject}.",
                   message_en=f"You have a new e-mail from KatibuAI: {subject}.",
                   title_sw="Barua pepe mpya", title_en="New e-mail", link=f"/gms/inbox/{mail.id}",
                   data={"mail_id": mail.id, "from_name": "KatibuAI", "subject": subject}, announce=u.id != user.id)
        owner = db.get(User, job.user_id)
        n = len(recipients)
        fn = first_name(owner.display_name) if owner else ""
        notify(db, job.user_id, "katibu_sent",
               message_sw=f"{fn}, Katibu ametuma kumbukumbu za {job.title} kwa wapokeaji {n}.",
               message_en=f"{fn}, Katibu has sent the minutes of {job.title} to {n} recipients.",
               title_sw="Kumbukumbu zimetumwa", title_en="Minutes sent", link=f"/hub/minutes/{job.id}",
               data={"job": job_view(job), "gms_users": delivered_users}, announce=False)
    _spawn(_track_deliveries(job.id))  # type: ignore[arg-type]
    return {**job_view(job), "gms_users": delivered_users}


@router.get("/jobs/{job_id}/documents/{lang}/{fmt}")
async def document(job_id: int, lang: str, fmt: str, db: DBSession = Depends(get_db), user: User = Depends(current_user)) -> Response:
    job = _own_job(db, job_id, user)
    doc = next((d for d in job.documents if str(d.get("language")).upper() == lang.upper() and str(d.get("format")).upper() == fmt.upper()), None)
    if not doc or not doc.get("downloadUrl"):
        raise HTTPException(404, {"code": "not_found", "error": "Document not available.", "error_sw": "Nyaraka haipatikani."})
    try:
        r = await katibu.request("GET", doc["downloadUrl"], timeout=120)
    except KatibuError as exc:
        raise HTTPException(502, {"code": "katibu_error", "error": exc.en, "error_sw": exc.sw})
    if r.status_code != 200:
        raise HTTPException(502, {"code": "katibu_error", "error": f"KatibuAI returned HTTP {r.status_code} for the document."})
    media = "application/pdf" if fmt.upper() == "PDF" else "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    name = doc.get("fileName") or f"minutes_{lang}.{fmt.lower()}"
    return Response(content=r.content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{name}"'})
