#!/usr/bin/env python3
"""Model daemon: owns the Ideogram 4 pipeline and exposes local HTTP APIs.

The WebUI server and CLI talk to this process instead of importing/loading the
pipeline themselves. Keep this process single-worker: it owns one MPS pipeline.
"""
import json
import logging
import math
import os
import resource
import time
import threading
import uuid
from io import BytesIO
from pathlib import Path

os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")
os.environ.setdefault("PYTORCH_MPS_FAST_MATH", "1")

from config import (
    MODEL_REPO, MODEL_REVISION, MODEL_DEVICE, LORA_DIR, WARMUP_SIZE, WARMUP_STEPS,
    DEFAULT_LORA_STRENGTH, DEFAULT_PRESET, DEFAULT_SERVER_FORMAT, DEFAULT_SEED,
    IMAGE_QUALITY_WEBP, IMAGE_QUALITY_JPEG,
    MODEL_DAEMON_HOST, MODEL_DAEMON_PORT, MODEL_DAEMON_LOG_LEVEL,
    MODEL_DAEMON_AUTOLOAD,
)
from logger import get_logger

logger = get_logger("model")

import torch
import safetensors.torch as sf
from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field
from ideogram4 import Ideogram4Pipeline, Ideogram4PipelineConfig
from ideogram4.modeling_ideogram4 import Ideogram4Transformer
from ideogram4 import Ideogram4Config
from ideogram4.scheduler import LogitNormalSchedule
from ideogram4.sampler_configs import PRESETS
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


def _max_rss_gib() -> float:
    # macOS reports ru_maxrss in bytes; Linux reports it in KiB.
    rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    if os.uname().sysname == "Darwin":
        return rss / (1024**3)
    return rss / (1024**2)


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
        "id": "realism-v4",
        "label": "Realism V4",
        "repo": "RazzzHF/Realism_Engine_Ideogram_4",
        "revision": "94305803d895f5ce4a150f45836d71798572f309",
        "filename": "Realism_Engine_Ideogram_V4.safetensors",
        "local_name": "Realism_Engine_Ideogram_V4.safetensors",
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


# ── HTTP daemon API ──────────────────────────────────────────────

app = FastAPI(title="Ideogram 4 Model Daemon")

_TASK_TTL_SECONDS = 60 * 60
_tasks: dict[str, dict] = {}
_tasks_lock = threading.Lock()
_lora_download_tasks: dict[str, dict] = {}
_lora_download_tasks_lock = threading.Lock()
_lora_op_tasks: dict[str, dict] = {}
_lora_op_tasks_lock = threading.Lock()
_lora_op_lock = threading.Lock()
_generation_lock = threading.Lock()
_pipeline_ops_lock = threading.Lock()
_pipeline_op_state_lock = threading.Lock()
_pipeline_op_state: dict = {"label": None, "started_at": None}


class GenerateRequest(BaseModel):
    caption: dict | str
    width: int = 1024
    height: int = 1024
    preset: str = DEFAULT_PRESET
    seed: int = DEFAULT_SEED
    format: str = DEFAULT_SERVER_FORMAT
    quality: int | None = None
    prompt_id: int | None = None
    loras: list[dict] | None = None


class LoraApplyRequest(BaseModel):
    name: str = ""
    strength: float = DEFAULT_LORA_STRENGTH
    loras: list[dict] | None = None


class LoraDownloadRequest(BaseModel):
    preset_id: str = Field(default="", min_length=1)


def _busy_response(msg: str):
    return JSONResponse(status_code=409, content={"error": msg})


def _set_pipeline_op(label: str):
    with _pipeline_op_state_lock:
        _pipeline_op_state["label"] = label
        _pipeline_op_state["started_at"] = time.time()


def _clear_pipeline_op():
    with _pipeline_op_state_lock:
        _pipeline_op_state["label"] = None
        _pipeline_op_state["started_at"] = None


def _pipeline_op_desc() -> str:
    with _pipeline_op_state_lock:
        label = _pipeline_op_state.get("label")
        started_at = _pipeline_op_state.get("started_at")
    if not label:
        return "current model operation"
    if not started_at:
        return label
    return f"{label} ({int(time.time() - started_at)}s)"


def _cleanup_done_tasks(tasks: dict[str, dict]):
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del tasks[task_id]


class GenerationCancelled(Exception):
    pass


def _update_task(task_id: str, **updates):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is not None:
            task.update(updates)


