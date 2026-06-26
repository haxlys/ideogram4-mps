# Ideogram 4 MLX WebUI

Local Ideogram 4 image generation for Apple Silicon using MLX-native weights.
The default model is `MLXBits/ideogram-4-mlx-q8`, an int8 MLX conversion of
Ideogram 4 intended for `mflux`.

## Architecture

```text
WebUI (:5173) -> FastAPI (:8000) -> Model daemon (:8001) -> mflux/MLX
```

- `server/model_daemon.py` owns the single local MLX model instance and handles
  load/unload, generation jobs, cancellation, short-lived artifacts, and local
  LoRA reloads.
- `server/mlx_runtime.py` resolves the Hugging Face or local MLX model path,
  loads the mflux Ideogram 4 runtime, tracks MLX memory, and runs image
  generation.
- `server/main.py` is the WebUI gateway and persistence layer. It stores prompts,
  generated images, favorites, the last form state, and prompt-image history
  links; runs Magic Prompt; and proxies generation work to the daemon.
- `webui/` is the React/Vite/TanStack Router interface with editor, gallery,
  history, favorites, and a client-side generation queue.
- `ideogram4_mlx.py` is the CLI. It uses the daemon by default and can run
  direct local MLX generation with `--daemon off`.

The FastAPI/WebUI generation contract stays stable: submit a structured caption,
width, height, preset, seed, and output format.

## Legacy PyTorch/MPS Runtime

