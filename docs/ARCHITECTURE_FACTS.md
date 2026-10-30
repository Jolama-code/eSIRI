# NURU v2 — architecture facts (from the code)

Written from the source on branch `feature/v2.1` (commit `2aaedc9`), 30 Oct 2026, for the architecture diagram
(`docs/architecture/nuru-architecture.html`). Every statement cites the file it comes from. Anything not visible in
NURU's code is marked **unverified** or **(KatibuAI docs)**; the diagram uses only facts from this file.

## 1. Components and where they run

| Component | Runs where | Port | Source |
|---|---|---|---|
| NURU web app (one React app: Hub, e-Mikutano, GMS, WERIS + the NURU overlay) | The user's browser (Google Chrome), laptop or phone; installable PWA | served on **5173** (Vite dev server, or `vite preview` with `--share`) | `frontend/src/App.tsx`, `start.sh`, `frontend/vite.config.ts` |
| Vite server | The presentation laptop | 5173; proxies `/api` → `http://localhost:8010` without buffering event streams | `frontend/vite.config.ts` |
| NURU backend (FastAPI + uvicorn) | The presentation laptop, bound to `127.0.0.1` | **8010** | `start.sh`, `backend/app/main.py` |
| NURU database (SQLite file) | Same laptop, `backend/data/nuru.db` (`NURU_DB` overrides; tests use `test.db`) | — | `backend/app/core.py` |
| KatibuAI backend (the real system) | Runs separately (`KATIBU_BASE_URL`, default `http://localhost:8000`) | **8000** | `backend/app/katibu.py` |
| OpenAI API | Internet | HTTPS | `backend/app/llm.py`, `tts.py` |
| Google speech recognition | Internet, used by Chrome's Web Speech API | — | **unverified in NURU code** (Chrome behaviour; NURU only calls `webkitSpeechRecognition`) |
| Cloudflare quick tunnel (optional, `./start.sh --share`) | `cloudflared` on the laptop → Cloudflare edge; gives phones an HTTPS URL to port 5173 | HTTPS | `start.sh` |

Network path: browser → `:5173` (Vite) → `/api/*` proxied to `127.0.0.1:8010`. Phones use the HTTPS tunnel URL
(Cloudflare) → `:5173` → `:8010`. Only one HTTP origin is visible to the browser.

## 2. Frontend (browser)

**Routes / systems** (`frontend/src/App.tsx`): `/hub/*` NURU Hub (Today, Tasks, Meetings, Minutes, Notifications,
Systems, Activity, Settings, Login); `/`, `/rooms/*`, `/recordings`, `/audit` e-Mikutano; `/gms/*` GMS (mailbox,
compose); `/weris/*` WERIS (dashboard, projects, PDP, tasks, reports, individual report). One sign-in for all four.
e-Mikutano, GMS and WERIS are front-end mock-ups ("test copies") with fictional people at `@mfano.go.tz`.

**NURU overlay** (`esiri/ui/EsiriRoot.tsx`, `NuruOverlays.tsx`, `Orb.tsx`, `Panel.tsx`): the orb, the chat panel,
reminder cards, toasts, the "tap to start" unlock overlay, the briefing and the demo panel, on every route.

**Agent driver** (`esiri/controller.ts` `runLoop`, `esiri/driver.ts`, `esiri/snapshot.ts`):
- `buildSnapshot()` returns `{system, page, route, language, user{name, role, username, id}, open_modal, toasts,
  state, elements}`. `state` is per system (rooms, meetings, minutes summaries, mail list and opened e-mail, WERIS
  tasks and report items, open reminders). `elements` = every visible element with a `data-esiri-id`: id, role,
  label (max 80 chars), state, value (inputs 160 chars, textareas 1500), select options (max 30), disabled, sensitive.
- **Excluded from the snapshot:** elements inside the NURU panel (`.esiri-panel`), the toast close button, hidden
  elements, everything behind an open modal (only the modal is scanned), duplicate ids, and password fields (the login
  password inputs carry no `data-esiri-id`: `hub/Login.tsx`, `gms/Gms.tsx`). No tokens are put in the snapshot.
- The driver executes `click`, `typeText`, `selectOption`, `navigate`. Driver functions return `{ok:false, code,
  error}` instead of throwing; codes `not_found`, `disabled`, `confirmation_required`, `not_editable`, `invalid`.

**Ghost cursor** (`esiri/cursor.ts`): a fixed-position SVG pointer with a "NURU" bubble, a highlight ring and a
click ripple, animated with `requestAnimationFrame` (500–700 ms per move). Pure DOM.