def _is_task_cancelled(task_id: str) -> bool:
    with _tasks_lock:
        task = _tasks.get(task_id)
        return bool(task and task.get("cancelled"))


def _update_lora_op_task(task_id: str, **updates):
    with _lora_op_tasks_lock:
        task = _lora_op_tasks.get(task_id)
        if task is not None:
            task.update(updates)


def _lora_progress_callback(task_id: str):
    def _callback(progress: int, msg: str, phase: str):
        _update_lora_op_task(
            task_id,
            progress=max(0, min(progress, 99)),
            msg=msg,
            phase=phase,
        )
    return _callback


def _load_model_locked():
    _pipeline_ops_lock.acquire()
    _set_pipeline_op("loading model")
    try:
        return handle_load()
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


def _normalise_size(width: int, height: int) -> tuple[int, int]:
    if width % 16:
        width = (width // 16) * 16
    if height % 16:
        height = (height // 16) * 16
    return max(16, width), max(16, height)


def _caption_to_prompt(caption: dict | str) -> tuple[str, str]:
    if isinstance(caption, dict):
        return json.dumps(caption, ensure_ascii=False), str(caption.get("high_level_description", ""))
    return str(caption), ""


def _image_format(fmt: str) -> tuple[str, str]:
    normalised = fmt.lower().strip()
    if normalised not in {"png", "webp", "jpeg"}:
        normalised = DEFAULT_SERVER_FORMAT
    pil_format = "JPEG" if normalised == "jpeg" else normalised.upper()
    return normalised, pil_format


def _run_generate(task_id: str, req: GenerateRequest):
    try:
        prompt_str, hld_text = _caption_to_prompt(req.caption)
        width, height = _normalise_size(req.width, req.height)
        preset_cfg = PRESETS.get(req.preset, PRESETS[DEFAULT_PRESET])
        fmt, pil_fmt = _image_format(req.format)
        total_steps = preset_cfg.num_steps

        _update_task(
            task_id,
            msg=f"Generating ({width}x{height}, {total_steps} steps)...",
            progress=0,
            total_steps=total_steps,
        )

        wait_started = time.time()
        while not _pipeline_ops_lock.acquire(timeout=1):
            if _is_task_cancelled(task_id):
                raise GenerationCancelled()
            waited_s = int(time.time() - wait_started)
            _update_task(task_id, msg=f"Waiting for {_pipeline_op_desc()}... ({waited_s}s)")

        _set_pipeline_op("generating image")
        try:
            _update_task(task_id, msg=f"Preparing pipeline ({width}x{height}, {total_steps} steps)...")
            pipe = get_pipeline()
            if pipe is None:
                raise RuntimeError("Model not loaded.")

            if req.loras:
                _update_task(task_id, msg="Applying requested LoRA stack before generation...")
                lora_result = apply_loras(req.loras)
                if not lora_result.get("ok"):
                    raise RuntimeError(lora_result.get("msg", "LoRA apply failed."))

            step_count = [0]
            orig_forward = pipe.unconditional_transformer.forward

            def _patched_forward(*args, **kwargs):
                if _is_task_cancelled(task_id):
                    raise GenerationCancelled()
                result = orig_forward(*args, **kwargs)
                step_count[0] += 1
                pct = min(int(step_count[0] / total_steps * 100), 99)
                _update_task(
                    task_id,
                    progress=pct,
                    msg=f"Generating ({width}x{height}, {step_count[0]}/{total_steps} steps)...",
                )
                return result

            t0 = time.time()
            pipe.unconditional_transformer.forward = _patched_forward
            try:
                with torch.inference_mode():
                    images = pipe(
                        prompts=prompt_str,
                        height=height,
                        width=width,
                        num_steps=total_steps,
                        guidance_schedule=preset_cfg.guidance_schedule,
                        mu=preset_cfg.mu,
                        std=preset_cfg.std,
                        seed=req.seed,
                        raise_on_caption_issues=False,
                    )
            finally:
                pipe.unconditional_transformer.forward = orig_forward

            gen_s = time.time() - t0
            if torch.backends.mps.is_available():
                logger.info(
                    "Task %s done in %.1fs | MPS cur:%.1fG drv:%.1fG max:%.1fG | RSS: %.1fG",
                    task_id,
                    gen_s,
                    torch.mps.current_allocated_memory() / (1024**3),
                    torch.mps.driver_allocated_memory() / (1024**3),
                    torch.mps.recommended_max_memory() / (1024**3),
                    _max_rss_gib(),
                )
            else:
                logger.info("Task %s done in %.1fs", task_id, gen_s)

            buf = BytesIO()
            save_kw = {}
            if fmt in {"webp", "jpeg"}:
                save_kw["quality"] = req.quality or (IMAGE_QUALITY_WEBP if fmt == "webp" else IMAGE_QUALITY_JPEG)
            images[0].save(buf, format=pil_fmt, **save_kw)
            artifact = buf.getvalue()

            lora_status = get_lora_status()
            lora_name = lora_status.get("applied")
            lora_strength = lora_status.get("strength") if lora_name else None
            filename = f"{task_id}.{fmt}"
            content_type = f"image/{'jpeg' if fmt == 'jpeg' else fmt}"

            _update_task(
                task_id,
                state="done",
                msg=f"Done in {gen_s:.1f}s",
                progress=100,
                artifact=artifact,
                content_type=content_type,
                image_meta={
                    "hld": hld_text,
                    "width": width,
                    "height": height,
                    "preset": req.preset,
                    "seed": req.seed,
                    "prompt_id": req.prompt_id,
                    "filename": filename,
                    "format": fmt,
                    "generation_seconds": round(gen_s, 1),
                    "lora_name": lora_name,
                    "lora_strength": lora_strength,
                },
                done_at=time.time(),
            )
        finally:
            _clear_pipeline_op()
            _pipeline_ops_lock.release()

    except GenerationCancelled:
        logger.info("Generation task %s cancelled", task_id)
        _update_task(
            task_id,
            state="done",
            msg="Cancelled.",
            error="Cancelled",
            image_meta=None,
            done_at=time.time(),
        )
    except Exception as e:
        logger.exception("Generation task %s failed", task_id)
        _update_task(
            task_id,
            state="done",
            msg=f"Error: {e}",
            error=str(e),
            image_meta=None,
            done_at=time.time(),
        )
    finally:
        _generation_lock.release()


@app.on_event("startup")
def startup():
    logger.info("Model daemon started")
    if MODEL_DAEMON_AUTOLOAD and is_mps_available():
        threading.Thread(target=_load_model_locked, daemon=True).start()
        logger.info("Auto-loading model on daemon startup")


@app.get("/health")
def api_health():
    return {"ok": True, "role": "model-daemon"}


@app.get("/model/status")
def api_model_status():
    status = handle_status()
    status["operation"] = _pipeline_op_desc() if _pipeline_ops_lock.locked() else None
    return status


@app.post("/model/load")
def api_load_model():
    if not is_mps_available():
        return {"ok": False, "msg": "MPS not available. Requires Apple Silicon."}
    if _pipeline_ops_lock.locked():
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    threading.Thread(target=_load_model_locked, daemon=True).start()
    return {"ok": True, "msg": "Load started."}


@app.post("/model/unload")
def api_unload_model():
    if not _pipeline_ops_lock.acquire(blocking=False):
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    _set_pipeline_op("unloading model")
    try:
        return handle_unload()
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


@app.get("/lora/status")
def api_lora_status():
    return get_lora_status()


@app.get("/lora/presets")
def api_lora_presets():
    return {"presets": get_lora_presets()}


def _run_lora_download(task_id: str, preset_id: str):
    try:
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id]["msg"] = "Downloading LoRA files..."
        files = download_lora_preset(preset_id)
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id].update({
                "state": "done",
                "msg": "Download complete.",
                "files": files,
                "done_at": time.time(),
            })
    except Exception as e:
        logger.exception("LoRA download task %s failed", task_id)
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id].update({
                "state": "done",
                "msg": f"Error: {e}",
                "error": str(e),
                "done_at": time.time(),
            })


