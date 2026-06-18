#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
VENV_PYTHON="$ROOT/.venv/bin/python"
PNPM="${PNPM:-$(command -v pnpm || true)}"

if [ -f "$ROOT/.env" ]; then
  set -a
  # shellcheck source=/dev/null
  source "$ROOT/.env"
  set +a
fi

SERVER_PORT="${IDEOGRAM4_SERVER_PORT:-8000}"
MODEL_DAEMON_PORT="${IDEOGRAM4_MODEL_DAEMON_PORT:-8001}"
MODEL_DAEMON_URL="${IDEOGRAM4_MODEL_DAEMON_URL:-http://127.0.0.1:${MODEL_DAEMON_PORT}}"
WEBUI_PORT="${IDEOGRAM4_WEBUI_PORT:-5173}"
WEBUI_HOST="${IDEOGRAM4_WEBUI_HOST:-127.0.0.1}"
MAGIC_LLM_PID=""
CLEANED_UP=0

usage() {
  cat <<EOF
Usage:
  ./run.sh [mode]

Modes:
  full      Restart model daemon, FastAPI server, and WebUI. Default.
  backend   Restart only the FastAPI server; keep model daemon and WebUI running.
  client    Restart only the Vite WebUI; keep backend and model daemon running.
  doctor    Check local dependencies, model files, ports, and memory policy.

Aliases:
  all -> full
  server, api -> backend
  webui, frontend -> client
  check -> doctor
EOF
}

MODE="${1:-full}"
if [ "$#" -gt 1 ]; then
  usage >&2
  exit 1
fi

case "$MODE" in
  full|all|--full|--all)
    MODE="full"
    ;;
  backend|server|api|--backend|--server|--api)
    MODE="backend"
    ;;
  client|webui|frontend|--client|--webui|--frontend)
    MODE="client"
    ;;
  doctor|check|--doctor|--check)
    MODE="doctor"
    ;;
  help|-h|--help)
    usage
    exit 0
    ;;
  *)
    echo "Unknown mode: $MODE" >&2
    usage >&2
    exit 1
    ;;
esac

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

require_pnpm() {
  if [ -z "$PNPM" ]; then
    echo "pnpm was not found in PATH." >&2
    exit 1
  fi
}

install_python_deps() {
  echo "Installing Python dependencies..."
  "$VENV_PYTHON" -m pip install -r "$ROOT/server/requirements.txt" -q
}

install_webui_deps() {
  require_pnpm
  echo "Installing webui dependencies..."
  (cd "$ROOT/webui" && "$PNPM" install --silent)
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
  if [ "$CLEANED_UP" = "1" ]; then
    return
  fi
  CLEANED_UP=1

  echo ""
  echo "Shutting down..."
  for pid in "${SERVER_PID:-}" "${MODEL_DAEMON_PID:-}" "${WEBUI_PID:-}" "${MAGIC_LLM_PID:-}"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  for pid in "${SERVER_PID:-}" "${MODEL_DAEMON_PID:-}" "${WEBUI_PID:-}" "${MAGIC_LLM_PID:-}"; do
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

warn_if_model_daemon_unreachable() {
  if curl -sf "${MODEL_DAEMON_URL%/}/health" >/dev/null 2>&1; then
    return
  fi

  echo "Warning: model daemon is not reachable at ${MODEL_DAEMON_URL%/}." >&2
  echo "FastAPI will still start, but image generation needs the daemon." >&2
}

run_full() {
  install_python_deps
  install_webui_deps

  stop_port "$SERVER_PORT" "server"
  stop_port "$MODEL_DAEMON_PORT" "model daemon"
  stop_port "$WEBUI_PORT" "webui"
  start_magic_llm

  echo ""
  echo "Starting model daemon (port $MODEL_DAEMON_PORT), server (port $SERVER_PORT), and webui (port $WEBUI_PORT)..."
  echo "  Model: http://localhost:$MODEL_DAEMON_PORT"
  echo "  API:   http://localhost:$SERVER_PORT"
  echo "  Web:   http://localhost:$WEBUI_PORT"
  echo ""

  "$VENV_PYTHON" "$ROOT/server/model_daemon.py" &
  MODEL_DAEMON_PID=$!

  wait_for_http "http://127.0.0.1:${MODEL_DAEMON_PORT}/health" "Model daemon" 60

  "$VENV_PYTHON" "$ROOT/server/main.py" &
  SERVER_PID=$!

  wait_for_http "http://127.0.0.1:${SERVER_PORT}/api/model/status" "FastAPI server" 60
  if is_enabled "${IDEOGRAM4_MODEL_DAEMON_AUTOLOAD:-0}"; then
    wait_for_model_loaded 300
  else
    echo "Model daemon autoload disabled; use the WebUI Load button or POST /api/model/load when needed."
  fi

  (cd "$ROOT/webui" && "$PNPM" run dev --host "$WEBUI_HOST" --port "$WEBUI_PORT") &
  WEBUI_PID=$!

  wait "$SERVER_PID" "$WEBUI_PID"
}

run_backend() {
  install_python_deps
  warn_if_model_daemon_unreachable

  stop_port "$SERVER_PORT" "server"

  echo ""
  echo "Starting FastAPI server only (port $SERVER_PORT)..."
  echo "  API:   http://localhost:$SERVER_PORT"
  echo "  Model: ${MODEL_DAEMON_URL%/} (kept running)"
  echo ""

  "$VENV_PYTHON" "$ROOT/server/main.py" &
  SERVER_PID=$!

  wait_for_http "http://127.0.0.1:${SERVER_PORT}/api/model/status" "FastAPI server" 60
  wait "$SERVER_PID"
}

run_client() {
  install_webui_deps

  stop_port "$WEBUI_PORT" "webui"

  echo ""
  echo "Starting WebUI only (port $WEBUI_PORT)..."
  echo "  Web:   http://localhost:$WEBUI_PORT"
  echo "  API:   http://localhost:$SERVER_PORT (kept running)"
  echo ""

  (cd "$ROOT/webui" && "$PNPM" run dev --host "$WEBUI_HOST" --port "$WEBUI_PORT") &
  WEBUI_PID=$!

  wait "$WEBUI_PID"
}

run_doctor() {
  local doctor_python="$VENV_PYTHON"
  if [ ! -x "$doctor_python" ]; then
    doctor_python="${PYTHON:-$(command -v python3 || true)}"
  fi
  if [ -z "$doctor_python" ]; then
    echo "No Python interpreter found for doctor checks." >&2
    exit 1
  fi
  "$doctor_python" "$ROOT/scripts/doctor.py"
}

if [ "$MODE" = "doctor" ]; then
  run_doctor
  exit $?
fi

trap cleanup EXIT INT TERM

case "$MODE" in
  full) run_full ;;
  backend) run_backend ;;
  client) run_client ;;
esac