**Speech in** (`esiri/stt.ts`): the browser Web Speech API (`SpeechRecognition` / `webkitSpeechRecognition`),
`sw-TZ` for Swahili and `en-US` for English, interim results on; one-shot listening for a request, and an optional
continuous wake-word mode ("Nuru"). One recognizer at a time.

**Speech out** (`esiri/tts.ts`): `speak()` fetches MP3 from `POST /api/tts` (OpenAI) for Swahili, and for English
when `ESIRI_ENGLISH_TTS=openai` (default); the browser `speechSynthesis` voice is the fallback (English only — no
Swahili browser voice means text only). `speak()` always resolves (timeout = estimated length + 3 s, + 8 s for the
network). Playback through an `<audio>` element drives the orb's level meter.

**Meeting recorder** (`esiri/meetingFlow.ts`): live mode records the meeting with `MediaRecorder` (Opus in WebM) on
its own microphone stream (echo cancellation, noise suppression); on stop it uploads the blob as `multipart/form-data`
to `POST /api/katibu/jobs`. Sample mode plays the sample recording aloud from `GET /api/katibu/sample`.

**Live captions** (`esiri/captions.ts`): Web Speech (`sw-TZ` / `en-US`) shown in the meeting; they pause while NURU
itself listens and never touch the recorder.

**Live-event client** (`esiri/events.ts`): one `EventSource` per signed-in device on `GET /api/events?token=…`
(SSE). If no `hello` arrives within 5 s (a tunnel buffering the stream), it switches to long-polling
`GET /api/events/poll?after=<seq>` (each request waits up to 20 s). Event types listed in §3.

**Browser storage:**
- `localStorage`: `nuru-token`, `nuru-user` (`esiri/session.ts`); `emikutano-store` (zustand persist: language,
  rooms, recordings, e-Mikutano meetings, **audit records (max 500)**, wake mode; `store/appStore.ts`);
  `nuru-unlocked-v1` (`proactive.ts`); a "briefing seen" key per day (`briefing.ts`).
- `sessionStorage`: `esiri-mute` (`tts.ts`), `nuru-meeting-links` (room → scheduled meeting, `meetingFlow.ts`),
  a greeting-shown flag (`EsiriRoot.tsx`).
- e-Mikutano rooms and recordings live **only in the browser** (`emikutano-store`); scheduled meetings are on the server.

## 3. Backend (FastAPI on :8010)

**Route groups** (`main.py`, `api_hub.py`, `api_mail.py`, `api_weris.py`, `katibu.py`):

| Group | Type | Examples |
|---|---|---|
| Agent | REST (JSON) | `POST /api/agent/step`, `POST /api/agent/reset` |
| Speech | REST → binary MP3 | `POST /api/tts` |
| Health | REST | `GET /api/health` (only `has_key`, model, TTS mode) |
| Auth & profile | REST | `POST /api/auth/login`, `/api/auth/logout`, `GET/PATCH /api/me`, `GET /api/users` |
| Day & briefing | REST | `GET /api/day`, `POST/PATCH/DELETE /api/day/items…`, `POST /api/briefing/parse`, `POST /api/briefing/save` |
| Meetings, tasks, reminders | REST | `/api/meetings`, `/api/tasks`, `/api/reminders/{id}/snooze|dismiss` |
| Notifications & audit | REST | `/api/notifications…`, `POST/GET /api/audit` |
| Live events | **SSE** + long-poll | `GET /api/events`, `GET /api/events/poll` |
| GMS (mail mock) | REST | `GET /api/mail`, `POST /api/mail/drafts`, `POST /api/mail/send` |
| WERIS mock | REST | `/api/weris/dashboard`, `/projects`, `/pdp`, `/reports/current` (GET/PUT), `POST /api/weris/reports/current/fill` |
| KatibuAI link | **multipart upload**, REST, **proxy download** | `POST /api/katibu/jobs` (audio), `GET /api/katibu/jobs/{id}`, `POST /api/katibu/jobs/{id}/send`, `GET /api/katibu/jobs/{id}/documents/{lang}/{fmt}` (proxied PDF/DOCX), `GET /api/katibu/sample`, `GET /api/katibu/status` |
| Demo controls | REST | `/api/demo/reset`, `/meeting-soon`, `/fire-next-reminder`, `/briefing-prompt` |

All routes except `/api/health` and login need a Bearer session (`core.current_user`); the event stream and poll take
the token as a `?token=` query parameter (`core.user_from_query`).

