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

| Runtime | Case | Result |
| --- | --- | --- |
| PyTorch/MPS legacy | model load | about 285s, from historical notes |
| MLX q8 | model load | about 2-3s after local model is present |
| PyTorch/MPS legacy | 1024x1024 `V4_QUALITY_48`, seed `20260608` | 408.0s |
| MLX q8 | 1024x1024 `V4_QUALITY_48`, seed `20260608` | 375.1s |
| MLX q8 | 256x256 `V4_TURBO_12`, no LoRA | about 7-8s |
| MLX q8 | 256x256 `V4_TURBO_12`, LoRA applied | about 8-9s |

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