The previous PyTorch/MPS implementation is preserved on the
[`legacy/pytorch-mps`](https://github.com/haxlys/ideogram4-mlx/tree/legacy/pytorch-mps)
branch. Use that branch if you need the old direct `torch`/MPS runtime,
FP8 dequant loading path, MPS scheduler patching, MPS warmup behavior, or the
old `ideogram4_mps.py` CLI.

This `main` line is now optimized for the MLX/mflux q8 runtime and does not aim
to keep backwards compatibility with the old PyTorch/MPS architecture.

## Install

```bash
python3 -m venv .venv
.venv/bin/python -m pip install -r server/requirements.txt
cd webui && pnpm install
./run.sh doctor
```

`server/requirements.txt` pins `mflux` to PR #445 commit
`8d80b9cb53688b62a2f814604b9f8b48987c5acd`. As of 2026-06-26, stable mflux
`0.18.0` is still the latest PyPI release and includes Ideogram 4 FP8 support,
but the mlx-forge checkpoint loader needed for `MLXBits/ideogram-4-mlx-q8` is
still pending in PR #445. Keep the pin until a stable mflux release can load a
repo containing `split_model.json`.

The rollback branch for the previous PyTorch/MPS implementation is
`legacy/pytorch-mps`.

## Model Access

Default:

```bash
IDEOGRAM4_MODEL_REPO=MLXBits/ideogram-4-mlx-q8
```

For an already downloaded model directory:

```bash
IDEOGRAM4_MODEL_PATH=/path/to/ideogram-4-mlx-q8
```

The model root must contain `split_model.json`. If `IDEOGRAM4_MODEL_PATH` is not
set, the daemon downloads/verifies the Hugging Face repo with
`huggingface_hub.snapshot_download`.

The MLXBits conversion is gated on Hugging Face and distributed under the
original Ideogram 4 Non-Commercial Model Agreement. Accept the model gate and
authenticate with `hf auth login` or `HF_TOKEN` before first download. Check the
model card before using it outside personal or research workflows.

## Run

```bash
./run.sh           # full stack, same as ./run.sh full
./run.sh full      # restart model daemon, FastAPI, and WebUI
./run.sh backend   # restart FastAPI; start the daemon if needed; keep WebUI running
./run.sh client    # restart Vite only
./run.sh doctor    # check dependencies, model files, ports, and memory policy
```

Manual debugging:

```bash
set -a && source .env && set +a
.venv/bin/python server/model_daemon.py
.venv/bin/python server/main.py
cd webui && pnpm dev
```

CLI:

```bash
python3 ideogram4_mlx.py --prompt-file examples/caption.json --out examples/result.png
python3 ideogram4_mlx.py --daemon off --prompt-file examples/caption.json --out examples/result.png
```

## API

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/api/model/status` | Daemon state, backend, model repo/path, quantization, MLX memory |
| `POST` | `/api/model/load` | Load the MLX model |
| `POST` | `/api/model/unload` | Unload the MLX model |
| `GET` | `/api/magic-prompt/status` | Magic Prompt provider/configuration health |
| `POST` | `/api/magic-prompt` | Expand text and optional reference images into a structured caption |
| `POST` | `/api/verify` | Validate a structured caption through mflux's verifier when available |
| `POST` | `/api/generate` | Start one local generation job |
| `GET` | `/api/status/{task_id}` | Poll generation progress |
| `POST` | `/api/cancel/{task_id}` | Request cancellation |
| `GET` | `/api/lora/status` | Local LoRA files and active stack |
| `GET` | `/api/lora/presets` | Local mflux-compatible `.safetensors` files exposed as UI presets |
| `POST` | `/api/lora/download` | Compatibility task endpoint; current MLX runtime reports downloads unsupported |
| `GET` | `/api/lora/download/{task_id}` | Poll compatibility LoRA download task status |
| `POST` | `/api/lora/apply` | Reload model with a local LoRA stack |
| `POST` | `/api/lora/remove` | Reload model without LoRA |
| `GET` | `/api/lora/operation/{task_id}` | Poll LoRA apply/remove progress |
| `GET` | `/api/images` | List generated images, optionally filtered by prompt/history link state |
| `GET` | `/api/images/stats` | Count total, linked, orphan, and dangling image records |
| `DELETE` | `/api/images/orphans` | Delete generated image files with no prompt history link |
| `DELETE` | `/api/images/{image_id}` | Delete one generated image record and file |
| `PATCH` | `/api/images/{image_id}` | Link an image to an existing prompt history row |
| `POST` | `/api/images/{image_id}/attach-history` | Create or attach prompt history for an image |
| `GET` | `/api/images/{image_id}/file` | Serve one generated image file |
| `GET` | `/outputs/{filename}` | Serve a generated image file by stored output filename |
| `GET` | `/api/prompts` | List saved prompt history rows |
| `GET` | `/api/prompts/{prompt_id}` | Fetch one prompt history row |
| `POST` | `/api/prompts` | Save a prompt history row |
| `DELETE` | `/api/prompts/{prompt_id}` | Delete a prompt history row |
| `GET` | `/api/favorites` | List favorited images/prompts |
| `GET` | `/api/favorites/{favorite_id}` | Fetch one favorite |
| `POST` | `/api/favorites` | Favorite an image or prompt |
| `DELETE` | `/api/favorites/images/{image_id}` | Remove favorite by image |
| `DELETE` | `/api/favorites/prompts/{prompt_id}` | Remove favorite by prompt |
| `GET` | `/api/form` | Load the last saved editor form |
| `POST` | `/api/form` | Save the last editor form |

Generation is daemon single-slot. The WebUI can queue, reorder, cancel, and
retry multiple client-side jobs, but only one job is submitted to the daemon at
a time. Direct concurrent `/api/generate` calls return HTTP `409`. LoRA
apply/remove operations also use model operation locks because mflux applies
LoRA at model load time.

All MLX/mflux runtime calls are routed through a single worker thread inside the
model daemon. This avoids MLX thread-local stream failures when a LoRA-loaded
model is generated after a reload. Do not call `runtime.load`,
`runtime.apply_loras`, `runtime.remove_loras`, `runtime.generate`, or
`runtime.unload` directly from request/task threads.

## Configuration

See `.env.example` for all settings. Common values:

| Variable | Default | Description |
| --- | --- | --- |
| `IDEOGRAM4_MODEL_REPO` | `MLXBits/ideogram-4-mlx-q8` | Hugging Face MLX model repo |
| `IDEOGRAM4_MODEL_REVISION` | empty | Optional repo revision |
| `IDEOGRAM4_MODEL_PATH` | empty | Optional local model root containing `split_model.json` |
| `IDEOGRAM4_MLX_CACHE_LIMIT_GB` | empty | Optional MLX cache limit |
| `IDEOGRAM4_MODEL_DAEMON_AUTOLOAD` | `0` | Load model when daemon starts |
| `IDEOGRAM4_DEFAULT_PRESET` | `V4_TURBO_12` | Default sampler preset |
| `IDEOGRAM4_MIN_IMAGE_SIZE` | `256` | Minimum API dimension |
| `IDEOGRAM4_MAX_IMAGE_SIZE` | `2048` | Maximum API dimension |
| `IDEOGRAM4_LORA_DIR` | `models/loras` | Local mflux-compatible LoRA files |

Autoload is off by default so the local Magic Prompt LLM and the image model do
not immediately compete for unified memory. Use the WebUI Load button or
`POST /api/model/load` when image generation is needed. Set
`IDEOGRAM4_MLX_CACHE_LIMIT_GB` when the machine needs a stricter reusable MLX
cache budget.

## Benchmarks

Use [docs/benchmarks.md](docs/benchmarks.md) for the canonical prompt, seed,
presets, and metrics. Current local measurements:

| Case | PyTorch/MPS legacy | MLX q8 | MLX q4 candidate | Difference |
| --- | --- | --- | --- | --- |
| Model load, local files ready | about 285s | 3.5s direct q8 load in the latest quality run | 2.9s direct q4 smoke | MLX keeps load in seconds |
| 1024x1024 `V4_QUALITY_48`, seed `20260608` | 408.0s | 289.0s direct q8 run | 287.7s direct q4 run | q4 was only 1.3s faster than q8 in direct runs, so q8 remains the default |

The 1024 benchmark uses the same `examples/caption.json` prompt, preset, seed,
and output size as the legacy run. The old MPS result is preserved in
`examples/result.log`. The q4 candidate was benchmarked but not made the
default because the same-path high-quality speedup was not meaningful; set
`IDEOGRAM4_MODEL_REPO` or `IDEOGRAM4_MODEL_PATH` to a q4 model if you prefer the
smaller checkpoint.

Post-merge `main` smoke produced 256x256 `V4_TURBO_12` images in 8.1-9.7s
through the FastAPI -> daemon path, including LoRA apply/remove checks. A direct
local cache-limit pass showed `IDEOGRAM4_MLX_CACHE_LIMIT_GB=2` kept reusable MLX
cache near 2GB on the 256px turbo smoke; unset cache reached about 5.7GB, and
`0` eliminated reusable cache. Treat these as local single-run measurements,
not a cross-machine guarantee.

## Magic Prompt

`POST /api/magic-prompt` expands a plain idea into the structured JSON caption
Ideogram 4 expects. It uses the existing OpenAI-compatible provider abstraction
and local llama.cpp option. `POST /api/magic-prompt` accepts text plus up to
`IDEOGRAM4_MAGIC_PROMPT_MAX_IMAGES` base64 reference images; text-only requests
still work when no multimodal local server is configured. Caption validation
uses mflux's Ideogram 4 caption verifier instead of the old `ideogram4` Python
package.

## WebUI State

The sidebar contains prompt history, gallery, and favorites routes. The editor
autosaves the latest form through `/api/form`; generation results are persisted
under `IDEOGRAM4_OUTPUT_DIR`; and prompt/image links are stored in SQLite so
history pages can show their generated images. A "new seed" or regenerate action
adds a client-side queue job, then the queue submits to the daemon when the
single generation slot is free.

`webui/src/routeTree.gen.ts` is generated by TanStack Router. Temporary
`webui/.tanstack/tmp/` files may appear during dev/build runs and should not be
treated as source changes.

## Verification

```bash
python3 -m compileall server ideogram4_mlx.py
rg "torch|safetensors.torch|from ideogram4|import ideogram4" server ideogram4_mlx.py
cd webui && pnpm test && pnpm lint && pnpm build
```

With model files available, also verify:

```bash
curl http://127.0.0.1:8001/health
curl -X POST http://127.0.0.1:8001/model/load
curl http://127.0.0.1:8001/model/status
```