**Agent orchestrator** (`main.py` `step`, `agent.py`): the system prompt (`SYSTEM_PROMPT`) + the app map
(`app_map.md`, every page and element id, sensitive ones marked ⚠) + signed-in user + today's date + language. Model
`OPENAI_MODEL` (default **gpt-4.1-mini**), `temperature 0.2`, `parallel_tool_calls`, OpenAI Chat Completions with
function tools. Memory: in RAM per `user.id:session_id`, the last **12** user turns; only the newest snapshot is sent
in full (older ones become "[old snapshot omitted]"). Swahili clock phrases in a request are converted in code
(`llm.time_notes`) and appended to the user message; existing room names are appended too. The backend returns
`{tool_calls, text}`; the browser executes them and posts `{tool_results}` + a fresh snapshot.

**Agent tools** (`agent.py` `TOOLS`, 17):
- `click` — click an element with the visible cursor.
- `type_text` — clear a field and type text.
- `select_option` — choose an option in a select list.
- `navigate` — jump to a page when there is no visible way to click there.
- `ask_confirmation` — ask the user to approve sensitive actions (`covers` = how many).
- `ask_user` — one clarifying question; ends the turn.
- `set_language` — switch UI, speech and replies to en/sw.
- `moderator_mode` — NURU runs the meeting lobby (on is sensitive).
- `schedule_reminder` — add an item with a spoken reminder to the user's day.
- `update_task_status` — set the status of the user's own WERIS task.
- `weris_report` — status / fill the weekly report (one structured call).
- `katibu_prepare_minutes` — ask KatibuAI to prepare minutes from the recording.
- `katibu_status` — progress of the latest minutes jobs.
- `katibu_open_minutes` — open minutes in the Hub.
- `katibu_send_minutes` — approve and e-mail the minutes through KatibuAI (sensitive).
- `finish` — speak the final reply and end the task.

**Sensitive actions** (`agent.py` SYSTEM_PROMPT, `app_map.md` ⚠, `driver.ts`, `controller.ts`): create room;
start/join/leave a meeting (also `navigate` to `meeting`, `hub.item.*.start`, `hub.meeting.*.open`); start/stop
recording; remove access; delete room or recording; clear the audit log; `gms.compose.send`; `weris.task.submit`
when the assignee is not the user; `weris.report.submit`; `send-minutes.confirm`; tools `katibu_send_minutes` and
`moderator_mode(enabled)`.

**Where the confirmation gate is enforced: in the browser only.** `driver.ts` refuses a click on an element with
`data-esiri-sensitive="true"` (and `navigate` into a meeting) unless `task.credits > 0`, returning
`confirmation_required`; the executors of `katibu_send_minutes` and `moderator_mode(enabled)` in `controller.ts`
check credits too. Credits are added only in `controller.ts` (a "yes" to `ask_confirmation`, or a reminder answered
with an explicit yes). The backend has no confirmation check (a grep of `backend/app` finds none); human clicks are
not gated. Known gap (CLAUDE.md): client-side, credits not bound to a specific element.

