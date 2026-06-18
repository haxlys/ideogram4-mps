from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _truthy_env(name: str, default: bool = False) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}

# ── Server ────────────────────────────────────────────────────────
WEBUI_PORT = int(os.environ.get("IDEOGRAM4_WEBUI_PORT", "5173"))
SERVER_HOST = os.environ.get("IDEOGRAM4_SERVER_HOST", "127.0.0.1")
SERVER_PORT = int(os.environ.get("IDEOGRAM4_SERVER_PORT", "8000"))
SERVER_LOG_LEVEL = os.environ.get("IDEOGRAM4_SERVER_LOG_LEVEL", "info")
MODEL_DAEMON_HOST = os.environ.get("IDEOGRAM4_MODEL_DAEMON_HOST", "127.0.0.1")
MODEL_DAEMON_PORT = int(os.environ.get("IDEOGRAM4_MODEL_DAEMON_PORT", "8001"))
MODEL_DAEMON_LOG_LEVEL = os.environ.get("IDEOGRAM4_MODEL_DAEMON_LOG_LEVEL", SERVER_LOG_LEVEL)
MODEL_DAEMON_URL = os.environ.get(
    "IDEOGRAM4_MODEL_DAEMON_URL",
    f"http://{MODEL_DAEMON_HOST}:{MODEL_DAEMON_PORT}",
).rstrip("/")
MODEL_DAEMON_TIMEOUT = float(os.environ.get("IDEOGRAM4_MODEL_DAEMON_TIMEOUT", "30.0"))
CORS_ORIGINS = os.environ.get(
    "IDEOGRAM4_CORS_ORIGINS",
    f"http://127.0.0.1:{WEBUI_PORT},http://localhost:{WEBUI_PORT}",
)
CORS_ALLOW_CREDENTIALS = _truthy_env("IDEOGRAM4_CORS_ALLOW_CREDENTIALS")

# ── Model ─────────────────────────────────────────────────────────
MODEL_REPO = os.environ.get("IDEOGRAM4_MODEL_REPO", "MLXBits/ideogram-4-mlx-q8")
MODEL_REVISION = os.environ.get("IDEOGRAM4_MODEL_REVISION", "").strip() or None
_MODEL_PATH_RAW = os.environ.get("IDEOGRAM4_MODEL_PATH", "").strip()
MODEL_DAEMON_AUTOLOAD = _truthy_env("IDEOGRAM4_MODEL_DAEMON_AUTOLOAD", False)

# ── Paths ─────────────────────────────────────────────────────────
def _resolve_path(value: str, default: Path) -> Path:
    path = Path(value) if value else default
    return path if path.is_absolute() else (ROOT / path)


LOG_DIR = _resolve_path(os.environ.get("IDEOGRAM4_LOG_DIR", ""), ROOT / "logs")
DB_PATH = _resolve_path(os.environ.get("IDEOGRAM4_DB_PATH", ""), ROOT / "server" / "data" / "ideogram4.db")
OUTPUT_DIR = _resolve_path(os.environ.get("IDEOGRAM4_OUTPUT_DIR", ""), ROOT / "server" / "output")
LORA_DIR = _resolve_path(os.environ.get("IDEOGRAM4_LORA_DIR", ""), ROOT / "models" / "loras")
MODEL_PATH = _resolve_path(_MODEL_PATH_RAW, ROOT / _MODEL_PATH_RAW) if _MODEL_PATH_RAW else None

# ── Generation defaults ───────────────────────────────────────────
DEFAULT_PRESET = os.environ.get("IDEOGRAM4_DEFAULT_PRESET", "V4_QUALITY_48")
DEFAULT_SERVER_FORMAT = os.environ.get("IDEOGRAM4_DEFAULT_FORMAT", "webp")
DEFAULT_SEED = int(os.environ.get("IDEOGRAM4_DEFAULT_SEED", "20260608"))
IMAGE_QUALITY_WEBP = int(os.environ.get("IDEOGRAM4_IMAGE_QUALITY_WEBP", "90"))
IMAGE_QUALITY_JPEG = int(os.environ.get("IDEOGRAM4_IMAGE_QUALITY_JPEG", "95"))
MIN_IMAGE_SIZE = int(os.environ.get("IDEOGRAM4_MIN_IMAGE_SIZE", "256"))
MAX_IMAGE_SIZE = int(os.environ.get("IDEOGRAM4_MAX_IMAGE_SIZE", "2048"))
IMAGE_SIZE_MULTIPLE = int(os.environ.get("IDEOGRAM4_IMAGE_SIZE_MULTIPLE", "16"))
MAX_CAPTION_JSON_BYTES = int(os.environ.get("IDEOGRAM4_MAX_CAPTION_JSON_BYTES", str(256 * 1024)))
MLX_CACHE_LIMIT_GB_RAW = os.environ.get("IDEOGRAM4_MLX_CACHE_LIMIT_GB", "").strip()
MLX_CACHE_LIMIT_GB = float(MLX_CACHE_LIMIT_GB_RAW) if MLX_CACHE_LIMIT_GB_RAW else None

# ── Magic prompt (LLM) ────────────────────────────────────────────
MAGIC_PROMPT_API_KEY = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_API_KEY", "")
MAGIC_PROMPT_MODEL = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MODEL", "local-model")
MAGIC_PROMPT_BASE_URL = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_BASE_URL", "http://127.0.0.1:18082/v1")
MAGIC_PROMPT_TIMEOUT = float(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_TIMEOUT", "120.0"))
MAGIC_PROMPT_MAX_TOKENS = int(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MAX_TOKENS", "16384"))
MAGIC_PROMPT_TEMPERATURE = float(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_TEMPERATURE", "1.0"))
MAGIC_PROMPT_PROVIDER = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_PROVIDER", "").strip().lower()
MAGIC_PROMPT_PROMPT_PROFILE = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_PROMPT_PROFILE", "").strip().lower()
MAGIC_PROMPT_RESPONSE_FORMAT = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_RESPONSE_FORMAT", "off").strip().lower()
MAGIC_PROMPT_TOKEN_PARAM = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_TOKEN_PARAM", "max_tokens").strip()
MAGIC_PROMPT_LOCAL_LLAMA = _truthy_env("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA")
MAGIC_PROMPT_MANAGED_LLAMA = _truthy_env("IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA")
MAGIC_PROMPT_LOCAL_LLAMA_CTX = int(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_CTX", "8192"))
MAGIC_PROMPT_MAX_CHARS = int(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MAX_CHARS", "12000"))
MAGIC_PROMPT_MAX_IMAGES = int(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MAX_IMAGES", "4"))
MAGIC_PROMPT_MAX_IMAGE_BYTES = int(os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MAX_IMAGE_BYTES", str(6 * 1024 * 1024)))

# ── API payload limits ─────────────────────────────────────────────
MAX_FORM_JSON_BYTES = int(os.environ.get("IDEOGRAM4_MAX_FORM_JSON_BYTES", str(1024 * 1024)))

# ── LoRA ──────────────────────────────────────────────────────────
DEFAULT_LORA_STRENGTH = float(os.environ.get("IDEOGRAM4_LORA_STRENGTH", "0.6"))

# ── DB ────────────────────────────────────────────────────────────
DB_QUERY_LIMIT = int(os.environ.get("IDEOGRAM4_DB_QUERY_LIMIT", "50"))
