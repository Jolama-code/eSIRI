# CLAUDE.md — NURU v2

NURU is a personal AI assistant for Tanzanian government officials (English + Swahili, voice or typed). Each official signs in to **NURU Hub** (`/hub`, an installable PWA). NURU:
- plans their day and reminds them aloud on every device;
- runs e-Mikutano meetings (moderator mode);
- asks the **real KatibuAI** backend for meeting minutes;
- drafts and sends e-mail in a **GMS** mock;
- shares tasks between supervisors and staff in a **WERIS** mock.

It operates every system visibly with a ghost cursor, asks before consequential actions (enforced in code), and audits every task. e-Mikutano, GMS and WERIS are front-end mockups with fictional people (`@mfano.go.tz`).

**Naming:** the user-visible name is **NURU** ("Nuru" when spoken). Internal identifiers keep `esiri` (folder, `data-esiri-*`, CSS classes, `data-testid`s, localStorage keys) — do not rename them. Demo accounts: `jolama` (staff), `halima` (Dkt. Halima Said, supervisor), `baraka` (staff); password `Demo@2026` (demo only). Seed rooms: `jolamas-room-r7k2` ("{display_name}'s Room", token `JLM-7K2Q`) and `kamati-ya-bajeti-k7b2`.

**Full details: `docs/CODEMAP.md` (v2.1 and v2 sections first). Demo: `docs/DEMO_SCRIPT.md`; rehearsal checklist `docs/FEATURE_CHECKLIST.md`.** Keep them in sync when you change behaviour. The presented v2 is tag `demo-v2-stable` / branch `demo/v2-stable` (never merge into it); a runnable copy lives in `../eSIRI-demo` (`docs/DEMO_FALLBACK.md`). Only one copy can run at a time (same ports).

## Run and test

```bash
cp .env.example .env            # OPENAI_API_KEY, KATIBU_*, MINUTES_RECIPIENTS ... (never commit .env, never print secrets)
./start.sh                      # backend :8010, frontend :5173 (KatibuAI runs separately on :8000)
./start.sh --share              # + Cloudflare quick tunnel, QR code, production build (vite preview)
# open http://localhost:5173/hub in Google Chrome

cd frontend
npm run build                   # tsc -b && vite build — must have zero TS errors
npm run test:e2e:nollm          # everything except @llm and @katibu
npm run test:e2e:llm            # agent scenarios: agent.spec (8), v2-agent.spec (8), demo.spec
npm run test:e2e:katibu         # real KatibuAI: sample recording (sends ONLY to KATIBU_TEST_RECIPIENT) + live fake-microphone meeting
npx playwright test --project=mobile   # Hub on Pixel 7 (mobile.spec.ts)
```

- The project path contains spaces: **quote every path** in shell commands.
- `pkill -f`/`pgrep -f` with a pattern that appears in your own command line kills your own shell; find processes by port (`ss -ltnp | grep :8010`).
- Port **8000 is KatibuAI**: never point NURU or its tests at it. **Never create, edit or delete anything under `../KATIBU-AI`**; use only its HTTP API.
- The backend does not auto-reload: restart it after changing `backend/app/*.py` or `app_map.md`.
- Playwright starts the backend with `NURU_TEST_MODE=1` and `NURU_DB=backend/data/test.db` (or reuses a running one) and sends `X-Nuru-Test: 1`. Either one forces Katibu e-mails to `KATIBU_TEST_RECIPIENT`.
- Tests sign in through the API (`e2e/helpers.ts` `signIn`, `resetDemo`). Server sessions survive `/api/demo/reset`.
- Don't edit `frontend/src/main.tsx` while Playwright is running against the dev server.
- `?mute=1` disables speech, the microphone, the greeting bubble, the unlock overlay and the automatic briefing (tests use it). `?unlock=1` forces the "Gusa ili kuanza" overlay.
- Env vars: `OPENAI_API_KEY`, `OPENAI_MODEL` (`gpt-4.1-mini`), `OPENAI_TTS_MODEL` (`gpt-4o-mini-tts`), `OPENAI_TTS_VOICE` (`coral`), `TTS_PROVIDER` (`openai`; `chatterbox` is a stub), `ESIRI_ENGLISH_TTS` (`openai`|`browser`), `NURU_TZ`, `MINUTES_RECIPIENTS`, `KATIBU_BASE_URL`, `KATIBU_CLIENT_ID`, `KATIBU_USERNAME`, `KATIBU_PASSWORD`, `KATIBU_TEST_RECIPIENT`, `NURU_DB`, `NURU_TEST_MODE`.