**Briefing parser** (`api_hub.py` `briefing_parse`): one OpenAI call with a strict JSON schema (`timetable`) turns the
spoken day into items; each item's `spoken_time` (the user's own words) is converted in code by
`llm.parse_spoken_time` (Swahili clock: "saa N" = (N + 6) mod 12, period word picks the half of the day).
`POST /api/briefing/save` stores the items (only after the user's yes in the briefing flow).

**Scheduler** (`services.scheduler_loop`): every **10 s** fires due reminders (meetings: the user's lead time;
tasks: 30 min before due; day items: lead time), each once, as a `reminder` event.

**Event hub** (`core.Broker`, `services.notify` / `push`): in memory; one queue per connected device, and
`publish(user_id, …)` puts the event on **every** queue of that user (fan-out to all their sessions/devices); also a
200-event history per user for long-polling. `notify` also stores a `Notification` row. Event types:
`reminder`, `reminder_closed`, `task_assigned`, `task_updated`, `mail_received`, `katibu_progress`, `katibu_ready`,
`katibu_sent`, `katibu_failed`, `katibu_delivery`, `weris_report`, `day_updated`, `briefing_prompt`, `demo_reset`
(+ `hello` on connect; the client also lists `notification`). Events carry `message_sw` and `message_en`; the client
announces them through `proactive.announce` (a queue that waits for the agent to be idle). History is lost on restart.

**Weekly report fill** (`api_weris.py` `fill_report`, `esiri/werisReport.ts`): `POST /api/weris/reports/current/fill`
makes **one** OpenAI call with a strict JSON schema (`weekly_report`) using the items, last week's promises and this
week's real data (tasks, PDP, NURU activity); text always English. Nothing is saved by the call: the browser types
the result into the cards with the ghost cursor and clicks Save Draft (`PUT /api/weris/reports/current`). Submit
(`weris.report.submit`) is sensitive; on submit the server notifies the supervisor (`weris_report` event).

**ffmpeg** (`katibu.py`): the uploaded recording is converted to 16 kHz mono PCM WAV (`ffmpeg -ac 1 -ar 16000`);
`ffprobe` measures duration; `volumedetect` measures loudness. Live audio shorter than 20 s, silent (< −50 dB),
missing or unreadable is refused with `live_unusable` (no silent fallback).

**Audit log**: every agent task ends in exactly one record (`controller.finalizeTask`; non-agent flows use
`logActivity`): request, steps, confirmations, outcome (Completed / Declined / Failed / Cancelled), duration. Stored in
`localStorage` (`emikutano-store`, max 500) and on the server (`POST /api/audit` → table `AuditRecord`), shown in
Hub → Activity.

**Database** (`core.py`, `models.py`): SQLite via SQLModel/SQLAlchemy, file `backend/data/nuru.db`; naive UTC
storage. Tables: `User`, `Session`, `ScheduledMeeting`, `ScheduleItem`, `Reminder`, `Task`, `Notification`,
`MailMessage`, `Project`, `PdpEntry`, `WeeklyReport`, `KatibuJob`, `AuditRecord`.

**Auth** (`core.py`): bcrypt password hashes; login creates a `Session` row with a random 32-byte URL-safe token,
valid 7 days; sent as `Authorization: Bearer`.

## 4. KatibuAI integration, step by step (`backend/app/katibu.py`)

1. Browser uploads the meeting audio (`multipart/form-data`, `POST /api/katibu/jobs`) or asks for the sample.
2. Backend converts it with ffmpeg to 16 kHz mono WAV and checks length and loudness (§3). Live never falls back to
   the sample silently: `live_unusable` → NURU asks the user; only with `allow_sample`/`use_sample` is the sample used.
   In sample mode the sample is also played aloud in the room.
3. A `KatibuJob` row is created; the job runs in a background task.
4. **Auth:** OAuth2 **password grant** at `POST {KATIBU_BASE_URL}/oauth2/access_token` (`client_id` default
   `katibuai-android`), refresh-token grant before expiry; every call carries `Authorization: Bearer`.
5. **GraphQL** at `POST /graphql`; success means envelope `code 9001`. Operations used: `createMeeting`
   (UNSTRUCTURED, UPLOAD, MIXED; title, chair and attendee names), `getProcessingStatus`, `getMeetingMinutes`
   (SW and EN), `getMeetingDocuments`, `exportMeetingTranscript`, `approveAndSendMinutes`, `getMeetingDeliveries`.
6. **Chunked upload** (REST): `POST /api/audio/uploads/` (meeting uid, size, SHA-256) → `PUT
   /api/audio/uploads/{uid}/chunks/{i}` for each chunk (chunk size set by KatibuAI; resumes received chunks) →
   `POST /api/audio/uploads/{uid}/complete`. Each chunk pushes a `katibu_progress` event.
7. **Polling:** `getProcessingStatus` every **3 s**, timeout **10 min**; each stage/progress change → `katibu_progress`
   event to the Hub (stages ASSEMBLE_AUDIO, TRANSCRIBE, IDENTIFY_SPEAKERS, ALIGN_AGENDA, WRITE_MINUTES,
   TRANSLATE_MINUTES, RENDER_DOCUMENTS, DONE).
8. On READY: minutes fetched in **Swahili and English**, the document list and a transcript excerpt; `katibu_ready`
   event ("The minutes … are ready. Would you like to see them?"). On failure: `katibu_failed`.
9. **Send** (sensitive, after the user's yes): `POST /api/katibu/jobs/{id}/send` → `approveAndSendMinutes` (SW + EN,
   PDF, recipients as `extraEmails` = `MINUTES_RECIPIENTS`, or `KATIBU_TEST_RECIPIENT` in test mode). KatibuAI e-mails
   the PDFs. Delivery status is then polled every 3 s (up to 20 times) → `katibu_delivery` event.
10. **GMS copy:** the backend drops a copy of the minutes (text) into the GMS inbox of each participant with a demo
    account (from `katibu@mfano.go.tz`) and sends `mail_received` events; the owner gets `katibu_sent`.
11. PDF/DOCX downloads in the Hub are proxied by the backend from KatibuAI's `downloadUrl` (Bearer GET).
12. Unfinished jobs are resumed (polling) after a backend restart (`resume_jobs`).

## 5. External calls

| To | What | Model / API | Source |
|---|---|---|---|
| OpenAI | Agent step: system prompt + app map + user name/e-mail + request + screen snapshot | Chat Completions, `gpt-4.1-mini` (`OPENAI_MODEL`), function tools | `main.py`, `agent.py` |
| OpenAI | Speech audio for NURU's replies and announcements | `gpt-4o-mini-tts` (`OPENAI_TTS_MODEL`), voice `coral`; retry with `tts-1` | `tts.py` |
| OpenAI | Briefing parse (spoken day → timetable) | same chat model, strict JSON schema | `api_hub.py` |
| OpenAI | Weekly report fill (one call) | same chat model, strict JSON schema | `api_weris.py` |
| Google (via Chrome) | Microphone audio for speech recognition (requests, wake word, live captions) | Web Speech API | `stt.ts`, `captions.ts`; that Chrome sends audio to Google's servers is **unverified in NURU code** (Chrome's documented behaviour) |
| KatibuAI | Meeting audio (16 kHz WAV), title, chair and attendee names; later the send request with recipient e-mails | OAuth2 + GraphQL + chunked REST upload | `katibu.py` |
| Cloudflare (only with `--share`) | All app traffic of phones, over HTTPS | quick tunnel | `start.sh` |

