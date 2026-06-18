# Ideogram 4 MLX Benchmark Notes

Use this page to keep comparisons reproducible across the old PyTorch/MPS
runtime and the MLX/mflux runtime.

## Canonical Prompt

Use `examples/caption.json` unless a benchmark explicitly says otherwise.

## Matrix

| Case | Size | Preset | Seed | LoRA | Notes |
| --- | --- | --- | --- | --- | --- |
| smoke | 256x256 | `V4_TURBO_12` | `20260618` | off | Fast health check after install |
| lora-smoke | 256x256 | `V4_TURBO_12` | `20260621` | `Realism_Engine_Ideogram_V2.safetensors`, 0.6 | Verifies local mflux LoRA reload + generation |
| baseline-quality | 1024x1024 | `V4_QUALITY_48` | `20260608` | off | Comparable with the old MPS benchmark |
| balanced | 768x768 | `V4_DEFAULT_20` | `20260608` | off | Useful repeated workflow estimate |

## Measurements So Far

### MPS vs MLX

| Case | PyTorch/MPS legacy | MLX q8 | Difference |
| --- | --- | --- | --- |
| Model load, local files ready | about 285s, from historical notes | 2.5-4.6s runtime load, 5.3s API-observed post-merge smoke | MLX loads about 54-114x faster |
| 1024x1024 `V4_QUALITY_48`, seed `20260608` | 408.0s | 375.1s | MLX saves 32.9s, about 8.1% faster |

The 1024 comparison used the same `examples/caption.json` prompt, output size,
`V4_QUALITY_48` preset, and seed `20260608`. The legacy MPS result is recorded
in `examples/result.log`. The MLX q8 result was generated after the local
`MLXBits/ideogram-4-mlx-q8` model was present.

### MLX Smoke Results

Post-merge `main` smoke on 2026-06-18 used the FastAPI -> model daemon path
with local Magic Prompt LLM also running. Model was unloaded again at the end.

| Runtime | Case | Result | MLX memory after case |
| --- | --- | --- | --- |
| MLX q8 | model load via `/api/model/load` | 5.334s observed, daemon reported 4.6s | active 28.518GB, peak 28.518GB, cache 0.000GB |
| MLX q8 | 256x256 `V4_TURBO_12`, seed `20260618`, no LoRA | 9.654s | active 28.708GB, peak 30.273GB, cache 5.419GB |
| MLX q8 | apply `Realism_Engine_Ideogram_V2.safetensors`, strength 0.6 | 2.221s | active 28.518GB, peak 30.273GB, cache 0.000GB |
| MLX q8 | 256x256 `V4_TURBO_12`, seed `20260621`, LoRA applied | 8.642s | active 28.708GB, peak 31.605GB, cache 6.760GB |
| MLX q8 | remove LoRA | 2.220s | active 28.518GB, peak 31.605GB, cache 0.000GB |
| MLX q8 | 256x256 `V4_TURBO_12`, seed `20260622`, after LoRA remove | 8.113s | active 28.708GB, peak 31.605GB, cache 5.409GB |

### MLX Cache Limit Experiment

Direct local MLX measurements on 2026-06-18 used separate Python processes for
each cache policy so import-time `IDEOGRAM4_MLX_CACHE_LIMIT_GB` settings did
not mix. The local Magic Prompt LLM was still running in the background.

| Cache limit | Model load | 256x256 `V4_TURBO_12` | Memory after generation |
| --- | --- | --- | --- |
| unset | 2.489s | 9.126s | active 28.708GB, peak 30.757GB, cache 5.718GB |
| `2` GB | 2.594s | 7.695s | active 28.708GB, peak 30.758GB, cache 2.010GB |
| `0` GB | 2.589s | 8.957s | active 28.708GB, peak 30.758GB, cache 0.000GB |

The 2GB limit was fastest in this single run, but the safer conclusion is about
memory: `IDEOGRAM4_MLX_CACHE_LIMIT_GB=2` capped reusable cache near 2GB without
hurting this 256px turbo smoke, while `0` eliminated reusable cache.

### Expanded MLX Cases

Measured in the default-cache direct local process after local model files were
already present.

| Case | Result | Memory after case |
| --- | --- | --- |
| 512x512 `V4_TURBO_12`, seed `20260618` | 17.639s | active 29.062GB, peak 32.179GB, cache 16.109GB |
| 256x256 `V4_DEFAULT_20`, seed `20260618` | 12.395s | active 29.062GB, peak 32.179GB, cache 16.185GB |

## Commands

Daemon-backed CLI:

```bash
python3 ideogram4_mlx.py \
  --prompt-file examples/caption.json \
  --out examples/result_mlx_q8_1024.png \
  --width 1024 \
  --height 1024 \
  --preset V4_QUALITY_48 \
  --seed 20260608 \
  --daemon require
```

Direct local MLX:

```bash
python3 ideogram4_mlx.py \
  --prompt-file examples/caption.json \
  --out examples/result_mlx_q8_1024_direct.png \
  --width 1024 \
  --height 1024 \
  --preset V4_QUALITY_48 \
  --seed 20260608 \
  --daemon off
```

API smoke:

```bash
curl -X POST http://127.0.0.1:8000/api/model/load
curl http://127.0.0.1:8000/api/model/status
```

Record at least:

- model load seconds
- generation seconds reported by the daemon
- width, height, preset, seed, LoRA stack
- `mlx_memory.active_gb`, `mlx_memory.peak_gb`, and `mlx_memory.cache_gb`
- whether Magic Prompt LLM was running at the same time
