# AGENTS.md — Ideogram 4 MPS

## Architecture

3-tier, local-only: **WebUI (:5173) → FastAPI (:8000) → Daemon (:8001)**

- **Daemon** (`server/model_daemon.py`) owns the Ideogram 4 pipeline in memory. Survives
  API server restarts. Must start first.
- **FastAPI** (`server/main.py`) thin proxy. Validates requests, writes PNGs to disk,
  manages SQLite persistence.
- **WebUI** (`webui/`) React + TypeScript + Vite. Proxies `/api/*` to `:8000` via
  `vite.config.ts`.

## Commands

### One-shot launch (everything)
```bash
./run.sh
```
Kills existing processes on 8000/8001/5173, installs deps, starts daemon→server→webui.
Cleans up on SIGINT/SIGTERM/EXIT.

### Manual (debugging — 3 terminals in this order)
```bash
python server/model_daemon.py   # terminal 1
python server/main.py            # terminal 2
cd webui && pnpm dev             # terminal 3
```

### CLI generation (no server needed)
```bash
python ideogram4_mps.py --prompt-file examples/caption.json --out result.png
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
- **Daemon must be running** for any WebUI operation. The server is a thin
  proxy — it errors gracefully ("Daemon unreachable") when daemon is down.
- **Daemon uses `ThreadingHTTPServer`**, not `asyncio`. The `httpx.Client` in
  `main.py` is synchronous (not `AsyncClient`).

## Logging

All processes write to `logs/<name>-<timestamp>.log` (gitignored). Flat
structured format with timestamps. Set `IDEOGRAM4_LOG_DIR` to override path.
Generation metadata `.log` files (`result.log`) are checked into git — don't
delete them.

## Unused dependencies (do not add code that relies on these)

WebUI `package.json` lists `@hookform/resolvers`, `react-hook-form`, `zod` but
they are not imported. Form state uses `useReducer` + controlled inputs.
