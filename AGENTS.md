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

## Unused dependencies (do not add code that relies on these)

WebUI `package.json` lists `@hookform/resolvers`, `react-hook-form`, `zod` but
they are not imported. Form state uses `useReducer` + controlled inputs.
