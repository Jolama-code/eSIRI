# NURU v2 — a personal AI assistant for every official

**NURU** (spoken "Nuru"; internal code name *eSiri*) is an AI assistant built by **e-Government Authority (e-GA), Tanzania**. Each official signs in to their own NURU, on a laptop or a phone. NURU plans their day, reminds them aloud before meetings and deadlines, starts and moderates their e-Mikutano meetings, asks **KatibuAI** to prepare the minutes, drafts and sends e-mails in GMS, and shares tasks between supervisors and staff in WERIS. It works in **Swahili (default) and English**, by voice or typing. It operates each system **visibly**, with its own cursor, **asks before anything consequential (enforced in code)**, and records every task in an activity log.

> **Demo build.** e-Mikutano, GMS and WERIS are front-end **mockups** with fictional people (domain `mfano.go.tz`). KatibuAI is the **real** eGA backend. Internal identifiers still use `esiri` (`frontend/src/esiri/`, `data-esiri-*`, test ids). Private repository: do not share outside the team.

**Rehearsal and stage:** see [`docs/DEMO_SCRIPT.md`](docs/DEMO_SCRIPT.md).

---

## What it does

| | |
|---|---|
| **NURU Hub** (`/hub`, installable app) | Today (greeting, animated orb, timeline with a live "now" marker), Tasks, Meetings, Minutes, Notifications, Systems, Activity, Settings |
| **Accounts** | Three demo accounts with server-side data shared across devices; one sign-in opens every system (single sign-on) |
| **Proactive reminders** | Spoken on every signed-in device before meetings, tasks and plan items; answer by voice or tap; snooze; the first device to answer closes the card on the others |
| **Morning briefing** | Describe your day aloud; NURU turns it into an ordered timetable (Swahili clock times converted in code), shows clashes, and saves it after a "ndiyo" |
| **Moderator mode** | From a reminder: "Ndiyo, anza kama msimamizi na uninyamazishe" — NURU starts the meeting, mutes you, admits people from the waiting room visibly and announces each one, then summarises when you say "Nimerudi" |
| **KatibuAI minutes** | When a meeting ends NURU offers to ask Katibu; the live recording (or the sample recording) goes to the real KatibuAI; minutes appear in the Hub ("Imeandaliwa na KatibuAI"); sent only after your approval, and copied into the participants' GMS inboxes |
| **GMS** (`/gms`) | NURU replies to an e-mail or writes one from an idea, using only the facts given, reads it back, accepts changes ("ifanye rasmi zaidi"), and sends only after "ndiyo"; delivery between demo users is live |
| **WERIS** (`/weris`) | Dashboard, projects, PDP, special tasks, weekly reports. A supervisor's NURU assigns a task; the staff member's NURU announces it within seconds; progress flows back |
| **NURU everywhere** | The orb sits at the top of a floating button stack on the right edge of e-Mikutano, GMS and WERIS (like huduma.serikali.go.tz); Alt+S or the orb opens the side panel |

---

## Requirements

- Ubuntu (or another Linux/macOS), **Python 3.10+**, **Node.js 18+**, **ffmpeg** (`sudo apt install ffmpeg`).
- **Google Chrome** (voice input uses Chrome's Web Speech API; Chromium's does not work). Android Chrome on phones.
- An **OpenAI API key** (agent, briefing parser, speech).
- **KatibuAI** running locally (default `http://localhost:8000`) with a KatibuAI user account.
- For phones: `cloudflared` (HTTPS tunnel) and optionally `qrencode` (QR code in the terminal).

## Setup

```bash
cp .env.example .env     # then fill in the values below
./start.sh               # first run installs everything; backend :8010, frontend :5173
```

Open **http://localhost:5173/hub** in Google Chrome. `Ctrl+C` stops everything.

**Start KatibuAI first** (in its own folder: `make demo`, port 8000). NURU starts without it, but minutes will fail until it is up.

### `.env`

