#!/usr/bin/env python3
"""Model daemon: owns the single local MLX Ideogram 4 runtime."""

from __future__ import annotations

import logging
import time
import threading
import uuid
from concurrent.futures import ThreadPoolExecutor
from io import BytesIO
from typing import Any

try:
    from .config import (
        DEFAULT_LORA_STRENGTH,
        DEFAULT_PRESET,
        DEFAULT_SEED,
        DEFAULT_SERVER_FORMAT,
        IMAGE_QUALITY_JPEG,
        IMAGE_QUALITY_WEBP,
        MODEL_DAEMON_AUTOLOAD,
        MODEL_DAEMON_HOST,
        MODEL_DAEMON_LOG_LEVEL,
        MODEL_DAEMON_PORT,
    )
    from .logger import get_logger
    from .mlx_runtime import GenerationCancelled, MlxRuntime
except ImportError:  # pragma: no cover - used when launched as python server/model_daemon.py.
    from config import (  # type: ignore
        DEFAULT_LORA_STRENGTH,
        DEFAULT_PRESET,
        DEFAULT_SEED,
        DEFAULT_SERVER_FORMAT,
        IMAGE_QUALITY_JPEG,
        IMAGE_QUALITY_WEBP,
        MODEL_DAEMON_AUTOLOAD,
        MODEL_DAEMON_HOST,
        MODEL_DAEMON_LOG_LEVEL,
        MODEL_DAEMON_PORT,
    )
    from logger import get_logger  # type: ignore
    from mlx_runtime import GenerationCancelled, MlxRuntime  # type: ignore

from fastapi import FastAPI
from fastapi.responses import JSONResponse, Response
from pydantic import BaseModel, Field


logger = get_logger("model")
runtime = MlxRuntime(logger)
app = FastAPI(title="Ideogram 4 MLX Model Daemon")

_TASK_TTL_SECONDS = 60 * 60
_tasks: dict[str, dict[str, Any]] = {}
_tasks_lock = threading.Lock()
_lora_download_tasks: dict[str, dict[str, Any]] = {}
_lora_download_tasks_lock = threading.Lock()
_lora_op_tasks: dict[str, dict[str, Any]] = {}
_lora_op_tasks_lock = threading.Lock()
_lora_op_lock = threading.Lock()
_generation_lock = threading.Lock()
_pipeline_ops_lock = threading.Lock()
_pipeline_op_state_lock = threading.Lock()
_pipeline_op_state: dict[str, Any] = {"label": None, "started_at": None}
_mlx_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="mlx-runtime")


class GenerateRequest(BaseModel):
    caption: dict | str
    width: int = 1024
    height: int = 1024
    preset: str = DEFAULT_PRESET
    seed: int = DEFAULT_SEED
    format: str = DEFAULT_SERVER_FORMAT
    quality: int | None = None
    prompt_id: int | None = None
    loras: list[dict[str, Any]] | None = None


class LoraApplyRequest(BaseModel):
    name: str = ""
    strength: float = DEFAULT_LORA_STRENGTH
    loras: list[dict[str, Any]] | None = None


class LoraDownloadRequest(BaseModel):
    preset_id: str = Field(default="", min_length=1)


def _busy_response(msg: str):
    return JSONResponse(status_code=409, content={"error": msg})


def _set_pipeline_op(label: str) -> None:
    with _pipeline_op_state_lock:
        _pipeline_op_state["label"] = label
        _pipeline_op_state["started_at"] = time.time()


def _clear_pipeline_op() -> None:
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
        return str(label)
    return f"{label} ({int(time.time() - started_at)}s)"


def _run_on_mlx_thread(fn, *args, **kwargs):
    """Run MLX/mflux work on one thread so thread-local GPU streams stay valid."""
    return _mlx_executor.submit(fn, *args, **kwargs).result()


def _cleanup_done_tasks(tasks: dict[str, dict[str, Any]]) -> None:
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del tasks[task_id]


def _update_task(task_id: str, **updates) -> None:
    with _tasks_lock:
        task = _tasks.get(task_id)
        if task is not None:
            task.update(updates)


def _is_task_cancelled(task_id: str) -> bool:
    with _tasks_lock:
        task = _tasks.get(task_id)
        return bool(task and task.get("cancelled"))


def _update_lora_op_task(task_id: str, **updates) -> None:
    with _lora_op_tasks_lock:
        task = _lora_op_tasks.get(task_id)
        if task is not None:
            task.update(updates)