## Architecture in brief

```
One React app: /hub/* (Hub) · / and /rooms/* (e-Mikutano) · /gms/* · /weris/*   + NURU overlay everywhere
  agent: snapshot.ts → controller.ts runLoop → POST /api/agent/step → OpenAI tools (agent.py) → driver.ts (cursor)
  proactive.ts: events.ts (SSE /api/events, long-poll fallback /api/events/poll) → reminder cards, announcements
  briefing.ts (guided flow) · moderator.ts (simulated lobby) · meetingFlow.ts (MediaRecorder → /api/katibu/jobs)
FastAPI :8010: core.py (DB, auth, broker) · services.py (reminders, scheduler, day) · api_hub/api_mail/api_weris · katibu.py → KatibuAI :8000
```

Agent loop: snapshot → tool calls (`click`, `type_text`, `select_option`, `navigate`, `ask_confirmation`, `ask_user`, `set_language`, `moderator_mode`, `schedule_reminder`, `update_task_status`, `weris_report`, `katibu_prepare_minutes`, `katibu_status`, `katibu_open_minutes`, `katibu_send_minutes`, `finish`) → frontend executes them → `{tool_results}` + fresh snapshot → until `finish`. Memory is per user + session in RAM (last 12 user turns; only the newest snapshot is sent in full). Swahili clock phrases in a request are converted in code (`llm.time_notes`) and appended to the user message.

## Key files

| File | Role |
|---|---|
| `backend/app/main.py` | App, routers, agent step (user-aware), TTS, error handlers |
| `backend/app/core.py` | SQLite engine, time helpers (naive UTC storage, `NURU_TZ` display), bcrypt auth + bearer sessions, SSE broker with long-poll history |
| `backend/app/models.py` | SQLModel tables (datetimes are pydantic `NaiveDatetime`) |
| `backend/app/services.py` | Notifications/events, reminder sync and firing, 10 s scheduler, the merged day view |
| `backend/app/seed.py` | Demo people, meetings, tasks, mail, WERIS data; `reset_all()` keeps sessions |
| `backend/app/api_hub.py` | Auth, me, day, briefing parse/save, meetings, tasks, reminders, notifications, audit, events, demo |
| `backend/app/api_mail.py`, `api_weris.py` | GMS (delivery between demo users, external addresses refused) and WERIS APIs |
| `backend/app/katibu.py` | KatibuAI client (password grant, GraphQL envelope code 9001, chunked upload), ffmpeg + sample fallback, polling, send, documents |
| `backend/app/llm.py` | OpenAI client, spoken dates, Swahili/English time parser |
| `backend/app/agent.py`, `app_map.md` | `SYSTEM_PROMPT`, `TOOLS`, memory helpers; the map of every page and element id |
| `frontend/src/esiri/controller.ts` | Loop, tool executors, confirmations/credits, change requests, `logActivity`, `testExecuteTool` |
| `frontend/src/esiri/driver.ts` | `click`, `typeText`, `selectOption`, `navigate`; **the sensitive-click gate** |
| `frontend/src/esiri/snapshot.ts` | Per-system state (hub/mikutano/gms/weris) + visible elements |
| `frontend/src/esiri/{session,events,proactive,briefing,moderator,meetingFlow,katibuActions,nuruStore}.ts` | v2 runtime |
| `frontend/src/esiri/{captions,werisReport}.ts`, `pages/MeetingKatibu.tsx`, `hub/Journey.tsx`, `weris/Report.tsx` | v2.1: live captions, the weekly-report tool, the recording badge/sample player/captions panel, the minutes journey, the WERIS report pages |
| `frontend/src/esiri/ui/{EsiriRoot,NuruOverlays,Orb,Panel}.tsx` | Floating stack, overlays (reminders, toasts, unlock, briefing, demo panel), the orb |
| `frontend/src/hub/*`, `gms/*`, `weris/*` | Hub pages, GMS mock, WERIS mock |
| `frontend/src/i18n/{en,sw,v2en,v2sw}.ts` | All strings; `sw` typed as `Dict` |
| `frontend/public/{sw.js,manifest.webmanifest,brand,fonts,icons}` | PWA and brand assets |
| `frontend/e2e/*.spec.ts` | `ui`, `agent` (v1), `v2`, `v2-agent`, `katibu`, `katibu-live`, `katibu-audio`, `typing`, `weris-report`, `weris-report-agent`, `mobile`, `screenshots`, `screenshots-v2`, `demo` |

