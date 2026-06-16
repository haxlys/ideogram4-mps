#!/usr/bin/env python3
"""FastAPI server — owns the Ideogram 4 pipeline directly.
Load/unload, generation, image persistence, DB — all in one process.
"""
import base64
import binascii
import json
import logging
import resource
import threading
import time
import uuid
from io import BytesIO

import torch

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from config import (
    SERVER_HOST, SERVER_PORT, SERVER_LOG_LEVEL, CORS_ORIGINS, CORS_ALLOW_CREDENTIALS,
    DEFAULT_PRESET, DEFAULT_SERVER_FORMAT, DEFAULT_SEED,
    IMAGE_QUALITY_WEBP, IMAGE_QUALITY_JPEG,
    MAGIC_PROMPT_MODEL, DEFAULT_LORA_STRENGTH,
    MIN_IMAGE_SIZE, MAX_IMAGE_SIZE, IMAGE_SIZE_MULTIPLE, MAX_CAPTION_JSON_BYTES,
    MAGIC_PROMPT_MAX_CHARS, MAGIC_PROMPT_MAX_IMAGES, MAGIC_PROMPT_MAX_IMAGE_BYTES,
    MAX_FORM_JSON_BYTES,
)
from db import (
    init_db, get_images, get_image, delete_image, get_prompts, save_prompt,
    delete_prompt, get_last_form, save_last_form, add_image, OUTPUT_DIR,
    get_prompt, resolve_image_path,
)
from logger import get_logger, get_log_file
from model_daemon import (
    handle_load, handle_unload, handle_status, get_pipeline, is_mps_available,
    list_loras, apply_lora, apply_loras, remove_lora, get_lora_status,
    get_lora_presets, download_lora_preset,
)

logger = get_logger("server")

app = FastAPI(title="Ideogram 4 MPS Server")


ALLOWED_PRESETS = {"V4_QUALITY_48", "V4_DEFAULT_20", "V4_TURBO_12"}
ALLOWED_FORMATS = {"png", "webp", "jpeg"}


def _parse_cors_origins(raw: str) -> list[str]:
    return [origin.strip() for origin in raw.split(",") if origin.strip()]


def _validate_dimension(value: int) -> int:
    if not MIN_IMAGE_SIZE <= value <= MAX_IMAGE_SIZE:
        raise ValueError(f"must be between {MIN_IMAGE_SIZE} and {MAX_IMAGE_SIZE}")
    if value % IMAGE_SIZE_MULTIPLE != 0:
        raise ValueError(f"must be a multiple of {IMAGE_SIZE_MULTIPLE}")
    return value


def _json_size_bytes(value: object) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode("utf-8"))


def _decode_b64_payload(value: str) -> bytes:
    data = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    try:
        return base64.b64decode(data, validate=True)
    except (binascii.Error, ValueError) as e:
        raise ValueError("image payload must be valid base64") from e


def _normalise_b64_payload(value: str) -> str:
    data = value.split(",", 1)[1] if value.startswith("data:") and "," in value else value
    _decode_b64_payload(data)
    return data

app.add_middleware(
    CORSMiddleware,
    allow_origins=_parse_cors_origins(CORS_ORIGINS),
    allow_credentials=CORS_ALLOW_CREDENTIALS,
    allow_methods=["*"],
    allow_headers=["*"],
)

_tasks: dict = {}
_tasks_lock = threading.Lock()
_lora_download_tasks: dict = {}
_lora_download_tasks_lock = threading.Lock()
_lora_op_tasks: dict = {}
_lora_op_tasks_lock = threading.Lock()
_lora_op_lock = threading.Lock()
_pipeline_ops_lock = threading.Lock()
_pipeline_op_state_lock = threading.Lock()
_pipeline_op_state: dict = {"label": None, "started_at": None}
_generation_lock = threading.Lock()
_TASK_TTL_SECONDS = 60 * 60