@app.post("/lora/download")
def api_download_lora(req: LoraDownloadRequest):
    task_id = uuid.uuid4().hex
    with _lora_download_tasks_lock:
        _cleanup_done_tasks(_lora_download_tasks)
        _lora_download_tasks[task_id] = {
            "state": "running",
            "msg": "Starting download...",
            "files": [],
            "created_at": time.time(),
        }

    threading.Thread(target=_run_lora_download, args=(task_id, req.preset_id), daemon=True).start()
    return {"ok": True, "task_id": task_id}


@app.get("/lora/download/{task_id}")
def api_lora_download_status(task_id: str):
    with _lora_download_tasks_lock:
        _cleanup_done_tasks(_lora_download_tasks)
        task = _lora_download_tasks.get(task_id)
        if task is None:
            return {"state": "done", "msg": "Task not found.", "files": []}
        return {
            "state": task.get("state", "done"),
            "msg": task.get("msg", ""),
            "files": task.get("files", []),
            "error": task.get("error"),
        }


def _run_lora_apply(task_id: str, req: LoraApplyRequest):
    try:
        wait_started = time.time()
        while not _pipeline_ops_lock.acquire(timeout=1):
            waited_s = int(time.time() - wait_started)
            _update_lora_op_task(
                task_id,
                msg=f"Waiting for {_pipeline_op_desc()}... ({waited_s}s)",
                phase="waiting",
                progress=0,
            )

        _set_pipeline_op("applying LoRA and warming up")
        try:
            _update_lora_op_task(task_id, msg="Starting LoRA apply...", phase="start", progress=1)
            result = apply_loras(req.loras, progress_cb=_lora_progress_callback(task_id)) if req.loras else apply_lora(
                req.name,
                req.strength,
                progress_cb=_lora_progress_callback(task_id),
            )
        finally:
            _clear_pipeline_op()
            _pipeline_ops_lock.release()

        ok = bool(result.get("ok"))
        _update_lora_op_task(
            task_id,
            state="done",
            msg=result.get("msg", "LoRA apply complete." if ok else "LoRA apply failed."),
            phase="done" if ok else "error",
            progress=100 if ok else 0,
            result=result,
            error=None if ok else result.get("msg", "LoRA apply failed."),
            done_at=time.time(),
        )
    except Exception as e:
        logger.exception("LoRA apply task %s failed", task_id)
        _update_lora_op_task(
            task_id,
            state="done",
            msg=f"Error: {e}",
            phase="error",
            progress=0,
            error=str(e),
            done_at=time.time(),
        )
    finally:
        _lora_op_lock.release()