## Conventions

- **Every actionable element** gets `{...ez('area.thing[.action]', t('label.key'), opts)}`; ids lower-case, hyphenated, language-independent, embedding real ids (`gms.message.{id}.open`, `weris.task.{id}.status`, `hub.item.{key}.done`). Stateful controls pass `state`. Dialogs use `Modal`; selects are driven with `select_option`.
- **Sensitive = consequential:** create room; start/join/leave meeting (and `navigate` to `meeting`, `hub.item.*.start`, `hub.meeting.*.open`); start/stop recording; remove access; delete room/recording; clear audit; `gms.compose.send`; `weris.task.submit` **when the assignee is not the user** (attribute set dynamically); `weris.report.submit` (the weekly report); `send-minutes.confirm`; tools `katibu_send_minutes` and `moderator_mode(enabled)` (checked in their executors). List new ones in `SYSTEM_PROMPT` and mark ⚠ in `app_map.md`. Never sensitive: drafting, saving drafts (including NURU filling the weekly report), opening pages, own reminders, own task status, preparing minutes, the briefing save (it has its own yes).
- **KatibuAI audio is honest:** live mode never falls back to the sample silently (`live_unusable` → NURU asks); sample mode plays the sample aloud. The weekly report text is always English.
- **No hard-coded UI text.** v2 strings go in `v2en.ts` + `v2sw.ts` (natural Tanzanian Swahili). User data is never translated.
- A new page or element must be documented in `app_map.md`; expose data the model needs in `buildSnapshot()` state. Never put passwords or tokens in snapshots.
- Server events carry `message_sw` and `message_en`; announcements go through `proactive.announce` (a queue that waits for the agent to be idle).
- Driver functions never throw for UI problems (`{ok:false, code, error}`); only cancellation throws. Every tool call id gets a result.
- Tests assert final state. LLM tests carry `@llm`, the KatibuAI test `@katibu`.
- Never use the names "Joseph Laurent" or "BigBlueButton", or real people from the reference screenshots.

## Rules not to break

1. **The confirmation gate stays in code.** `driver.ts` refuses sensitive clicks (and `navigate` into a meeting) unless `task.credits > 0`. The executors of `katibu_send_minutes` and `moderator_mode(enabled)` check credits too. Credits are added only in `controller.ts`: after a "yes" to `ask_confirmation`, or when a reminder answer with an explicit yes ("Ndiyo, anza…") starts a task (`submit` with `preapproved`; the reminder question is itself the confirmation and is audited). Do not move this into the prompt only, and do not gate human clicks.
2. After a decline, the task must not re-ask (`task.declined`) and must end Declined. A non-yes/no answer of 2+ words is a change request (`{change}`), not a decline.
3. Esc / Stop / "stop" cancels immediately: abort the fetch, stop speech and listening, hide the cursor, log Cancelled.
4. Every task produces exactly one audit record (`finalizeTask`; non-agent flows use `logActivity`), in localStorage and the server (`POST /api/audit`, shown in Hub → Activity).
5. Never commit `.env`, `backend/data/`, recordings, `NURU_V2_BUILD_PROMPT.md`, `reference/` or the sample WAV. Never print the API key or Katibu password; `/api/health` exposes only `has_key`.
6. Automated tests send Katibu minutes only to `KATIBU_TEST_RECIPIENT`.
7. `speak()` always resolves (timeouts), so audio can never block the loop.
8. Before committing: `npm run build` clean and the relevant Playwright tests passing.

## Known gaps

- The confirmation gate is client-side and credits are not bound to a specific element. `window.__esiriTest` (including `testExecuteTool`) is exposed in all builds.
- Agent sessions in RAM are never evicted, and the event history is lost on a backend restart (clients refetch).
- Cloudflare quick tunnels (cloudflared 2026.10.3) buffer event streams, so phones use long-polling through `--share`.
- The moderator waiting room is simulated, and the voice paths are only tested manually.
- `demo.spec.ts` can still be flaky (~1 in 6) when the model treats a translated room name as a duplicate.