def _load_model_locked():
    _pipeline_ops_lock.acquire()
    _set_pipeline_op("loading model")
    try:
        return handle_load()
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


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


def _cleanup_tasks_locked():
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(_tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del _tasks[task_id]


def _cleanup_lora_download_tasks_locked():
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(_lora_download_tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del _lora_download_tasks[task_id]


def _cleanup_lora_op_tasks_locked():
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(_lora_op_tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del _lora_op_tasks[task_id]


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


def _busy_response(msg: str):
    return JSONResponse(status_code=409, content={"error": msg})


@app.on_event("startup")
def startup():
    init_db()
    logger.info("FastAPI server started")
    if is_mps_available():
        threading.Thread(target=_load_model_locked, daemon=True).start()
        logger.info("Auto-loading model on startup")


@app.middleware("http")
async def log_requests(request: Request, call_next):
    t0 = time.time()
    response = await call_next(request)
    dt = (time.time() - t0) * 1000
    logger.debug("%s %s → %s (%.1fms)", request.method, request.url.path, response.status_code, dt)
    return response


# ── Model endpoints ─────────────────────────────────────────────

@app.get("/api/model/status")
def api_model_status():
    return handle_status()


@app.post("/api/model/load")
def api_load_model():
    logger.info("Model load requested via API")
    if not is_mps_available():
        return {"ok": False, "msg": "MPS not available. Requires Apple Silicon."}
    if _pipeline_ops_lock.locked():
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    threading.Thread(target=_load_model_locked, daemon=True).start()
    return {"ok": True, "msg": "Load started."}


@app.post("/api/model/unload")
def api_unload_model():
    if not _pipeline_ops_lock.acquire(blocking=False):
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    _set_pipeline_op("unloading model")
    try:
        return handle_unload()
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


# ── LoRA endpoints ───────────────────────────────────────────────

@app.get("/api/lora/status")
def api_lora_status():
    return get_lora_status()


@app.get("/api/lora/presets")
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


@app.post("/api/lora/download")
def api_download_lora(req: dict):
    preset_id = str(req.get("preset_id", "")).strip()
    if not preset_id:
        return {"ok": False, "msg": "Missing LoRA preset id."}

    task_id = uuid.uuid4().hex
    with _lora_download_tasks_lock:
        _cleanup_lora_download_tasks_locked()
        _lora_download_tasks[task_id] = {
            "state": "running",
            "msg": "Starting download...",
            "files": [],
            "created_at": time.time(),
        }

    threading.Thread(target=_run_lora_download, args=(task_id, preset_id), daemon=True).start()
    return {"ok": True, "task_id": task_id}


@app.get("/api/lora/download/{task_id}")
def api_lora_download_status(task_id: str):
    with _lora_download_tasks_lock:
        _cleanup_lora_download_tasks_locked()
        task = _lora_download_tasks.get(task_id)
        if task is None:
            return {"state": "done", "msg": "Task not found.", "files": []}
        return {
            "state": task.get("state", "done"),
            "msg": task.get("msg", ""),
            "files": task.get("files", []),
            "error": task.get("error"),
        }


def _run_lora_apply(task_id: str, requested_loras, name: str, strength: float):
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
            if requested_loras:
                result = apply_loras(requested_loras, progress_cb=_lora_progress_callback(task_id))
            else:
                result = apply_lora(name, strength, progress_cb=_lora_progress_callback(task_id))
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


@app.post("/api/lora/apply")
def api_apply_lora(req: dict):
    requested_loras = req.get("loras")
    name = req.get("name", "")
    strength = float(req.get("strength", DEFAULT_LORA_STRENGTH))
    if not requested_loras and not name:
        return {"ok": False, "msg": "Missing LoRA name."}
    if not _lora_op_lock.acquire(blocking=False):
        return _busy_response("A LoRA operation is already running.")

    task_id = uuid.uuid4().hex
    with _lora_op_tasks_lock:
        _cleanup_lora_op_tasks_locked()
        _lora_op_tasks[task_id] = {
            "state": "running",
            "msg": "Queued LoRA apply...",
            "phase": "queued",
            "progress": 0,
            "created_at": time.time(),
        }

    t = threading.Thread(
        target=_run_lora_apply,
        args=(task_id, requested_loras, name, strength),
        daemon=True,
    )
    try:
        t.start()
    except Exception:
        _lora_op_lock.release()
        with _lora_op_tasks_lock:
            _lora_op_tasks.pop(task_id, None)
        raise
    return {"ok": True, "task_id": task_id, "msg": "LoRA apply started."}


@app.post("/api/lora/remove")
def api_remove_lora():
    if not _lora_op_lock.acquire(blocking=False):
        return _busy_response("A LoRA operation is already running.")

    task_id = uuid.uuid4().hex
    with _lora_op_tasks_lock:
        _cleanup_lora_op_tasks_locked()
        _lora_op_tasks[task_id] = {
            "state": "running",
            "msg": "Queued LoRA remove...",
            "phase": "queued",
            "progress": 0,
            "created_at": time.time(),
        }

    t = threading.Thread(target=_run_lora_remove, args=(task_id,), daemon=True)
    try:
        t.start()
    except Exception:
        _lora_op_lock.release()
        with _lora_op_tasks_lock:
            _lora_op_tasks.pop(task_id, None)
        raise
    return {"ok": True, "task_id": task_id, "msg": "LoRA remove started."}


@app.get("/api/lora/operation/{task_id}")
def api_lora_operation_status(task_id: str):
    with _lora_op_tasks_lock:
        _cleanup_lora_op_tasks_locked()
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


# ── Validation / Magic prompt ─────────────────────────────────────

class VerifyRequest(BaseModel):
    caption: dict


@app.post("/api/verify")
def api_verify(req: VerifyRequest):
    try:
        from ideogram4.caption_verifier import CaptionVerifier
        verifier = CaptionVerifier()
        warnings = verifier.verify(req.caption)
        return {"valid": len(warnings) == 0, "warnings": warnings}
    except Exception:
        return {"valid": True, "warnings": []}


class MagicPromptRequest(BaseModel):
    prompt: str = Field(default="", max_length=MAGIC_PROMPT_MAX_CHARS)
    width: int = 1024
    height: int = 1024
    images_b64: list[str] | None = None

    @model_validator(mode="after")
    def validate_prompt_or_image(self):
        if not self.prompt.strip() and not self.images_b64:
            raise ValueError("prompt or at least one image is required")
        return self

    @field_validator("width", "height")
    @classmethod
    def validate_size(cls, value: int) -> int:
        return _validate_dimension(value)

    @field_validator("images_b64")
    @classmethod
    def validate_images(cls, value: list[str] | None) -> list[str] | None:
        if value is None:
            return value
        if len(value) > MAGIC_PROMPT_MAX_IMAGES:
            raise ValueError(f"at most {MAGIC_PROMPT_MAX_IMAGES} images are allowed")
        normalised = []
        for image_b64 in value:
            payload = _normalise_b64_payload(image_b64)
            if len(base64.b64decode(payload)) > MAGIC_PROMPT_MAX_IMAGE_BYTES:
                max_mb = MAGIC_PROMPT_MAX_IMAGE_BYTES / (1024 * 1024)
                raise ValueError(f"each image must be {max_mb:.1f} MB or smaller")
            normalised.append(payload)
        return normalised


_MAGIC_MODEL = MAGIC_PROMPT_MODEL


@app.post("/api/magic-prompt")
def api_magic_prompt(req: MagicPromptRequest):
    logger.info("Magic prompt request: %dx%d", req.width, req.height)
    from magic_prompt import expand_prompt
    try:
        caption = expand_prompt(req.prompt, req.width, req.height, req.images_b64)
        return {"caption": caption, "model": _MAGIC_MODEL}
    except Exception as e:
        logger.error("Magic prompt failed: %s", str(e))
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── Generation ────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    caption: dict
    width: int = 1024
    height: int = 1024
    preset: str = DEFAULT_PRESET
    seed: int = DEFAULT_SEED
    format: str = DEFAULT_SERVER_FORMAT
    prompt_id: int | None = None

    @field_validator("caption")
    @classmethod
    def validate_caption(cls, value: dict) -> dict:
        if _json_size_bytes(value) > MAX_CAPTION_JSON_BYTES:
            max_kb = MAX_CAPTION_JSON_BYTES / 1024
            raise ValueError(f"caption JSON must be {max_kb:.0f} KB or smaller")
        return value

    @field_validator("width", "height")
    @classmethod
    def validate_size(cls, value: int) -> int:
        return _validate_dimension(value)

    @field_validator("preset")
    @classmethod
    def validate_preset(cls, value: str) -> str:
        if value not in ALLOWED_PRESETS:
            raise ValueError(f"preset must be one of: {', '.join(sorted(ALLOWED_PRESETS))}")
        return value

    @field_validator("format")
    @classmethod
    def validate_format(cls, value: str) -> str:
        value = value.lower()
        if value not in ALLOWED_FORMATS:
            raise ValueError(f"format must be one of: {', '.join(sorted(ALLOWED_FORMATS))}")
        return value


class PromptSaveRequest(BaseModel):
    hld: str = Field(default="", max_length=12000)
    form_json: str = Field(max_length=MAX_FORM_JSON_BYTES)

    @field_validator("form_json")
    @classmethod
    def validate_form_json(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_FORM_JSON_BYTES:
            max_kb = MAX_FORM_JSON_BYTES / 1024
            raise ValueError(f"form JSON must be {max_kb:.0f} KB or smaller")
        json.loads(value)
        return value


class LastFormRequest(BaseModel):
    form_json: str = Field(max_length=MAX_FORM_JSON_BYTES)

    @field_validator("form_json")
    @classmethod
    def validate_form_json(cls, value: str) -> str:
        if len(value.encode("utf-8")) > MAX_FORM_JSON_BYTES:
            max_kb = MAX_FORM_JSON_BYTES / 1024
            raise ValueError(f"form JSON must be {max_kb:.0f} KB or smaller")
        json.loads(value)
        return value


def _run_generate(task_id: str, caption: dict, width: int, height: int, preset: str, seed: int, fmt: str = "webp"):
    from ideogram4.sampler_configs import PRESETS

    try:
        _tasks[task_id]["msg"] = "Encoding prompt..."

        prompt_str = json.dumps(caption, ensure_ascii=False)
        preset_cfg = PRESETS.get(preset, PRESETS["V4_QUALITY_48"])

        if width % 16:
            width = (width // 16) * 16
        if height % 16:
            height = (height // 16) * 16

        total_steps = preset_cfg.num_steps
        _tasks[task_id]["msg"] = f"Generating ({width}x{height}, {total_steps} steps)..."
        _tasks[task_id]["progress"] = 0
        _tasks[task_id]["total_steps"] = total_steps

        wait_started = time.time()
        while not _pipeline_ops_lock.acquire(timeout=1):
            waited_s = int(time.time() - wait_started)
            _tasks[task_id]["msg"] = f"Waiting for {_pipeline_op_desc()}... ({waited_s}s)"

        _set_pipeline_op("generating image")
        try:
            _tasks[task_id]["msg"] = f"Preparing pipeline ({width}x{height}, {total_steps} steps)..."
            pipe = get_pipeline()
            if pipe is None:
                raise RuntimeError("Model not loaded.")

            t0 = time.time()

            step_count = [0]
            _orig_forward = pipe.unconditional_transformer.forward

            def _patched_forward(*args, **kwargs):
                result = _orig_forward(*args, **kwargs)
                step_count[0] += 1
                pct = min(int(step_count[0] / total_steps * 100), 99)
                _tasks[task_id]["progress"] = pct
                _tasks[task_id]["msg"] = f"Generating ({width}x{height}, {step_count[0]}/{total_steps} steps)..."
                return result

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
                        seed=seed,
                        raise_on_caption_issues=False,
                    )
            finally:
                pipe.unconditional_transformer.forward = _orig_forward

            gen_s = time.time() - t0
            _tasks[task_id]["progress"] = 100
            _tasks[task_id]["msg"] = f"Done in {gen_s:.1f}s"

            if torch.backends.mps.is_available():
                mem_drv = torch.mps.driver_allocated_memory()
                mem_cur = torch.mps.current_allocated_memory()
                mem_max = torch.mps.recommended_max_memory()
                mem_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                logger.info("Task %s done in %.1fs  |  MPS cur:%.1fG drv:%.1fG max:%.1fG  |  RSS: %.1fG",
                             task_id, gen_s,
                             mem_cur / (1024**3),
                             mem_drv / (1024**3),
                             mem_max / (1024**3) if mem_max else 0,
                             mem_rss / (1024**2))
            else:
                mem_rss = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
                logger.info("Task %s done in %.1fs  |  RSS: %.1fG",
                             task_id, gen_s,
                             mem_rss / (1024**2))

            buf = BytesIO()
            save_kw = {}
            if fmt in ("webp", "jpeg"):
                save_kw["quality"] = IMAGE_QUALITY_WEBP if fmt == "webp" else IMAGE_QUALITY_JPEG
            PIL_fmt = fmt.upper()
            images[0].save(buf, format=PIL_fmt, **save_kw)
            buf.seek(0)

            timestamp = uuid.uuid4().hex[:12]
            filename = f"{timestamp}.{fmt}"
            filepath = OUTPUT_DIR / filename
            filepath.write_bytes(buf.getvalue())
            buf.seek(0)

            hld_text = caption.get("high_level_description", "")
            lora_status = get_lora_status()
            lora_name = lora_status.get("applied")
            lora_strength = lora_status.get("strength") if lora_name else None

            image_id = add_image(
                hld_text, width, height, preset, seed,
                filename,
                _tasks[task_id].get("prompt_id"),
                lora_name,
                lora_strength,
            )
        finally:
            _clear_pipeline_op()
            _pipeline_ops_lock.release()

        logger.info("Task %s → %s (id=%d, %dx%d, lora=%s)", task_id, filename, image_id, width, height, lora_name or "none")

        _tasks[task_id]["state"] = "done"
        _tasks[task_id]["image_b64"] = base64.b64encode(buf.getvalue()).decode()
        _tasks[task_id]["image_meta"] = {
            "hld": hld_text,
            "width": width,
            "height": height,
            "preset": preset,
            "seed": seed,
            "prompt_id": _tasks[task_id].get("prompt_id"),
            "image_id": image_id,
            "filename": filename,
            "lora_name": lora_name,
            "lora_strength": lora_strength,
        }

    except Exception as e:
        logger.exception("Generation task %s failed", task_id)
        _tasks[task_id]["state"] = "done"
        _tasks[task_id]["msg"] = f"Error: {e}"
        _tasks[task_id]["image"] = None
    finally:
        _tasks[task_id]["done_at"] = time.time()
        _generation_lock.release()


@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    logger.info("Generate request: %dx%d, %s, seed=%d, prompt_id=%s",
                 req.width, req.height, req.preset, req.seed, req.prompt_id)

    with _tasks_lock:
        _cleanup_tasks_locked()

    if not _generation_lock.acquire(blocking=False):
        return JSONResponse(
            status_code=409,
            content={"error": "A generation is already running. Wait for it to finish before starting another."},
        )

    task_id = uuid.uuid4().hex
    with _tasks_lock:
        _tasks[task_id] = {
            "state": "running", "msg": "Queued...", "image": None,
            "progress": 0, "total_steps": 0, "prompt_id": req.prompt_id,
            "created_at": time.time(),
        }
    logger.info("Generation task %s started: %dx%d, %s, seed=%d",
                 task_id, req.width, req.height, req.preset, req.seed)

    t = threading.Thread(
        target=_run_generate,
        args=(task_id, req.caption, req.width, req.height, req.preset, req.seed, req.format),
        daemon=True,
    )
    try:
        t.start()
    except Exception:
        _generation_lock.release()
        with _tasks_lock:
            _tasks.pop(task_id, None)
        raise
    return {"task_id": task_id}


@app.get("/api/status/{task_id}")
def api_task_status(task_id: str):
    with _tasks_lock:
        _cleanup_tasks_locked()
        task = _tasks.get(task_id)
    if task is None:
        return {"state": "done", "msg": "Task not found.", "image": None, "progress": 0, "total_steps": 0}

    image_b64 = task.pop("image_b64", None)
    image_meta = task.pop("image_meta", None)

    if image_b64:
        meta = image_meta or {}
        task["image"] = {
            "id": meta.get("image_id"),
            "url": f"/api/images/{meta.get('image_id')}/file",
            "hld": meta.get("hld", ""),
            "time": time.strftime("%H:%M:%S"),
            "prompt_id": meta.get("prompt_id"),
        }

    return {
        "state": task["state"],
        "msg": task.get("msg", ""),
        "image": task.get("image"),
        "progress": task.get("progress", 0),
        "total_steps": task.get("total_steps", 0),
    }


# ── Static files ──────────────────────────────────────────────────

@app.get("/outputs/{path:path}")
def serve_output(path: str):
    full = resolve_image_path(path)
    if full and full.is_file():
        return FileResponse(full)
    return {"error": "not found"}


# ── Images API ────────────────────────────────────────────────────

@app.get("/api/images")
def api_get_images(prompt_id: int | None = None):
    return get_images(prompt_id=prompt_id)


@app.delete("/api/images/{image_id}")
def api_delete_image(image_id: int):
    ok = delete_image(image_id)
    return {"ok": ok}


@app.get("/api/images/{image_id}/file")
def api_serve_image(image_id: int):
    row = get_image(image_id)
    if row:
        path = resolve_image_path(row["file_path"])
        if path and path.is_file():
            return FileResponse(path)
    return {"error": "not found"}


# ── Prompts API ──────────────────────────────────────────────────

@app.get("/api/prompts")
def api_get_prompts():
    return get_prompts()


@app.get("/api/prompts/{prompt_id}")
def api_get_single_prompt(prompt_id: int):
    p = get_prompt(prompt_id)
    if p is None:
        return {"error": "not found"}
    return p


@app.post("/api/prompts")
def api_save_prompt(body: PromptSaveRequest):
    pid = save_prompt(body.hld, body.form_json)
    return {"id": pid}


@app.delete("/api/prompts/{prompt_id}")
def api_delete_prompt(prompt_id: int):
    ok = delete_prompt(prompt_id)
    return {"ok": ok}


# ── Form persistence ──────────────────────────────────────────────

@app.get("/api/form")
def api_get_last_form():
    fj = get_last_form()
    return {"form_json": fj}


@app.post("/api/form")
def api_save_last_form(req: LastFormRequest):
    save_last_form(req.form_json)
    return {"ok": True}


if __name__ == "__main__":
    import uvicorn
    log_file = get_log_file()
    if log_file:
        uvicorn_fh = logging.FileHandler(str(log_file), encoding="utf-8")
        uvicorn_fh.setLevel(logging.DEBUG)
        uvicorn_fh.setFormatter(logging.Formatter(
            "%(asctime)s  %(levelname)-7s  [uvicorn] %(message)s", datefmt="%Y-%m-%d %H:%M:%S"
        ))
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            ulog = logging.getLogger(name)
            ulog.handlers.clear()
            ulog.addHandler(uvicorn_fh)
            ulog.setLevel(logging.DEBUG)
    uvicorn.run(app, host=SERVER_HOST, port=SERVER_PORT, log_level=SERVER_LOG_LEVEL)
