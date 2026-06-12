#!/usr/bin/env python3
"""Run Ideogram 4 on Apple Silicon via MPS — no CUDA required.

FP8 weights are dequantized to bf16 on CPU, then loaded onto MPS.
Non-trivial tricks: ndtri MPS bypass via scheduler patch, manual fp8->bf16
dequant, and Qwen3-VL text encoder loading without vision components.

Requirements:
    pip install torch safetensors transformers accelerate huggingface-hub ideogram4

You must be logged in (huggingface-cli login) and have accepted the gated
repo terms at https://huggingface.co/ideogram-ai/ideogram-4-fp8

Usage:
    python ideogram4_mps.py --prompt-file caption.json --out examples/result.png
    python ideogram4_mps.py --prompt '{"high_level_description":"..."}' --out out.png
    python ideogram4_mps.py --prompt-file cap.json --resolution 512 --preset V4_TURBO_12 --out out.png
    python ideogram4_mps.py --prompt-file cap.json --width 832 --height 1248 --out out.png

Presets: V4_QUALITY_48 (best), V4_DEFAULT_20, V4_TURBO_12
Resolutions: any multiple of 16 (512, 768, 1024, 1536, 2048)
Formats: png (default), webp (lossless), jpeg
"""
import argparse
import json
import logging
import math
import os
import random
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_MPS_FAST_MATH", "1")

# --- logging ---
_LOG_DIR = Path(os.environ.get("IDEOGRAM4_LOG_DIR", Path(__file__).resolve().parent / "logs"))
_LOG_DIR.mkdir(parents=True, exist_ok=True)

_mps_logger: logging.Logger | None = None


