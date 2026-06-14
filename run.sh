#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="$ROOT/.venv/bin/python"
PNPM="$(command -v pnpm)"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

SERVER_PORT=8000
WEBUI_PORT=5173

cleanup() {
  echo ""
  echo "Shutting down..."
  kill $SERVER_PID $WEBUI_PID 2>/dev/null
  wait $SERVER_PID $WEBUI_PID 2>/dev/null
  echo "Done."
}

trap cleanup EXIT INT TERM

echo "Installing Python dependencies..."
$VENV_PYTHON -m pip install -r "$ROOT/server/requirements.txt" -q

echo "Installing webui dependencies..."
(cd "$ROOT/webui" && $PNPM install --silent)

if lsof -ti :$SERVER_PORT &>/dev/null; then
  echo "Killing existing process on port $SERVER_PORT..."
  lsof -ti :$SERVER_PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

if lsof -ti :$WEBUI_PORT &>/dev/null; then
  echo "Killing existing process on port $WEBUI_PORT..."
  lsof -ti :$WEBUI_PORT | xargs kill -9 2>/dev/null
  sleep 1
fi

echo ""
echo "Starting server (port $SERVER_PORT) and webui (port $WEBUI_PORT)..."
echo "  API: http://localhost:$SERVER_PORT"
echo "  Web: http://localhost:$WEBUI_PORT"
echo ""

$VENV_PYTHON "$ROOT/server/main.py" &
SERVER_PID=$!

(cd "$ROOT/webui" && $PNPM run dev) &
WEBUI_PID=$!

wait $SERVER_PID $WEBUI_PID
