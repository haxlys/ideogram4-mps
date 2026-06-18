# AGENTS.md - Ideogram 4 MLX

## Architecture

3-process, local-only: **WebUI (:5173 default) -> FastAPI (:8000 default) -> Model Daemon (:8001 default)**.

- **Model daemon** (`server/model_daemon.py`) owns the single MLX/mflux Ideogram
  4 runtime. Keep it single-worker: multiple worker processes duplicate the
  model in unified memory. It handles model load/unload, generation jobs,
  progress, cancellation, short-lived image artifacts, and local LoRA reloads.
- **MLX runtime** (`server/mlx_runtime.py`) resolves `IDEOGRAM4_MODEL_PATH` or
  downloads `IDEOGRAM4_MODEL_REPO`, validates `split_model.json`, instantiates
  the mflux Ideogram 4 runtime, and reports MLX memory.
- **FastAPI** (`server/main.py`) is the WebUI gateway and persistence layer. It
  handles Magic Prompt, request validation, SQLite prompt/image/form
  persistence, generated image file persistence, and daemon proxying. It must
  not import or load the model directly.
- **CLI** (`ideogram4_mlx.py`) uses the model daemon by default when reachable
  (`--daemon auto`) and can fall back to direct local MLX loading. Use
  `--daemon require` when a warm daemon is required, or `--daemon off` for
  standalone local loading.
- **Configuration** (`server/config.py`) reads settings from environment
  variables at import time. `run.sh` auto-loads `.env` from project root.
- **WebUI** (`webui/`) is React + TypeScript + Vite. It proxies `/api/*` to
  `IDEOGRAM4_SERVER_PORT` via `vite.config.ts`.

## Open-source extensibility

Prefer provider-neutral interfaces, documented environment variables, and small
adapters over hard-coded local paths, private credentials, or one-machine
assumptions.

- Keep defaults conservative and broadly runnable.
- Put machine-specific paths, ports, model files, tokens, and tuning knobs in
  `.env` / `.env.example`.
- Unsupported capabilities should degrade clearly. Text-only Magic Prompt
  should still work when image input or a local multimodal server is absent.
- Normalize provider quirks at the boundary, then keep internal caption,
  generation, storage, and WebUI contracts stable.

## Commands

### Launch / restart

```bash
./run.sh
./run.sh full
./run.sh backend
./run.sh client
./run.sh doctor
```

`backend` restarts only FastAPI and keeps the model daemon warm. `client`
restarts only Vite. `full` restarts model daemon, FastAPI, and WebUI. `doctor`
checks local dependencies, model files, LLM paths, ports, and memory policy.

### Manual debugging

```bash
set -a && source .env && set +a
.venv/bin/python server/model_daemon.py
.venv/bin/python server/main.py
cd webui && pnpm dev
```

### CLI generation

```bash
python3 ideogram4_mlx.py --prompt-file examples/caption.json --out examples/result.png
python3 ideogram4_mlx.py --daemon off --prompt-file examples/caption.json --out examples/result.png
```

### WebUI-only

```bash
cd webui && pnpm dev
cd webui && pnpm build
cd webui && pnpm lint
```

- Use **pnpm**, not npm/yarn.
- No backend test suite exists. Use compile/lint/build and manual smoke checks.

## Critical gotchas

- Default model is `MLXBits/ideogram-4-mlx-q8`, not the old FP8 runtime repo.
- The model root must contain `split_model.json`. Use `IDEOGRAM4_MODEL_PATH` for
  a local directory or `IDEOGRAM4_MODEL_REPO` for Hugging Face download.
- `mflux` is pinned to PR #445 commit
  `8d80b9cb53688b62a2f814604b9f8b48987c5acd` until the MLXBits q8 loader lands
  in a stable mflux release.
- Do not reintroduce `torch`, `safetensors.torch`, or direct `ideogram4`
  pipeline imports in runtime code.
- Generation uses `threading.Thread`, not `asyncio`. MLX work runs in the model
  daemon process, and every `runtime.load`, `runtime.unload`,
  `runtime.apply_loras`, `runtime.remove_loras`, and `runtime.generate` call
  must go through the daemon's single `_run_on_mlx_thread` worker. Calling mflux
  from multiple Python threads can trip MLX thread-local GPU stream errors,
  especially after LoRA reloads.
- Generation is local single-slot. Extra `/api/generate` requests return HTTP
  `409`.
- LoRA support is mflux-native local `.safetensors` only. Apply/remove reloads
  the MLX model with the requested stack instead of patching state dicts.
- Raw JSON mode is authoritative. If `rawJson` is present in WebUI state,
  generation submits that JSON object directly.

## Logging

All processes write to `logs/<name>-<timestamp>.log` (gitignored). Generation
metadata `.log` files under examples are checked into git; do not delete them
unless the task explicitly asks.

## Magic Prompt

Natural language -> structured caption via LLM. Server module:
`server/magic_prompt.py`. API: `POST /api/magic-prompt`.

Uses a configurable OpenAI-compatible LLM provider. Local `llama.cpp` can be
enabled with `IDEOGRAM4_MAGIC_PROMPT_PROVIDER=llama_cpp`. Caption verification
uses mflux's Ideogram 4 caption verifier.

## Configuration

See `.env.example` for all options. Important model settings:

| Variable | Default | Description |
| --- | --- | --- |
| `IDEOGRAM4_MODEL_REPO` | `MLXBits/ideogram-4-mlx-q8` | Hugging Face MLX model repo |
| `IDEOGRAM4_MODEL_REVISION` | empty | Optional repo revision |
| `IDEOGRAM4_MODEL_PATH` | empty | Optional local MLX model root |
| `IDEOGRAM4_MLX_CACHE_LIMIT_GB` | empty | Optional MLX cache limit |
| `IDEOGRAM4_MODEL_DAEMON_AUTOLOAD` | `0` | Auto-load model on daemon startup |
| `IDEOGRAM4_MIN_IMAGE_SIZE` | `256` | Minimum API generation dimension |
| `IDEOGRAM4_MAX_IMAGE_SIZE` | `2048` | Maximum API generation dimension |
| `IDEOGRAM4_LORA_DIR` | `models/loras` | Local mflux-compatible LoRA files |

Keep autoload off by default unless a deployment is dedicated to image
generation. This avoids immediately reserving roughly 29 GB of unified memory
while the local Magic Prompt LLM may also be running. Use
`IDEOGRAM4_MLX_CACHE_LIMIT_GB` for tighter cache behavior on smaller machines.

## Verification

```bash
python3 -m compileall server ideogram4_mlx.py
rg "torch|safetensors.torch|from ideogram4|import ideogram4" server ideogram4_mlx.py
cd webui && pnpm lint
cd webui && pnpm build
```

With model files available, smoke-test `/health`, `/model/load`, `/model/status`,
and one 256x256 `V4_TURBO_12` generation.

Benchmark comparisons should follow `docs/benchmarks.md`.

## Unused dependencies

WebUI `package.json` lists `@hookform/resolvers`, `react-hook-form`, and `zod`,
but they are not imported. Form state uses `useReducer` and controlled inputs.