def _progress_for_task(task_id: str):
    def _callback(progress: int, msg: str, phase: str) -> None:
        _update_task(
            task_id,
            progress=max(0, min(progress, 99)),
            msg=msg,
            phase=phase,
        )

    return _callback


def _progress_for_lora_task(task_id: str):
    def _callback(progress: int, msg: str, phase: str) -> None:
        _update_lora_op_task(
            task_id,
            progress=max(0, min(progress, 99)),
            msg=msg,
            phase=phase,
        )

    return _callback


def _load_model_locked(progress_cb=None):
    _pipeline_ops_lock.acquire()
    _set_pipeline_op("loading MLX model")
    try:
        return _run_on_mlx_thread(runtime.load, progress_cb=progress_cb)
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


def _normalise_size(width: int, height: int) -> tuple[int, int]:
    if width % 16:
        width = (width // 16) * 16
    if height % 16:
        height = (height // 16) * 16
    return max(16, width), max(16, height)


def _caption_hld(caption: dict | str) -> str:
    if isinstance(caption, dict):
        return str(caption.get("high_level_description", ""))
    return ""


def _image_format(fmt: str) -> tuple[str, str]:
    normalised = fmt.lower().strip()
    if normalised not in {"png", "webp", "jpeg"}:
        normalised = DEFAULT_SERVER_FORMAT
    pil_format = "JPEG" if normalised == "jpeg" else normalised.upper()
    return normalised, pil_format


def _run_generate(task_id: str, req: GenerateRequest) -> None:
    try:
        width, height = _normalise_size(req.width, req.height)
        fmt, pil_fmt = _image_format(req.format)
        total_steps = runtime.preset_step_count(req.preset)

        _update_task(
            task_id,
            msg=f"Generating with MLX ({width}x{height}, {total_steps} steps)...",
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
            if req.loras:
                _update_task(task_id, msg="Reloading MLX model with requested LoRA stack...")
                lora_result = _run_on_mlx_thread(runtime.apply_loras, req.loras)
                if not lora_result.get("ok"):
                    raise RuntimeError(lora_result.get("msg", "LoRA apply failed."))

            image, gen_meta = _run_on_mlx_thread(
                runtime.generate,
                caption=req.caption,
                width=width,
                height=height,
                preset=req.preset,
                seed=req.seed,
                progress_cb=_progress_for_task(task_id),
                cancel_cb=lambda: _is_task_cancelled(task_id),
            )

            buf = BytesIO()
            save_kw: dict[str, Any] = {}
            if fmt in {"webp", "jpeg"}:
                save_kw["quality"] = req.quality or (IMAGE_QUALITY_WEBP if fmt == "webp" else IMAGE_QUALITY_JPEG)
            image.save(buf, format=pil_fmt, **save_kw)

            lora_status = runtime.get_lora_status()
            lora_name = lora_status.get("applied")
            lora_strength = lora_status.get("strength") if lora_name else None
            filename = f"{task_id}.{fmt}"
            content_type = f"image/{'jpeg' if fmt == 'jpeg' else fmt}"

            _update_task(
                task_id,
                state="done",
                msg=f"Done in {gen_meta['generation_seconds']:.1f}s",
                progress=100,
                total_steps=total_steps,
                artifact=buf.getvalue(),
                content_type=content_type,
                image_meta={
                    "hld": _caption_hld(req.caption),
                    "width": width,
                    "height": height,
                    "preset": req.preset,
                    "seed": req.seed,
                    "prompt_id": req.prompt_id,
                    "filename": filename,
                    "format": fmt,
                    "generation_seconds": gen_meta["generation_seconds"],
                    "quantization_bits": gen_meta.get("quantization_bits"),
                    "lora_name": lora_name,
                    "lora_strength": lora_strength,
                },
                done_at=time.time(),
            )
            logger.info("Generation task %s done in %.1fs", task_id, gen_meta["generation_seconds"])
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
    except Exception as exc:
        logger.exception("Generation task %s failed", task_id)
        _update_task(
            task_id,
            state="done",
            msg=f"Error: {exc}",
            error=str(exc),
            image_meta=None,
            done_at=time.time(),
        )
    finally:
        _generation_lock.release()


@app.on_event("startup")
def startup() -> None:
    logger.info("MLX model daemon started")
    ok, err = runtime.is_available()
    if not ok:
        logger.warning("MLX runtime dependencies unavailable: %s", err)
        return
    if MODEL_DAEMON_AUTOLOAD:
        threading.Thread(target=_load_model_locked, daemon=True).start()
        logger.info("Auto-loading MLX model on daemon startup")


@app.get("/health")
def api_health():
    ok, err = runtime.is_available()
    return {"ok": ok, "role": "model-daemon", "backend": "mlx", "error": err}


@app.get("/model/status")
def api_model_status():
    status = runtime.status()
    status["operation"] = _pipeline_op_desc() if _pipeline_ops_lock.locked() else None
    return status


@app.post("/model/load")
def api_load_model():
    ok, err = runtime.is_available()
    if not ok:
        return {"ok": False, "msg": f"MLX runtime unavailable: {err}"}
    if _pipeline_ops_lock.locked():
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    threading.Thread(target=_load_model_locked, daemon=True).start()
    return {"ok": True, "msg": "MLX model load started."}


@app.post("/model/unload")
def api_unload_model():
    if not _pipeline_ops_lock.acquire(blocking=False):
        return _busy_response(f"A model operation is already running: {_pipeline_op_desc()}.")
    _set_pipeline_op("unloading MLX model")
    try:
        return _run_on_mlx_thread(runtime.unload)
    finally:
        _clear_pipeline_op()
        _pipeline_ops_lock.release()


@app.get("/lora/status")
def api_lora_status():
    return runtime.get_lora_status()


@app.get("/lora/presets")
def api_lora_presets():
    return {"presets": runtime.get_lora_presets()}


def _run_lora_download(task_id: str, preset_id: str) -> None:
    try:
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id]["msg"] = "Preparing LoRA download..."
        files = runtime.download_lora_preset(preset_id)
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id].update(
                {
                    "state": "done",
                    "msg": "Download complete.",
                    "files": files,
                    "done_at": time.time(),
                }
            )
    except Exception as exc:
        logger.exception("LoRA download task %s failed", task_id)
        with _lora_download_tasks_lock:
            _lora_download_tasks[task_id].update(
                {
                    "state": "done",
                    "msg": f"Error: {exc}",
                    "error": str(exc),
                    "done_at": time.time(),
                }
            )


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


def _run_lora_apply(task_id: str, req: LoraApplyRequest) -> None:
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

        _set_pipeline_op("reloading MLX model with LoRA")
        try:
            loras = req.loras if req.loras else [{"name": req.name, "strength": req.strength}]
            result = _run_on_mlx_thread(
                runtime.apply_loras,
                loras,
                progress_cb=_progress_for_lora_task(task_id),
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
    except Exception as exc:
        logger.exception("LoRA apply task %s failed", task_id)
        _update_lora_op_task(
            task_id,
            state="done",
            msg=f"Error: {exc}",
            phase="error",
            progress=0,
            error=str(exc),
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
            "msg": "Queued MLX LoRA reload...",
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
    return {"ok": True, "task_id": task_id, "msg": "LoRA reload started."}


def _run_lora_remove(task_id: str) -> None:
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

        _set_pipeline_op("reloading MLX model without LoRA")
        try:
            result = _run_on_mlx_thread(
                runtime.remove_loras,
                progress_cb=_progress_for_lora_task(task_id),
            )
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
    except Exception as exc:
        logger.exception("LoRA remove task %s failed", task_id)
        _update_lora_op_task(
            task_id,
            state="done",
            msg=f"Error: {exc}",
            phase="error",
            progress=0,
            error=str(exc),
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
            "msg": "Queued MLX LoRA removal...",
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
    return {"ok": True, "task_id": task_id, "msg": "LoRA removal started."}


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


def run() -> None:
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
        uvicorn_fh.setFormatter(
            logging.Formatter(
                "%(asctime)s  %(levelname)-7s  [uvicorn.model] %(message)s",
                datefmt="%Y-%m-%d %H:%M:%S",
            )
        )
        for name in ("uvicorn", "uvicorn.error", "uvicorn.access"):
            ulog = logging.getLogger(name)
            ulog.handlers.clear()
            ulog.addHandler(uvicorn_fh)
            ulog.setLevel(logging.DEBUG)

    uvicorn.run(app, host=MODEL_DAEMON_HOST, port=MODEL_DAEMON_PORT, log_level=MODEL_DAEMON_LOG_LEVEL)


if __name__ == "__main__":
    run()