**KatibuAI's own services (KatibuAI docs only — `../KATIBU-AI/INTEGRATION_GUIDE.md`, `katibuAI-backend/README.md`;
not checked in its code, not modified):** Django + GraphQL + REST on :8000; **Celery** worker and beat run the
processing pipeline; **PostgreSQL 16** stores all data; **Redis 7** is the Celery broker, cache and Channels layer;
hosted AI engines — **Google Gemini** by default for transcription and minutes, falling back to OpenAI, then Groq;
documents built with python-docx and converted to **PDF** by LibreOffice (or Gotenberg); **e-mail** through SMTP
(the local setup uses real SMTP).

## 6. What data leaves the machine, and the safeguards

**Leaves the machine:**
- **To OpenAI:** the user's typed/spoken request text, the screen snapshot (visible labels and field values — e.g.
  e-mail subjects and bodies being read or drafted, task titles, room names and tokens), the user's name and e-mail
  in the system prompt, conversation history (12 turns); every sentence NURU speaks (TTS); the briefing transcript;
  the weekly-report items plus this week's tasks, PDP entries and NURU activity requests.
- **To Google (via Chrome):** microphone audio while NURU listens or captions run (**unverified in NURU code**).
- **To KatibuAI:** the meeting recording, meeting title, chair and attendee names, and recipient e-mail addresses.
  KatibuAI then sends the audio to its AI engine (Gemini by default) and e-mails the minutes (KatibuAI docs).
- **To Cloudflare:** everything a phone sends, when the HTTPS tunnel is used.
- Not sent anywhere: passwords (not in snapshots; bcrypt on the server), session tokens, the OpenAI key and the
  Katibu password (`/api/health` exposes only `has_key`).

**Safeguards:**
- **Bearer sessions** — every API call (except health and login) needs a valid session token (7 days); events use
  the token in the query string.
- **Confirmation gate** — sensitive actions need an approved `ask_confirmation`; enforced **in the browser** (driver
  + tool executors), not on the server.
- **E-mail domain block** — GMS `POST /api/mail/send` refuses any address not ending in `@mfano.go.tz`
  (`external_recipient`). (Minutes e-mailed by KatibuAI go to `MINUTES_RECIPIENTS`, or only to
  `KATIBU_TEST_RECIPIENT` in test mode.)
- **Audit log** — one record per task in the browser and on the server (`AuditRecord`), visible in Hub → Activity.

## 7. Not used in the diagram (unverified or out of scope)

- Exact Google endpoint and retention for Chrome speech recognition (Chrome behaviour, not NURU code).
- KatibuAI internals beyond its docs (exact Gemini model names, worker counts, retry policy).
- `TTS_PROVIDER=chatterbox` (a stub, not implemented).
- e-Mikutano video/audio between participants (the meeting screen is a mock-up; the moderator lobby is simulated).
