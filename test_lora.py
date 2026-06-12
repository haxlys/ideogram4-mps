#!/usr/bin/env python3
"""A/B test: Ideogram 4 with/without Realism Engine LoRA on MPS."""
import argparse
import json
import os
import sys
import time
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_MPS_FAST_MATH", "1")

import torch
import safetensors.torch as sf

# Import from sibling module
sys.path.insert(0, str(Path(__file__).resolve().parent))
from ideogram4_mps import download_repo, load_pipeline
from apply_lora import apply_lokr_lora

PRESETS = None


def main():
    parser = argparse.ArgumentParser(description="LoRA A/B test")
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--lora", type=Path, default="models/loras/Realism_Engine_V1.safetensors")
    parser.add_argument("--strength", type=float, default=0.6)
    parser.add_argument("--resolution", type=int, default=1024)
    parser.add_argument("--preset", default="V4_QUALITY_48")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--out-dir", type=Path, default=Path("output/loratest"))
    args = parser.parse_args()

    device = torch.device("mps")
    print(f"LoRA A/B test  |  Torch {torch.__version__}  |  strength={args.strength}")
    print(f"Prompt: {args.prompt_file}")
    print(f"LoRA: {args.lora}")

    args.out_dir.mkdir(parents=True, exist_ok=True)

    # Load base pipeline
    t0 = time.time()
    snapshot = download_repo("ideogram-ai/ideogram-4-fp8")
    pipe = load_pipeline(snapshot, device)
    print(f"Pipeline loaded in {time.time() - t0:.0f}s")

    prompt = args.prompt_file.read_text().strip()

    # Import presets lazily (they are global in ideogram4 module)
    from ideogram4.sampler_configs import PRESETS
    preset = PRESETS[args.preset]
    w = h = args.resolution

    # ── Generate WITHOUT LoRA ──
    print("\n--- WITHOUT LoRA ---")
    t0 = time.time()
    img_no_lora = pipe(
        prompts=prompt,
        height=h, width=w,
        num_steps=preset.num_steps,
        guidance_schedule=preset.guidance_schedule,
        mu=preset.mu,
        std=preset.std,
        seed=args.seed,
        raise_on_caption_issues=False,
    )[0]
    gen_no = time.time() - t0
    out_no = args.out_dir / "no_lora.png"
    img_no_lora.save(out_no)
    print(f"  Done: {gen_no:.0f}s -> {out_no}")

    # ── Apply LoRA to both transformers ──
    sd_cond = pipe.conditional_transformer.state_dict()
    apply_lokr_lora(sd_cond, str(args.lora), strength=args.strength)
    pipe.conditional_transformer.load_state_dict(sd_cond, strict=False)

    sd_uncond = pipe.unconditional_transformer.state_dict()
    apply_lokr_lora(sd_uncond, str(args.lora), strength=args.strength)
    pipe.unconditional_transformer.load_state_dict(sd_uncond, strict=False)
    print(f"\nLoRA applied (strength={args.strength})")

    # ── Generate WITH LoRA ──
    print("--- WITH LoRA ---")
    t0 = time.time()
    img_lora = pipe(
        prompts=prompt,
        height=h, width=w,
        num_steps=preset.num_steps,
        guidance_schedule=preset.guidance_schedule,
        mu=preset.mu,
        std=preset.std,
        seed=args.seed,
        raise_on_caption_issues=False,
    )[0]
    gen_lora = time.time() - t0
    out_lora = args.out_dir / "with_lora.png"
    img_lora.save(out_lora)
    print(f"  Done: {gen_lora:.0f}s -> {out_lora}")

    print(f"\n=== Summary ===")
    print(f"  No LoRA:  {gen_no:.0f}s  {out_no}")
    print(f"  + LoRA:   {gen_lora:.0f}s  {out_lora}")


if __name__ == "__main__":
    main()
