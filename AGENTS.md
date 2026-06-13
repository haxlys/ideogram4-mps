# AGENTS.md — Ideogram 4 MPS

## Architecture

2-tier, local-only: **WebUI (:5173) → FastAPI (:8000)**

- **FastAPI** (`server/main.py`) owns the Ideogram 4 pipeline in the same process.
  Handles model load/unload, generation, image persistence, and SQLite storage.
  Uses `threading.Thread` for pipeline load and generation (FastAPI is async,
  but pipeline ops are CPU-only).
- **Model management** (`server/model_daemon.py`) is a plain module with no HTTP
  server. Imported directly by `main.py`. Exposes `handle_load()`, `handle_unload()`,
  `handle_status()`, `get_pipeline()`.
- **Configuration** (`server/config.py`) reads all settings from environment variables
  at import time. `run.sh` auto-loads `.env` from project root. Single source of truth
  for paths, ports, defaults, and tuning parameters.
- **WebUI** (`webui/`) React + TypeScript + Vite. Proxies `/api/*` to `:8000` via
  `vite.config.ts`.

## Commands

### One-shot launch (everything)
```bash
./run.sh
```
Kills existing processes on 8000/5173, installs deps, starts server→webui.
Cleans up on SIGINT/SIGTERM/EXIT.

### Manual (debugging — 2 terminals in this order)
```bash
set -a && source .env && set +a  # load env vars
python server/main.py            # terminal 1
cd webui && pnpm dev             # terminal 2
```

### CLI generation (no server needed)
```bash
python ideogram4_mps.py --prompt-file examples/caption.json --out examples/result.png
```

### WebUI-only
```bash
cd webui && pnpm dev             # development
cd webui && pnpm build           # typecheck + production build → dist/
cd webui && pnpm lint            # ESLint
```

- Use **pnpm**, not npm/yarn.
- No tests exist. There is no test command.

## Critical gotchas

- **`ideogram4` is not on PyPI.** Must install from GitHub:
  `pip install git+https://github.com/ideogram-oss/ideogram4.git`
- **Model repo is gated.** Requires HuggingFace account that accepted terms at
  https://huggingface.co/ideogram-ai/ideogram-4-fp8. Use `hf auth login` (NOT
  the deprecated `huggingface-cli login`).
