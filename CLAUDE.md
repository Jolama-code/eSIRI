# CLAUDE.md — eSiri × e-Mikutano PoC

eSiri is an AI assistant (English + Swahili, voice or typed) that completes tasks inside a government web system by visibly clicking and typing in its UI, asks before consequential actions, and audits every task. The target system here is a **front-end mockup of e-Mikutano** (Tanzania's government video-conferencing system; BigBlueButton/Greenlight-style). No real video server. The user is always "Rahma Mbuyu".

**Full details (architecture, real traces, safety, data flow, decisions): `docs/CODEMAP.md`.** Keep it in sync when you change behaviour.

## Run and test

```bash
cp .env.example .env            # OPENAI_API_KEY=... (never commit .env, never print the key)
./start.sh                      # installs on first run; backend :8000, frontend :5173 (Ctrl+C stops both)
# open http://localhost:5173 in Google Chrome (Chromium's speech recognition fails)

cd frontend
npm run build                   # tsc -b && vite build — must have zero TS errors
npx playwright test             # 27 e2e tests; starts both servers if not running
npm run test:e2e:nollm          # 18 tests without the OpenAI key
npm run test:e2e:llm            # 9 @llm tests (8 required scenarios + demo script)
```

- The project path contains spaces: **quote every path** in shell commands.
- `pkill -f`/`pgrep -f` with a pattern that appears in your own command line kills your own shell; find processes by port (`ss -ltnp | grep :8000`) instead.
- The backend does not auto-reload: restart it after changing `backend/app/*.py` or `app_map.md` (it is read at import).
- Don't edit `frontend/src/main.tsx` while Playwright is running against the dev server: Vite reloads the page and breaks the running test.
- Env vars: `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4.1-mini`), `OPENAI_TTS_MODEL` (`gpt-4o-mini-tts`, falls back to `tts-1`), `OPENAI_TTS_VOICE` (`coral`), `ESIRI_ENGLISH_TTS` (`browser`|`openai`).
- `?mute=1` in the URL disables speech output and the microphone (tests use it).

## Architecture in brief

```
Mockup pages (tagged data-esiri-*)  ←─ driver.ts + cursor.ts (click / type / navigate, confirmation gate)
        │                                        ▲ tool calls
snapshot.ts buildSnapshot() ──► controller.ts runLoop() ──► POST /api/agent/step (backend/app/main.py)
                                                              └─► OpenAI Chat Completions + TOOLS (agent.py)
speech: stt.ts (Web Speech), tts.ts (speechSynthesis / POST /api/tts → OpenAI)   audit: localStorage + /api/audit → backend/audit_log.jsonl
```

Loop: snapshot → model returns tool calls (`click`, `type_text`, `navigate`, `ask_confirmation`, `ask_user`, `set_language`, `finish`) → frontend executes them in order with a visible ghost cursor → sends `{tool_results}` + fresh snapshot → repeat until `finish`. The backend keeps conversation memory per `session_id` in RAM (last 12 user turns) and replaces all but the newest snapshot with `[old snapshot omitted]`.

## Key files

| File | Role |
|---|---|
| `frontend/src/esiri/controller.ts` | Agent loop (`runLoop`, `execute`), confirmations/credits, guards (30 steps, 3 same failures), `cancel()`, audit (`finalizeTask`) |
| `frontend/src/esiri/driver.ts` | `click()`, `typeText()` (React native value setter), `navigate()`; **the sensitive-click gate** |
| `frontend/src/esiri/snapshot.ts` | `buildSnapshot()`: page, state summary, visible tagged elements (modal-scoped) |
| `frontend/src/esiri/{stt,tts,audioLevel,cursor}.ts` | Speech in/out, wake word, orb level, ghost cursor |
| `frontend/src/esiri/ui/{EsiriRoot,Panel,Orb}.tsx` | Orb, side panel, Alt+S / Esc |
| `frontend/src/store/appStore.ts` | zustand `useApp` (persisted in localStorage `emikutano-store`): rooms, recordings, chat, audit, language |
| `frontend/src/components/esiriProps.ts` | `ez(id, label, {sensitive, state})` → `data-esiri-*` attributes |
| `frontend/src/i18n/{en,sw}.ts` | All UI strings; `sw.ts` is typed as `Dict`, so keys must match `en.ts` |
| `backend/app/main.py` | Endpoints, session memory, OpenAI call, error codes |
| `backend/app/agent.py` | `SYSTEM_PROMPT`, `TOOLS`, `repair_dangling_tool_calls`, `trim_history`, `render_messages` |
| `backend/app/app_map.md` | The agent's knowledge of every page, element id and cause→effect rule |
| `frontend/e2e/*.spec.ts` | `ui` (no LLM), `agent` (8 scenarios), `demo`, `screenshots` |