@app.post("/lora/apply")
def api_apply_lora(req: LoraApplyRequest):
    if not req.loras and not req.name:
        return {"ok": False, "msg": "Missing LoRA name."}
    if not _lora_op_lock.acquire(blocking=False):
        return _busy_response("A LoRA operation is already running.")

    task_id = uuid.uuid4().hex
    with _lora_op_tasks_lock:
        _cleanup_done_tasks(_lora_op_tasks)
        _lora_op_tasks[task_id] = {
            "state": "running",
            "msg": "Queued LoRA apply...",
            "phase": "queued",
            "progress": 0,
            "created_at": time.time(),
        }

    try:
        threading.Thread(target=_run_lora_apply, args=(task_id, req), daemon=True).start()
    except Exception:
        _lora_op_lock.release()
        with _lora_op_tasks_lock:
            _lora_op_tasks.pop(task_id, None)
        raise
    return {"ok": True, "task_id": task_id, "msg": "LoRA apply started."}


def _run_lora_remove(task_id: str):
    try:
        wait_started = time.time()
        while not _pipeline_ops_lock.acquire(timeout=1):
            waited_s = int(time.time() - wait_started)
            _update_lora_op_task(
                task_id,
                msg=f"Waiting for {_pipeline_op_desc()}... ({waited_s}s)",
                phase="waiting",
                progress=0,
            )

        _set_pipeline_op("removing LoRA and warming up")
        try:
            _update_lora_op_task(task_id, msg="Starting LoRA remove...", phase="start", progress=1)
            result = remove_lora(progress_cb=_lora_progress_callback(task_id))
        finally:
            _clear_pipeline_op()
            _pipeline_ops_lock.release()

        ok = bool(result.get("ok"))
        _update_lora_op_task(
            task_id,
            state="done",
            msg=result.get("msg", "LoRA removed." if ok else "LoRA remove failed."),
            phase="done" if ok else "error",
            progress=100 if ok else 0,
            result=result,
            error=None if ok else result.get("msg", "LoRA remove failed."),
            done_at=time.time(),
        )
    except Exception as e:
        logger.exception("LoRA remove task %s failed", task_id)
        _update_lora_op_task(
            task_id,
            state="done",
            msg=f"Error: {e}",
            phase="error",
            progress=0,
            error=str(e),
            done_at=time.time(),
        )
    finally:
        _lora_op_lock.release()