def _get_logger() -> logging.Logger:
    global _mps_logger
    if _mps_logger is not None:
        return _mps_logger
    ts = time.strftime("%Y%m%d-%H%M%S")
    log_file = _LOG_DIR / f"ideogram4_mps-{ts}.log"
    _mps_logger = logging.getLogger("ideogram4_mps")
    _mps_logger.setLevel(logging.DEBUG)
    _mps_logger.handlers.clear()
    fh = logging.FileHandler(str(log_file), encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    sh = logging.StreamHandler()
    sh.setLevel(logging.INFO)
    sh.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
    _mps_logger.addHandler(fh)
    _mps_logger.addHandler(sh)
    _mps_logger.info("Log file: %s", log_file)
    return _mps_logger

import torch
import safetensors.torch as sf

FP8_DTYPE = torch.float8_e4m3fn
DEFAULT_REPO = "ideogram-ai/ideogram-4-fp8"


def download_repo(repo_id: str) -> Path:
    from huggingface_hub import snapshot_download
    logger = _get_logger()
    logger.info("Downloading/verifying %s ...", repo_id)
    t0 = time.time()
    try:
        local = snapshot_download(repo_id)
    except Exception as e:
        logger.error("Failed to download %s", repo_id)
        logger.error("  %s", e)
        logger.error("Make sure you ran `huggingface-cli login` and accepted the gated repo terms.")
        sys.exit(1)
    logger.info("  done in %.1fs  →  %s", time.time() - t0, local)
    return Path(local)


def dequant_state_dict(state_dict: dict) -> dict:
    new = {}
    for k, v in state_dict.items():
        if k.endswith(".weight_scale"):
            continue
        if v.dtype == FP8_DTYPE:
            scale = state_dict[k + "_scale"]
            w = v.to(torch.float32) * scale.to(torch.float32).unsqueeze(1)
            new[k] = w.to(torch.bfloat16)
        else:
            new[k] = v
    return new


def load_and_dequant_shard(snapshot: Path, index_filename: str) -> dict:
    with open(snapshot / index_filename) as f:
        idx = json.load(f)
    sdir = index_filename.rsplit("/", 1)[0]
    combined = {}
    for sf_name in sorted(set(idx["weight_map"].values())):
        sd = sf.load_file(str(snapshot / sdir / sf_name), device="cpu")
        combined.update(sd)
    return dequant_state_dict(combined)


def load_text_encoder(snapshot: Path, device):
    from transformers import AutoConfig, AutoModel

    logger = _get_logger()
    logger.info("Loading text encoder (CPU dequant)...")
    t0 = time.time()
    cfg = AutoConfig.from_pretrained(str(snapshot / "text_encoder"), trust_remote_code=True)
    model = AutoModel.from_config(cfg, trust_remote_code=True)
    sd = sf.load_file(str(snapshot / "text_encoder" / "model.safetensors"), device="cpu")
    n = sum(1 for v in sd.values() if v.dtype == torch.float8_e4m3fn)
    model.load_state_dict(dequant_state_dict(sd), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    logger.info("  done in %.1fs, dequantized %d fp8 weights", time.time() - t0, n)
    return model


def load_transformer(snapshot: Path, subdir: str, device):
    from ideogram4 import Ideogram4Config
    from ideogram4.modeling_ideogram4 import Ideogram4Transformer

    logger = _get_logger()
    index_fn = f"{subdir}/diffusion_pytorch_model.safetensors.index.json"
    logger.info("Loading %s (CPU dequant)...", subdir)
    t0 = time.time()
    model = Ideogram4Transformer(Ideogram4Config())
    model.to(torch.bfloat16)
    model.load_state_dict(load_and_dequant_shard(snapshot, index_fn), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    n = sum(p.numel() for p in model.parameters())
    logger.info("  done in %.1fs, %.1fB params", time.time() - t0, n / 1e9)
    return model


def load_vae(snapshot: Path, device):
    from ideogram4.pipeline_ideogram4 import _load_autoencoder

    logger = _get_logger()
    t0 = time.time()
    vae = _load_autoencoder(
        str(snapshot / "vae" / "diffusion_pytorch_model.safetensors"),
        device,
        torch.bfloat16,
    )
    logger.info("  VAE done in %.1fs", time.time() - t0)
    return vae


def patch_scheduler():
    """Replace ndtri (unsupported on MPS) with a CPU-backed impl."""
    from ideogram4.scheduler import LogitNormalSchedule

    def patched(self, t):
        t = t.to(torch.float32).cpu()
        y = self.mean + self.std * torch.special.ndtri(t)
        t_ = 1 - torch.special.expit(y)
        t_min = 1.0 / (1 + math.exp(0.5 * self.logsnr_max))
        t_max = 1.0 / (1 + math.exp(0.5 * self.logsnr_min))
        return t_.clamp(t_min, t_max).to(t.device)

    LogitNormalSchedule.__call__ = patched


def load_pipeline(snapshot: Path, device):
    from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig
    from transformers import AutoTokenizer

    logger = _get_logger()
    t0 = time.time()
    patch_scheduler()

    tokenizer = AutoTokenizer.from_pretrained(
        str(snapshot / "tokenizer"), trust_remote_code=True
    )
    text_encoder = load_text_encoder(snapshot, device)
    cond = load_transformer(snapshot, "transformer", device)
    uncond = load_transformer(snapshot, "unconditional_transformer", device)
    vae = load_vae(snapshot, device)

    pipe = Ideogram4Pipeline(
        conditional_transformer=cond,
        unconditional_transformer=uncond,
        text_encoder=text_encoder,
        text_tokenizer=tokenizer,
        autoencoder=vae,
        config=Ideogram4PipelineConfig(weights_repo="ideogram-ai/ideogram-4-fp8"),
        device=device,
        dtype=torch.bfloat16,
    )
    logger.info("Pipeline loaded in %.1fs\n", time.time() - t0)
    return pipe


def main():
    parser = argparse.ArgumentParser(
        description="Ideogram 4 on Apple Silicon (MPS)",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("--prompt", type=str, help="JSON caption string")
    parser.add_argument("--prompt-file", type=Path, help="File containing JSON caption")
    parser.add_argument(
        "--repo",
        type=str,
        default=DEFAULT_REPO,
        help=f"HuggingFace repo ID (default: {DEFAULT_REPO})",
    )
    parser.add_argument(
        "--width",
        type=int,
        default=None,
        help="Output width, multiple of 16 (overrides --resolution)",
    )
    parser.add_argument(
        "--height",
        type=int,
        default=None,
        help="Output height, multiple of 16 (overrides --resolution)",
    )
    parser.add_argument(
        "--resolution",
        type=int,
        default=1024,
        help="Square resolution, multiple of 16 (default: 1024). Ignored if --width/--height set.",
    )
    parser.add_argument(
        "--preset",
        type=str,
        default="V4_QUALITY_48",
        choices=["V4_QUALITY_48", "V4_DEFAULT_20", "V4_TURBO_12"],
    )
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument(
        "--format", type=str, default="png", choices=["png", "webp", "jpeg"],
        help="Image format (default: png). webp saves lossless.",
    )
    parser.add_argument(
        "--quality", type=int, default=None,
        help="Lossy quality 1-100 (webp/jpeg only; default: lossless)",
    )
    parser.add_argument("--out", type=Path, required=True, help="Output image path")
    parser.add_argument("--lora", type=Path, default=None, help="LoRA safetensors path to apply")
    parser.add_argument("--lora-strength", type=float, default=0.6, help="LoRA strength (default: 0.6)")
    args = parser.parse_args()
    if args.seed is None:
        args.seed = random.randint(0, 2**32 - 1)

    logger = _get_logger()

    if not torch.backends.mps.is_available():
        logger.error("MPS not available. This script requires Apple Silicon.")
        sys.exit(1)

    device = torch.device("mps")
    logger.info("Ideogram 4 MPS  |  Torch %s", torch.__version__)

    snapshot = download_repo(args.repo)

    if args.prompt_file:
        prompt = args.prompt_file.read_text().strip()
    elif args.prompt:
        prompt = args.prompt
    else:
        parser.error("--prompt or --prompt-file required")

    try:
        cap = json.loads(prompt)
        if not isinstance(cap, dict):
            logger.warning("JSON is not a dict, treating as plain text (low quality)")
    except (json.JSONDecodeError, ValueError):
        logger.warning("Not JSON — Ideogram 4 needs structured captions for quality")

    pipe = load_pipeline(snapshot, device)

    if args.lora:
        from apply_lora import apply_lokr_lora, apply_std_lora
        is_lokr = any("lokr_w1" in k for k in sf.load_file(str(args.lora)).keys())
        logger.info("Applying LoRA: %s (strength=%.2f, format=%s)", args.lora.name, args.lora_strength, "lokr" if is_lokr else "standard")
        sd_cond = pipe.conditional_transformer.state_dict()
        (apply_lokr_lora if is_lokr else apply_std_lora)(sd_cond, str(args.lora), strength=args.lora_strength)
        pipe.conditional_transformer.load_state_dict(sd_cond, strict=False)
        sd_uncond = pipe.unconditional_transformer.state_dict()
        (apply_lokr_lora if is_lokr else apply_std_lora)(sd_uncond, str(args.lora), strength=args.lora_strength)
        pipe.unconditional_transformer.load_state_dict(sd_uncond, strict=False)

    logger.info("Warming up MPSGraph kernels...")
    with torch.inference_mode():
        pipe(
            prompts=prompt,
            height=64,
            width=64,
            num_steps=2,
            guidance_schedule=[1, 1],
            mu=0.0,
            std=1.5,
            seed=args.seed,
            raise_on_caption_issues=False,
        )
    torch.mps.empty_cache()
    logger.info("  warmup done")

    from ideogram4.sampler_configs import PRESETS

    preset = PRESETS[args.preset]

    if args.width is not None and args.height is not None:
        w, h = args.width, args.height
    elif args.width is not None or args.height is not None:
        parser.error("--width and --height must be set together")
    else:
        w = h = args.resolution

    if w % 16:
        w = (w // 16) * 16
        logger.info("Width rounded to %d", w)
    if h % 16:
        h = (h // 16) * 16
        logger.info("Height rounded to %d", h)

    logger.info("Preset: %s  |  %d steps  |  mu=%s std=%s", args.preset, preset.num_steps, preset.mu, preset.std)
    logger.info("Resolution: %dx%d  |  Seed: %d", w, h, args.seed)

    t0 = time.time()
    with torch.inference_mode():
        images = pipe(
            prompts=prompt,
            height=h,
            width=w,
            num_steps=preset.num_steps,
            guidance_schedule=preset.guidance_schedule,
            mu=preset.mu,
            std=preset.std,
            seed=args.seed,
            raise_on_caption_issues=False,
        )
    gen_s = time.time() - t0

    out = args.out.with_suffix(f".{args.format}")
    out.parent.mkdir(parents=True, exist_ok=True)
    save_kw = {}
    if args.format in ("webp", "jpeg"):
        save_kw["quality"] = args.quality or 95
        if args.format == "webp":
            save_kw["lossless"] = args.quality is None
    images[0].save(out, format=args.format.upper(), **save_kw)
    logger.info("Done: %.1fs -> %s", gen_s, out)

    log = {
        "preset": args.preset,
        "resolution": [w, h],
        "steps": preset.num_steps,
        "seed": args.seed,
        "generation_seconds": round(gen_s, 1),
        "output": str(out),
        "format": args.format,
        "torch": torch.__version__,
        "device": "mps",
        "prompt": prompt,
        "cmd": " ".join(sys.argv),
    }
    out.with_suffix(".log").write_text(
        json.dumps(log, ensure_ascii=False, indent=2)
    )


if __name__ == "__main__":
    main()