| Variable | Meaning |
|---|---|
| `OPENAI_API_KEY` | Required. Never commit or print it. |
| `OPENAI_MODEL` | Default `gpt-4.1-mini` |
| `OPENAI_TTS_MODEL`, `OPENAI_TTS_VOICE` | Default `gpt-4o-mini-tts`, voice `coral` (one voice for Swahili and English) |
| `TTS_PROVIDER` | `openai` (default). `chatterbox` is a documented stub for later; it falls back to OpenAI |
| `ESIRI_ENGLISH_TTS` | `openai` (default) or `browser` |
| `NURU_TZ` | `Africa/Dar_es_Salaam` |
| `MINUTES_RECIPIENTS` | Comma-separated addresses that approved minutes are e-mailed to (e.g. `jolama0001@gmail.com`) |
| `KATIBU_BASE_URL`, `KATIBU_CLIENT_ID`, `KATIBU_USERNAME`, `KATIBU_PASSWORD` | KatibuAI connection (password grant, client `katibuai-android`) |
| `KATIBU_TEST_RECIPIENT` | The only address automated tests ever send minutes to |
| `NURU_DB` | Optional SQLite path (default `backend/data/nuru.db`, git-ignored) |
| `NURU_TEST_MODE` | Set by Playwright; forces Katibu e-mails to `KATIBU_TEST_RECIPIENT` |

The database is created and seeded on first start. The sample meeting recording (`backend/assets/sample_meeting.wav`, git-ignored) is copied from `reference/nuru-v2/sample-meeting.wav` by `start.sh`.

## Demo accounts

| Username | Person | Role |
|---|---|---|
| `jolama` | Jolama, Afisa TEHAMA (ICT Officer) | staff (supervisor: Dkt. Halima) |
| `halima` | Dkt. Halima Said, Msimamizi wa Idara (Head of Section) | supervisor |
| `baraka` | Baraka Mollel, Afisa Mifumo (Systems Officer) | staff |

Password for all three: **`Demo@2026`** — demo only. Other people in the directory (Neema Mwakalinga, Juma Hassan, Zawadi Kimaro, the ICT team, the helpdesk) have no accounts. All people and addresses are fictional.

## Phones and other laptops

One laptop is the server: it runs NURU (frontend and backend) and KatibuAI.

```bash
./start.sh --share
```

This also starts a **Cloudflare quick tunnel** and prints an `https://…trycloudflare.com/hub` URL with a **QR code**. On each phone or laptop:

1. Scan the QR code (or type the URL) in **Chrome**.
2. Sign in as a demo user (several devices may share one account: reminders arrive on all of them).
3. Tap **Gusa ili kuanza** (Tap to start). It unlocks audio, asks for the microphone and notifications, and NURU greets you. Without this tap, phones stay silent.
4. Optional: **Mipangilio → Sakinisha programu** (Install app) or the browser's "Add to Home screen".

HTTPS through the tunnel is what lets phones use the microphone, notifications and the installable app. The tunnel URL changes every time `--share` starts. If `cloudflared` is missing, the script prints the install commands and carries on without sharing.

## Demo controls (for the presenter)

Open with **Ctrl+Shift+D** on a laptop, or **tap the NURU logo 5 times** on a phone. Never shown otherwise.

- **Mkutano baada ya dakika 2** — a meeting starting in 2 minutes (its reminder fires at once).
- **Toa kikumbusho kinachofuata sasa** — fire the next reminder now.
- **Anzisha mpango wa asubuhi** — start the morning briefing.
- **Rejesha data ya onyesho** — reset all demo data (server and this device), after a confirmation.
- Meeting audio for Katibu: **live microphone** or **sample recording**.
- KatibuAI connection status and last error.

## Using NURU

- **Talk:** click the orb (or Alt+S), speak, or type in the panel. Esc, the Stop button or "simama"/"stop" cancels at once.
- **Consent:** NURU asks before creating rooms, starting/joining/leaving meetings, recording, removing access, deleting, sending e-mail, assigning someone else a task, turning moderator mode on, and sending minutes. The app refuses those actions in code without a "yes". Drafting, saving drafts, opening pages and your own reminders never need confirmation.
- **Reminders:** answer the card by voice ("ndiyo", "baadaye", "hapana", or a full instruction) or with its buttons.
- Useful requests: "Nikumbushe kumpigia Mkurugenzi saa nane mchana", "Jibu barua ya Dkt. Halima…", "Mpe Jolama kazi ya…", "Mwambie Dkt. Halima nimemaliza…", "Zitume kumbukumbu kwa washiriki".

