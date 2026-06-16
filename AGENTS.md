# AGENTS.md — Ideogram 4 MPS

## Architecture

2-tier, local-only: **WebUI (:5173 default) → FastAPI (:8000 default)**

- **FastAPI** (`server/main.py`) owns the Ideogram 4 pipeline in the same process.
  Handles model load/unload, generation, image persistence, and SQLite storage.
  Uses `threading.Thread` for pipeline load and generation (FastAPI is async,
  but pipeline ops are CPU/MPS-bound). Model load, unload, LoRA apply/remove,
  and generation share a pipeline operation lock.
- **Model management** (`server/model_daemon.py`) is a plain module with no HTTP
  server. Imported directly by `main.py`. Exposes `handle_load()`, `handle_unload()`,
  `handle_status()`, `get_pipeline()`.
- **Configuration** (`server/config.py`) reads server settings from environment
  variables at import time. `run.sh` auto-loads `.env` from project root and
  also reads `IDEOGRAM4_WEBUI_PORT`. Single source of truth for paths, ports,
  defaults, and tuning parameters.
- **WebUI** (`webui/`) React + TypeScript + Vite. Proxies `/api/*` to
  `IDEOGRAM4_SERVER_PORT` via `vite.config.ts`.

## Open-source extensibility

This project should be implemented as reusable open-source software, not as a
single-machine integration. Prefer provider-neutral interfaces, documented
environment variables, and small adapters over hard-coded model names, absolute
local paths, private credentials, or assumptions about one user's toolchain.

- Keep defaults conservative and broadly runnable. Optional local/provider
  integrations must be opt-in, clearly named, and safe to disable.
- Treat OpenAI-compatible LLMs, local llama.cpp servers, hosted providers, and
  future prompt expanders as interchangeable backends behind the same API
  contract whenever practical.
- Put machine-specific paths, ports, model files, tokens, and tuning knobs in
  `.env` / `.env.example`; never bake personal filesystem paths or private
  service details into source code.
- Design feature additions so unsupported capabilities degrade clearly:
  text-only should still work when image input, a multimodal projector, or a
  local server is unavailable.
- Normalize provider quirks at the boundary, then keep internal caption,
  generation, storage, and WebUI contracts stable.
- Document every new integration with the exact environment variables, expected
  process topology, failure modes, and minimal verification command.

## Commands

### One-shot launch (everything)
```bash
./run.sh
```
Stops existing processes on configured server/webui ports (graceful first,
force stop only if needed), installs deps, starts server→webui. Cleans up on
SIGINT/SIGTERM/EXIT.

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
- **Generation uses `threading.Thread`**, not `asyncio`. The pipeline runs in
  the main process in a daemon thread. This avoids GIL issues since pytorch
  operations release the GIL.
- **Generation is local single-slot.** Only one generation is accepted at a
  time. Extra `/api/generate` requests return HTTP `409` instead of queuing
  unbounded work. Completed task status entries are cleaned after ~1 hour.
- **Raw JSON mode is authoritative.** If `rawJson` is present in WebUI state,
  generation submits that JSON object directly.

## Logging

All processes write to `logs/<name>-<timestamp>.log` (gitignored). Flat
structured format with timestamps. Set `IDEOGRAM4_LOG_DIR` to override path.
Generation metadata `.log` files (`examples/result.log`) are checked into git — don't
delete them.

## Magic Prompt

Natural language → structured caption via LLM (WebUI Quick Prompt card).
Server module: `server/magic_prompt.py`. API: `POST /api/magic-prompt`.

Uses a configurable OpenAI-compatible LLM provider. Local `llama.cpp` can be
enabled with `IDEOGRAM4_MAGIC_PROMPT_PROVIDER=llama_cpp`. Supports text-only
and text+image (multi-image base64) input when the selected provider/model
supports vision.

Failure modes surface as toast: "Failed to expand prompt: IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set".

## Configuration

All settings are read from environment variables at import time by `server/config.py`.
`run.sh` auto-loads `.env` from the project root. See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `IDEOGRAM4_MAGIC_PROMPT_API_KEY` | — | LLM API key for Quick Prompt (use `local` for unauthenticated local servers) |
| `IDEOGRAM4_MAGIC_PROMPT_PROVIDER` | `openai_compatible` | Provider behavior: `openai_compatible` or `llama_cpp` |
| `IDEOGRAM4_MAGIC_PROMPT_MODEL` | `local-model` | LLM model for prompt expansion |
| `IDEOGRAM4_MAGIC_PROMPT_BASE_URL` | `http://127.0.0.1:18082/v1` | LLM provider base URL |
| `IDEOGRAM4_MAGIC_PROMPT_PROMPT_PROFILE` | provider-specific | Prompt profile: `ideogram_official`, `compact_json`, or `gemma4` |
| `IDEOGRAM4_MAGIC_PROMPT_RESPONSE_FORMAT` | `off` | Optional structured output request mode; currently `off` or `json_object` |
| `IDEOGRAM4_MAGIC_PROMPT_TOKEN_PARAM` | `max_tokens` | Token budget parameter name: `max_tokens` or `max_completion_tokens` |
| `IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA` | — | If truthy, `run.sh` starts/stops a local `llama-server` |
| `IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_PORT` | `18082` | Managed local `llama-server` port |
| `IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL` | — | Managed local GGUF model path |
| `IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MMPROJ` | — | Optional managed local multimodal projector GGUF path |
| `IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_CTX` | `8192` | Managed local `llama-server` context size |
| `IDEOGRAM4_MAGIC_PROMPT_TIMEOUT` | `120` | LLM request timeout (seconds) |
| `IDEOGRAM4_MAGIC_PROMPT_MAX_TOKENS` | `16384` | LLM max response tokens |
| `IDEOGRAM4_MAGIC_PROMPT_TEMPERATURE` | `1.0` | LLM temperature |
| `IDEOGRAM4_SERVER_HOST` | `0.0.0.0` | FastAPI bind host |
| `IDEOGRAM4_SERVER_PORT` | `8000` | FastAPI listen port |
| `IDEOGRAM4_WEBUI_PORT` | `5173` | Vite WebUI dev server port used by `run.sh` |
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
