#!/usr/bin/env python3
"""Model management module: load/unload/status of the Ideogram 4 pipeline.
Imported directly by main.py. No HTTP server, no generation logic.
"""
import json
import logging
import math
import os
import time
import threading
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_MPS_FAST_MATH", "1")

from config import (
    MODEL_REPO, MODEL_REVISION, MODEL_DEVICE, LORA_DIR, WARMUP_SIZE, WARMUP_STEPS,
    DEFAULT_LORA_STRENGTH,
)
from logger import get_logger

logger = get_logger("model")

import torch
import safetensors.torch as sf
from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig
from ideogram4.modeling_ideogram4 import Ideogram4Transformer
from ideogram4 import Ideogram4Config
from ideogram4.scheduler import LogitNormalSchedule
from transformers import AutoTokenizer, AutoConfig, AutoModel
from ideogram4.pipeline_ideogram4 import _load_autoencoder
from huggingface_hub import hf_hub_download, snapshot_download


FP8_DTYPE = torch.float8_e4m3fn

_pipeline = None
_device = None
_snapshot = None
_state = "idle"
_state_msg = ""
_lock = threading.Lock()


# ── model loading ────────────────────────────────────────────────

def _download_repo(repo_id: str) -> Path:
    revision_label = MODEL_REVISION or "default"
    logger.info("Downloading/verifying %s @ %s ...", repo_id, revision_label)
    t0 = time.time()
    try:
        local = snapshot_download(repo_id, revision=MODEL_REVISION)
    except Exception as e:
        logger.error("Failed to download %s: %s", repo_id, e)
        raise RuntimeError(f"Failed to download {repo_id}: {e}") from e
    logger.info("  done in %.1fs  ->  %s", time.time() - t0, local)
    return Path(local)


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


def _load_and_dequant_shard(snapshot: Path, index_filename: str) -> dict:
    with open(snapshot / index_filename) as f:
        idx = json.load(f)
    sdir = index_filename.rsplit("/", 1)[0]
    combined = {}
    for sf_name in sorted(set(idx["weight_map"].values())):
        sd = sf.load_file(str(snapshot / sdir / sf_name), device="cpu")
        combined.update(sd)
    return _dequant_state_dict(combined)