## Tests

```bash
cd frontend
npm run build               # tsc -b && vite build, zero errors
npm run test:e2e:nollm      # everything except @llm and @katibu
npm run test:e2e:llm        # agent scenarios (original 8 + v2 8 + demo script), needs OPENAI_API_KEY
npm run test:e2e:katibu     # real KatibuAI with the sample recording; sends ONLY to KATIBU_TEST_RECIPIENT
npx playwright test --project=mobile   # Hub on a Pixel 7
```

Playwright starts the backend on 8010 in test mode with its own database (`backend/data/test.db`) if it is not already running. Measured: KatibuAI prepared minutes for the 2-minute sample in **59 seconds**.

## Troubleshooting

| Problem | Fix |
|---|---|
| The tunnel prints no URL | Check the internet connection; run `cloudflared tunnel --url http://localhost:5173` by hand to see its error; restart `./start.sh --share` |
| Phone microphone does nothing | Use Chrome; open the site through the **https** tunnel URL (not the LAN IP); allow the microphone (lock icon → Permissions); tap **Gusa ili kuanza** again |
| No sound | Tap **Gusa ili kuanza** (open `/hub?unlock=1` to show it again); check volume and silent mode; check that **Sauti ya Nuru** is on in Settings |
| "KatibuAI haijaunganishwa" / minutes fail | Start KatibuAI (`make demo`); check `KATIBU_*` in `.env`; the demo panel shows the last error |
| Minutes used the sample recording | The live recording was under 20 s, silent or missing (the Hub says why); switch the source in Settings |
| A device stops receiving announcements | Reload: it reconnects to the event stream and restores open reminders |
| Banner "OpenAI API key is missing" | Add `OPENAI_API_KEY` to `.env` and restart |

## Privacy (what leaves the server)

- **OpenAI:** every agent step sends a compact screen snapshot — including the opened e-mail text (up to 2,000 characters), list rows, form values, the day's items and the signed-in user's name and role. Briefing transcripts. Text that NURU speaks (text-to-speech). Never passwords or tokens.
- **Google:** speech recognition in Chrome sends the microphone audio while NURU is listening.
- **KatibuAI:** the meeting audio (live recording or sample), which KatibuAI sends to Google Gemini for transcription and minutes. The live microphone records the room, **including NURU's own voice**.
- Stored locally on the server: the SQLite database (`backend/data/`) and uploaded recordings (`backend/data/recordings/`), both git-ignored.

## Architecture

```
Browser (Hub · e-Mikutano · GMS · WERIS, one React app)          FastAPI backend :8010                KatibuAI :8000
  NURU overlay: orb, panel, ghost cursor, agent loop  ── /api/agent/step ──► OpenAI tool calling
  proactive: reminders, announcements, briefing        ◄── SSE /api/events ── scheduler (10 s), notifications
  speech: Web Speech (in), /api/tts (out)               ── /api/* (bearer) ─► SQLite: users, day, meetings,
  MediaRecorder (meeting audio)                         ── /api/katibu/jobs ─► ffmpeg → upload ─────────────► GraphQL + audio API
```

Details, traces and decisions: [`docs/CODEMAP.md`](docs/CODEMAP.md). AI-assistant briefing: [`CLAUDE.md`](CLAUDE.md).

## Known limitations

- The mock systems were built with `data-esiri-*` tags for the agent; real systems will not have them.
- The confirmation gate runs in the browser: strong against the AI, but not a server-side security control.
- Moderator mode's waiting room is simulated; the e-Mikutano mock has no real video server.
- Needs the internet (OpenAI, Google speech, Gemini via KatibuAI). Voice input needs Google Chrome.
- Each agent step takes about 2–3 seconds (one AI call plus the visible cursor), so a five-step e-mail reply takes 15–25 seconds.