@app.post("/lora/remove")
def api_remove_lora():
    if not _lora_op_lock.acquire(blocking=False):
        return _busy_response("A LoRA operation is already running.")

    task_id = uuid.uuid4().hex
    with _lora_op_tasks_lock:
        _cleanup_done_tasks(_lora_op_tasks)
        _lora_op_tasks[task_id] = {
            "state": "running",
            "msg": "Queued LoRA remove...",
            "phase": "queued",
            "progress": 0,
            "created_at": time.time(),
        }

    try:
        threading.Thread(target=_run_lora_remove, args=(task_id,), daemon=True).start()
    except Exception:
        _lora_op_lock.release()
        with _lora_op_tasks_lock:
            _lora_op_tasks.pop(task_id, None)
        raise
    return {"ok": True, "task_id": task_id, "msg": "LoRA remove started."}


@app.get("/lora/operation/{task_id}")
def api_lora_operation_status(task_id: str):
    with _lora_op_tasks_lock:
        _cleanup_done_tasks(_lora_op_tasks)
        task = _lora_op_tasks.get(task_id)
        if task is None:
            return {
                "state": "done",
                "msg": "Task not found.",
                "phase": "done",
                "progress": 0,
                "error": "Task not found.",
            }
        return {
            "state": task.get("state", "done"),
            "msg": task.get("msg", ""),
            "phase": task.get("phase", ""),
            "progress": task.get("progress", 0),
            "error": task.get("error"),
            "result": task.get("result"),
        }


@app.post("/generate")
def api_generate(req: GenerateRequest):
    with _tasks_lock:
        _cleanup_done_tasks(_tasks)

    if not _generation_lock.acquire(blocking=False):
        return _busy_response("A generation is already running. Wait for it to finish before starting another.")

    task_id = uuid.uuid4().hex
    with _tasks_lock:
        _tasks[task_id] = {
            "state": "running",
            "msg": "Queued...",
            "progress": 0,
            "total_steps": 0,
            "created_at": time.time(),
            "prompt_id": req.prompt_id,
        }

    try:
        threading.Thread(target=_run_generate, args=(task_id, req), daemon=True).start()
    except Exception:
        _generation_lock.release()
        with _tasks_lock:
            _tasks.pop(task_id, None)
        raise
    return {"task_id": task_id}


@app.post("/cancel/{task_id}")
def api_cancel_task(task_id: str):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None:
            return JSONResponse(status_code=404, content={"error": "Task not found."})
        if task.get("state") == "done":
            return {"ok": True, "msg": "Task already finished."}
        task["cancelled"] = True
        task["msg"] = "Cancelling..."
    return {"ok": True, "msg": "Cancellation requested."}


@app.get("/status/{task_id}")
def api_task_status(task_id: str):
    with _tasks_lock:
        _cleanup_done_tasks(_tasks)
        task = _tasks.get(task_id)
        if task is None:
            return {"state": "done", "msg": "Task not found.", "progress": 0, "total_steps": 0}
        return {
            "state": task.get("state", "done"),
            "msg": task.get("msg", ""),
            "progress": task.get("progress", 0),
            "total_steps": task.get("total_steps", 0),
            "image_meta": task.get("image_meta"),
            "has_artifact": bool(task.get("artifact")),
            "error": task.get("error"),
            "cancelled": bool(task.get("cancelled")),
        }


@app.get("/artifact/{task_id}")
def api_task_artifact(task_id: str):
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is None or not task.get("artifact"):
            return JSONResponse(status_code=404, content={"error": "Artifact not found."})
        meta = task.get("image_meta") or {}
        filename = meta.get("filename") or f"{task_id}.png"
        content_type = task.get("content_type", "application/octet-stream")
        artifact = task["artifact"]
    return Response(
        content=artifact,
        media_type=content_type,
        headers={"Content-Disposition": f'inline; filename="{filename}"'},
    )


def run():
    import uvicorn

    log_file = None
    try:
        from logger import get_log_file
        log_file = get_log_file()
    except Exception:
        log_file = None

    if log_file:
        uvicorn_fh = logging.FileHandler(str(log_file), encoding="utf-8")
        uvicorn_fh.setLevel(logging.DEBUG)
        uvicorn_fh.setFormatter(logging.Formatter(
            "%(asctime)s  %(levelname)-7s  [uvicorn.model] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        ))
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            ulog = logging.getLogger(name)
            ulog.handlers.clear()
            ulog.addHandler(uvicorn_fh)
            ulog.setLevel(logging.DEBUG)

    uvicorn.run(app, host=MODEL_DAEMON_HOST, port=MODEL_DAEMON_PORT, log_level=MODEL_DAEMON_LOG_LEVEL)


if __name__ == "__main__":
    run()
