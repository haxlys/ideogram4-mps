#!/usr/bin/env python3
"""Measure pipeline load breakdown on current machine."""
import os
import sys
import time
import json
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_MPS_FAST_MATH", "1")
sys.path.insert(0, str(Path(__file__).parent / "server"))

print("Pipeline load breakdown — current machine")
print(f"  Python: {os.popen('python3 --version').read().strip()}")
print(f"  macOS: {os.popen('sw_vers -productVersion').read().strip()}")
print(f"  Python: {os.popen('python3 --version').read().strip()}")

import torch
import safetensors.torch as sf
from transformers import AutoTokenizer, AutoConfig, AutoModel
from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig
from ideogram4.modeling_ideogram4 import Ideogram4Transformer
from ideogram4 import Ideogram4Config
from ideogram4.scheduler import LogitNormalSchedule
from ideogram4.pipeline_ideogram4 import _load_autoencoder
from huggingface_hub import snapshot_download
import math

print(f"  PyTorch: {torch.__version__}")
print(f"  MPS available: {torch.backends.mps.is_available()}")
print()

FP8_DTYPE = torch.float8_e4m3fn
REPO = "ideogram-ai/ideogram-4-fp8"
device = torch.device("mps")
_global_step = 0

def timed(label, fn):
    global _global_step
    _global_step += 1
    print(f"[{_global_step}] {label}")
    sys.stdout.flush()
    t0 = time.time()
    result = fn()
    elapsed = time.time() - t0
    print(f"    -> {elapsed:.1f}s")
    sys.stdout.flush()
    return elapsed, result

def _dequant_state_dict(state_dict: dict) -> dict:
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

def _load_and_dequant_shard(snapshot, index_filename):
    with open(snapshot / index_filename) as f:
        idx = json.load(f)
    sdir = index_filename.rsplit("/", 1)[0]
    combined = {}
    for sf_name in sorted(set(idx["weight_map"].values())):
        sd = sf.load_file(str(snapshot / sdir / sf_name), device="cpu")
        combined.update(sd)
    return _dequant_state_dict(combined)

# ─── Download ───
dl_s, snapshot_p = timed("Download/verify repo", lambda: Path(snapshot_download(REPO)))
snapshot = snapshot_p

# ─── Patch scheduler ───
original_call = LogitNormalSchedule.__call__
def patched(self, t):
    t = t.to(torch.float32).cpu()
    y = self.mean + self.std * torch.special.ndtri(t)
    t_ = 1 - torch.special.expit(y)
    t_min = 1.0 / (1 + math.exp(0.5 * self.logsnr_max))
    t_max = 1.0 / (1 + math.exp(0.5 * self.logsnr_min))
    return t_.clamp(t_min, t_max).to(t.device)
LogitNormalSchedule.__call__ = patched

# ─── Tokenizer ───
tok_s, tokenizer = timed("Tokenizer", lambda: AutoTokenizer.from_pretrained(str(snapshot / "tokenizer"), trust_remote_code=True))

# ─── Text encoder ───
def load_text_encoder():
    cfg = AutoConfig.from_pretrained(str(snapshot / "text_encoder"), trust_remote_code=True)
    model = AutoModel.from_config(cfg, trust_remote_code=True)
    sd = sf.load_file(str(snapshot / "text_encoder" / "model.safetensors"), device="cpu")
    model.load_state_dict(_dequant_state_dict(sd), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    return model

te_s, text_encoder = timed("Text encoder (CPU dequant -> MPS)", load_text_encoder)

# ─── Conditional transformer ───
def load_transformer(subdir):
    index_fn = f"{subdir}/diffusion_pytorch_model.safetensors.index.json"
    model = Ideogram4Transformer(Ideogram4Config())
    model.to(torch.bfloat16)
    model.load_state_dict(_load_and_dequant_shard(snapshot, index_fn), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    n = sum(p.numel() for p in model.parameters())
    return model, n

ct_s, (cond, n_ct) = timed("Conditional transformer (9.3B)", lambda: load_transformer("transformer"))

# ─── Unconditional transformer ───
ut_s, (uncond, n_ut) = timed("Unconditional transformer (9.3B)", lambda: load_transformer("unconditional_transformer"))

# ─── VAE ───
def load_vae():
    return _load_autoencoder(str(snapshot / "vae" / "diffusion_pytorch_model.safetensors"), device, torch.bfloat16)
vae_s, vae = timed("VAE", load_vae)

# ─── Pipeline init ───
pipe_s, pipe = timed("Pipeline __init__", lambda: Ideogram4Pipeline(
    conditional_transformer=cond,
    unconditional_transformer=uncond,
    text_encoder=text_encoder,
    text_tokenizer=tokenizer,
    autoencoder=vae,
    config=Ideogram4PipelineConfig(weights_repo=REPO),
    device=device,
    dtype=torch.bfloat16,
))

# ─── MPSGraph warmup ───
def warmup():
    with torch.inference_mode():
        pipe(
            prompts='{"high_level_description":"warmup"}',
            height=64, width=64,
            num_steps=2,
            guidance_schedule=[1, 1],
            mu=0.0, std=1.5, seed=0,
            raise_on_caption_issues=False,
        )
    torch.mps.empty_cache()
warmup_s, _ = timed("MPSGraph warmup (first inference)", warmup)

total = dl_s + tok_s + te_s + ct_s + ut_s + vae_s + pipe_s + warmup_s

print(f"\n{'='*60}")
print(f"LOAD BREAKDOWN")
print(f"{'='*60}")
print(f"  Download/verify:             {dl_s:6.0f}s")
print(f"  Tokenizer:                   {tok_s:6.0f}s")
print(f"  Text encoder (CPU dequant):  {te_s:6.0f}s")
print(f"  Conditional transformer:     {ct_s:6.0f}s")
print(f"  Unconditional transformer:   {ut_s:6.0f}s")
print(f"  VAE:                         {vae_s:6.0f}s")
print(f"  Pipeline __init__:           {pipe_s:6.0f}s")
print(f"  MPSGraph warmup:             {warmup_s:6.0f}s")
print(f"  ───────────────────────────")
print(f"  Total:                       {total:6.0f}s")
print(f"{'='*60}")