- **`PYTORCH_ENABLE_MPS_FALLBACK=1`** is set automatically in both
  `ideogram4_mps.py` and `model_daemon.py`. Required for `ndtri` op (MPS
  doesn't support it). Never override.
- **`PYTORCH_MPS_FAST_MATH=1`** is set automatically in both
  `ideogram4_mps.py` and `model_daemon.py`. Enables MPS fast math kernels.
  Small resolution generation shows ~40% speedup on M4 Pro; large resolution
  marginal gain. Override with `PYTORCH_MPS_FAST_MATH=0` if numerical issues
  are suspected.
- **Apple Silicon only.** M1+ required. ~50 GB unified memory for 1024×1024
  V4_QUALITY_48. No CUDA/NVIDIA support.
- **Generation uses `threading.Thread`**, not `asyncio`. The pipeline runs on
  the main process in a daemon thread. This avoids GIL issues since pytorch
  operations release the GIL.

## Logging

All processes write to `logs/<name>-<timestamp>.log` (gitignored). Flat
structured format with timestamps. Set `IDEOGRAM4_LOG_DIR` to override path.
Generation metadata `.log` files (`examples/result.log`) are checked into git — don't
delete them.

## Magic Prompt

Natural language → structured caption via LLM (WebUI Quick Prompt card).
Server module: `server/magic_prompt.py`. API: `POST /api/magic-prompt`.

Uses `MiniMaxAI/MiniMax-M3` on commandcode.ai (OpenAI-compatible). Supports
text-only and text+image (multi-image base64) input.

Failure modes surface as toast: "Failed to expand prompt: IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set".

## Configuration

All settings are read from environment variables at import time by `server/config.py`.
`run.sh` auto-loads `.env` from the project root. See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `IDEOGRAM4_MAGIC_PROMPT_API_KEY` | — | LLM API key for Quick Prompt (required) |
| `IDEOGRAM4_MAGIC_PROMPT_MODEL` | `MiniMaxAI/MiniMax-M3` | LLM model for prompt expansion |
| `IDEOGRAM4_MAGIC_PROMPT_BASE_URL` | `https://api.commandcode.ai/provider/v1` | LLM provider base URL |
| `IDEOGRAM4_MAGIC_PROMPT_TIMEOUT` | `120` | LLM request timeout (seconds) |
| `IDEOGRAM4_MAGIC_PROMPT_MAX_TOKENS` | `16384` | LLM max response tokens |
| `IDEOGRAM4_MAGIC_PROMPT_TEMPERATURE` | `1.0` | LLM temperature |
| `IDEOGRAM4_SERVER_HOST` | `0.0.0.0` | FastAPI bind host |
| `IDEOGRAM4_SERVER_PORT` | `8000` | FastAPI listen port |
| `IDEOGRAM4_SERVER_LOG_LEVEL` | `info` | Uvicorn log level |
| `IDEOGRAM4_CORS_ORIGINS` | `*` | CORS allow-origins |
| `IDEOGRAM4_MODEL_REPO` | `ideogram-ai/ideogram-4-fp8` | HuggingFace model repo |
| `IDEOGRAM4_DEFAULT_PRESET` | `V4_QUALITY_48` | Default generation preset |
| `IDEOGRAM4_DEFAULT_FORMAT` | `webp` | Default output format (server) |
| `IDEOGRAM4_DEFAULT_SEED` | `20260608` | Default generation seed |
| `IDEOGRAM4_IMAGE_QUALITY_WEBP` | `90` | WebP lossy quality |
| `IDEOGRAM4_IMAGE_QUALITY_JPEG` | `95` | JPEG lossy quality |
| `IDEOGRAM4_LOG_DIR` | `logs/` | Log output directory |
| `IDEOGRAM4_DB_PATH` | `server/data/ideogram4.db` | SQLite database path |
| `IDEOGRAM4_OUTPUT_DIR` | `server/output/` | Generated image output dir |
| `IDEOGRAM4_LORA_DIR` | `models/loras/` | LoRA weight files dir |
| `IDEOGRAM4_LORA_STRENGTH` | `0.6` | Default LoRA merge strength |
| `IDEOGRAM4_WARMUP_SIZE` | `64` | Warmup resolution (width=height) |
| `IDEOGRAM4_WARMUP_STEPS` | `2` | Warmup step count |
| `IDEOGRAM4_DB_QUERY_LIMIT` | `50` | Default row limit for DB queries |

## LoRA

LoRA weights (Lokr or standard lora_A/lora_B format) are merged directly into
the `conditional_transformer` and `unconditional_transformer` state dicts.
No runtime adapter overhead — weights are patched once, then inference runs
at native speed. Original weights are backed up and restored on remove.

### API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/lora/status` | List available LoRAs + currently applied |
| `POST` | `/api/lora/apply` | Apply LoRA by name with strength |
| `POST` | `/api/lora/remove` | Restore original weights |

### File locations

- `server/apply_lora.py` — `apply_lokr_lora()` and `apply_std_lora()` merge logic
- `server/model_daemon.py` — `apply_lora()`, `remove_lora()`, `list_loras()`, `get_lora_status()`
- `models/loras/` (gitignored) — `.safetensors` weight files
- LoRA is auto-detected (Lokr vs standard) by inspecting tensor keys.

### CLI

```bash
python ideogram4_mps.py --lora models/loras/foo.safetensors --lora-strength 0.6 ...
```

### Known issue: MPSGraph recompile overhead

Merging LoRA changes weights→triggers MPSGraph JIT recompile on next inference.
Mitigated by running a small warmup inference immediately after `apply_lora()`
and `remove_lora()` via `_warmup_pipeline()`. The warmup cost is now paid at
apply/remove time rather than on the first user generation.

## Unused dependencies (do not add code that relies on these)

WebUI `package.json` lists `@hookform/resolvers`, `react-hook-form`, `zod` but
they are not imported. Form state uses `useReducer` + controlled inputs.
