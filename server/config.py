from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# ── Server ────────────────────────────────────────────────────────
SERVER_HOST = os.environ.get("IDEOGRAM4_SERVER_HOST", "0.0.0.0")
SERVER_PORT = int(os.environ.get("IDEOGRAM4_SERVER_PORT", "8000"))
SERVER_LOG_LEVEL = os.environ.get("IDEOGRAM4_SERVER_LOG_LEVEL", "info")
CORS_ORIGINS = os.environ.get("IDEOGRAM4_CORS_ORIGINS", "*")

# ── Model ─────────────────────────────────────────────────────────
MODEL_REPO = os.environ.get("IDEOGRAM4_MODEL_REPO", "ideogram-ai/ideogram-4-fp8")
MODEL_DEVICE = "mps"

# ── Paths ─────────────────────────────────────────────────────────
LOG_DIR = Path(os.environ.get("IDEOGRAM4_LOG_DIR", str(ROOT / "logs")))
DB_PATH = Path(os.environ.get("IDEOGRAM4_DB_PATH", str(ROOT / "server" / "data" / "ideogram4.db")))
OUTPUT_DIR = Path(os.environ.get("IDEOGRAM4_OUTPUT_DIR", str(ROOT / "server" / "output")))
LORA_DIR = Path(os.environ.get("IDEOGRAM4_LORA_DIR", str(ROOT / "models" / "loras")))

# ── Generation defaults ───────────────────────────────────────────
DEFAULT_PRESET = os.environ.get("IDEOGRAM4_DEFAULT_PRESET", "V4_QUALITY_48")
DEFAULT_SERVER_FORMAT = os.environ.get("IDEOGRAM4_DEFAULT_FORMAT", "webp")
DEFAULT_SEED = int(os.environ.get("IDEOGRAM4_DEFAULT_SEED", "20260608"))
IMAGE_QUALITY_WEBP = int(os.environ.get("IDEOGRAM4_IMAGE_QUALITY_WEBP", "90"))
IMAGE_QUALITY_JPEG = int(os.environ.get("IDEOGRAM4_IMAGE_QUALITY_JPEG", "95"))

# ── Warmup ────────────────────────────────────────────────────────
WARMUP_SIZE = int(os.environ.get("IDEOGRAM4_WARMUP_SIZE", "64"))
WARMUP_STEPS = int(os.environ.get("IDEOGRAM4_WARMUP_STEPS", "2"))

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
MAGIC_PROMPT_LOCAL_LLAMA = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA", "").lower() in {"1", "true", "yes", "on"}

# ── LoRA ──────────────────────────────────────────────────────────
DEFAULT_LORA_STRENGTH = float(os.environ.get("IDEOGRAM4_LORA_STRENGTH", "0.6"))

# ── DB ────────────────────────────────────────────────────────────
DB_QUERY_LIMIT = int(os.environ.get("IDEOGRAM4_DB_QUERY_LIMIT", "50"))
