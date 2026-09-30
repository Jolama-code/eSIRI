# eSiri × e-Mikutano — Code Map

> **Rename note (2026-09-30).** The assistant was renamed from **eSiri** to **NURU** in everything a user sees (spoken as "Nuru"; wake word "Nuru"/"Noor"/"Nooru", deliberately not "new room"), and the signed-in user from **Rahma Mbuyu** to **Jolama** (initials JO, seed room "Jolama's Room", id `jolamas-room-r7k2`, token `JLM-7K2Q`). Internal identifiers keep "esiri" (`frontend/src/esiri/`, `data-esiri-*`, CSS classes, `data-testid`s, localStorage keys). The rest of this document was written before the rename and still uses the old names; the captured snapshots and traces are unchanged historical records.

This document describes what is built in this repository today. Every claim points to a file and a function or component. Where something is uncertain or not verified, it says so. The real snapshots and model trace in sections 9 and 10 were captured from the running app on 2026-09-29 with the project's `.env` key and model `gpt-4.1-mini`.

Paths are relative to the project root. `frontend/src/…` is the browser app, `backend/app/…` is the Python server.

---

## Contents

1. [Summary](#1-summary)
2. [How to run it, and environment variables](#2-how-to-run-it-and-environment-variables)
3. [Directory tree](#3-directory-tree)
4. [Tech stack](#4-tech-stack)
5. [Architecture](#5-architecture)
6. [End-to-end trace: "Create a room called Board Meeting"](#6-end-to-end-trace-create-a-room-called-board-meeting)
7. [The agent loop in detail](#7-the-agent-loop-in-detail)
8. [How the agent knows what it can do](#8-how-the-agent-knows-what-it-can-do)
9. [Real example snapshot (room page, Settings tab)](#9-real-example-snapshot-room-page-settings-tab)
10. [Real captured trace of one run](#10-real-captured-trace-of-one-run)
11. [The ghost cursor and action execution](#11-the-ghost-cursor-and-action-execution)
12. [Safety: confirmation gate, credits, decline, cancellation](#12-safety-confirmation-gate-credits-decline-cancellation)
13. [Speech](#13-speech)
14. [Bilingual support](#14-bilingual-support)
15. [State and persistence](#15-state-and-persistence)
16. [Data flow and privacy](#16-data-flow-and-privacy)
17. [Testing](#17-testing)
18. [Decisions, deviations, and bugs fixed during the build](#18-decisions-deviations-and-bugs-fixed-during-the-build)
19. [Known limitations and weaknesses](#19-known-limitations-and-weaknesses)
20. [Extension guide](#20-extension-guide)
21. [Glossary](#21-glossary)

---

## 1. Summary

**eSiri** is an AI assistant for government web systems, built as a proof of concept for e-Government Authority (e-GA) Tanzania. The user speaks or types a request in English or Swahili ("Create a room called Board Meeting", "Tengeneza chumba kiitwacho Kikao cha Bodi"). eSiri then completes the task *inside the existing web interface* by visibly moving its own cursor, clicking buttons and typing into fields, the same way a person would. Before consequential actions (creating a room, starting a meeting, recording, leaving, deleting, removing access) it asks for confirmation, and the app blocks those clicks in code until the user says yes. Every task is written to an audit log. In this PoC the "existing government system" is a **mockup of e-Mikutano**, Tanzania's government video-conferencing system (a front-end-only imitation of a BigBlueButton/Greenlight deployment: rooms, settings, access codes, sharing, presentations, meeting screen, recordings). There is no real video server. The logged-in user is always the fictional **Rahma Mbuyu** (`frontend/src/store/data.ts`, `CURRENT_USER`).

---

## 2. How to run it, and environment variables

### Run

```bash
cp .env.example .env      # put OPENAI_API_KEY=sk-... in .env
./start.sh                # first run installs everything; then starts backend :8000 and frontend :5173
```

Open `http://localhost:5173` in **Google Chrome** (not Chromium; Chromium's speech recognition fails with a `network` error on Linux).

What `start.sh` does, in order:
1. `set -e`, `cd "$(dirname "$0")"`; every path is quoted, so it works in folders with spaces.
2. Checks `python3` and `npm` exist; otherwise exits with an error.
3. Warns (does not exit) if `.env` is missing, or if `OPENAI_API_KEY` is missing or still the `sk-...` placeholder.
4. Creates `backend/.venv` and runs `pip install -r backend/requirements.txt` if `backend/.venv/bin/uvicorn` does not exist.
5. Runs `npm install` in `frontend/` if `frontend/node_modules` does not exist.
6. Starts `uvicorn app.main:app --host 127.0.0.1 --port 8000` in the background (cwd `backend/`).
7. Installs a `trap cleanup EXIT INT TERM` that kills the backend when the script ends (Ctrl+C).
8. Prints `Open http://localhost:5173 in Google Chrome (not Chromium).` and runs `npm run dev` (Vite, port 5173, `--strictPort`) in the foreground.

Verified during the build: fresh clone into a path containing spaces → install → both servers up; Ctrl+C left no process listening on 8000/5173; without `.env` it printed the warning and `/api/health` reported `has_key: false`.

### Environment variables (read from `.env` in the project root)

`backend/app/main.py` calls `load_dotenv(PROJECT_ROOT / ".env")` at import time. All variables are read by the backend only; the frontend learns `english_tts` through `GET /api/health`.

| Variable | Default | Read in | What it controls |
|---|---|---|---|
| `OPENAI_API_KEY` | none | `main.py` `api_key()` | Required for `/api/agent/step` and `/api/tts`. Without it both return HTTP 400 `{"code":"no_key"}` and `/api/health` returns `has_key:false`, which makes the panel show a banner (`Panel.tsx`, `data-testid="esiri-nokey"`). |
| `OPENAI_MODEL` | `gpt-4.1-mini` | `main.py` `model_name()` | Chat Completions model for the agent. If the key cannot use it, the backend returns `{"code":"model_not_found"}` with a message naming `OPENAI_MODEL`. |
| `OPENAI_TTS_MODEL` | `gpt-4o-mini-tts` | `tts.py` `synthesize()` | Text-to-speech model. On any error, `synthesize()` retries once with `tts-1`. |
| `OPENAI_TTS_VOICE` | `coral` | `tts.py` `synthesize()` | OpenAI voice. For the `tts-1` fallback, if the voice is not one of `alloy, echo, fable, onyx, nova, shimmer` it uses `nova`. |
| `ESIRI_ENGLISH_TTS` | `browser` | `main.py` `english_tts()` | `browser` = English is spoken with Chrome's `speechSynthesis`; `openai` = English also uses `/api/tts`. Anything after `#` is ignored (so the inline comment in `.env.example` is safe). Swahili always prefers a browser `sw*` voice and falls back to OpenAI. |

### URL parameters (frontend)

| Parameter | Where | Effect |
|---|---|---|
| `?mute=1` | `frontend/src/esiri/tts.ts` (module top level) | Stored in `sessionStorage['esiri-mute']`. `isMuted()` then makes `speak()` return immediately (no speech) and `listenForCommand()` (`controller.ts`) skip the microphone and focus the text input instead. `voiceAvailable()` returns false, so confirmations and questions are not listened for. Used by all automated tests. `?mute=0` clears it. |
| `?token=XXXX` | `frontend/src/pages/Landing.tsx` | Pre-fills the meeting-token field. |

---

## 3. Directory tree

(`node_modules/`, `.venv/`, build output and test artifacts omitted.)

```
eSIRI/
├── start.sh                    one-command install + run (section 2)
├── .env.example                template for .env (the real .env is git-ignored)
├── .gitignore                  ignores .env, .venv, node_modules, dist, audit_log.jsonl, test artifacts
├── README.md                   user-facing setup, usage, demo script, troubleshooting
├── CLAUDE.md                   short briefing for future Claude Code sessions
├── ESIRI_BUILD_PROMPT.md       the original build specification (local only, git-ignored, not in the repo)
├── docs/CODEMAP.md             this document
├── reference/                  original screenshots, orb inspiration image, coat of arms (local only, git-ignored)
├── backend/
│   ├── requirements.txt        Python dependencies
│   ├── audit_log.jsonl         created at runtime; one JSON line per eSiri task (git-ignored)
│   └── app/
│       ├── __init__.py         empty; makes `app` a package
│       ├── main.py             FastAPI app: /api/health, /api/agent/step, /api/agent/reset, /api/tts, /api/audit; session memory; OpenAI call
│       ├── agent.py            SYSTEM_PROMPT, build_system_prompt(), TOOLS schemas, memory helpers (repair, trim, render/prune)
│       ├── app_map.md          the agent's knowledge base about the mockup (pages, element ids, cause→effect)
│       └── tts.py              synthesize(): OpenAI TTS with tts-1 fallback and in-memory cache
└── frontend/
    ├── package.json            npm scripts and dependencies
    ├── vite.config.ts          dev server :5173, proxy /api → http://localhost:8000
    ├── playwright.config.ts    e2e config; webServer starts backend (venv uvicorn) + frontend
    ├── tsconfig*.json          TypeScript strict config (app + node/e2e)
    ├── index.html              HTML shell; loads Inter + Montserrat from Google Fonts
    ├── public/assets/tanzania-coat-of-arms.svg   copy of the reference SVG (viewBox added)
    ├── e2e/
    │   ├── helpers.ts          store(), startSignedIn(), openPanel(), createRoomByHand(), askEsiri(), roomByName()
    │   ├── ui.spec.ts          14 tests without the LLM (mockup, language, gate, snapshot, TTS/audit endpoints)
    │   ├── agent.spec.ts       8 required eSiri scenarios (@llm)
    │   ├── demo.spec.ts        the README demo script as one conversation (@llm)
    │   ├── screenshots.spec.ts 4 visual tests (EN/SW × 1366/1920) with overflow checks
    │   └── screenshots/        48 PNGs produced by screenshots.spec.ts
    └── src/
        ├── main.tsx            React root; installs window.__esiriTest hook for tests
        ├── App.tsx             router, RequireAuth, Shell (app-shell with panel-open margin), NavBridge, EsiriRoot
        ├── index.css           global CSS variables, buttons, inputs, tabs, toasts, modal, toggle, badges
        ├── vite-env.d.ts       Vite type reference
        ├── i18n/
        │   ├── en.ts           261 English strings; exports I18nKey and Dict types
        │   ├── sw.ts           261 Swahili strings typed as Dict (compiler enforces identical keys)
        │   └── index.ts        tr(), t(), useT(), useLang()
        ├── store/
        │   ├── appStore.ts     zustand store `useApp` (persisted): language, rooms, recordings, meetings, audit, live meeting, toasts; helpers
        │   └── data.ts         DIRECTORY (6 users), SAMPLE_DOCS (3 e-Office docs), CURRENT_USER, formatBytes()
        ├── components/
        │   ├── esiriProps.ts   ez(): builds data-esiri-id / -label / -sensitive / -state / -role attributes
        │   ├── Header.tsx      FlagStripe, Wordmark, FullHeader (landing), CompactHeader + UserMenu, PageFooter
        │   ├── Common.tsx      Toasts, Modal (data-esiri-modal), Toggle (role=switch), copyText(), joinLink()
        │   └── RecordingList.tsx  recordings table with Play/Delete; RecordingsEmpty
        ├── pages/
        │   ├── Landing.tsx     language toggle, token join, Reserve a meeting (sign-in), cyan footer
        │   ├── Rooms.tsx       Rooms dashboard, DashboardTabs, CreateRoomModal, lastSessionText()
        │   ├── RoomPage.tsx    room header + tabs: RoomRecordings, PresentationTab, AccessTab + ShareAccessModal, SettingsTab + delete modal
        │   ├── Recordings.tsx  all recordings across rooms
        │   ├── Meeting.tsx     meeting screen: sidebar, chat/notes, top bar (record/leave), stage, bottom bar
        │   └── Audit.tsx       audit table, filters, expandable rows, CSV export (auditToCsv), clear modal
        └── esiri/
            ├── controller.ts   THE AGENT LOOP: activate, listenForCommand, submit, runLoop, execute, askConfirmation, answerConfirmation, finishTask, failTask, cancel, newConversation
            ├── driver.ts       the "hands": click(), typeText(), navigate(), elementPresent(); sensitive-click gate
            ├── cursor.ts       ghost cursor DOM: showCursor, hideCursor, glideTo, highlight, ripple, press
            ├── snapshot.ts     buildSnapshot(), visibleElements(), describeElement(), modal/visibility helpers
            ├── api.ts          fetch wrappers: fetchHealth, agentStep, postAudit, fetchTTS, resetSession (unused); ApiError
            ├── tts.ts          speak() routing browser/OpenAI, stopSpeaking(), isMuted(), stripMarkdown(), splitSentences()
            ├── stt.ts          listenOnce(), stopListening(), startWake()/stopWake(), WAKE_RE
            ├── audioLevel.ts   level bus for the orb; mic level (getUserMedia + AnalyserNode); simulated levels
            ├── util.ts         sleep(), nextFrames(), CancelledError, isAbort(), isStopUtterance(), parseYesNo()
            ├── nav.ts          setNavigator()/goTo() bridge to React Router; pageFromPath(), roomIdFromPath()
            ├── esiriStore.ts   zustand store `useEsiri` (not persisted): panel, status, messages, interim, health
            ├── esiri.css       orb, stage orb, floating button, side panel, ghost cursor styles
            └── ui/
                ├── EsiriRoot.tsx   mounts orb button, stage orb, panel; Alt+S / Esc handlers; health fetch; wake-mode effect
                ├── Panel.tsx       side panel: header, wake toggle, banners, messages (MessageView), input/mic/stop/send
                ├── Orb.tsx         CSS iridescent orb component; reads audio level as --level
                └── orbState.ts     orbStateFor(): maps status to orb visual state
```

---

## 4. Tech stack

Most choices were fixed by the build specification (`ESIRI_BUILD_PROMPT.md`, section 1; kept on the owner's machine, not in the repository). "Why" gives the reason that applies to this project; where the spec mandated it, that is stated.

### Frontend (`frontend/package.json`; installed versions from `npm ls`)

| Library | Declared | Installed | What it does here | Why this and not an alternative |
|---|---|---|---|---|
| React | ^18.3.1 | 18.3.1 | All UI components (mockup and eSiri overlay). | Mandated. Controlled inputs are also why the native-setter technique (section 11) is needed. |
| react-dom | ^18.3.1 | 18.3.1 | Renders into `#root` (`main.tsx`). | Pairs with React. |
| react-router-dom | ^6.28.0 | 6.30.6 | Routes in `App.tsx`; `useNavigate` exposed to the agent through `esiri/nav.ts`. | Mandated (v6 API). Real URLs per page let the snapshot report `page`/`route` and let the agent's `navigate` tool work. |
| zustand | ^4.5.5 | 4.5.7 | Two stores: `useApp` (persisted app data + audit) and `useEsiri` (panel/runtime). | Mandated. Its `getState()` lets non-React code (controller, driver, snapshot) read and write state directly, which the agent loop needs; `persist` middleware gives localStorage persistence with one option. |
| lucide-react | ^0.460.0 | 0.460.0 | Icons. | Mandated; tree-shakable SVG icons, no brand logos. |
| Vite | ^5.4.11 | 5.4.21 | Dev server (port 5173, `/api` proxy) and production build. | Mandated. Fast dev server; the proxy avoids CORS problems in development. |
| @vitejs/plugin-react | ^4.3.3 | 4.7.0 | JSX/refresh for Vite. | Standard Vite React plugin. |
| TypeScript | ~5.6.3 | 5.6.3 | Strict type checking (`tsconfig.app.json`: `strict`, `noUnusedLocals`, `noUnusedParameters`). | Mandated. Also enforces that `sw.ts` has exactly the keys of `en.ts` (type `Dict`). |
| @playwright/test | ^1.48.2 | 1.63.0 | End-to-end and visual tests (`frontend/e2e/`). | Mandated. Drives a real Chromium, can read the DOM/localStorage, and starts both servers via `webServer`. |
| @types/node, @types/react, @types/react-dom | ^22.9.0 / ^18.3.12 / ^18.3.1 | 22.20.4 / 18.3.31 / 18.3.7 | Type definitions. | — |
| Plain CSS + CSS variables | — | — | Styling (`index.css` + per-component CSS). | Mandated (no Tailwind, no UI kit). |
| Google Fonts (Inter, Montserrat) | — | — | Loaded in `index.html` with system-font fallbacks (`--font-body`, `--font-display` in `index.css`). | Mandated. |
| Web Speech API (browser built-in) | — | Chrome | `SpeechRecognition`/`webkitSpeechRecognition` for speech-to-text; `speechSynthesis` for English speech. | Mandated. No extra service or key for STT; Chrome sends audio to Google (section 16). |
| Web Audio API (browser built-in) | — | Chrome | `AnalyserNode` for mic level and OpenAI audio level → orb animation (`audioLevel.ts`). | Needed for the "orb follows your voice" behaviour. |

### Backend (`backend/requirements.txt`; installed versions from `pip list` in `backend/.venv`, Python 3.12.3)

| Library | Declared | Installed | What it does here | Why |
|---|---|---|---|---|
| FastAPI | >=0.110 | 0.141.1 | HTTP endpoints in `main.py`; request validation via pydantic models. | Mandated. Async, so an OpenAI call does not block other requests. |
| uvicorn[standard] | >=0.29 | 0.54.0 (+ uvloop 0.22.1, watchfiles 1.3.0, websockets 17.1) | ASGI server. | Mandated. |
| openai (official SDK) | >=1.40 | **3.20.0** | `AsyncOpenAI` client: `chat.completions.create` (agent) and `audio.speech.create` (TTS). | Mandated. Note: the installed SDK is v3.20, newer than the v1 the spec mentions. Its `chat.completions.create` and `audio.speech.create` signatures were inspected during the build and accept every parameter used. |
| python-dotenv | >=1.0 | 1.2.3 | Loads `.env` from the project root. | Mandated. |
| pydantic | >=2.5 | 2.13.5 | `StepRequest`, `ToolResult`, `ResetRequest`, `TTSRequest` models in `main.py`. | Comes with FastAPI; mandated. |

### External services

| Service | Used for | Called from |
|---|---|---|
| OpenAI Chat Completions (`gpt-4.1-mini` by default) with tool calling | The agent's reasoning | `main.py` `step()` |
| OpenAI Audio Speech (`gpt-4o-mini-tts`, fallback `tts-1`) | Swahili speech, and English if `ESIRI_ENGLISH_TTS=openai` | `tts.py` `synthesize()` |
| Google speech service (inside Chrome) | Speech recognition | Browser `SpeechRecognition` in `stt.ts` |
| Google Fonts | Web fonts | `index.html` |

---

## 5. Architecture

```
┌──────────────────────────────── Chrome tab (http://localhost:5173) ──────────────────────────────┐
│                                                                                                   │
│  e-Mikutano MOCKUP (pages/*.tsx, components/*)          eSiri OVERLAY (esiri/ui/*)               │
│  every actionable element tagged with                   orb button, stage orb, side panel        │
│  data-esiri-id / -label / -sensitive / -state           Alt+S / Esc (EsiriRoot)                  │
│        ▲  state in zustand useApp (localStorage)                │ user text / voice              │
│        │                                                         ▼                                │
│        │ el.click(), native value setter              CONTROLLER (esiri/controller.ts)           │
│        │                                              submit → runLoop → execute                 │
│  DRIVER + GHOST CURSOR  ◀──── tool calls ─────────────  confirmation credits, guards, audit      │
│  (esiri/driver.ts, cursor.ts)                                  │           ▲                      │
│                                                                │ snapshot  │ tool_calls          │
│  SNAPSHOT BUILDER (esiri/snapshot.ts) ── JSON of page ────────▶│           │                      │
│                                                                ▼           │                      │
│  SPEECH LAYER: stt.ts (Web Speech), tts.ts (speechSynthesis / <audio>), audioLevel.ts            │
└──────────────────────────────────────────┬──────────────────────────────┬────────────────────────┘
                                 /api/* (Vite proxy)                     │ Chrome speech → Google
                                           ▼                              
┌────────────────────── FastAPI backend (http://127.0.0.1:8000) ─────────────────────┐
│ /api/agent/step  main.step(): session memory (SESSIONS), prune/trim (agent.py),     │
│                  system prompt + app_map.md + TOOLS  ──────────▶ OpenAI Chat        │
│ /api/tts         tts.synthesize() (cache) ─────────────────────▶ OpenAI TTS         │
│ /api/audit       append line → backend/audit_log.jsonl                              │
│ /api/health      has_key, model, english_tts                                        │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Files | Responsibility | Talks to |
|---|---|---|---|
| Mockup app | `pages/*`, `components/*`, `store/appStore.ts` | A human-usable imitation of e-Mikutano. Each actionable element carries `data-esiri-*` attributes built by `ez()` (`components/esiriProps.ts`). | Reads/writes `useApp`. Has no knowledge of eSiri except the tags. |
| eSiri overlay | `esiri/ui/EsiriRoot.tsx`, `Panel.tsx`, `Orb.tsx`, `esiri.css` | Orb, side panel, keyboard shortcuts, wake mode. | Calls `controller.ts`; reads `useEsiri`. |
| Controller | `esiri/controller.ts` | Owns the task: the loop, confirmations and credits, guards, cancellation, audit record. | `api.ts`, `snapshot.ts`, `driver.ts`, `tts.ts`, `stt.ts`, both stores. |
| Snapshot builder | `esiri/snapshot.ts` | Turns the current screen + store into compact JSON for the model. | Reads DOM and `useApp`. |
| Driver ("hands") + ghost cursor | `esiri/driver.ts`, `esiri/cursor.ts` | Performs click / type / navigate visibly; enforces the sensitive-click gate. | DOM, `nav.ts`, `useApp` (navigate only). |
| Speech layer | `esiri/stt.ts`, `esiri/tts.ts`, `esiri/audioLevel.ts` | Listening, speaking, wake word, orb audio level. | Browser APIs; `/api/tts`. |
| Agent backend | `backend/app/main.py`, `agent.py`, `app_map.md` | Keeps conversation per `session_id`, builds prompt, calls OpenAI, returns tool calls. | OpenAI. |
| Audit | `controller.ts` `finalizeTask()`, `store/appStore.ts` `addAudit`, `pages/Audit.tsx`, `main.py` `audit()` | One record per task, in the browser and in `backend/audit_log.jsonl`. | — |

Important design point: **the model never touches the DOM or the store.** It only returns tool calls. All execution, validation and safety enforcement happens in the browser code (`controller.ts` / `driver.ts`).

---

## 6. End-to-end trace: "Create a room called Board Meeting"

This follows one request from the key press to the audit record, in call order. Voice is used for the request; the typed path differs only at step 2. The actual timeline of a captured typed run (section 10) was: thinking 0.4 s → acting 4.0 s → thinking 7.0 s → awaiting_confirmation 8.6 s → (Yes) → thinking 8.8 s → acting 11.1 s → thinking 12.6 s → idle 15.0 s.

### Step 1 — Alt+S opens eSiri and starts listening (frontend)

1. `frontend/src/esiri/ui/EsiriRoot.tsx`, `EsiriRoot` → `useEffect` registers `onKey` on `window` (`keydown`, capture phase). `e.altKey && (e.code === 'KeyS' …)` → `e.preventDefault()` → `activate()`.
2. `frontend/src/esiri/controller.ts` `activate()`: status is `idle`, so not busy and not listening → `useEsiri.setPanelOpen(true)` → `listenForCommand()`.
   - Opening the panel re-renders `App.tsx` `Shell` with class `panel-open`; on screens ≥1000 px `index.css` `.app-shell.panel-open { margin-right: var(--panel-w) }` (380 px) shrinks the page so the panel never covers it.
3. `listenForCommand()`: `isMuted()` (tts.ts) false; `sttSupported()` (stt.ts) true → `listen('listening')`:
   - `setStatus('listening')`, `setMicOpen(true)`;
   - `startMicLevel()` (`audioLevel.ts`): `getUserMedia({audio:true})` → `createMediaStreamSource` → `AnalyserNode` → `driveFromAnalyser()` publishes RMS to `setLevel()`; `Orb.tsx` subscribes via `subscribeLevel()` and sets CSS `--level` (scale/glow). Falls back to `simulateLevel()` if the mic cannot be opened.
   - `listenOnce(lang, onInterim)` (`stt.ts`): `stopListening()`, `stopWake()`, creates `webkitSpeechRecognition` with `lang = 'en-US'` (`recognitionLang()`), `interimResults = true`, `continuous = false`; `onresult` → `onInterim` → `useEsiri.setInterim()` (shown in the stage caption and as an italic bubble in the panel); `onend` resolves `{ text }`.
4. Back in `listenForCommand()`: status restored to `idle`; `isStopUtterance(text)` (util.ts) false → `submit(text, 'voice')`.

(Typed path: `Panel.tsx` `send()` → `submit(v, 'text')`.)

### Step 2 — Starting the task (frontend)

5. `controller.ts` `submit()`: no pending confirmation, not busy, not a stop word → `useEsiri.addMsg({kind:'user', …})` → `newTask()` creates the `Task` object (`credits: 0`, `abort: new AbortController()`, …) → `runLoop(task, { user_message, input_mode })`.
6. `runLoop()`: `setStatus('thinking')` → `buildSnapshot()` (`snapshot.ts`, see section 9) → `agentStep(body, task.abort.signal)` (`api.ts`) → `fetch('POST /api/agent/step')`. Vite's proxy (`vite.config.ts`) forwards `/api` to `http://localhost:8000`.

### Step 3 — First model call (backend)

7. `backend/app/main.py` `step(req: StepRequest)`: pydantic validates the body; `api_key()` present; per-session `asyncio.Lock` from `LOCKS`; `messages = SESSIONS.setdefault(session_id, [])`; `agent.compact_json(snapshot)`.
8. `user_message` branch: `agent.repair_dangling_tool_calls(messages)` (no-op on first turn); builds content `"[language=en] [input=voice] User request: …"`, appends `"(Existing room names, exact: …)"` from `_room_names(snapshot)`; stores the snapshot under the private key `_snapshot`.
9. `agent.trim_history(messages)`; `agent.build_system_prompt('en')` + `agent.render_messages(messages)` (snapshot pruning); `client().chat.completions.create(model, messages, tools=agent.TOOLS, temperature=0.2, parallel_tool_calls=True)`.
10. The model returned two calls: `click(rooms.new-room-btn)` and `type_text(create-room.name-input, "Board Meeting")`. `step()` parses each `function.arguments` with `json.loads`, appends the assistant message (with `tool_calls`) to the session, logs one line, returns `{"tool_calls":[…], "text":""}`.

### Step 4 — Executing the first batch (frontend)

11. `runLoop()` iterates the calls. For each: stale-prediction check (only after a route change), 30-execution guard, `task.toolExecs++`, `execute(task, call, appearWaitMs)` where `appearWaitMs` is 150 ms for the first call of a batch and 1500 ms for later ones.
12. `execute()` case `click`: `setStatus('acting')`; reads the element's label with `describeElement()` → panel step line "→ Clicked '+ New Room'" (`stepLine()`) → `driver.ts` `click('rooms.new-room-btn', ctx)`:
    - `find()` → `query()` (visible, not inside `.esiri-panel`); `isReachable()` (not behind a modal); `isDisabled()`; not sensitive;
    - `approach()` → `cursor.ts` `showCursor()`, `scrollIntoView` if off-screen, `glideTo()` (500–700 ms ease-in-out), `highlight()`;
    - `sleep(140)`, `ripple()`, `press()`, `el.click()` → React `onClick` in `pages/Rooms.tsx` `Rooms` → `setCreating(true)` → `CreateRoomModal` renders inside `Modal` with `data-esiri-modal="create-room"`;
    - `settle()`: 350 ms + 2 animation frames (+250 ms more if the route changed) → `{ ok: true }`.
    - `record()` appends to `task.steps`; the step line becomes ✓.
13. `execute()` case `type_text`: `driver.ts` `typeText('create-room.name-input', 'Board Meeting', ctx)`: `find()` waits up to 1500 ms for the modal input, `approach()`, `el.focus()`, `el.click()`, `setNativeValue(el, '')`, then one character every 35 ms via `setNativeValue()` (section 11). React's `onChange` in `CreateRoomModal` updates its `name` state. After `settle()` it verifies `el.value === text`.
    - Then `execute()` runs the deterministic duplicate check for `create-room.name-input` (normalised name compared with `useApp.rooms`) and adds `duplicate_of: null` and a note to the result.
14. End of batch → `body = { tool_results: [...] }` → loop: `setStatus('thinking')`, new `buildSnapshot()` (now `open_modal: "create-room"` and only the three modal elements), `agentStep()`.

### Step 5 — Second model call and confirmation

15. Backend `step()` `tool_results` branch: finds the last assistant message, writes one `role:"tool"` message per expected `tool_call_id` (missing ids become `{"skipped":true}`), attaches the snapshot to the last one, calls OpenAI. The model returned `ask_confirmation({"summary":"Create a new room called Board Meeting"})`.
16. Frontend `execute()` case `ask_confirmation`: `hideCursor()`; `task.declined` is false; `covers` clamped to 1..10 (default 1) → `askConfirmation(task, summary)`:
    - adds a `confirm` message (the card with Yes/No, `Panel.tsx` `MessageView`), `setStatus('awaiting_confirmation')`, stores `pendingConfirm = { resolve, msgId }`;
    - in the background: `speak(summary)`; then, if `voiceAvailable()`, `listen()` for up to two attempts and `parseYesNo()` the answer.
17. The user says "yes" (or clicks **Yes**, `data-testid="esiri-confirm-yes"`) → `answerConfirmation(true)`: clears `pendingConfirm`, `stopListening()`, `stopSpeaking()`, marks the card `approved`, resolves the promise.
18. Back in `execute()`: `task.confirmations.push({summary, result:'approved'})`, **`task.credits += covers`** (now 1), `setStatus('thinking')`, result `{ok:true, confirmed:true, note:"Approved for 1 sensitive click(s)…"}`.

### Step 6 — The sensitive click

19. Third model call returned `click(create-room.submit)`.
20. `driver.ts` `click()`: the element has `data-esiri-sensitive="true"` → `ctx.hasCredit()` is true (credits 1), so it proceeds; after the animation, `ctx.useCredit()` (credits 0) and `el.click()`.
    - The button is `type="submit"` in the `<form>` of `CreateRoomModal` → `submit()` → `useApp.getState().createRoom('Board Meeting')` (`appStore.ts`: id = `slugify(name)` + `-` + `randomId(4)`, token via `makeToken()`, `DEFAULT_SETTINGS`) → `onClose()` → `navigate('/rooms/<id>')` → `toast('A new room has been created.')`.
    - `settle()` notices the path changed and waits the extra 250 ms.

### Step 7 — Finish, speech and audit

21. Fourth model call returned `finish({"message":"The room called Board Meeting has been created successfully."})`.
22. `execute()` case `finish` → `finishTask(task, message)`:
    - `hideCursor()`;
    - `finalizeTask(task, 'Completed', message)`: `task.done = true`, `current = null`, builds the `AuditRecord` (id, timestamp, user, language, inputMode, request, steps, confirmations, outcome, finalMessage, durationMs) → `useApp.addAudit(rec)` (persisted to localStorage) → `api.ts` `postAudit(rec)` → `POST /api/audit` (`keepalive`, errors ignored) → backend `audit()` → `asyncio.to_thread(_append_audit)` appends one JSON line to `backend/audit_log.jsonl`;
    - adds the assistant bubble, `setStatus('speaking')`, `speak(message, 'en')` → `tts.ts`: English + `browser` mode → `pickVoice('en')` → `speakBrowser()` (sentence chunks, simulated orb level), wrapped in `withTimeout()`;
    - then `setStatus('idle')`.
23. `runLoop()` sees `end === 'finish'` and returns. The result of the `finish` call is never sent to the backend; the next user message's `repair_dangling_tool_calls()` inserts a placeholder tool result for it (section 7).

The captured audit record for this exact request is shown in section 10.

---

## 7. The agent loop in detail

### `/api/agent/step` request shapes (`main.py` `StepRequest`)

A new user message:
```json
{
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "user_message": "Create a room called Board Meeting",
  "input_mode": "text",
  "snapshot": { "...": "see section 9" }
}
```
Results of the previous tool calls:
```json
{
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "tool_results": [
    { "tool_call_id": "call_LhqK…", "result": { "ok": true } },
    { "tool_call_id": "call_S9i7…", "result": { "ok": true, "duplicate_of": null, "note": "No room with this exact name exists. Continue creating it." } }
  ],
  "snapshot": { "...": "fresh snapshot after the actions" }
}
```
Field rules: `session_id` 1–200 chars; `language` `"en"|"sw"` (default `"en"`); `input_mode` `"voice"|"text"`. If neither `user_message` nor `tool_results` is present → HTTP 422 `bad_request`. The `session_id` is generated by the frontend (`appStore.ts` `newSessionId()`, `crypto.randomUUID()`), persisted in localStorage, and replaced by `newSession()` (panel's "New conversation" button, "Reset demo data").

### Response shape

```json
{
  "tool_calls": [
    { "id": "call_LhqKWpucM403XKYPOMkjmI4E", "name": "click",
      "arguments": { "element_id": "rooms.new-room-btn", "reason": "Open create new room modal" } }
  ],
  "text": ""
}
```
`arguments` is already parsed JSON (invalid JSON becomes `{}`). If `tool_calls` is empty, the frontend treats `text` as the final message (`runLoop()` → `finishTask(task, resp.text || errorGeneric)`).

Errors are `{"error": "<message>", "code": "<code>"}` (`main.py` `error()`):

| HTTP | code | When |
|---|---|---|
| 400 | `no_key` | `OPENAI_API_KEY` empty |
| 409 | `session_expired` | `tool_results` sent but the session has no pending assistant tool calls (e.g. backend restarted) |
| 422 | `bad_request` | neither `user_message` nor `tool_results` |
| 502 | `model_not_found` | `openai.NotFoundError`, or a `BadRequestError` mentioning a missing model |
| 401 | `auth` | key rejected |
| 429 | `rate_limit` | rate limit / quota |
| 502 | `bad_request` | other `BadRequestError`; the session is **deleted** (assumed corrupted history) |
| 504 | `network` | connection error / timeout to OpenAI |
| 502 | `api_error` | any other OpenAI API error |

Frontend handling: `api.ts` `agentStep()` throws `ApiError(code, message)`; `runLoop()` `catch` shows the raw message as an error notice in the panel, flashes the orb red, and ends the task with a localized spoken message chosen by code (`esiri.errorNetwork`, `esiri.errorModel`, `esiri.errorNoKey`, else `esiri.errorGeneric`) via `failTask()` → outcome **Failed**.

### How a batch is executed (`controller.ts` `runLoop()`)

The model may return several tool calls in one response (`parallel_tool_calls=True`). The frontend runs them **sequentially, in order**:

1. If an earlier call in the batch failed, was declined, or ended the turn → push `{"skipped": true}` for the remaining ids (OpenAI requires a result for every id).
2. **Stale-prediction skip:** if the route changed since the batch started and the next `click`/`type_text` target is not present within 1500 ms (`driver.ts` `elementPresent()`), push `{"skipped": true, "note": "The page changed; …Re-plan from the new snapshot."}` and stop the batch. No panel step is shown.
3. **Execution cap:** if `task.toolExecs >= 30` (`MAX_TOOL_EXECUTIONS`) → `failTask(esiri.tooManySteps)`.
4. `execute()` the call; append its `result`.
5. **Failure handling:** a failed call stops the batch. The key `name:element_id` (or `page`) is compared with the previous failure; three consecutive failures of the same key (`MAX_SAME_FAILURES = 3`) → `failTask(esiri.repeatedFailure)`. Any successful non-confirmation call resets the counter.
6. `ask_confirmation` pauses the batch until answered; a decline sets `stopBatch`.
7. `finish` ends the task; `ask_user` ends the turn and sets status `awaiting_answer` (the answer arrives as the next `user_message` and continues the same task and audit record: `submit()` appends ` → <answer>` to `task.request`).
8. Otherwise send `{ tool_results }` with a fresh snapshot and loop.

### What each tool returns to the model

| Tool | Result object (from `execute()` / `driver.ts`) |
|---|---|
| `click` | `{ok:true}` or `{ok:false, code, error}` with `code` ∈ `not_found`, `disabled`, `confirmation_required` |
| `type_text` | `{ok:true}` or `{ok:false, code, error}` (`not_found`, `not_editable`, `disabled`, or value mismatch); for `create-room.name-input` also `duplicate_of` (`{id,name}` or `null`) and a `note` |
| `navigate` | `{ok:true}` or `{ok:false, code:'invalid' | 'confirmation_required', error}` |
| `ask_confirmation` | `{ok:true, confirmed:true|false, note}`; if the task was already declined: `{ok:true, confirmed:false}` and the task ends |
| `ask_user` | `{ok:true, note:"The user's answer will arrive as the next user message."}` (only reaches the model through `repair_dangling_tool_calls`, see below) |
| `set_language` | `{ok:true, language}` |
| `finish` | `{ok:true}` (never sent; see below) |
| unknown name | `{ok:false, error:'Unknown tool "…"'}` |

### How results and snapshots return (backend)

`main.py` `step()` `tool_results` branch writes one `{"role":"tool","tool_call_id":…,"content":compact_json(result)}` per id of the last assistant message, in the assistant's order. **The snapshot is attached once, to the last tool message of the batch** (key `_snapshot`), not to every result.

### Session memory (`main.py` `SESSIONS`, `agent.py`)

- `SESSIONS: dict[session_id → list[message]]`, in process memory. Messages are OpenAI chat messages plus an optional private `_snapshot` string. Memory survives across tasks, so follow-ups like "turn it off again" work (verified by `e2e/demo.spec.ts`).
- `LOCKS: dict[session_id → asyncio.Lock]` serialises requests of the same session (a cancelled task's in-flight request cannot interleave with the next one).
- `repair_dangling_tool_calls()` runs before every new user message. For every assistant tool call without a tool result it inserts one: for `ask_user` `{"ok":true,"note":"The user's answer is in the next user message."}`, otherwise `{"skipped":true,"note":"Not executed (task ended or was interrupted)."}`. This covers `ask_user`, cancelled tasks, and the `finish` call (whose result is never sent — so the model later sees its own `finish` marked as "skipped"; harmless but not literally accurate).
- `trim_history()` keeps only the messages from the 12th-last user message onwards (`MAX_USER_TURNS = 12`), so the history always starts with a user message.
- `POST /api/agent/reset {session_id}` deletes a session, but **no frontend code calls it** (`api.ts` `resetSession()` is unused). "New conversation" instead generates a new `session_id`; the old session stays in memory until the backend restarts. Sessions are never evicted.

### Snapshot pruning (`agent.py` `render_messages()`)

When building the request, only the newest message that has a `_snapshot` gets the full snapshot. All older ones get the literal text `[old snapshot omitted]`. User messages get `\n\nCURRENT SCREEN SNAPSHOT: …`; tool messages get `\nSNAPSHOT: …`. In the captured run (section 10) the prompt stayed at ~4,150–4,500 tokens per call because of this.

### Step limits and loop guards (summary)

| Guard | Where | Value |
|---|---|---|
| Max tool executions per task | `controller.ts` `MAX_TOOL_EXECUTIONS` | 30 → Failed |
| Same action failing in a row | `controller.ts` `MAX_SAME_FAILURES` | 3 → Failed with the error |
| Batch stops at first failure | `runLoop()` | remaining calls `{"skipped":true}` |
| Re-asking after a decline | `execute()` `ask_confirmation` | ends the task with `esiri.declinedAck` |
| Wait for predicted elements | `driver.ts` `find()` | 150 ms (first call of batch) / 1500 ms (later calls) |
| OpenAI client timeout / retries | `main.py` `client()` | 60 s, `max_retries=1` |
| Speech can never block | `tts.ts` `withTimeout()` | estimate + 3 s (+6 s for OpenAI audio) |
| One-shot recognition safety net | `stt.ts` `listenOnce()` | 20 s |
| Any network/model error | `runLoop()` `catch` | spoken localized error, Failed |

---

## 8. How the agent knows what it can do

The model receives four things: the **system prompt** (rules), the **app map** (knowledge of the mockup, embedded in the system prompt), the **tool definitions** (what it can call), and at each step the **snapshot** (what is on screen now, with element ids). Ids exist because the mockup is **tagged** with `data-esiri-*` attributes.

### 8.1 System prompt (verbatim from `backend/app/agent.py` `SYSTEM_PROMPT`)

`build_system_prompt(language)` replaces `{app_map}` with the full text of `app_map.md` and appends one line:
`\nCURRENT LANGUAGE: English (en). Reply, confirm and ask in this language.\n` (or `Swahili (sw)`). In the captured run the complete system message was 14,603 characters.

```text
You are eSiri, an AI assistant built by e-Government Authority (e-GA) Tanzania. You help government staff and citizens complete tasks inside e-Mikutano, the government video-conferencing system, by operating its user interface for them.

HOW YOU WORK
- You act ONLY through the tools. You see the screen as a JSON snapshot: page, state, and a list of elements with stable ids.
- Use ONLY element ids that appear in the latest snapshot, or that you can predict with certainty from the APP MAP id conventions for an element that will appear after your previous action in the same batch (e.g. after clicking rooms.new-room-btn, the modal's create-room.name-input will exist).
- Prefer visible navigation (clicking tabs, buttons, cards) over the navigate tool, so the user can follow what you do.
- You may return several tool calls at once for predictable sequences, but stop the batch before any step whose target you cannot predict. A click that opens another page (opening a room, starting or leaving a meeting, creating a room) must be the LAST call of its batch; continue after you see the new snapshot.
- After tools run you receive a fresh snapshot. Check that the result is what you intended before continuing. If a step failed, read the error and the snapshot and try a different way; do not repeat the same failing call.
- Toggles: read their current state first and only click the ones that need to change.
- Only do what the user asked. Do not open extra pages, change extra settings or close notifications (toasts) unless asked; toasts never block anything.

SAFETY AND CONSENT
- Before any sensitive action (creating a room, starting or joining a meeting, starting or stopping a recording, leaving a meeting, removing someone's access, deleting a room or a recording) you MUST call ask_confirmation with a short, specific summary. When a request contains several sensitive actions, ask once and set covers accordingly (for example covers 2 for "stop recording and leave the meeting").
- Do NOT ask for confirmation for anything else: changing settings toggles, generating access codes, sharing access, adding presentation files, typing, chatting, switching tabs or opening pages are not sensitive.
- Call ask_confirmation BEFORE the sensitive click. It may be the first call of a batch followed by the actions: the app pauses at the confirmation, and if the user declines, the remaining calls of the batch are skipped automatically.
- If the user declines ({"confirmed": false}), do not perform that action and never ask again: your very next call must be finish with a short acknowledgement (e.g. "Okay, I will not delete it.").
- The app enforces confirmations: a sensitive click without an approved confirmation returns confirmation_required. Then ask for confirmation and retry.
- If required information is missing or ambiguous (e.g. which room, what name), call ask_user with one short question. Never invent names.
- Duplicate room names: the app checks this for you. When creating a room, just open the modal and type the name: the type_text result for create-room.name-input tells you whether a room with exactly that name exists (duplicate_of). Only if duplicate_of is set, tell the user and ask whether to open it or create another (ask_user). Never decide yourself that a room exists because a name looks similar or is a translation: "Kikao cha Bodi" and "Board Meeting" are two different rooms.
- Stay within e-Mikutano. For unrelated requests, briefly say what you can help with using finish.

LANGUAGE AND STYLE
- The current language is given with every request: reply in it (en = English, sw = Swahili; natural Tanzanian Swahili). Room names and other user data stay exactly as the user said them, never translated. A Swahili request like "Tengeneza chumba kiitwacho Kikao cha Bodi" means create a room named exactly "Kikao cha Bodi".
- Confirmation summaries, questions and final messages are all spoken to the user in the current language.
- If the user asks to switch language (e.g. "speak Swahili", "ongea Kiingereza"), call set_language, then continue in the new language.
- Your text is spoken aloud: one or two short sentences, no markdown, no lists, no element ids, no technical words.
- When you generate or read an access code, say the digits clearly, separated by spaces (e.g. "4 8 2 9 1 7").
- Questions about the current state (e.g. "what is the viewer code?") can be answered directly from the snapshot state with finish.
- Always end a task with finish, summarising what you did in one sentence.

APP MAP
{app_map}
```

### 8.2 `backend/app/app_map.md` (structure)

Loaded once at import (`agent.py` `APP_MAP`); changing it requires restarting the backend. Sections:

1. **Reading the snapshot** — meaning of `page`, `state.rooms`, `state.current_room`, `state.meeting`, `elements`, `open_modal`, and that `sensitive` elements need an approved confirmation.
2. **Pages and how to get there** — one subsection per screen with every element id and what it does, marking sensitive ones with ⚠:
   Landing `/` · Rooms dashboard `/rooms` · Create New Room modal · Room page `/rooms/{roomId}` with Recordings / Presentation / Access / Settings tabs · All recordings `/recordings` · Meeting `/rooms/{roomId}/meeting` · Audit Log `/audit` · Always available (`toast.close`, `navigate` rules).
   It also lists the fixed ids of data the model cannot see until a modal opens: directory users (`juma-hassan`, `neema-mwakalinga`, …) and e-Office docs (`meeting-agenda`, `budget-2026-27`, `previous-minutes`), plus natural-language aliases ("the meeting agenda" = `Meeting_Agenda.pdf`).
3. **Typical flows** inline (create room; share access; chat).
4. **Cause and effect** — e.g. mute-on-join makes the mic start muted; recording requires Allow recording; stopping saves a recording named "<room> – <date>"; leaving while recording also saves; access codes are in Settings; the first presentation file is the meeting slide; `rooms.new-room-btn` exists only on the dashboard; changing language changes labels, never ids.

### 8.3 Tool definitions (verbatim, `agent.py` `TOOLS`, sent as `tools=` on every call)

```json
[
  {
    "type": "function",
    "function": {
      "name": "click",
      "description": "Click an element on the screen with the visible cursor.",
      "parameters": {
        "type": "object",
        "properties": {
          "element_id": {
            "type": "string",
            "description": "data-esiri-id of the element"
          },
          "reason": {
            "type": "string",
            "description": "Short reason, for the log"
          }
        },
        "required": [
          "element_id",
          "reason"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "type_text",
      "description": "Click a text field, clear it and type the given text.",
      "parameters": {
        "type": "object",
        "properties": {
          "element_id": {
            "type": "string"
          },
          "text": {
            "type": "string",
            "description": "Exact text to type"
          },
          "reason": {
            "type": "string"
          }
        },
        "required": [
          "element_id",
          "text",
          "reason"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "navigate",
      "description": "Go directly to a page. Use only when there is no visible way to click there.",
      "parameters": {
        "type": "object",
        "properties": {
          "page": {
            "type": "string",
            "enum": [
              "landing",
              "rooms",
              "recordings",
              "audit",
              "room",
              "meeting"
            ]
          },
          "room_id": {
            "type": "string",
            "description": "Required for room and meeting"
          }
        },
        "required": [
          "page"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ask_confirmation",
      "description": "Ask the user to approve sensitive actions. Returns {confirmed: true|false}. covers = how many sensitive clicks this approval allows.",
      "parameters": {
        "type": "object",
        "properties": {
          "summary": {
            "type": "string",
            "description": "Short spoken question in the current language"
          },
          "covers": {
            "type": "integer",
            "minimum": 1,
            "default": 1
          }
        },
        "required": [
          "summary"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "ask_user",
      "description": "Ask the user one short clarifying question when required information is missing. Ends this turn; the answer arrives as the next user message. Never use it to say a room already exists unless type_text on create-room.name-input returned duplicate_of (a translated or similar name is NOT a duplicate).",
      "parameters": {
        "type": "object",
        "properties": {
          "question": {
            "type": "string"
          }
        },
        "required": [
          "question"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "set_language",
      "description": "Switch the whole interface, speech and your replies to English or Swahili.",
      "parameters": {
        "type": "object",
        "properties": {
          "language": {
            "type": "string",
            "enum": [
              "en",
              "sw"
            ]
          }
        },
        "required": [
          "language"
        ],
        "additionalProperties": false
      }
    }
  },
  {
    "type": "function",
    "function": {
      "name": "finish",
      "description": "Speak the final short reply and end the task.",
      "parameters": {
        "type": "object",
        "properties": {
          "message": {
            "type": "string"
          }
        },
        "required": [
          "message"
        ],
        "additionalProperties": false
      }
    }
  }
]
```

Note: the model can put `covers` > 1 on `ask_confirmation`; the frontend clamps it to 1..10 (`execute()`).

### 8.4 The `data-esiri-*` tagging system

Every actionable element in the mockup is spread with `{...ez(id, label, opts)}` from `frontend/src/components/esiriProps.ts`:

| Attribute | Meaning | Set by |
|---|---|---|
| `data-esiri-id` | Stable, semantic, language-independent id. | `ez(id, …)` |
| `data-esiri-label` | Visible label **in the current language** (re-rendered on language change). | `ez(…, label)` |
| `data-esiri-sensitive="true"` | Clicking requires an approved confirmation. | `ez(…, {sensitive:true})` |
| `data-esiri-state` | `on`/`off` (toggles, meeting controls, recording), `selected`/`unselected` (tabs, language buttons, filter chips), `open`/`closed` (user menu). | `ez(…, {state})` |
| `data-esiri-role` | Optional role override (not currently used by any element). | `ez(…, {role})` |
| `data-esiri-modal="<name>"` | Marks an open modal container. | `components/Common.tsx` `Modal` |

**Id convention:** `<area>.<thing>[.<action>]`, lower-case, hyphens inside words. Dynamic ids embed real data ids: `room-card.{roomId}.open|copy-link|start`, `presentation.sample.{docId}.add`, `presentation.file.{fileId}.remove`, `access.user.{userId}.add`, `access.shared.{userId}.remove`, `recording.{recId}.play|delete`, `meeting.reaction.{thumbs|clap|laugh|heart|party}`, `audit.filter.{all|completed|declined|cancelled|failed}`.

**Sensitive elements (exact list, grep of `sensitive: true`):** `landing.join-btn`, `room-card.{roomId}.start`, `create-room.submit`, `room.start-meeting`, `access.shared.{userId}.remove`, `delete-room.confirm`, `recording.{recId}.delete`, `meeting.record-toggle`, `meeting.leave`, `audit.clear-confirm`. In addition, `driver.ts` `navigate('meeting', …)` requires a credit.

**How tags become the snapshot element list** (`snapshot.ts` `visibleElements()`): scope = the topmost `[data-esiri-modal]` if one is open, else the whole document; skip anything inside `.esiri-panel`; skip `toast.close` (documented in the app map instead); keep only visible elements (`isVisible()`: has client rects, not `visibility:hidden`/`display:none`); de-duplicate by id; describe each with `describeElement()` → `{id, role, label, state?, value?, disabled?, sensitive?}`. `roleOf()` uses `data-esiri-role`, else ARIA `role` (`tab`, `switch`, `menuitem`), else tag name (`input`→`textbox`, `textarea`→`textarea`, `a`→`link`, otherwise `button`). Input/textarea values are included (first 120 chars). Labels are trimmed to 80 chars.

---

## 9. Real example snapshot (room page, Settings tab)

Captured with `window.__esiriTest.buildSnapshot()` right after eSiri created "Board Meeting" and the Settings tab was clicked (1366×768, English). This is exactly what the model receives as `CURRENT SCREEN SNAPSHOT` (minified to one line in the real request). Nothing is trimmed here.

```json
{
  "page": "room",
  "route": "/rooms/board-meeting-dzjj",
  "language": "en",
  "open_modal": null,
  "toasts": [
    "A new room has been created."
  ],
  "state": {
    "signed_in": true,
    "rooms": [
      {
        "id": "rahma-mbuyus-room-r7k2",
        "name": "Rahma Mbuyu's Room",
        "token": "RMR-7K2Q",
        "last_session": "September 25, 2026 11:11 AM"
      },
      {
        "id": "board-meeting-dzjj",
        "name": "Board Meeting",
        "token": "BRD-QQBS",
        "last_session": "none"
      }
    ],
    "current_room": {
      "id": "board-meeting-dzjj",
      "name": "Board Meeting",
      "settings": {
        "mute_on_join": "off",
        "require_approval": "off",
        "anyone_can_start": "off",
        "all_moderators": "off",
        "allow_recording": "on"
      },
      "viewer_code": "none",
      "moderator_code": "none",
      "shared_users": [],
      "presentation": [],
      "recordings": []
    },
    "current_tab": "settings"
  },
  "elements": [
    {
      "id": "header.home",
      "role": "button",
      "label": "e-Mikutano home"
    },
    {
      "id": "header.user-menu",
      "role": "button",
      "label": "Rahma Mbuyu",
      "state": "closed"
    },
    {
      "id": "room.home-btn",
      "role": "button",
      "label": "Home"
    },
    {
      "id": "room.copy-link",
      "role": "button",
      "label": "Copy Join Link"
    },
    {
      "id": "room.start-meeting",
      "role": "button",
      "label": "Start Meeting",
      "sensitive": true
    },
    {
      "id": "room.tab.recordings",
      "role": "tab",
      "label": "Recordings",
      "state": "unselected"
    },
    {
      "id": "room.tab.presentation",
      "role": "tab",
      "label": "Presentation",
      "state": "unselected"
    },
    {
      "id": "room.tab.access",
      "role": "tab",
      "label": "Access",
      "state": "unselected"
    },
    {
      "id": "room.tab.settings",
      "role": "tab",
      "label": "Settings",
      "state": "selected"
    },
    {
      "id": "settings.toggle.mute-on-join",
      "role": "switch",
      "label": "Mute users on join",
      "state": "off"
    },
    {
      "id": "settings.toggle.require-approval",
      "role": "switch",
      "label": "Require moderator approval before joining",
      "state": "off"
    },
    {
      "id": "settings.toggle.anyone-can-start",
      "role": "switch",
      "label": "Allow any user to start this meeting",
      "state": "off"
    },
    {
      "id": "settings.toggle.all-moderators",
      "role": "switch",
      "label": "All users join as moderators",
      "state": "off"
    },
    {
      "id": "settings.toggle.allow-recording",
      "role": "switch",
      "label": "Allow recording",
      "state": "on"
    },
    {
      "id": "settings.viewer-code.generate",
      "role": "button",
      "label": "Generate – Viewer access code"
    },
    {
      "id": "settings.viewer-code.delete",
      "role": "button",
      "label": "Delete – Viewer access code",
      "disabled": true
    },
    {
      "id": "settings.moderator-code.generate",
      "role": "button",
      "label": "Generate – Moderator access code"
    },
    {
      "id": "settings.moderator-code.delete",
      "role": "button",
      "label": "Delete – Moderator access code",
      "disabled": true
    },
    {
      "id": "settings.room-name-input",
      "role": "textbox",
      "label": "Room Name",
      "value": "Board Meeting"
    },
    {
      "id": "settings.room-name-save",
      "role": "button",
      "label": "Save"
    },
    {
      "id": "settings.delete-room",
      "role": "button",
      "label": "Delete Room"
    }
  ]
}
```

Things to notice:
- `state.rooms` is always included, so the model can build ids like `room-card.board-meeting-dzjj.open`.
- `current_room.settings` lets the model decide whether a toggle needs clicking without reading the DOM.
- `settings.viewer-code.delete` is `disabled: true` because no code exists yet.
- The toast text is in `toasts`, but its close button is deliberately not in `elements`.
- `last_session` is always formatted in English (`snapshot.ts` `lastSessionText()` passes `'en'`), even when the UI is Swahili.

For comparison, the snapshot while the Create New Room modal was open (from the same run; only modal elements are listed):

```json
{
  "page": "rooms",
  "route": "/rooms",
  "language": "en",
  "open_modal": "create-room",
  "toasts": [],
  "state": {
    "signed_in": true,
    "rooms": [
      {
        "id": "rahma-mbuyus-room-r7k2",
        "name": "Rahma Mbuyu's Room",
        "token": "RMR-7K2Q",
        "last_session": "September 25, 2026 11:11 AM"
      }
    ]
  },
  "elements": [
    {
      "id": "create-room.name-input",
      "role": "textbox",
      "label": "Room Name",
      "value": "Board Meeting"
    },
    {
      "id": "create-room.close",
      "role": "button",
      "label": "Close"
    },
    {
      "id": "create-room.submit",
      "role": "button",
      "label": "Create Room",
      "sensitive": true
    }
  ]
}
```

---

## 10. Real captured trace of one run

Request (typed): **"Create a room called Board Meeting"**, fresh browser storage, starting on `/rooms`, `?mute=1`, Yes clicked on the confirmation card.

How it was captured (scratch tooling, not part of the repo): the unmodified backend was run through a wrapper that replaced the client's `chat.completions.create` with a logging pass-through, on a separate port with its own Vite dev server, so no application code changed. The frontend's `/api/agent/step` traffic was recorded with Playwright network events.

Measured: 4 model calls, 15.0 s from Send to idle; prompt 4,156–4,493 tokens and completion 20–71 tokens per call.

### 10.1 Status timeline (from `data-testid="esiri-status"`)

```json
[
{
"ms": 382,
"status": "thinking"
},
{
"ms": 4029,
"status": "acting"
},
{
"ms": 7042,
"status": "thinking"
},
{
"ms": 8591,
"status": "awaiting_confirmation"
},
{
"ms": 8595,
"event": "clicked Yes"
},
{
"ms": 8768,
"status": "thinking"
},
{
"ms": 11059,
"status": "acting"
},
{
"ms": 12631,
"status": "thinking"
},
{
"ms": 14966,
"status": "idle"
}
]
```

### 10.2 Frontend ⇄ backend (`/api/agent/step`), snapshots replaced by a placeholder

```text
→ POST /api/agent/step
{
  "user_message": "Create a room called Board Meeting",
  "input_mode": "text",
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "snapshot": "<snapshot>"
}

← 200
{
  "tool_calls": [
    {
      "id": "call_LhqKWpucM403XKYPOMkjmI4E",
      "name": "click",
      "arguments": {
        "element_id": "rooms.new-room-btn",
        "reason": "Open create new room modal"
      }
    },
    {
      "id": "call_S9i7sdmcuvBnmDfXq9MckHsO",
      "name": "type_text",
      "arguments": {
        "element_id": "create-room.name-input",
        "text": "Board Meeting",
        "reason": "Type new room name"
      }
    }
  ],
  "text": ""
}

→ POST /api/agent/step
{
  "tool_results": [
    {
      "tool_call_id": "call_LhqKWpucM403XKYPOMkjmI4E",
      "result": {
        "ok": true
      }
    },
    {
      "tool_call_id": "call_S9i7sdmcuvBnmDfXq9MckHsO",
      "result": {
        "ok": true,
        "duplicate_of": null,
        "note": "No room with this exact name exists. Continue creating it."
      }
    }
  ],
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "snapshot": "<snapshot>"
}

← 200
{
  "tool_calls": [
    {
      "id": "call_dP0E0OSgSpR8WEVJ9BD2qeu9",
      "name": "ask_confirmation",
      "arguments": {
        "summary": "Create a new room called Board Meeting"
      }
    }
  ],
  "text": ""
}

→ POST /api/agent/step
{
  "tool_results": [
    {
      "tool_call_id": "call_dP0E0OSgSpR8WEVJ9BD2qeu9",
      "result": {
        "ok": true,
        "confirmed": true,
        "note": "Approved for 1 sensitive click(s). Continue with the approved action now."
      }
    }
  ],
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "snapshot": "<snapshot>"
}

← 200
{
  "tool_calls": [
    {
      "id": "call_UVT35gMNLGT69XkfnW0dfchb",
      "name": "click",
      "arguments": {
        "element_id": "create-room.submit",
        "reason": "Confirm and create the new room called Board Meeting"
      }
    }
  ],
  "text": ""
}

→ POST /api/agent/step
{
  "tool_results": [
    {
      "tool_call_id": "call_UVT35gMNLGT69XkfnW0dfchb",
      "result": {
        "ok": true
      }
    }
  ],
  "session_id": "f7f1506c-c46e-4fd4-8cfd-cd5267b7ff8c",
  "language": "en",
  "snapshot": "<snapshot>"
}

← 200
{
  "tool_calls": [
    {
      "id": "call_cCCEELlCQtPA75qNjWXUovgh",
      "name": "finish",
      "arguments": {
        "message": "The room called Board Meeting has been created successfully."
      }
    }
  ],
  "text": ""
}
```

### 10.3 What the model received and returned (backend ⇄ OpenAI)

Every call also carried `tools` (section 8.3), `temperature: 0.2`, `parallel_tool_calls: true`, model `gpt-4.1-mini`. The system message (14,603 chars) is section 8.1 + app map + language line. Full snapshots are shown as `<N chars>`; pruned ones show the literal text sent.

```text
── CALL 1 ─ prompt_tokens=4176 completion_tokens=71
  [system]    <14603 chars: SYSTEM_PROMPT + app_map.md + 'CURRENT LANGUAGE: English (en)…'>
  [user]      [language=en] [input=text] User request: Create a room called Board Meeting
              (Existing room names, exact: "Rahma Mbuyu's Room". Any other name, including a translation of one of these, is a new room.)
              
              CURRENT SCREEN SNAPSHOT: <990 chars of snapshot JSON>
  ⇒ MODEL RETURNED: content=null tool_calls:
      click({"element_id": "rooms.new-room-btn", "reason": "Open create new room modal"})   id=call_LhqKWpucM403XKYPOMkjmI4E
      type_text({"element_id": "create-room.name-input", "text": "Board Meeting", "reason": "Type new room name"})   id=call_S9i7sdmcuvBnmDfXq9MckHsO

── CALL 2 ─ prompt_tokens=4156 completion_tokens=20
  [system]    <14603 chars: SYSTEM_PROMPT + app_map.md + 'CURRENT LANGUAGE: English (en)…'>
  [user]      [language=en] [input=text] User request: Create a room called Board Meeting
              (Existing room names, exact: "Rahma Mbuyu's Room". Any other name, including a translation of one of these, is a new room.)
              
              CURRENT SCREEN SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: click({"element_id": "rooms.new-room-btn", "reason": "Open create new room modal"}); type_text({"element_id": "create-room.name-input", "text": "Board Meeting", "reason": "Type new room name"})
  [tool …kjmI4E] {"ok":true}
  [tool …MckHsO] {"ok":true,"duplicate_of":null,"note":"No room with this exact name exists. Continue creating it."}
              SNAPSHOT: <497 chars of snapshot JSON>
  ⇒ MODEL RETURNED: content=null tool_calls:
      ask_confirmation({"summary":"Create a new room called Board Meeting"})   id=call_dP0E0OSgSpR8WEVJ9BD2qeu9

── CALL 3 ─ prompt_tokens=4211 completion_tokens=28
  [system]    <14603 chars: SYSTEM_PROMPT + app_map.md + 'CURRENT LANGUAGE: English (en)…'>
  [user]      [language=en] [input=text] User request: Create a room called Board Meeting
              (Existing room names, exact: "Rahma Mbuyu's Room". Any other name, including a translation of one of these, is a new room.)
              
              CURRENT SCREEN SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: click({"element_id": "rooms.new-room-btn", "reason": "Open create new room modal"}); type_text({"element_id": "create-room.name-input", "text": "Board Meeting", "reason": "Type new room name"})
  [tool …kjmI4E] {"ok":true}
  [tool …MckHsO] {"ok":true,"duplicate_of":null,"note":"No room with this exact name exists. Continue creating it."}
              SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: ask_confirmation({"summary":"Create a new room called Board Meeting"})
  [tool …D2qeu9] {"ok":true,"confirmed":true,"note":"Approved for 1 sensitive click(s). Continue with the approved action now."}
              SNAPSHOT: <497 chars of snapshot JSON>
  ⇒ MODEL RETURNED: content=null tool_calls:
      click({"element_id":"create-room.submit","reason":"Confirm and create the new room called Board Meeting"})   id=call_UVT35gMNLGT69XkfnW0dfchb

── CALL 4 ─ prompt_tokens=4493 completion_tokens=22
  [system]    <14603 chars: SYSTEM_PROMPT + app_map.md + 'CURRENT LANGUAGE: English (en)…'>
  [user]      [language=en] [input=text] User request: Create a room called Board Meeting
              (Existing room names, exact: "Rahma Mbuyu's Room". Any other name, including a translation of one of these, is a new room.)
              
              CURRENT SCREEN SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: click({"element_id": "rooms.new-room-btn", "reason": "Open create new room modal"}); type_text({"element_id": "create-room.name-input", "text": "Board Meeting", "reason": "Type new room name"})
  [tool …kjmI4E] {"ok":true}
  [tool …MckHsO] {"ok":true,"duplicate_of":null,"note":"No room with this exact name exists. Continue creating it."}
              SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: ask_confirmation({"summary":"Create a new room called Board Meeting"})
  [tool …D2qeu9] {"ok":true,"confirmed":true,"note":"Approved for 1 sensitive click(s). Continue with the approved action now."}
              SNAPSHOT: [old snapshot omitted]
  [assistant] content="" tool_calls: click({"element_id":"create-room.submit","reason":"Confirm and create the new room called Board Meeting"})
  [tool …0dfchb] {"ok":true}
              SNAPSHOT: <1387 chars of snapshot JSON>
  ⇒ MODEL RETURNED: content=null tool_calls:
      finish({"message":"The room called Board Meeting has been created successfully."})   id=call_cCCEELlCQtPA75qNjWXUovgh
```

Snapshot sent in call 1 (full, on `/rooms`):

```json
{
  "page": "rooms",
  "route": "/rooms",
  "language": "en",
  "open_modal": null,
  "toasts": [],
  "state": {
    "signed_in": true,
    "rooms": [
      {
        "id": "rahma-mbuyus-room-r7k2",
        "name": "Rahma Mbuyu's Room",
        "token": "RMR-7K2Q",
        "last_session": "September 25, 2026 11:11 AM"
      }
    ]
  },
  "elements": [
    {
      "id": "header.home",
      "role": "button",
      "label": "e-Mikutano home"
    },
    {
      "id": "header.user-menu",
      "role": "button",
      "label": "Rahma Mbuyu",
      "state": "closed"
    },
    {
      "id": "rooms.tab.rooms",
      "role": "tab",
      "label": "Rooms",
      "state": "selected"
    },
    {
      "id": "rooms.tab.recordings",
      "role": "tab",
      "label": "Recordings",
      "state": "unselected"
    },
    {
      "id": "rooms.search",
      "role": "textbox",
      "label": "Search",
      "value": ""
    },
    {
      "id": "rooms.new-room-btn",
      "role": "button",
      "label": "+ New Room"
    },
    {
      "id": "room-card.rahma-mbuyus-room-r7k2.open",
      "role": "button",
      "label": "Rahma Mbuyu's Room"
    },
    {
      "id": "room-card.rahma-mbuyus-room-r7k2.copy-link",
      "role": "button",
      "label": "Copy join link"
    },
    {
      "id": "room-card.rahma-mbuyus-room-r7k2.start",
      "role": "button",
      "label": "Start – Rahma Mbuyu's Room",
      "sensitive": true
    }
  ]
}
```

Snapshot sent in call 4 (after the room was created; on the new room page):

```json
{
  "page": "room",
  "route": "/rooms/board-meeting-dzjj",
  "language": "en",
  "open_modal": null,
  "toasts": [
    "A new room has been created."
  ],
  "state": {
    "signed_in": true,
    "rooms": [
      {
        "id": "rahma-mbuyus-room-r7k2",
        "name": "Rahma Mbuyu's Room",
        "token": "RMR-7K2Q",
        "last_session": "September 25, 2026 11:11 AM"
      },
      {
        "id": "board-meeting-dzjj",
        "name": "Board Meeting",
        "token": "BRD-QQBS",
        "last_session": "none"
      }
    ],
    "current_room": {
      "id": "board-meeting-dzjj",
      "name": "Board Meeting",
      "settings": {
        "mute_on_join": "off",
        "require_approval": "off",
        "anyone_can_start": "off",
        "all_moderators": "off",
        "allow_recording": "on"
      },
      "viewer_code": "none",
      "moderator_code": "none",
      "shared_users": [],
      "presentation": [],
      "recordings": []
    },
    "current_tab": "recordings"
  },
  "elements": [
    {
      "id": "header.home",
      "role": "button",
      "label": "e-Mikutano home"
    },
    {
      "id": "header.user-menu",
      "role": "button",
      "label": "Rahma Mbuyu",
      "state": "closed"
    },
    {
      "id": "room.home-btn",
      "role": "button",
      "label": "Home"
    },
    {
      "id": "room.copy-link",
      "role": "button",
      "label": "Copy Join Link"
    },
    {
      "id": "room.start-meeting",
      "role": "button",
      "label": "Start Meeting",
      "sensitive": true
    },
    {
      "id": "room.tab.recordings",
      "role": "tab",
      "label": "Recordings",
      "state": "selected"
    },
    {
      "id": "room.tab.presentation",
      "role": "tab",
      "label": "Presentation",
      "state": "unselected"
    },
    {
      "id": "room.tab.access",
      "role": "tab",
      "label": "Access",
      "state": "unselected"
    },
    {
      "id": "room.tab.settings",
      "role": "tab",
      "label": "Settings",
      "state": "unselected"
    }
  ]
}
```

### 10.4 Panel content after the run

```text
Create a room called Board Meeting
→ Clicked '+ New Room'
→ Typed 'Board Meeting'
Create a new room called Board Meeting   [card: ✓ Approved]
→ Clicked 'Create Room'
The room called Board Meeting has been created successfully.
```

### 10.5 The audit record produced (from localStorage; the same JSON was POSTed to `/api/audit`)

```json
{
  "id": "task-1790689353192-4e3s",
  "timestamp": "2026-09-29T13:42:33.192Z",
  "user": "Rahma Mbuyu",
  "language": "en",
  "inputMode": "text",
  "request": "Create a room called Board Meeting",
  "steps": [
    {
      "time": "2026-09-29T13:42:38.187Z",
      "tool": "click",
      "target": "+ New Room",
      "ok": true
    },
    {
      "time": "2026-09-29T13:42:39.788Z",
      "tool": "type_text",
      "target": "Room Name",
      "text": "Board Meeting",
      "ok": true
    },
    {
      "time": "2026-09-29T13:42:45.402Z",
      "tool": "click",
      "target": "Create Room",
      "ok": true
    }
  ],
  "confirmations": [
    {
      "summary": "Create a new room called Board Meeting",
      "result": "approved"
    }
  ],
  "outcome": "Completed",
  "finalMessage": "The room called Board Meeting has been created successfully.",
  "durationMs": 14582
}
```

Note: `ask_confirmation` does not appear in `steps`; confirmations are recorded separately in `confirmations`.

---

## 11. The ghost cursor and action execution

### The cursor (`frontend/src/esiri/cursor.ts`)

- Pure DOM, created lazily by `ensure()`: a fixed full-screen layer `.esiri-cursor-layer` (`z-index: 2147483000`, `pointer-events: none`) containing a highlight ring `.esiri-ring` and the pointer `.esiri-pointer` (an inline SVG arrow with a gradient fill and an "eSiri" label bubble). Styles are in `esiri/esiri.css`.
- `showCursor()` makes it visible; the first time in a task it starts near the bottom centre of the viewport (where the stage orb is). `hideCursor()` is called on ask_confirmation, ask_user, finish, fail and cancel.
- `glideTo(x, y, signal)`: `requestAnimationFrame` animation with cubic ease-in-out; duration `min(700, max(500, 380 + distance × 0.35))` ms; rejects with `AbortError` if the task is cancelled mid-flight.
- `highlight(el)`: positions the pulsing ring around the element's bounding box (5 px padding). `ripple(x, y)`: an expanding circle for 0.6 s. `press()`: shrinks the pointer for 120 ms.

### Click (`driver.ts` `click()`)

`find()` → reachable/disabled checks → sensitive gate (section 12) → `approach()` (scroll into view with `{block:'center', behavior:'smooth'}` only if the element is not within 60 px of the viewport edges, wait until its position stops changing, glide, highlight) → 140 ms pause → re-check the element still exists and is enabled → `ripple()` + `press()` → use a credit if sensitive → **`el.click()`** → 120 ms → clear highlight → `settle()` (350 ms + 2 animation frames; +250 ms and 2 frames more if the URL path changed) → `{ok:true}`.

`el.click()` dispatches a real DOM click event, so React's `onClick`, `<form onSubmit>` for `type="submit"` buttons, and checkbox semantics all behave exactly as for a human click.

### Typing and the React native-setter technique (`driver.ts` `setNativeValue()` / `typeText()`)

The mockup's inputs are **React controlled components**: their displayed value comes from React state (`value={name}` + `onChange`). Simply doing `input.value = 'x'` does not work: React keeps track of the last value it set on the DOM node (it overrides the element's `value` property with its own setter), so a direct assignment updates that tracker too; when the `input` event fires React sees "no change" and does not call `onChange`, and the next render puts the old state value back.

The fix, as implemented:

```ts
const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
setter.call(el, value);                                   // bypass React's instance-level setter
el.dispatchEvent(new Event('input', { bubbles: true }));  // React listens for 'input' to fire onChange
```

Calling the **prototype's** native setter changes the DOM value without updating React's tracker, so React detects a change and runs `onChange`, which updates its state. `typeText()` does this once with `''` (clear), then once per character with the growing string, every 35 ms, so the user sees it being typed. It never sends key events (no Enter), so typing cannot submit a form. After settling it checks `el.value === text` and reports a mismatch as a failure.

### Navigate (`driver.ts` `navigate()`)

Validates the page name; refuses to leave a meeting (`meeting.leave` must be used); for `room`/`meeting` requires a known `room_id`; `meeting` needs and consumes a confirmation credit; signs the user in if needed (`useApp.signIn()`); calls `nav.ts` `goTo(path)` (React Router's `navigate`, registered by `App.tsx` `NavBridge` via `setNavigator()`); settles. No cursor animation for navigate.

### Errors never throw

The driver returns `{ok:false, code, error}` for UI problems (missing, disabled, behind a modal, not editable). Only cancellation throws (`CancelledError`/`AbortError` from `util.ts` `sleep()` or `glideTo()`), which `runLoop()` catches silently.

---

## 12. Safety: confirmation gate, credits, decline, cancellation

### Where the gate is enforced

In the browser, in **`frontend/src/esiri/driver.ts`**:

```ts
// click()
const sensitive = el.getAttribute('data-esiri-sensitive') === 'true';
if (sensitive && !ctx.hasCredit()) {
  return { ok: false, code: 'confirmation_required', error: 'confirmation_required: …' };
}
… animation …
if (sensitive) ctx.useCredit();
el.click();
```

and in `navigate()` for `page === 'meeting'` (`hasCredit()` → `useCredit()`).

`ctx` is built per task by `controller.ts` `driverCtx(task)`: `hasCredit = () => task.credits > 0`, `useCredit = () => task.credits = max(0, credits − 1)`.

### How credits are granted ("covers")

Only one place adds credits: `controller.ts` `execute()` case `ask_confirmation`, after the user answered **yes**: `task.credits += covers`, where `covers` = the model's argument rounded and clamped to 1..10 (default 1). Credits live on the `Task` object, so they disappear when the task ends; they are not shared between tasks. Example: "Stop recording and leave the meeting" → the model asks once with `covers: 2` → two sensitive clicks allowed (`meeting.record-toggle`, `meeting.leave`), as seen in the build logs.

A refused click appears in the panel as "Needs confirmation: '<label>'" (`esiri.step.blocked`) with ✗, is recorded as a failed step, and returns `confirmation_required` to the model, which is told by the prompt to ask and retry.

This gate is covered by a non-LLM test: `e2e/ui.spec.ts` "sensitive clicks are refused without a confirmation (enforced in code)" calls `window.__esiriTest.click('create-room.submit', ctx)` with zero credits → `confirmation_required` and no room created; with one credit → success and 0 credits left.

### Why in code and not only in the prompt

A prompt is a request to a probabilistic model; it can be ignored, misread, or overridden by unusual input. During this build the model did misbehave: after a decline it asked for confirmation seven more times and then tried to click `delete-room.confirm` — the code gate refused that click, so the room survived (section 18). With the gate in the driver, a sensitive click without a "yes" in the same task is not possible regardless of what the model outputs. Human clicks are never gated (they don't go through the driver).

### What happens on decline

- Button **No**, a spoken/typed "no/hapana/…", or two unclear/silent voice attempts → `answerConfirmation(false)`.
- `execute()`: records `{summary, result:'declined'}`, sets `task.declined = true`, returns `{ok:true, confirmed:false, note:"The user said NO. Do not perform this action and do not ask again. Call finish now…"}` and stops the batch (`stopBatch`), so any actions the model batched after the confirmation get `{"skipped":true}`.
- No credits are added, so even if the model tries the sensitive click it is refused.
- If the model calls `ask_confirmation` again in the same task, `execute()` immediately ends the task with `esiri.declinedAck` ("Okay, I have not done it." / "Sawa, sijafanya hivyo.").
- Outcome: `finishTask()` records **Declined** whenever any confirmation in the task was declined (`task.declined`).

### Cancellation (Esc / Stop / orb / spoken "stop")

Triggers:
- **Esc**: `EsiriRoot.tsx` keydown handler (capture phase) — only when status ≠ `idle` or the mic is open; it calls `stopImmediatePropagation()` so it does not also close a modal. `components/Common.tsx` `Modal` only closes on Esc when `document.body.dataset.esiriBusy !== '1'`.
- **Stop button** in the panel (`data-testid="esiri-stop"`, shown while working) → `cancel()`.
- **Orb click while busy** → `activate()` → `cancel()`.
- **Spoken or typed stop word** as the whole utterance: `util.ts` `isStopUtterance()` (stop, cancel, simama, acha, sitisha, optionally prefixed by "eSiri" / followed by "it/now/sasa") → `cancel()`.

`controller.ts` `cancel()` immediately: `stopListening()`, `stopMicLevel()`, `stopSpeaking()`, `hideCursor()`, clears interim text; resolves any pending confirmation as declined; `task.abort.abort()` — this aborts the in-flight `fetch` (the `signal` passed to `agentStep()`), and every driver wait (`sleep`, `glideTo`) rejects on the next tick; `finalizeTask(task, 'Cancelled', 'Stopped.')` writes the audit record; adds "Stopped." / "Nimesimama." to the panel; sets status `idle`; speaks it (non-blocking). `runLoop()`'s `catch` sees `task.done`/`AbortError` and exits silently. On the backend, the aborted request may still complete and append the model's reply to the session; its unanswered tool calls are fixed by `repair_dangling_tool_calls()` on the next message.

Test: `e2e/agent.spec.ts` scenario 8 presses Esc while `acting`, asserts status `idle` within 5 s, audit outcome `Cancelled`, and that the rooms state does not change during the next 3 s.

---

## 13. Speech

### Speech-to-text (`frontend/src/esiri/stt.ts`)

- API: `window.SpeechRecognition ?? window.webkitSpeechRecognition` (`recognitionCtor()`); typings are declared locally because they are not in `lib.dom`.
- Language: `recognitionLang()` → `en-US` or `sw-TZ`, from the current app language at the moment listening starts.
- `listenOnce(lang, onInterim)`: `interimResults = true`, `continuous = false`, `maxAlternatives = 1`. Interim text goes to the panel/stage caption. Resolves once with `{text}` or `{error}`; a 20 s safety timer stops recognition if Chrome never fires `onend`. Only one recognizer runs at a time: it calls `stopListening()` and `stopWake()` first.
- Error mapping (`onerror`): `no-speech` → quietly back to idle; `not-allowed`, `service-not-allowed`, `audio-capture` → `not-allowed` → notice "Microphone access was blocked…"; `network` → notice "Voice recognition needs Google Chrome (not Chromium) and internet. You can type instead."; `aborted`; anything else → `other` → "Voice recognition stopped unexpectedly…". If the API is missing, `listenForCommand()` shows an info notice once and focuses the text input (`esiri.sttUnsupported`). Notices are produced by `controller.ts` `sttErrorNotice()`.
- The mic level for the orb comes from a **separate** `getUserMedia` stream analysed locally (`audioLevel.ts` `startMicLevel()`), with a generation counter so a late-resolving stream is closed if listening already stopped.

### Text-to-speech (`frontend/src/esiri/tts.ts` `speak(text, lang)`)

1. `stripMarkdown()` removes code, links, headings, bullets, emphasis. Empty text or `isMuted()` → return.
2. `stopSpeaking()` first (increments a generation counter so older speech stops).
3. Routing:
   - **English, `english_tts = openai`** → `speakOpenAI()`; on failure falls back to the browser voice.
   - **English, `browser`** (default) → `pickVoice('en')` prefers a voice named "Google" with `en-US`, then any "Google" English voice, then a local `en-US`, then any English voice → `speakBrowser()`.
   - **Swahili** → `pickVoice('sw')` looks for a voice whose `lang` starts with `sw`; if found, browser; **otherwise `speakOpenAI(text, 'sw')`**. During the build, Chrome on this Linux machine had no `sw` voice, and Swahili speech went through `/api/tts` (verified: HTTP 200 `audio/mpeg`, played to completion).
4. `speakBrowser()` splits the text into chunks of ≤180 characters on sentence boundaries (`splitSentences()`), because Chrome cuts long utterances; speaks them in sequence at rate 1.02; drives the orb with a simulated rhythm (`simulateLevel()`).
5. `speakOpenAI()` fetches `POST /api/tts {text, lang}`, plays the MP3 with an `Audio` element, routes it through an `AnalyserNode` so the orb pulses with the real audio.
6. **Timeout:** every `speak()` is wrapped in `withTimeout()`: estimated duration (`words × 420 ms + 600 ms`) + 3 s, plus 6 s extra when OpenAI audio is used. On timeout the speech is stopped and the promise resolves. `speak()` never rejects; on any error the user just sees the text.
7. Voice list: `loadVoices()` waits for `voiceschanged` (max 1.5 s) and refreshes on later changes; `initTTS()` warms it up at startup.

Backend TTS (`backend/app/tts.py` `synthesize()`): cache key = SHA-256 of `lang + NUL + text`; up to 200 entries (oldest evicted); `instructions` = `SW_INSTRUCTIONS` ("natural, fluent Kiswahili with a warm Tanzanian accent…") or `EN_INSTRUCTIONS`; `response_format="mp3"`; on any exception retries once with `tts-1` (no instructions). `/api/tts` returns `audio/mpeg`.

### Voice yes/no parsing (`util.ts` `parseYesNo()`)

Lower-cases, strips punctuation, and checks whole words/phrases:
- Yes: yes, yeah, yep, sure, ok, okay, go ahead, do it, proceed, confirm, ndiyo, ndio, sawa, endelea, haya, thibitisha, yes please, of course.
- No: no, nope, cancel, don't, dont, do not, stop, hapana, acha, usifanye, ghairi, sitisha, no thanks.
If both appear, the first word decides; otherwise `null` (unclear). The same parser is applied to **typed** text while a confirmation card is open (`submit()`).

Voice flow in `askConfirmation()`: speak the summary → listen → yes/no → answer; unclear or silence → speak "Please say yes or no." / "Tafadhali sema ndiyo au hapana." → listen once more → still unclear/silent → **No**. A recognition error other than `no-speech` stops listening and leaves the card waiting for the buttons.

### Wake-word mode (`stt.ts` `startWake()`, `EsiriRoot.tsx` effect)

- Toggle in the panel (`data-testid="esiri-wake-toggle"`), stored as `useApp.wakeMode` (persisted). Default off.
- Runs only while status is `idle` and the mic is not open; the `EsiriRoot` effect stops it whenever status changes and restarts it when idle again.
- Continuous recognition with interim results, restarted 250 ms after every `onend`. Match: `WAKE_RE = /\b(e[\s-]?siri|hey siri|hi siri|a siri|easy ri|siri)\b/i`.
- On a **final** result containing the wake word: any text after it is used directly as the command (`submit(command, 'voice')`); if nothing follows → `activate()` (open panel and listen). On an **interim** match it waits 1.6 s for the rest, then activates without a command.
- Fatal errors (`not-allowed`, `service-not-allowed`, `network`) or 5 other errors → turns wake mode off and shows the network notice. A small green "Wake word on" indicator shows while it runs.

### Echo avoidance

eSiri does not listen while it is speaking or acting: listening only starts from `activate()`, from `askConfirmation()` **after** `speak(summary)` resolves, or from `runLoop()` for `ask_user` **after** `say(question)` resolves; wake mode is paused whenever status ≠ `idle`. One small overlap exists: after a cancel, "Stopped." is spoken while status is already `idle`, so wake mode could be listening during it (it contains no wake word).

### Where speech is exercised by tests

Automated tests run with `?mute=1`, so they do not exercise the microphone or speakers. The TTS endpoint is tested directly (`ui.spec.ts`). Real voice was checked manually in headless Google Chrome for Swahili playback only; spoken input needs a manual check (section 19).

---

## 14. Bilingual support

- **Dictionaries:** `frontend/src/i18n/en.ts` (261 keys, exports `I18nKey` and `Dict = Record<I18nKey,string>`) and `sw.ts` (`const sw: Dict`), so TypeScript refuses to compile if a key is missing or extra. Keys are dotted, grouped by area: `header.*`, `landing.*`, `footer.*`, `rooms.*`, `createRoom.*`, `room.*`, `recordings.*`, `presentation.*`, `access.*`, `settings.*`, `meeting.*`, `audit.*`, `page.*`, `esiri.*`. Placeholders use `{name}` and are filled by `tr()`.
- **Functions** (`i18n/index.ts`): `tr(lang, key, params)` (pure); `t(key, params)` reads the current language from `useApp` (used in non-React code such as the controller); `useT()` hook re-renders on language change; `useLang()`.
- **One setting:** `useApp.language` (persisted, default `en`), changed by `useApp.setLanguage()` (also sets `<html lang>`). Three entry points call it: the landing toggle (`Landing.tsx`, `landing.lang.sw/en`), the panel chip (`Panel.tsx`, `esiri-lang-chip`), and the agent's `set_language` tool (`controller.ts` `execute()`).
- **Propagation:**
  - UI text and `data-esiri-label`s: every component uses `useT()`, so a change re-renders all labels; ids stay the same.
  - Speech recognition: `listen()` passes `lang()` at call time → `en-US` / `sw-TZ`. Wake mode restarts with the new language (effect dependency).
  - Speech output: `speak(text, lang())` chooses browser or OpenAI voice as above.
  - Agent replies: every `/api/agent/step` body has `language`; the backend puts `[language=xx]` into the user message and `CURRENT LANGUAGE: …` into the system prompt (`build_system_prompt()`), and the prompt tells the model to reply, confirm and ask in it.
  - Dates: `formatDateLong()` / `formatTime()` in `appStore.ts` use `sw-TZ` or `en-US` locales.
- **Never translated:** user data (room names, chat, file names, people's names). The header title/subtitle are Swahili in both dictionaries by design.
- **Model-facing text is English only:** tool-result `note`s, driver `error` messages and `app_map.md` are English regardless of language; they are not shown to the user.

---

## 15. State and persistence

### `useApp` — `frontend/src/store/appStore.ts` (zustand + `persist`)

Persisted to **localStorage key `emikutano-store`** (JSON, `version: 1`, `partialize` selects these fields):

| Field | Content |
|---|---|
| `language` | `'en' \| 'sw'` |
| `signedIn` | set by Reserve a meeting / cleared by Sign out; `/rooms`, `/recordings`, `/rooms/:id`, `/audit` redirect to `/` when false (`App.tsx` `RequireAuth`) |
| `sessionId` | UUID used as the backend `session_id` |
| `rooms` | `Room[]`: id, name, token, lastSession, createdAt, settings (5 booleans), viewerCode, moderatorCode, sharedUsers (user ids), presentation (files) |
| `recordings` | `Recording[]`: id, roomId, name, date, durationSec |
| `meetings` | per room id: `chat` messages and shared `notes` |
| `audit` | `AuditRecord[]`, newest first, capped at 500 |
| `wakeMode` | boolean |

Not persisted: `toasts` (max 3 shown, auto-dismiss after 5 s) and `live` (the current meeting: roomId, recording + start time, mic, camera, screenShare, handRaised, panel). Reloading during a meeting therefore starts a fresh live state (`Meeting.tsx` calls `startMeeting()` on mount).

Seed data (`seedData()`): room "Rahma Mbuyu's Room" (`rahma-mbuyus-room-r7k2`, token `RMR-7K2Q`, last session 25 Sep 2026 11:11) and one 32-minute recording. Used on first load and by `resetDemo()` ("Reset demo data" in the user menu, which also clears the audit and starts a new session id).

Actions: `setLanguage, signIn, signOut, resetDemo, setWakeMode, newSession, createRoom, renameRoom, deleteRoom, setSetting, generateCode, deleteCode, addSharedUser, removeSharedUser, addPresentation, removePresentation, deleteRecording, startMeeting, updateLive, startRecording, stopRecording, leaveMeeting, sendChat, setNotes, toast, dismissToast, addAudit, clearAudit`.

### `useEsiri` — `frontend/src/esiri/esiriStore.ts` (zustand, **not** persisted)

`panelOpen`, `status` (`idle | listening | thinking | acting | speaking | awaiting_confirmation | awaiting_answer`, mirrored into `data-testid="esiri-status"`), `micOpen`, `interim`, `messages` (user / assistant / step / confirm / notice), `health`, `errorFlash`, `wakeRunning`, `sttNoticeShown`. A page reload clears the conversation shown in the panel (the backend still remembers it under the persisted `sessionId`).

### Module-level state in the controller (`controller.ts`)

`current: Task | null`, `awaitingAnswer`, `pendingConfirm` — plain variables, lost on reload.

### Other browser storage

`sessionStorage['esiri-mute']` (`tts.ts`) — test mode flag.

### Backend memory (`backend/app/main.py`)

`SESSIONS` (conversation per session id) and `LOCKS`; `tts.py` `_cache` (≤200 MP3s). All in process memory, lost on restart, never evicted otherwise.

### `backend/audit_log.jsonl`

Append-only, one JSON object per line, exactly the `AuditRecord` POSTed by `finalizeTask()` (`main.py` `audit()` → `_append_audit()`). Written only by the backend; the Audit page reads the browser store, not this file. The endpoint accepts any JSON object without validation. The file is git-ignored.

---

## 16. Data flow and privacy

| Data | Destination | When | Code |
|---|---|---|---|
| System prompt + app map + conversation history (user requests, the model's own tool calls, tool results) + **the latest screen snapshot** | **OpenAI** Chat Completions API | Every agent step (typically 3–5 per task) | `main.py` `step()` |
| What the snapshot contains | (same) | (same) | `snapshot.ts` `buildSnapshot()` |
| → room names, ids, **join tokens**, last-session times | | | `state.rooms` |
| → current room settings, **viewer and moderator access codes**, names of people with access, presentation file names, recording names/durations | | | `state.current_room` |
| → in meetings: recording/mic/camera/share state, **last 5 public chat messages**, length of the notes (not the notes text) | | | `state.meeting` |
| → visible element labels and **current values of visible text inputs** (e.g. a search box, the chat input) | | | `elements[].value` |
| → toast texts | | | `toasts` |
| Text to be spoken (Swahili always, unless a local `sw` browser voice exists; English only if `ESIRI_ENGLISH_TTS=openai`) | **OpenAI** Audio Speech API | Each spoken reply/question/confirmation | `tts.py` `synthesize()` |
| **Microphone audio** while eSiri is listening (and continuously in wake mode) | **Google**, through Chrome's built-in speech recognition | While listening | `stt.ts` (browser API) |
| English text spoken with Chrome "Google …" voices | Very likely Google (these voices report `localService: false` in Chrome) — **not verified in this project** | Each English reply | `tts.ts` `pickVoice()` |
| Font requests | Google Fonts | Page load | `index.html` |

What **stays local** (browser or this machine):
- All app data (rooms, codes, chat, notes, recordings, audit) in the browser's localStorage.
- The microphone level stream used for the orb animation (`getUserMedia` → `AnalyserNode`, never transmitted).
- `backend/audit_log.jsonl` and backend session memory.
- The OpenAI API key (only in `.env` and backend process memory; never sent to the browser — `/api/health` exposes only `has_key: true/false`).

Not sent to OpenAI: the audit log, uploaded presentation file contents (the mockup only stores name and size), the shared-notes text (only its length), full chat history beyond 5 messages.

The backend binds to `127.0.0.1` in `start.sh` and CORS allows only `http://localhost:5173` and `http://127.0.0.1:5173`. There is no authentication on any endpoint.

---

## 17. Testing

All tests are Playwright end-to-end tests in `frontend/e2e/`. There are **no unit tests**. Total: **27 tests** (14 + 8 + 1 + 4). Final run during the build: 27 passed, 0 flaky, with `retries: 1` (the LLM suites also passed in two separate runs with retries disabled). Run while writing this document (2026-09-29, isolated ports, no code changes): **27 passed, of which `demo.spec.ts` was flaky** — it failed on the first attempt (see the "Kikao cha Bodi" row in section 18) and passed on the automatic retry.

### Configuration (`frontend/playwright.config.ts`)

Chromium (Playwright's bundled build), viewport 1366×768, `timeout: 120_000` per test, `expect` timeout 15 s, `retries: 1`, `workers: 1` (serial), traces and screenshots kept on failure in `e2e/test-results/`, HTML report in `e2e/report/`. `webServer` starts the backend with `".venv/bin/uvicorn" app.main:app --port 8000` (cwd `backend/`, so the spaces in the path don't matter) and the frontend with `npm run dev`; both `reuseExistingServer: true`.

Each test gets a new browser context (fresh localStorage). Tests open the app with `?mute=1`. Prerequisites for LLM scenarios are created through the human UI (`helpers.ts` `createRoomByHand()`), not by earlier tests.

### Helpers (`e2e/helpers.ts`)

`store(page)` reads `localStorage['emikutano-store']`; `startSignedIn()` → `/?mute=1` + Reserve; `openPanel()`; `createRoomByHand()`; `askEsiri(page, text, {confirm})` types into `esiri-input`, clicks `esiri-send`, clicks `esiri-confirm-yes`/`-no` whenever a card appears, returns when `esiri-status` is `idle`, and **fails if eSiri asks a clarifying question** (`awaiting_answer`); `roomByName()`.

### `e2e/ui.spec.ts` — 14 tests, no LLM needed

| Test | Proves |
|---|---|
| landing page branding, no forbidden names, health check | Title/subtitle/coat of arms/tagline/copyright; the page HTML contains neither "Joseph Laurent" nor "BigBlueButton"; `/api/health` ok |
| sign-in gate | `/rooms` redirects to `/` when signed out; Reserve signs in; seed room and its "Last Session" text |
| language toggle | Landing toggle switches UI to Swahili (`Vyumba`, `+ Chumba Kipya`); the panel chip switches back and updates the store; header title stays Swahili |
| token join | Invalid token → error; `?token=` pre-fills; valid token → meeting screen |
| human create-room flow | Empty-name validation, trimming, URL `board-meeting-xxxx`, toast, token `BRD-XXXX`, search filter |
| room tabs | Toggles, 6-digit codes generate/delete, share/remove access, e-Office docs + upload, default presentation badge, rename, delete with cancel/confirm |
| meeting | Mic starts muted with mute-on-join, chat, notes, camera tile, screen-share banner, reaction animation, raised hand, record ≥2 s → saved recording with correct name, leave → room page, last session set |
| recording disabled | `meeting.record-toggle` disabled when Allow recording is off |
| user menu | Audit Log page, Reset demo data (back to 1 room), Sign out |
| audit page | Rows, filter chips, expand details, CSV export contents, Clear with confirmation |
| orb + Alt+S | Alt+S opens the panel, suggestions shown, status `idle`, the page content shrinks by the panel width |
| sensitive clicks refused | The code gate (section 12) without any LLM |
| snapshot | Page detection, sensitive flag, only modal elements while a modal is open, labels switch language |
| backend TTS + audit | `/api/tts` Swahili → `audio/mpeg` > 1000 bytes (skipped without key); `/api/audit` accepts a record |

### `e2e/agent.spec.ts` — 8 tests, tagged `@llm` (skipped if `has_key` is false)

| # | Request | Asserts (final state only) |
|---|---|---|
| 1 | "Create a room called Board Meeting" (from `/rooms`) | Room exists, URL is its room page, card on dashboard, latest audit **Completed** with ≥1 approved confirmation |
| 2 | "Open the settings and turn on mute users on join, then generate a viewer access code" | `muteOnJoin` true, 6-digit viewer code, UI shows both |
| 3 | "Share access with Neema Mwakalinga" | `neema-mwakalinga` in `sharedUsers` and in the Access list |
| 4 | "Start the meeting and send 'Good morning everyone' in the public chat" (mute-on-join set by hand) | On meeting route, chat contains the text, mic state `off` |
| 5 | "Start recording", then "Stop recording and leave the meeting" | Exactly 1 recording for the room, back on room page |
| 6 | Panel chip → SW, "Tengeneza chumba kiitwacho Kikao cha Bodi" | Room "Kikao cha Bodi" (untranslated) exists, language `sw`, dashboard tab reads "Vyumba", reply has no English words the/room/created |
| 7 | "Delete the room Board Meeting", click **No** | Room still exists, audit **Declined**, **exactly one** confirmation (regression test for the re-ask bug) |
| 8 | Long multi-step request, **Esc** when status is `acting` | Status `idle` within 5 s, audit **Cancelled**, no further state changes for 3 s |

### `e2e/demo.spec.ts` — 1 test `@llm`

The README demo script as one continuous conversation (13 requests, incl. "What is the viewer code?" answered with the right digits, "Actually, turn it off again." via memory, adding the agenda, the slide showing `Meeting_Agenda.pdf`, recording, "Speak Swahili.", the Swahili room, and "Fungua kumbukumbu za ukaguzi." opening the audit page). Asserts at least 12 audit records, all **Completed**. Timeout 600 s.

### `e2e/screenshots.spec.ts` — 4 tests (EN/SW × 1366×768/1920×1080)

Walks every page with the panel open (landing, rooms, create modal, all four room tabs, share modal, meeting with camera/recording, recordings, audit with a sample conversation injected into the panel), saves 12 PNGs per run to `e2e/screenshots/` (48 total, committed), and at each page asserts no horizontal page scroll and no element overflowing the content area; on the meeting page asserts the bottom bar fits in the viewport. The screenshots were inspected by eye during the build and compared with `reference/`.

### Commands

```bash
cd frontend
npm run build             # tsc -b && vite build (type errors fail the build)
npm run typecheck         # tsc -b --noEmit
npx playwright install chromium
npx playwright test       # all 27
npm run test:e2e:nollm    # --grep-invert @llm  → ui + screenshots (18)
npm run test:e2e:llm      # --grep @llm         → agent + demo (9)
```

What tests do **not** cover: real microphone input, real speaker output, wake-word mode, voice confirmations, OpenAI English TTS mode, behaviour of other models than `gpt-4.1-mini`.

---

## 18. Decisions, deviations, and bugs fixed during the build

### Decisions not specified by the build prompt

| Decision | Where | Why |
|---|---|---|
| `landing.join-btn` (token join) is sensitive | `Landing.tsx` | The prompt lists "joining a meeting" as consequential, but its id catalogue did not mark this button. |
| `audit.clear-confirm` is sensitive; extra ids `audit.clear-cancel`, `audit.filter.*` | `Audit.tsx` | Clearing the audit trail is destructive; filters needed ids to be drivable. |
| Inner pages require sign-in (`RequireAuth`); the meeting route does not | `App.tsx` | "Reserve a meeting" was specified as signing in; token joins must reach the meeting without signing in. |
| `?mute=1` also disables the microphone (not only speech) | `controller.ts` `listenForCommand()`, `voiceAvailable()` | Tests must never depend on or be disturbed by the mic. |
| `window.__esiriTest` hook (buildSnapshot, click, typeText, stores, speak) | `main.tsx` | Enables non-LLM tests of the gate and snapshot. It is also present in production builds. |
| Snapshot sent once per step (attached to the last tool result), not inside every result | `runLoop()`, `main.py` | Avoids duplicating a large JSON several times per batch. The spec wording implied one per result. |
| Backend repairs unanswered tool calls | `agent.py` `repair_dangling_tool_calls()` | OpenAI rejects histories with unanswered tool calls (after cancel, ask_user, finish). |
| Per-session `asyncio.Lock` | `main.py` | A cancelled request finishing late must not interleave with the next one. |
| `navigate` into a meeting consumes a credit; `navigate` out of a meeting is refused | `driver.ts` | Otherwise `navigate` would be a way around the gate / around `meeting.leave`. |
| Confirmation may be the first call of a batch, with the actions after it | prompt + `runLoop()` | Fewer model round trips; declines skip the rest. |
| Typed yes/no is accepted while a confirmation card is open | `submit()` | Typing must be a full fallback for voice. |
| Leaving a meeting while recording saves the recording | `appStore.ts` `leaveMeeting()` | Prevents losing a recording. |
| Token format: first letter + following consonants, 3 letters + 4 random (`BRD-QQBS`) | `appStore.ts` `makeToken()` | Matches the spec's `BRD-4K7Q` example. |
| Recording names use the date in the language active when recording | `stopRecording()` | Simplest; stored data is never re-translated. |
| Webcam shown as a strip above the slide; toasts above the orb (top-right in meetings) | `Meeting.tsx/.css`, `index.css` | Found overlaps in screenshots. |
| A `viewBox` was added to the copied coat-of-arms SVG | `frontend/public/assets/…svg` | Without it the SVG clips instead of scaling. `reference/` is untouched. |
| Tests set up prerequisites through the UI, per test, instead of chaining scenarios | `e2e/agent.spec.ts` | Spec required fresh storage per test. |
| Extra tests: `demo.spec.ts`, overflow checks in screenshots, gate/snapshot tests | `e2e/` | Cover what will be shown live and the safety claim. |
| "New conversation" button in the panel header | `Panel.tsx` → `newConversation()` | Reset for rehearsals. It creates a new session id rather than calling `/api/agent/reset`. |

### Bugs found and fixed during the build

| Symptom | Cause | Fix |
|---|---|---|
| After the user declined deleting a room, the model asked for confirmation 7 more times and then tried `delete-room.confirm` (blocked by the gate). | Model did not treat `{"confirmed": false}` as final. | Decline result now includes an explicit `note`; prompt says the next call must be `finish`; `execute()` ends the task if the model asks again; test 7 asserts exactly one confirmation. |
| In the full demo, "Tengeneza chumba kiitwacho Kikao cha Bodi" was answered with "that room already exists". | The model equated the Swahili name with "Board Meeting" (its translation); prompt rules alone did not help. | Deterministic duplicate check on `create-room.name-input` results (`duplicate_of`); the exact existing names appended to each user message (`main.py`); `ask_user` description forbids claiming duplicates without `duplicate_of`. **Mitigated, not eliminated:** after the fix the demo passed in 4 consecutive runs, but in the run made while writing this document the model again asked "open the existing room or create a new one?" — this time *before* typing the name, so the deterministic check never ran (captured model log). It passed on retry. Observed rate: 1 failure in 6 demo attempts. |
| Model kept clicking `toast.close`, and batched guesses after page-changing clicks (red ✗ steps). | Toast close button visible in snapshot; model predicted ids on pages that hadn't loaded. | `toast.close` excluded from `elements`; stale predictions after a route change are skipped silently; first call of a batch waits only 150 ms. |
| Model asked for confirmation for settings changes. | Over-cautious reading of the rules. | Prompt lists what is **not** sensitive. |
| Meeting screen taller than the viewport with the webcam on. | Grid row sized to content. | `grid-template-rows: minmax(0, 1fr)`, `min-height: 0` (`Meeting.css`). |
| Landing title wrapped at 1366 px; overflowed with the panel open. | Viewport-based font size. | Container-query units (`cqi`) on the header (`Header.css`). |
| Toasts covered the orb and the meeting bottom bar; webcam tile covered the slide title; recording names wrapped badly. | Layout. | Repositioned toasts; webcam strip; flex name cell. |
| Mic stream could stay open if listening stopped before permission resolved. | Async race in `startMicLevel()`. | Generation counter (`micGen`). |
| Orb click with wake mode on could start two recognizers. | React effect cleanup runs after the render. | `listenOnce()` calls `stopWake()` synchronously. |
| `startMeeting` could re-run when the room object changed. | Effect depended on the room object. | Depends on the room id only. |
| Step lines like "Turned 'Turn camera on' on". | Meeting buttons exposed as `role=switch`. | Role removed; they report as buttons with a state. |
| Panel "eSiri" edge tab did not appear. | Used `getState()` in render. | Subscribed with a hook. |
| Orb looked washed-out/white. | Too much white in the gradients. | More saturated palette (`esiri.css`). |
| One test measured the panel push during its CSS transition. | Test timing. | `expect.poll`. |

Not app bugs, but seen during the build: one LLM test run failed because the Vite dev server reloaded the page while files were being edited; the rerun passed.

---

## 19. Known limitations and weaknesses

**Approach**
- **The mockup was built for the agent.** Every element has a stable `data-esiri-id`, a label, a sensitivity flag and a state. A real third-party government system will not have these. Pointing this at a real system needs an equivalent layer: ids derived from the accessibility tree/DOM selectors, a curated map, or APIs (section 20).
- **The "system" is a front-end mockup.** No real video, recording, sharing, e-Office integration, or server-side data. All data is in one browser's localStorage.
- **Single user, no authentication.** "Rahma Mbuyu" is hard-coded; backend endpoints are open to anything that can reach `127.0.0.1:8000`.

**Safety**
- The gate lives in the browser. It is strong against the **model**, but anyone with browser devtools can bypass it (as they could click the button themselves). There is no server-side check.
- Credits are **not bound to the element or the summary** the user approved: within one task, an approval of N credits allows any N sensitive clicks. The model is instructed to ask per action, but the code does not verify that the clicked element matches the confirmation text.
- Correctness of the gate depends on correct tagging (`data-esiri-sensitive`). An untagged consequential button would not be gated.
- `window.__esiriTest` is exposed in all builds and gives direct access to the driver and stores.
- `/api/audit` accepts any JSON; the audit in localStorage can be cleared by the user. The audit is not tamper-evident.

**Model behaviour**
- LLM output varies. The tests assert final state and use `retries: 1`. Several behaviours were fixed in code because prompt rules alone were not reliable with `gpt-4.1-mini` (section 18). Other models were not tested.
- **Swahili room names that translate an existing room can still trigger a wrong "already exists" question** in long conversations ("Kikao cha Bodi" vs "Board Meeting"), because the model can call `ask_user` before the deterministic duplicate check runs. Seen once in 6 demo runs. For a live demo, starting the Swahili segment with a fresh conversation (panel ↺ button) reduces the risk (reasoning, not measured).
- The backend shows the model its own `finish` calls as `{"skipped": true, "note": "Not executed…"}` on the next request (section 7). Whether this confuses the model is not known; it is visible in the captured logs.
- Model-facing notes, errors and the app map are English even in Swahili sessions (the model copes; not evaluated systematically).
- The snapshot's `last_session` is always English-formatted.

**Performance and cost**
- Latency: the captured "create a room" took **~15 s** end to end with 4 model calls (3–4 s per call plus animations and the user's confirmation). About 4.2–4.5k prompt tokens per call; the 14.6k-character system prompt is most of it. No explicit prompt caching is configured (OpenAI may apply automatic caching — not verified).
- Backend sessions are never evicted (memory grows with sessions until restart). `/api/agent/reset` is never called by the UI.

**Dependencies**
- Needs internet: OpenAI (agent and Swahili speech), Google (Chrome speech recognition; fonts; probably Chrome's Google voices).
- Voice input needs **Google Chrome**; Chromium and other browsers without Google's speech service fail. Swahili recognition quality with `sw-TZ` was not measured.
- Wake word regex includes bare "siri", so false activations are possible.

**Testing gaps**
- No unit tests. Voice input/output, wake mode, voice confirmations and `ESIRI_ENGLISH_TTS=openai` are not covered by automated tests (manual check needed).

**Code hygiene (dead code, left as-is)**
- Unused exports: `api.ts` `resetSession()`, `controller.ts` `hasPendingTask()` and `trFor()`, `stt.ts` `isWakeActive()`, `appStore.ts` `getRoom()`. `ez()`'s `role` option is never used.

---

## 20. Extension guide

### Add a new screen to the mockup

1. Create `frontend/src/pages/MyPage.tsx` (+ CSS). Use `useT()` for every string; add keys to **both** `i18n/en.ts` and `i18n/sw.ts` (the compiler will complain until both have them).
2. Spread `{...ez('mypage.thing', t('…'), { sensitive?, state? })}` onto every actionable element. Choose ids following `<area>.<thing>[.<action>]`; embed real data ids for list items. Use `components/Common.tsx` `Modal` for dialogs (it sets `data-esiri-modal`), and `Toggle` for switches (it sets `role="switch"` and `data-esiri-state`).
3. Add the route in `App.tsx` (wrap in `RequireAuth` if it needs sign-in).
4. Teach the snapshot about the page: add a case to `esiri/nav.ts` `pageFromPath()` and, if the model needs data that isn't visible as elements, add it to `state` in `esiri/snapshot.ts` `buildSnapshot()`. If the agent may jump there directly, add it to `driver.ts` `navigate()` and to the `navigate` enum in `agent.py` `TOOLS`.
5. Document the page in `backend/app/app_map.md`: route, every id and what it does, ⚠ on sensitive ones, cause→effect rules. Restart the backend.
6. Add tests: a human-flow test in `e2e/ui.spec.ts`, an `@llm` scenario in `e2e/agent.spec.ts`, and add the page to `e2e/screenshots.spec.ts`.

### Add a new action (on an existing screen)

1. Implement the behaviour (store action in `appStore.ts` + button in the page).
2. Tag the button with `ez()`; if it is consequential, add `{ sensitive: true }` — this alone makes the driver require a confirmation.
3. Add the id, what it does, and any cause→effect to `app_map.md`; if it is sensitive, add it to the sensitive-action list in `SYSTEM_PROMPT` (`agent.py`, SAFETY AND CONSENT) so the model asks before trying.
4. If the model needs to read a result (like access codes), expose it in the snapshot `state`.
5. Add an `@llm` test asserting the final state.

A new **tool** (a new kind of action beyond click/type/navigate) needs: a schema in `agent.py` `TOOLS`, a `case` in `controller.ts` `execute()` returning `{result, failed?, stopBatch?, end?}`, a panel step text in `i18n`, and a prompt/app-map mention.

### Point the same pattern at another government system

The reusable part is the loop: **snapshot → model with tools → validated actions → confirmation gate → audit**. What is specific to e-Mikutano: the tags, `app_map.md`, the snapshot `state`, and the sensitive list.

1. **Decide how to act on the system.**
   - Web UI you cannot change: run the "hands" server-side with Playwright (headless or headed browser) instead of in-page. Build element ids from stable selectors/accessibility roles and a curated mapping (the equivalent of `data-esiri-id`), and mark sensitive actions in that mapping, not in the page.
   - System with an API: make the tools API calls (e.g. `create_room(name)`), keep `ask_confirmation` and credits in the executor.
   - Web UI you control: add `data-esiri-*` tags as done here.
2. **Write the snapshot builder** for that system: page/route, open dialogs, visible actionable elements with ids/labels/states, plus a compact domain state summary. Keep it small (prune old snapshots as `agent.py` does).
3. **Write the app map** (pages, ids, cause→effect, sensitive actions) and adjust `SYSTEM_PROMPT` wording (system name, sensitive list).
4. **Keep enforcement in the executor**: sensitive actions blocked unless a same-task approval credit exists; decline ends the task; cancel aborts everything; 30-step and repeated-failure guards; audit every task.
5. **Add deterministic checks** for things the model tends to get wrong (like `duplicate_of` here).
6. **Test on final state** with an LLM suite, plus non-LLM tests for the gate.

---

## 21. Glossary

| Term | Meaning in this codebase |
|---|---|
| **eSiri** | The AI assistant (overlay + controller + backend agent). |
| **e-Mikutano** | Tanzania's government video-conferencing system; here, the mockup being driven. |
| **Greenlight / BigBlueButton** | The open-source front end / conferencing server e-Mikutano is based on; the mockup imitates their layouts but never shows their names. |
| **e-GA** | e-Government Authority, Tanzania. |
| **e-Office** | Government document system; here only 3 sample documents (`SAMPLE_DOCS`). |
| **Agent loop** | `controller.ts` `runLoop()`: snapshot → model → execute tool calls → results → repeat until `finish`. |
| **Task** | One user request from submit to finish/fail/decline/cancel (`Task` in `controller.ts`); one audit record. |
| **Turn** | One user message and the model calls it triggers; a task can span turns via `ask_user`. |
| **Tool / tool call** | A function the model may call (`TOOLS`); a tool call is one invocation with id, name and JSON arguments. |
| **Tool result** | The JSON the frontend returns for a tool call id. |
| **Batch** | All tool calls returned in one model response; executed in order. |
| **Parallel tool calls** | OpenAI option allowing several calls per response (`parallel_tool_calls=True`); executed sequentially here. |
| **Snapshot** | JSON description of the screen and app state sent to the model (`buildSnapshot()`). |
| **Snapshot pruning** | Replacing all but the newest snapshot with `[old snapshot omitted]` (`render_messages()`). |
| **Session / session_id** | Server-side conversation memory key; UUID stored in the browser. |
| **App map** | `app_map.md`, the agent's knowledge base about the mockup. |
| **System prompt** | `SYSTEM_PROMPT` + app map + language line; the model's standing instructions. |
| **data-esiri-id / label / sensitive / state / role / modal** | The tagging attributes (section 8.4). |
| **Element id** | The value of `data-esiri-id`, e.g. `room.start-meeting`. |
| **Sensitive action** | A click on an element tagged `data-esiri-sensitive="true"` (or navigating into a meeting). |
| **Confirmation gate** | The check in `driver.ts` that refuses sensitive clicks without credits. |
| **Credit / covers** | Number of sensitive clicks an approved confirmation allows (`ask_confirmation.covers`, `task.credits`). |
| **Decline** | The user answering no to a confirmation; outcome Declined. |
| **Cancel** | Stopping a running task (Esc/Stop/orb/"stop"); outcome Cancelled. |
| **Outcome** | Completed / Declined / Cancelled / Failed. |
| **Audit record / audit log** | Per-task JSON (`AuditRecord`); stored in localStorage and `backend/audit_log.jsonl`. |
| **Driver ("hands")** | `driver.ts`: performs actions on the DOM. |
| **Ghost cursor** | The animated SVG pointer showing where eSiri acts (`cursor.ts`). |
| **Settle** | Wait after an action for React/route changes (`driver.ts` `settle()`). |
| **Native setter** | The prototype's `value` setter used to change React-controlled inputs (section 11). |
| **Controlled component** | A React input whose value is held in React state. |
| **Stale prediction** | A batched tool call targeting an element that is not on the new page. |
| **Orb / stage orb / orb button** | The animated sphere: 64 px floating button (bottom right), 120 px stage orb (bottom centre while active), small ones in the panel. |
| **Status** | eSiri's state: idle, listening, thinking, acting, speaking, awaiting_confirmation, awaiting_answer. |
| **Interim transcript** | Partial speech-recognition text shown while the user speaks. |
| **STT / TTS** | Speech-to-text / text-to-speech. |
| **Web Speech API** | Browser APIs `SpeechRecognition` and `speechSynthesis`. |
| **Wake word / wake mode** | Background listening for "eSiri" (`startWake()`). |
| **AnalyserNode** | Web Audio node used to measure audio level for the orb. |
| **Toast** | Short notification bottom-right (`Toasts` component). |
| **Modal** | Dialog (`Modal` component) marked with `data-esiri-modal`. |
| **Live meeting** | Non-persisted meeting state `useApp.live`. |
| **Mute mode** | `?mute=1`: no speech output and no microphone (tests). |
| **Seed data / Reset demo data** | Initial room and recording; restored by `resetDemo()`. |
| **Join token** | Code like `BRD-QQBS` to join a room's meeting from the landing page. |
| **Access code** | 6-digit viewer or moderator code in room Settings. |
| **i18n** | Internationalisation: `en.ts`, `sw.ts`, `useT()`. |
| **zustand / persist** | State library and its localStorage middleware. |
| **Vite proxy** | Dev-server forwarding of `/api/*` to the backend (`vite.config.ts`). |
| **FastAPI / uvicorn / pydantic** | Python web framework / ASGI server / request models. |
| **Playwright / webServer / @llm tag** | E2E test tool / its option to start servers / tag selecting tests that need the key. |
| **cqi** | CSS container-query inline unit (1% of the container's width), used for the header title. |
