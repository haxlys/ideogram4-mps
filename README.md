# Ideogram 4 on Apple Silicon (MPS)

[![Gallery](https://img.shields.io/badge/Gallery-ideogram4--gallery-blue?style=for-the-badge)](https://ideogram4-gallery-dev.haxlys.workers.dev/)

Run [Ideogram 4](https://huggingface.co/ideogram-ai/ideogram-4-fp8) on a MacBook
with MPS — no CUDA, no NVIDIA GPU needed.

FP8 weights are dequantized to bf16 on CPU, then the full model is loaded onto
MPS. Three non-obvious tricks make this work: a monkey-patch around MPS's missing
`ndtri` op, manual fp8→bf16 dequant that avoids bitsandbytes entirely, and
loading the Qwen3-VL text encoder without its vision components.

A **WebUI** (FastAPI + React + SQLite) is included for interactive use with
structured prompt composition, generation progress tracking, image history, and
prompt history.

## Quick start

### CLI (single image)

```bash
# 1. Create venv and install deps
python3 -m venv .venv && source .venv/bin/activate
pip install git+https://github.com/ideogram-oss/ideogram4.git
pip install -r server/requirements.txt

# 2. Log in and accept the gated repo terms at
#    https://huggingface.co/ideogram-ai/ideogram-4-fp8
hf auth login

# 3. Generate
python ideogram4_mps.py \
  --prompt-file examples/caption.json \
  --resolution 1024 \
  --preset V4_QUALITY_48 \
  --out examples/result.png
```

### WebUI (full stack)

```bash
# 1. Create venv and install Python deps
python3 -m venv .venv && source .venv/bin/activate
pip install git+https://github.com/ideogram-oss/ideogram4.git
pip install -r server/requirements.txt

# 2. Install Node deps
cd webui && pnpm install && cd ..

# 3. Configure Quick Prompt (optional but recommended)
cp .env.example .env
# Edit .env: set IDEOGRAM4_MAGIC_PROMPT_API_KEY

# 4. Log in to HuggingFace
hf auth login

# 5. Launch
./run.sh
```

Then open http://localhost:5173.

> **Note:** `ideogram4` is not published on PyPI. `pip install git+...` pulls it
> directly from the [official GitHub repo](https://github.com/ideogram-oss/ideogram4).
> `huggingface-cli login` is deprecated — use `hf auth login` instead.

## Model download

The model weights (~26 GB, FP8 safetensors) are **not** included in this repo.
They are downloaded automatically from HuggingFace on first pipeline load — you
don't need to run a separate download command. Weights are cached to
`~/.cache/huggingface/hub/`.

To pre-download without running inference:

```bash
source .venv/bin/activate
hf download ideogram-ai/ideogram-4-fp8
```

> The download above is optional. The model auto-downloads on first load either way.

### Prerequisites

1. **License**: Accept the terms at
   [https://huggingface.co/ideogram-ai/ideogram-4-fp8](https://huggingface.co/ideogram-ai/ideogram-4-fp8)
   (**"Agree and access repository"** button).

2. **Token permissions**: If using a **fine-grained** token, you must enable
   **"Read access to contents of all public gated repos you can access"** in
   [your token settings](https://huggingface.co/settings/tokens). The simplest
   option is to create a **Read**-scoped token (not fine-grained) and use it with
   `hf auth login`.

## Architecture

```
Browser (localhost:5173 by default)
    │
    │ HTTP (Vite dev proxy /api → localhost:8000 by default)
    ▼
FastAPI Server (server/main.py, port 8000 by default)
    │
    ├── model_daemon.py    ← model lifecycle, LoRA, get_pipeline()
    │     ├── LoRA apply/remove (server/apply_lora.py)
    │     │     Lokr / standard weight merge → load_state_dict()
    │     └── Ideogram4Pipeline (MPS)
    │           FP8 → bf16 on CPU → MPS
    │           Qwen3-VL text encoder (text-only)
    │           Conditional + Unconditional transformers
    │           VAE autoencoder
    │
    ├── magic_prompt.py    ← POST /api/magic-prompt → OpenAI-compatible LLM
    │
    ├── config.py          ← env var config (paths, ports, defaults)
    │
    ├── db.py              ← SQLite (images, prompts, form state)
    │
    └── logger.py          ← structured logs → logs/
```

### Key ports

| Default port | Variable | Process | Role |
|--------------|----------|---------|------|
| 8000 | `IDEOGRAM4_SERVER_PORT` | `main.py` | FastAPI server, pipeline owner, SQLite |
| 5173 | `IDEOGRAM4_WEBUI_PORT` | Vite dev server | React WebUI with proxy to `IDEOGRAM4_SERVER_PORT` |

### Startup flow (`./run.sh`)

1. Installs Python + Node dependencies
2. Loads `.env` from project root (if present)
3. Stops existing processes on the configured server/webui ports (graceful stop first, force stop only if needed)
4. Starts server and webui on the configured ports in parallel
5. Cleans up all processes on SIGINT / SIGTERM / EXIT

### Manual startup (for debugging)

```bash
# Load env vars, then:
# Terminal 1: API Server
set -a && source .env && set +a
python server/main.py

# Terminal 2: WebUI
cd webui && pnpm dev -- --port "${IDEOGRAM4_WEBUI_PORT:-5173}"
```

![WebUI screenshot](examples/webui-screenshot.png)

## WebUI features

- **Model Panel** — Load / Unload controls with live status indicator (idle / loading / loaded)
- **Quick Prompt** — Natural language → structured caption via configurable OpenAI-compatible LLM provider. Supports hosted providers and local `llama.cpp` servers, text-only and text+image (drag-drop, multi-image). Auto-populates all form fields including style settings.
- **Caption Editor** — Tabbed interface: structured form (scene, style, composition) or raw JSON, with bidirectional real-time sync
- **Raw JSON mode** — If raw JSON is present, generation submits that JSON object directly rather than rebuilding it from form fields
- **Style Settings** — Aesthetics, lighting, medium (photograph / illustration / 3d_render / painting / graphic_design), camera or art style, color palette
- **Composition** — Background description + dynamic element list (type: obj/text, bbox, description)
- **LoRA** — Apply/remove LoRA weights (Lokr or standard format) with strength control. Auto-detected from `models/loras/` (gitignored).
- **Generation Settings** — 7 aspect ratio presets with visual preview, custom width/height (128–2048px, snapped to 128), quality preset (Turbo / Default / Quality), seed, estimated generation time
- **Status Overlay** — Progress bar with percentage during generation, error state with dismiss
- **Prompt History** — Sidebar with persistent URLs (`/history/$promptId`), click to restore form + view result, auto-refresh on generation
- **Auto-save** — Form state persisted via server API (SQLite) with localStorage fallback

Full WebUI spec: [`docs/WEBUI_SPEC.md`](docs/WEBUI_SPEC.md) (Korean)

## CLI options

| Flag | Default | Description |
|------|---------|-------------|
| `--prompt` | — | JSON caption string (inline) |
| `--prompt-file` | — | File containing JSON caption |
| `--repo` | `ideogram-ai/ideogram-4-fp8` | HuggingFace repo ID |
| `--width` | — | Output width, multiple of 16 (overrides `--resolution`) |
| `--height` | — | Output height, multiple of 16 (overrides `--resolution`) |
| `--resolution` | `1024` | Square output (multiple of 16). Ignored if `--width`/`--height` set |
| `--preset` | `V4_QUALITY_48` | `V4_QUALITY_48` / `V4_DEFAULT_20` / `V4_TURBO_12` |
| `--seed` | `20260608` | Random seed |
| `--format` | `png` | Output format: `png` / `webp` / `jpeg` |
| `--quality` | — | Lossy quality 1-100 (webp/jpeg only; default: lossless) |
| `--lora` | — | Path to LoRA `.safetensors` to apply (Lokr or standard) |
| `--lora-strength` | `0.6` | LoRA merge strength |
| `--out` | **required** | Output image path |

## JSON caption format

Ideogram 4 needs structured JSON captions. See `examples/caption.json` for a
complete example. Minimal example:

```json
{
  "compositional_deconstruction": {
    "background": "Seoul alleyway at dusk, warm neon signs, wet pavement",
    "elements": [
      {"type": "obj", "desc": "A young Korean woman holding a sign"},
      {"type": "text", "desc": "The sign reads '사랑합니다' in clean Hangul"}
    ]
  }
}
```

Full format reference: https://github.com/ideogram-oss/ideogram4/blob/main/docs/prompting.md

## API endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/model/status` | Model state (`idle` / `loading` / `loaded`) |
| `POST` | `/api/model/load` | Trigger model load |
| `POST` | `/api/model/unload` | Unload model from memory |
| `POST` | `/api/magic-prompt` | Natural language → structured caption via LLM |
| `POST` | `/api/generate` | Submit generation task (JSON caption + params). Local single-generation slot; returns `409` if another generation is running |
| `GET` | `/api/status/{task_id}` | Poll generation progress and result |
| `POST` | `/api/verify` | Validate a JSON caption without generating |
| `GET` | `/api/lora/status` | List available LoRAs + currently applied |
| `POST` | `/api/lora/apply` | Apply LoRA by name with strength |
| `POST` | `/api/lora/remove` | Restore original weights |
| `GET` | `/api/images` | List generated images |
| `DELETE` | `/api/images/{id}` | Delete a generated image |
| `GET` | `/api/prompts` | List saved prompts |
| `GET` | `/api/prompts/{id}` | Get single prompt by ID |
| `DELETE` | `/api/prompts/{id}` | Delete a saved prompt |
| `GET` | `/api/form` | Load last saved form state |
| `POST` | `/api/form` | Save form state |

### Runtime concurrency

This is a local single-user app. Model load, unload, LoRA apply/remove, and
generation share one in-process pipeline and are protected by a pipeline
operation lock. Generation runs in a daemon thread, but only one generation is
accepted at a time; extra `/api/generate` requests return `409` instead of
queuing unbounded work. Completed task status entries are kept briefly for
polling and cleaned up after about one hour.

## Memory & speed

Common baseline (V4_QUALITY_48):

- **Disk**: ~26 GB model weights (FP8 safetensors)
- **Total model params**: ~26.8B (2× 9.3B transformers + 8B text encoder + VAE)
- **Peak memory (M5 Max, no swap)**: ~50 GB
- **Peak memory (M1 Max 64 GB, heavy swap)**: 63–68 GB

### M5 Max (128 GB unified memory)

| Resolution | Load | Generation | Peak MPS mem |
|:----------:|:----:|:----------:|:-----------:|
| 1024×1024 | ~197 s | ~408 s | ~50 GB |

### Pipeline load breakdown

All times from `bench_load.py` run on each machine. M5 Max numbers are with `PYTORCH_MPS_FAST_MATH=1`.

| Step | M5 Max (128 GB) | M1 Max (64 GB) |
|------|:---:|:---:|
| Text encoder (CPU dequant → MPS) | 77 s | 128 s |
| Conditional transformer (9.3B) | 74 s | 84 s |
| Unconditional transformer (9.3B) | 38 s | 84 s |
| VAE | 2 s | 19 s |
| MPSGraph warmup (first inference) | 5 s | 88 s |
| **Pipeline load total** | **197 s** | **315 s** |

### M1 Max (64 GB unified memory)

### Cross-chip comparison

All at V4_QUALITY_48, same caption prompt. Ratios are consistent across
resolutions — generation slowdown is fixed per-step, not pixel-dependent.

| Metric | M5 Max (128 GB) | M1 Max (64 GB) | Ratio (M1/M5) |
|--------|:---------------:|:--------------:|:-------------:|
| Pipeline load | 197 s | 315 s | **1.6×** |
| Generation 1024² | 408 s | 2240 s | **5.5×** |
| Generation 512² | ~149 s* | 818 s | **5.5×** |
| Peak memory 1024² | ~50 GB | 68.4 GB | swap |
| Peak memory 512² | — | 63.7 GB | swap |

\* 512² on M5 Max is estimated (408 / 2.74 scaling based on M1 resolution ratio).

### Analysis

- **Pipeline load** is 1.6× slower on M1 Max — dominated by CPU dequant + MPS
  transfer (text encoder 8B), not GPU compute.
- **Generation** is consistently **~5.5× slower** regardless of resolution
  (512² and 1024² show the same ratio). This reflects the combined effect of
  lower MPS compute throughput, narrower memory bandwidth, and swap pressure
  on the 64 GB machine.
- On M1 Max 64 GB, **even 512×512 exceeds physical RAM** (63.7 GB peak).
  Swap is unavoidable at any resolution with V4_QUALITY_48.

### Recommendations for M1 Max 64 GB

| Goal | Suggested config | Est. time |
|:----|:----------------|:---------:|
| Best quality without swap | 768×768 + V4_DEFAULT_20 | ~300–400 s |
| Fast generation | 512×512 + V4_TURBO_12 | ~200–300 s |
| Maximum quality (accept swap) | 1024×1024 + V4_QUALITY_48 | ~2240 s |

Upgrading to **96 GB+ unified memory** eliminates swap entirely and brings
generation time closer to the ~2-3× chip-gap ratio.

## Logging

All processes write structured runtime logs to `logs/` (gitignored):

| Process | Log file pattern | Content |
|---------|-----------------|---------|
| CLI (`ideogram4_mps.py`) | `logs/ideogram4_mps-<ts>.log` | Download, dequant, loading, generation, output |
| Server (`main.py`) | `logs/server-<ts>.log` | HTTP requests, model lifecycle, generation, uvicorn |

Logs include timestamps, severity level, and structured messages. Set
`IDEOGRAM4_LOG_DIR` to override the default `logs/` directory.

The `.log` suffix from generation metadata (`examples/result.log`) is kept in git via
`.gitignore` exclusion while runtime logs are ignored.

## Configuration

All settings are read from environment variables at import time by `server/config.py`.
`run.sh` auto-loads `.env` from the project root. See `.env.example` for all options.

| Variable | Default | Description |
|----------|---------|-------------|
| `IDEOGRAM4_MAGIC_PROMPT_API_KEY` | — | LLM API key for Quick Prompt (use `local` for local unauthenticated servers) |
| `IDEOGRAM4_MAGIC_PROMPT_PROVIDER` | `openai_compatible` | Provider behavior: `openai_compatible` or `llama_cpp` |
| `IDEOGRAM4_MAGIC_PROMPT_MODEL` | `local-model` | LLM model for prompt expansion |
| `IDEOGRAM4_MAGIC_PROMPT_BASE_URL` | `http://127.0.0.1:18082/v1` | LLM provider base URL |
| `IDEOGRAM4_MAGIC_PROMPT_PROMPT_PROFILE` | provider-specific | Prompt profile: `ideogram_official`, `compact_json`, or `gemma4` |
| `IDEOGRAM4_MAGIC_PROMPT_RESPONSE_FORMAT` | `off` | Optional structured output request mode; currently `off` or `json_object` |
| `IDEOGRAM4_MAGIC_PROMPT_TOKEN_PARAM` | `max_tokens` | Token budget parameter name: `max_tokens` or `max_completion_tokens` |
| `IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA` | — | If truthy, `run.sh` starts and stops a local `llama-server` for Magic Prompt |
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

- Apple Silicon Mac (M1/M2/M3/M4/M5)
- Python 3.11+ with pip
- Node.js 20+ with pnpm
- `PYTORCH_ENABLE_MPS_FALLBACK=1` (set automatically)
- `PYTORCH_MPS_FAST_MATH=1` (set automatically)
- ~50 GB unified memory for 1024×1024 V4_QUALITY_48 (smaller resolutions / presets may work with less)
- ~26 GB free disk space for FP8 model weights
- HuggingFace account with access to the gated repo `ideogram-ai/ideogram-4-fp8`

## Example output

<table>
  <tr>
    <td align="center"><img src="examples/result.png" alt="Korean woman in hanbok, garden at dawn" width="300"/><br/><sub>한복 여인, 새벽 정원<br/>(V4_QUALITY_48, 1024×1024)</sub></td>
    <td align="center"><img src="examples/result_village.png" alt="Korean hanok village at twilight" width="300"/><br/><sub>황혼 녘 한옥마을<br/>(V4_QUALITY_48, 1024×1024)</sub></td>
    <td align="center"><img src="examples/result_pattern.png" alt="Korean traditional folk pattern illustration" width="200"/><br/><sub>전통 문양 일러스트<br/>(V4_QUALITY_48, 832×1248)</sub></td>
  </tr>
</table>

## License

This project is MIT. The Ideogram 4 model weights are under the
[Ideogram 4 Non-Commercial License](https://huggingface.co/ideogram-ai/ideogram-4-fp8/blob/main/LICENSE.md).