def _load_text_encoder(snapshot: Path, device):
    logger.info("Loading text encoder (CPU dequant)...")
    t0 = time.time()
    cfg = AutoConfig.from_pretrained(str(snapshot / "text_encoder"), trust_remote_code=True)
    model = AutoModel.from_config(cfg, trust_remote_code=True)
    sd = sf.load_file(str(snapshot / "text_encoder" / "model.safetensors"), device="cpu")
    model.load_state_dict(_dequant_state_dict(sd), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    logger.info("  done in %.1fs", time.time() - t0)
    return model


def _load_transformer(snapshot: Path, subdir: str, device):
    index_fn = f"{subdir}/diffusion_pytorch_model.safetensors.index.json"
    logger.info("Loading %s (CPU dequant)...", subdir)
    t0 = time.time()
    model = Ideogram4Transformer(Ideogram4Config())
    model.to(torch.bfloat16)
    model.load_state_dict(_load_and_dequant_shard(snapshot, index_fn), strict=False)
    model.to(device, dtype=torch.bfloat16).eval()
    n = sum(p.numel() for p in model.parameters())
    logger.info("  done in %.1fs, %.1fB params", time.time() - t0, n / 1e9)
    return model


def _load_vae(snapshot: Path, device):
    t0 = time.time()
    vae = _load_autoencoder(
        str(snapshot / "vae" / "diffusion_pytorch_model.safetensors"),
        device,
        torch.bfloat16,
    )
    logger.info("  VAE done in %.1fs", time.time() - t0)
    return vae


def _patch_scheduler():
    def patched(self, t):
        t = t.to(torch.float32).cpu()
        y = self.mean + self.std * torch.special.ndtri(t)
        t_ = 1 - torch.special.expit(y)
        t_min = 1.0 / (1 + math.exp(0.5 * self.logsnr_max))
        t_max = 1.0 / (1 + math.exp(0.5 * self.logsnr_min))
        return t_.clamp(t_min, t_max).to(t.device)
    LogitNormalSchedule.__call__ = patched


def _load_pipeline(snapshot: Path, device) -> Ideogram4Pipeline:
    from transformers import AutoTokenizer

    t0 = time.time()
    _patch_scheduler()

    tokenizer = AutoTokenizer.from_pretrained(str(snapshot / "tokenizer"), trust_remote_code=True)
    text_encoder = _load_text_encoder(snapshot, device)
    cond = _load_transformer(snapshot, "transformer", device)
    uncond = _load_transformer(snapshot, "unconditional_transformer", device)
    vae = _load_vae(snapshot, device)

    pipe = Ideogram4Pipeline(
        conditional_transformer=cond,
        unconditional_transformer=uncond,
        text_encoder=text_encoder,
        text_tokenizer=tokenizer,
        autoencoder=vae,
        config=Ideogram4PipelineConfig(weights_repo=MODEL_REPO),
        device=device,
        dtype=torch.bfloat16,
    )
    logger.info("Pipeline loaded in %.1fs", time.time() - t0)

    _warmup_pipeline(pipe)

    return pipe


def _emit_progress(progress_cb, progress: int, msg: str, phase: str):
    if progress_cb:
        progress_cb(progress=progress, msg=msg, phase=phase)


def _warmup_pipeline(pipe: Ideogram4Pipeline, progress_cb=None):
    _emit_progress(progress_cb, 80, "Warming up MPSGraph kernels...", "warmup")
    logger.info("Warming up MPSGraph kernels...")
    t0 = time.time()
    with torch.inference_mode():
        pipe(
            prompts='{"high_level_description":"warmup"}',
            height=WARMUP_SIZE,
            width=WARMUP_SIZE,
            num_steps=WARMUP_STEPS,
            guidance_schedule=[1, 1],
            mu=0.0,
            std=1.5,
            seed=0,
            raise_on_caption_issues=False,
        )
    torch.mps.empty_cache()
    logger.info("  warmup done in %.1fs", time.time() - t0)
    _emit_progress(progress_cb, 95, "Warmup complete.", "warmup")


# ── public API ──────────────────────────────────────────────────

def is_mps_available() -> bool:
    return torch.backends.mps.is_available()


def get_pipeline():
    with _lock:
        return _pipeline


def handle_load():
    global _pipeline, _device, _snapshot, _state, _state_msg

    with _lock:
        if _state == "loaded" or _state == "loading":
            return {"ok": _state == "loaded", "msg": _state_msg}
        _state = "loading"
        _state_msg = "Starting model load..."

    logger.info("Model load requested")

    try:
        device = torch.device(MODEL_DEVICE)
        snapshot = _download_repo(MODEL_REPO)

        with _lock:
            _state_msg = "Loading pipeline (~140s)..."
        pipe = _load_pipeline(snapshot, device)

        with _lock:
            _pipeline = pipe
            _device = device
            _snapshot = snapshot
            _state = "loaded"
            _state_msg = "Model loaded."
        logger.info("Model loaded successfully")
        return {"ok": True, "msg": "Model loaded successfully."}

    except Exception as e:
        logger.exception("Model load failed")
        with _lock:
            _state = "idle"
            _state_msg = str(e)
        return {"ok": False, "msg": str(e)}


def handle_unload():
    global _pipeline, _device, _snapshot, _state, _state_msg
    logger.info("Model unload requested")
    with _lock:
        _pipeline = None
        _device = None
        _snapshot = None
        _state = "idle"
        _state_msg = ""
    import gc
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()
    logger.info("Model unloaded")
    return {"ok": True}


def handle_status():
    return {"state": _state, "msg": _state_msg}


# ── LoRA ─────────────────────────────────────────────────────────

_lora_applied: str | None = None
_lora_strength: float = DEFAULT_LORA_STRENGTH
_lora_stack: list[dict] = []
_original_states: dict | None = None


LORA_PRESETS = [
    {
        "id": "realism-v1",
        "label": "Realism V1",
        "repo": "RazzzHF/Realism_Engine_Ideogram_4",
        "revision": "94305803d895f5ce4a150f45836d71798572f309",
        "filename": "Realism_Engine_Ideogram4_V1.safetensors",
        "local_name": "Realism_Engine_V1.safetensors",
        "default_strength": 0.6,
    },
    {
        "id": "realism-v2",
        "label": "Realism V2",
        "repo": "RazzzHF/Realism_Engine_Ideogram_4",
        "revision": "94305803d895f5ce4a150f45836d71798572f309",
        "filename": "Realism_Engine_Ideogram_V2.safetensors",
        "local_name": "Realism_Engine_Ideogram_V2.safetensors",
        "default_strength": 0.6,
    },
    {
        "id": "realism-v3",
        "label": "Realism V3",
        "repo": "RazzzHF/Realism_Engine_Ideogram_4",
        "revision": "94305803d895f5ce4a150f45836d71798572f309",
        "filename": "Realism_Engine_Ideogram_V3.safetensors",
        "local_name": "Realism_Engine_Ideogram_V3.safetensors",
        "default_strength": 0.6,
    },
    {
        "id": "zjourney-v1",
        "label": "zjourney V1",
        "repo": "tsolful/zjourney-Ideogram-4-Fantasy-Realism-Refiner",
        "revision": "469c3e884cf2d7897744c8f5f7f6e948db996f95",
        "filename": "zjourneyv1.safetensors",
        "local_name": "zjourneyv1.safetensors",
        "default_strength": 0.5,
    },
    {
        "id": "zjourney-v2",
        "label": "zjourney V2",
        "repo": "tsolful/zjourney-Ideogram-4-Fantasy-Realism-Refiner",
        "revision": "469c3e884cf2d7897744c8f5f7f6e948db996f95",
        "filename": "zjourneyv2.safetensors",
        "local_name": "zjourneyv2.safetensors",
        "default_strength": 0.55,
    },
    {
        "id": "zjourney-stack",
        "label": "zjourney V1+V2",
        "loras": [
            {"local_name": "zjourneyv1.safetensors", "default_strength": 0.35},
            {"local_name": "zjourneyv2.safetensors", "default_strength": 0.45},
        ],
    },
]


def _clone_state_dict_to_cpu(state_dict: dict) -> dict:
    return {
        k: v.detach().cpu().clone() if hasattr(v, "detach") else v
        for k, v in state_dict.items()
    }


def _restore_original_lora_targets(pipe):
    if _original_states is None:
        return
    pipe.conditional_transformer.load_state_dict(_original_states["cond"], strict=False)
    pipe.unconditional_transformer.load_state_dict(_original_states["uncond"], strict=False)


def _detect_lora_format(lora_path: str) -> str:
    sd = sf.load_file(lora_path)
    for key in sd.keys():
        if "lokr_w1" in key:
            return "lokr"
        if "lora_A" in key:
            return "standard"
    raise ValueError(f"Unknown LoRA format in {lora_path}")


def list_loras() -> list[dict]:
    if not LORA_DIR.is_dir():
        return []
    result = []
    for f in sorted(LORA_DIR.iterdir()):
        if not f.suffix == ".safetensors":
            continue
        try:
            fmt = _detect_lora_format(str(f))
            size_mb = f.stat().st_size / (1024 * 1024)
            result.append({"name": f.name, "path": str(f), "format": fmt, "size_mb": round(size_mb, 1)})
        except Exception:
            continue
    return result


def _preset_loras(preset: dict) -> list[dict]:
    if "loras" in preset:
        resolved = []
        by_local_name = {item["local_name"]: item for item in LORA_PRESETS if "local_name" in item}
        for item in preset["loras"]:
            base = by_local_name.get(item["local_name"], {})
            resolved.append({**base, **item})
        return resolved
    return [preset]


def get_lora_presets() -> list[dict]:
    available = {lora["name"]: lora for lora in list_loras()}
    result = []
    for preset in LORA_PRESETS:
        loras = []
        for item in _preset_loras(preset):
            local_name = item["local_name"]
            installed = local_name in available
            loras.append({
                "name": local_name,
                "repo": item.get("repo"),
                "revision": item.get("revision"),
                "filename": item.get("filename"),
                "strength": item["default_strength"],
                "installed": installed,
                "format": available[local_name]["format"] if installed else None,
                "size_mb": available[local_name]["size_mb"] if installed else None,
            })
        result.append({
            "id": preset["id"],
            "label": preset["label"],
            "installed": all(lora["installed"] for lora in loras),
            "loras": loras,
        })
    return result


def get_lora_preset(preset_id: str) -> dict | None:
    for preset in LORA_PRESETS:
        if preset["id"] == preset_id:
            return preset
    return None


def download_lora_preset(preset_id: str) -> list[dict]:
    preset = get_lora_preset(preset_id)
    if preset is None:
        raise ValueError(f"Unknown LoRA preset: {preset_id}")

    LORA_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = []

    for item in _preset_loras(preset):
        local_name = item["local_name"]
        target = LORA_DIR / local_name
        if target.is_file():
            downloaded.append({"name": local_name, "status": "already_installed"})
            continue

        repo = item.get("repo")
        revision = item.get("revision")
        filename = item.get("filename")
        if not repo or not filename:
            raise ValueError(f"LoRA preset cannot be downloaded: {local_name}")

        logger.info("Downloading LoRA %s from %s:%s @ %s", local_name, repo, filename, revision or "default")
        downloaded_path = Path(
            hf_hub_download(
                repo_id=repo,
                filename=filename,
                revision=revision,
                local_dir=str(LORA_DIR),
            )
        )
        if downloaded_path.name != local_name:
            downloaded_path.replace(target)

        _detect_lora_format(str(target))
        downloaded.append({"name": local_name, "status": "downloaded"})

    return downloaded


def _merge_lora_into_pipe(pipe, lora_path: Path, fmt: str, strength: float, progress_cb=None, progress_start: int = 35, progress_span: int = 35):
    import importlib
    apply_mod = importlib.import_module("apply_lora")
    label = lora_path.name
    midpoint = progress_start + progress_span // 2
    progress_end = progress_start + progress_span

    if fmt == "lokr":
        _emit_progress(progress_cb, progress_start, f"Merging {label} into conditional transformer...", "merge")
        sd = pipe.conditional_transformer.state_dict()
        apply_mod.apply_lokr_lora(sd, str(lora_path), strength=strength)
        pipe.conditional_transformer.load_state_dict(sd, strict=False)
        _emit_progress(progress_cb, midpoint, f"Merging {label} into unconditional transformer...", "merge")
        sd2 = pipe.unconditional_transformer.state_dict()
        apply_mod.apply_lokr_lora(sd2, str(lora_path), strength=strength)
        pipe.unconditional_transformer.load_state_dict(sd2, strict=False)
    else:
        _emit_progress(progress_cb, progress_start, f"Merging {label} into conditional transformer...", "merge")
        sd = pipe.conditional_transformer.state_dict()
        apply_mod.apply_std_lora(sd, str(lora_path), strength=strength)
        pipe.conditional_transformer.load_state_dict(sd, strict=False)
        _emit_progress(progress_cb, midpoint, f"Merging {label} into unconditional transformer...", "merge")
        sd2 = pipe.unconditional_transformer.state_dict()
        apply_mod.apply_std_lora(sd2, str(lora_path), strength=strength)
        pipe.unconditional_transformer.load_state_dict(sd2, strict=False)
    _emit_progress(progress_cb, progress_end, f"Merged {label}.", "merge")


def apply_loras(loras: list[dict], progress_cb=None) -> dict:
    global _lora_applied, _lora_strength, _lora_stack, _original_states

    _emit_progress(progress_cb, 5, "Checking LoRA files...", "validate")
    pipe = get_pipeline()
    if pipe is None:
        return {"ok": False, "msg": "Model not loaded."}

    requested = []
    for item in loras:
        name = str(item.get("name", "")).strip()
        strength = float(item.get("strength", DEFAULT_LORA_STRENGTH))
        if not name:
            return {"ok": False, "msg": "Missing LoRA name."}

        lora_path = LORA_DIR / name
        if not lora_path.is_file():
            return {"ok": False, "msg": f"LoRA not found: {name}"}

        try:
            fmt = _detect_lora_format(str(lora_path))
        except ValueError as e:
            return {"ok": False, "msg": str(e)}

        requested.append({"name": name, "path": lora_path, "format": fmt, "strength": strength})

    if not requested:
        return {"ok": False, "msg": "No LoRAs requested."}

    if _original_states is None:
        _emit_progress(progress_cb, 15, "Backing up base weights...", "backup")
        _original_states = {
            "cond": _clone_state_dict_to_cpu(pipe.conditional_transformer.state_dict()),
            "uncond": _clone_state_dict_to_cpu(pipe.unconditional_transformer.state_dict()),
        }
        _emit_progress(progress_cb, 30, "Base weights backed up.", "backup")
    else:
        _emit_progress(progress_cb, 15, "Restoring base weights before applying new LoRA...", "restore")
        _restore_original_lora_targets(pipe)
        _emit_progress(progress_cb, 30, "Base weights restored.", "restore")

    merge_start = 35
    merge_total = 35
    merge_span = max(1, merge_total // len(requested))
    for idx, item in enumerate(requested):
        item_start = merge_start + idx * merge_span
        item_span = merge_total - idx * merge_span if idx == len(requested) - 1 else merge_span
        _merge_lora_into_pipe(
            pipe,
            item["path"],
            item["format"],
            item["strength"],
            progress_cb=progress_cb,
            progress_start=item_start,
            progress_span=item_span,
        )

    _lora_stack = [
        {"name": item["name"], "strength": item["strength"], "format": item["format"]}
        for item in requested
    ]
    _lora_applied = " + ".join(item["name"] for item in _lora_stack)
    _lora_strength = _lora_stack[0]["strength"] if len(_lora_stack) == 1 else 0.0
    logger.info("LoRA stack applied: %s", _lora_stack)
    _emit_progress(progress_cb, 75, "LoRA weights merged. Preparing warmup...", "warmup")
    _warmup_pipeline(pipe, progress_cb=progress_cb)
    return {"ok": True, "msg": f"LoRA stack applied: {_lora_applied}", "applied_loras": _lora_stack}


def apply_lora(name: str, strength: float = DEFAULT_LORA_STRENGTH, progress_cb=None) -> dict:
    return apply_loras([{"name": name, "strength": strength}], progress_cb=progress_cb)


def remove_lora(progress_cb=None) -> dict:
    global _lora_applied, _lora_stack, _original_states

    _emit_progress(progress_cb, 5, "Checking applied LoRA...", "validate")
    pipe = get_pipeline()
    if pipe is None:
        return {"ok": False, "msg": "Model not loaded."}
    if _original_states is None:
        return {"ok": False, "msg": "No LoRA applied."}

    _emit_progress(progress_cb, 25, "Restoring original weights...", "restore")
    _restore_original_lora_targets(pipe)
    _emit_progress(progress_cb, 65, "Original weights restored.", "restore")

    _original_states = None
    _lora_applied = None
    _lora_stack = []
    logger.info("LoRA removed, original weights restored")
    _warmup_pipeline(pipe, progress_cb=progress_cb)
    return {"ok": True, "msg": "LoRA removed, original weights restored."}


def get_lora_status() -> dict:
    return {
        "applied": _lora_applied,
        "strength": _lora_strength,
        "applied_loras": _lora_stack,
        "available": list_loras(),
    }
