#!/usr/bin/env bash
# NURU v2 — install (first run) and start everything.
#   ./start.sh            backend :8010 + frontend :5173 on this machine (and the LAN)
#   ./start.sh --share    also opens a Cloudflare quick tunnel (HTTPS) and prints a QR code for phones
set -e
cd "$(dirname "$0")"
ROOT="$(pwd)"
SHARE=0
for arg in "$@"; do
  case "$arg" in
    --share) SHARE=1 ;;
    *) echo "Unknown option: $arg (use --share)"; exit 1 ;;
  esac
done

echo "== NURU v2 =="

# --- checks -----------------------------------------------------------------
command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 (3.10+) is required."; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "ERROR: Node.js 18+ and npm are required."; exit 1; }
command -v ffmpeg >/dev/null 2>&1 || echo "WARNING: ffmpeg is missing (sudo apt install ffmpeg). Meeting recordings cannot be converted for KatibuAI."

if [ ! -f "$ROOT/.env" ]; then
  echo "WARNING: no .env file found. Copy .env.example to .env and fill in the keys."
elif ! grep -Eq '^OPENAI_API_KEY=.+' "$ROOT/.env" || grep -Eq '^OPENAI_API_KEY=sk-\.\.\.\s*$' "$ROOT/.env"; then
  echo "WARNING: OPENAI_API_KEY is missing in .env. NURU will show a banner until you add it."
fi

KATIBU_URL="$(grep -E '^KATIBU_BASE_URL=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | cut -d' ' -f1)"
KATIBU_URL="${KATIBU_URL:-http://localhost:8000}"
if command -v curl >/dev/null 2>&1 && ! curl -s -m 3 "$KATIBU_URL/healthz" >/dev/null 2>&1; then
  echo "WARNING: KatibuAI is not reachable at $KATIBU_URL. Start it first (cd ../KATIBU-AI/katibuAI-backend && make demo)."
  echo "         NURU still runs; meeting minutes will fail until KatibuAI is up."
fi

# --- backend ----------------------------------------------------------------
if [ ! -x "$ROOT/backend/.venv/bin/uvicorn" ]; then
  echo "-- Creating Python virtualenv and installing backend requirements..."
  python3 -m venv "$ROOT/backend/.venv"
  "$ROOT/backend/.venv/bin/pip" install --upgrade pip >/dev/null
  "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
elif ! "$ROOT/backend/.venv/bin/python" -c "import sqlmodel, bcrypt, multipart, httpx" >/dev/null 2>&1; then
  echo "-- Installing new backend requirements..."
  "$ROOT/backend/.venv/bin/pip" install -r "$ROOT/backend/requirements.txt"
fi

# The sample meeting recording (fallback audio for KatibuAI) is kept out of git.
mkdir -p "$ROOT/backend/assets"
if [ ! -f "$ROOT/backend/assets/sample_meeting.wav" ] && [ -f "$ROOT/reference/nuru-v2/sample-meeting.wav" ]; then
  cp "$ROOT/reference/nuru-v2/sample-meeting.wav" "$ROOT/backend/assets/sample_meeting.wav"
fi
[ -f "$ROOT/backend/assets/sample_meeting.wav" ] || echo "WARNING: backend/assets/sample_meeting.wav is missing; the sample-audio fallback will not work."

# --- frontend ---------------------------------------------------------------
if [ ! -d "$ROOT/frontend/node_modules/@fortawesome" ]; then
  echo "-- Installing frontend dependencies (npm install)..."
  (cd "$ROOT/frontend" && npm install)
fi

# --- run --------------------------------------------------------------------
BACKEND_PID=""
TUNNEL_PID=""
cleanup() {
  echo ""
  echo "-- Stopping NURU..."
  for pid in "$TUNNEL_PID" "$BACKEND_PID"; do
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      wait "$pid" 2>/dev/null || true
    fi
  done
}
trap cleanup EXIT INT TERM

echo "-- Starting backend on http://localhost:8010 ..."
(cd "$ROOT/backend" && exec "$ROOT/backend/.venv/bin/uvicorn" app.main:app --host 127.0.0.1 --port 8010) &
BACKEND_PID=$!

if [ "$SHARE" = "1" ]; then
  if ! command -v cloudflared >/dev/null 2>&1; then
    echo ""
    echo "cloudflared is not installed, so the HTTPS share link cannot be created. Install it with:"
    echo "  wget https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64.deb"
    echo "  sudo dpkg -i cloudflared-linux-amd64.deb"
    echo "Then run ./start.sh --share again. Continuing without sharing."
    echo ""
  else
    TUNNEL_LOG="$(mktemp -t nuru-tunnel.XXXXXX)"
    cloudflared tunnel --no-autoupdate --url http://localhost:5173 >"$TUNNEL_LOG" 2>&1 &
    TUNNEL_PID=$!
    (
      for _ in $(seq 1 60); do
        URL="$(grep -Eo 'https://[a-z0-9-]+\.trycloudflare\.com' "$TUNNEL_LOG" | head -1)"
        if [ -n "$URL" ]; then
          echo ""
          echo "======================================================================"
          echo " NURU is shared at:  $URL/hub"
          echo " Scan this QR code with each phone (open it in Chrome):"
          echo "======================================================================"
          if command -v qrencode >/dev/null 2>&1; then
            qrencode -t ANSIUTF8 -m 2 "$URL/hub"
          else
            "$ROOT/backend/.venv/bin/python" - "$URL/hub" <<'PY' 2>/dev/null || echo "(install qrencode for a QR code: sudo apt install qrencode)"
import sys
try:
    import qrcode
except ImportError:
    raise SystemExit(1)
q = qrcode.QRCode(border=1)
q.add_data(sys.argv[1])
q.print_ascii(invert=True)
PY
          fi
          echo ""
          exit 0
        fi
        sleep 1
      done
      echo "WARNING: the tunnel did not report a URL within 60 s. Log: $TUNNEL_LOG"
    ) &
  fi
fi

echo ""
echo "Open http://localhost:5173/hub in Google Chrome (not Chromium). Demo password: Demo@2026"
echo "Press Ctrl+C to stop."
echo ""

cd "$ROOT/frontend"
npm run dev
