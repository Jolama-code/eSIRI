# Demo fallback: the stable NURU v2 copy

If the new version (`feature/v2.1`) misbehaves before or during a presentation, switch to the
stable copy of the version that was presented: tag `demo-v2-stable`, branch `demo/v2-stable`.

| Copy | Folder | Git branch |
|---|---|---|
| Stable demo (v2) | `../eSIRI-demo` (next to `eSIRI`) | `demo/v2-stable` (tag `demo-v2-stable`) |
| New version (v2.1) | `eSIRI` | `feature/v2.1` |

The stable copy is a separate git worktree with its own `backend/.venv`, `frontend/node_modules`,
`.env`, sample recording and database (`backend/data/nuru.db`). Nothing is shared with `eSIRI` except
the git history, so a database reset or a code change in one copy never touches the other.

## Only one copy at a time

Both copies use the same ports: backend **:8010**, frontend **:5173**. KatibuAI stays on **:8000**
and is shared by both copies. Stop one copy before you start the other.

## Switch to the stable copy

```bash
# 1. Stop the new version: Ctrl+C in the terminal running ./start.sh
#    (check that nothing is left: ss -ltnp | grep -E ':8010|:5173')

# 2. Start the stable copy
cd ../eSIRI-demo
./start.sh            # or ./start.sh --share for phones (new tunnel URL and QR code)

# 3. Open http://localhost:5173/hub in Google Chrome
```

Phones and other browsers keep their sign-in token, but the two copies have different databases.
If a device shows "signed out" after you switch, sign in again (`jolama`, `halima` or `baraka`,
password `Demo@2026`). Use the demo panel (Ctrl+Shift+D, or five taps on the logo on a phone) →
"Reset demo" to start from the seed data.

## Switch back to the new version

```bash
# Ctrl+C in the terminal running ./start.sh in eSIRI-demo
cd ../eSIRI
./start.sh
```

## Keeping the stable copy as it is

- Do not commit in `../eSIRI-demo`, and never merge anything into `demo/v2-stable`.
- `.env` in `../eSIRI-demo` is a copy. If you change a key in `eSIRI/.env`, copy the file again:
  `cp ../eSIRI/.env ../eSIRI-demo/.env`.
- If the folder is lost, recreate it from the eSIRI folder:
  `git worktree add ../eSIRI-demo demo/v2-stable`, then copy `.env` and
  `backend/assets/sample_meeting.wav` into it and run `./start.sh` (it creates the venv and runs
  `npm install` on the first run).