## Conventions

- **Every actionable element** gets `{...ez('area.thing[.action]', t('label.key'), opts)}`. Ids are lower-case, hyphenated, language-independent; list items embed real ids: `room-card.{roomId}.open`, `access.user.{userId}.add`, `recording.{recId}.delete`. Toggles/tabs/stateful buttons pass `state` (`on`/`off`, `selected`/`unselected`). Dialogs use `Modal` from `components/Common.tsx` (sets `data-esiri-modal`), switches use `Toggle`.
- **Sensitive = consequential** (create room, start/join meeting, start/stop recording, leave meeting, remove access, delete room/recording, clear audit): pass `{ sensitive: true }`. Also list it in `SYSTEM_PROMPT` SAFETY section and mark it ⚠ in `app_map.md`.
- **No hard-coded UI text.** Add each string to both `en.ts` and `sw.ts` (natural Tanzanian Swahili; follow the glossary in `ESIRI_BUILD_PROMPT.md` §6). User data (room names, chat, file and people names) is never translated. Header title/subtitle stay Swahili in both.
- A new page or element must also be documented in `backend/app/app_map.md`; if the model needs to read data, expose it in `buildSnapshot()` `state`.
- Driver functions never throw for UI problems; they return `{ok:false, code, error}`. Only cancellation throws.
- Every tool call id must get a result (`{"skipped": true}` if not run); the backend fills gaps via `repair_dangling_tool_calls`.
- Tests assert **final state**, not the model's exact steps. LLM tests carry the `@llm` tag and skip without a key.
- Never use the names "Joseph Laurent" or "BigBlueButton" in the UI.

## Rules not to break

1. **The confirmation gate stays in code.** `driver.ts` must refuse clicks on `data-esiri-sensitive="true"` elements (and `navigate` into a meeting) unless `task.credits > 0`; credits are added only in `controller.ts` `execute()` `ask_confirmation` after a "yes", scoped to the current task. Do not move this into the prompt only, and do not gate human clicks.
2. After a decline, the task must not re-ask (`task.declined` guard) and must end with outcome Declined.
3. Esc / Stop / "stop" must cancel immediately: abort the fetch, stop speech and listening, hide the cursor, log Cancelled.
4. Every task produces exactly one audit record (`finalizeTask`), in localStorage and `POST /api/audit`.
5. Never commit `.env`, never print or hardcode the API key; `/api/health` exposes only `has_key`.
6. Don't modify anything in `reference/`.
7. `speak()` must always resolve (timeouts), so audio can never block the loop.
8. Before committing: `npm run build` clean and the Playwright suite passing (at least the non-LLM tests if no key).

## Known gaps (see CODEMAP §19)

Mockup was built with agent tags (a real system won't have them); gate is client-side only and credits aren't bound to a specific element; `window.__esiriTest` is exposed in all builds; backend sessions never evicted and `/api/agent/reset` unused; voice paths have no automated tests; ~15 s latency for a 4-step task; the model occasionally treats a Swahili room name that translates an existing one ("Kikao cha Bodi" vs "Board Meeting") as a duplicate and asks instead of acting (`demo.spec.ts` flaky ~1 in 6).
