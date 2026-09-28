#!/usr/bin/env bash
# eSiri × e-Mikutano PoC — install (first run) and start everything.
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"

echo "== eSiri × e-Mikutano =="

# --- checks -----------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 (3.10+) is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: Node.js 18+ and npm are required."; exit 1; }

if [ ! -f "$ROOT/.env" ]; then
  echo "WARNING: no .env file found. Copy .env.example to .env and add your OPENAI_API_KEY."
  echo "         The app will start, but eSiri cannot think or speak Swahili without the key."
elif ! grep -Eq '^OPENAI_API_KEY=.+' "$ROOT/.env" || grep -Eq '^OPENAI_API_KEY=sk-\.\.\.\s*$' "$ROOT/.env"; then
  echo "WARNING: OPENAI_API_KEY is missing in .env. eSiri will show a banner until you add it."
fi

# --- backend ----------------------------------------------------------------
if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "-- Creating Python virtualenv and installing backend requirements..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install --upgrade pip >/dev/null
  "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
fi

# --- frontend ---------------------------------------------------------------
if [ ! -d "$ROOT/frontend/node_modules" ]; then
  echo "-- Installing frontend dependencies (npm install)..."
  (cd "$ROOT/frontend" && npm install)
fi

# --- run --------------------------------------------------------------------
BACKEND_PID=""
cleanup() {
  echo ""
  echo "-- Stopping eSiri..."
  if [ -n "$BACKEND_PID" ] && kill -0 "$BACKEND_PID" 2>/dev/null; then
    kill "$BACKEND_PID" 2>/dev/null || true
    wait "$BACKEND_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

echo "-- Starting backend on http://localhost:8000 ..."
(cd "$ROOT/backend" && exec "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8000) &
BACKEND_PID=$!

echo ""
echo "Open http://localhost:5173 in Google Chrome (not Chromium)."
echo "Press Ctrl+C to stop."
echo ""

cd "$ROOT/frontend"
npm run dev
