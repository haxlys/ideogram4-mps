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

SERVER_PORT="${IDEOGRAM4_SERVER_PORT:-8000}"
WEBUI_PORT="${IDEOGRAM4_WEBUI_PORT:-5173}"
WEBUI_HOST="${IDEOGRAM4_WEBUI_HOST:-127.0.0.1}"
MAGIC_LLM_PID=""

is_enabled() {
  case "${1:-}" in
    1|true|TRUE|yes|YES|on|ON) return 0 ;;
    *) return 1 ;;
  esac
}

should_manage_magic_llm() {
  if is_enabled "${IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA:-}"; then
    return 0
  fi
  if is_enabled "${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA:-}" && [ -n "${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL:-}" ]; then
    return 0
  fi
  return 1
}

stop_port() {
  local port="$1"
  local label="$2"
  local pids
  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -z "$pids" ]; then
    return
  fi

  echo "Stopping existing process on $label port $port..."
  kill $pids 2>/dev/null || true
  sleep 1

  pids="$(lsof -ti :"$port" 2>/dev/null || true)"
  if [ -n "$pids" ]; then
    echo "Force stopping process on $label port $port..."
    kill -9 $pids 2>/dev/null || true
    sleep 1
  fi
}

cleanup() {
  echo ""
  echo "Shutting down..."
  for pid in "${SERVER_PID:-}" "${WEBUI_PID:-}" "${MAGIC_LLM_PID:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${SERVER_PID:-}" "${WEBUI_PID:-}" "${MAGIC_LLM_PID:-}"; do
    if [ -n "$pid" ]; then
      wait "$pid" 2>/dev/null || true
    fi
  done
  echo "Done."
}

wait_for_http() {
  local url="$1"
  local label="$2"
  local tries="${3:-120}"

  for _ in $(seq 1 "$tries"); do
    if curl -sf "$url" >/dev/null 2>&1; then
      return 0
    fi
    sleep 1
  done

  echo "$label did not become ready: $url" >&2
  return 1
}

wait_for_model_loaded() {
  local tries="${1:-300}"
  local status_url="http://127.0.0.1:${SERVER_PORT}/api/model/status"

  echo "Waiting for Ideogram model to finish auto-loading..."
  for _ in $(seq 1 "$tries"); do
    local state
    state="$(
      curl -sf "$status_url" 2>/dev/null \
        | "$VENV_PYTHON" -c 'import sys,json; print(json.load(sys.stdin).get("state",""))' 2>/dev/null \
        || true
    )"
    if [ "$state" = "loaded" ]; then
      echo "Ideogram model loaded."
      return 0
    fi
    sleep 1
  done

  echo "Ideogram model did not finish loading within ${tries}s (may still be loading in background)." >&2
  return 0
}

start_magic_llm() {
  if ! should_manage_magic_llm; then
    return
  fi

  local llama_server
  llama_server="$(command -v llama-server || true)"
  if [ -z "$llama_server" ]; then
    echo "IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA=1 but llama-server was not found in PATH." >&2
    exit 1
  fi

  local model="${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL:-}"
  local mmproj="${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MMPROJ:-}"
  local port="${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_PORT:-18082}"
  local ctx="${IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_CTX:-8192}"
  local alias="${IDEOGRAM4_MAGIC_PROMPT_MODEL:-local-gemma4}"

  if [ ! -f "$model" ]; then
    echo "Local magic prompt model not found: $model" >&2
    exit 1
  fi
  if [ -n "$mmproj" ] && [ ! -f "$mmproj" ]; then
    echo "Local magic prompt mmproj not found: $mmproj" >&2
    exit 1
  fi

  stop_port "$port" "magic prompt llm"

  mkdir -p "${IDEOGRAM4_LOG_DIR:-$ROOT/logs}"
  local llm_log="${IDEOGRAM4_LOG_DIR:-$ROOT/logs}/magic-llm-$(date +%Y%m%d-%H%M%S).log"
  local llama_args=(
    -m "$model"
    --host 127.0.0.1
    --port "$port"
    --ctx-size "$ctx"
    --parallel 1
    --no-ui
    --alias "$alias"
    --reasoning off
    --reasoning-format none
  )
  if [ -n "$mmproj" ]; then
    llama_args+=(--mmproj "$mmproj")
  fi

  echo "Starting local magic prompt LLM (port $port)..."
  "$llama_server" "${llama_args[@]}" > "$llm_log" 2>&1 &
  MAGIC_LLM_PID=$!

  wait_for_http "http://127.0.0.1:$port/health" "Local magic prompt LLM" 180
}

trap cleanup EXIT INT TERM

echo "Installing Python dependencies..."
$VENV_PYTHON -m pip install -r "$ROOT/server/requirements.txt" -q

echo "Installing webui dependencies..."
(cd "$ROOT/webui" && $PNPM install --silent)

stop_port "$SERVER_PORT" "server"
stop_port "$WEBUI_PORT" "webui"
start_magic_llm

echo ""
echo "Starting server (port $SERVER_PORT) and webui (port $WEBUI_PORT)..."
echo "  API: http://localhost:$SERVER_PORT"
echo "  Web: http://localhost:$WEBUI_PORT"
echo ""

$VENV_PYTHON "$ROOT/server/main.py" &
SERVER_PID=$!

wait_for_http "http://127.0.0.1:${SERVER_PORT}/api/model/status" "FastAPI server" 60
wait_for_model_loaded 300

(cd "$ROOT/webui" && $PNPM run dev -- --host "$WEBUI_HOST" --port "$WEBUI_PORT") &
WEBUI_PID=$!

wait $SERVER_PID $WEBUI_PID
