#!/usr/bin/env python3
"""FastAPI server — owns the Ideogram 4 pipeline directly.
Load/unload, generation, image persistence, DB — all in one process.
"""
import base64
import json
import logging
import os
import threading
import time
import uuid
from io import BytesIO

import torch

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from db import init_db, get_images, delete_image, get_prompts, save_prompt, delete_prompt, get_last_form, save_last_form, add_image, OUTPUT_DIR
from logger import get_logger, get_log_file
from model_daemon import (
    handle_load, handle_unload, handle_status, get_pipeline, is_mps_available,
)

logger = get_logger("server")

app = FastAPI(title="Ideogram 4 MPS Server")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_tasks: dict = {}
_lock = threading.Lock()


@app.on_event("startup")
def startup():
    init_db()
    logger.info("FastAPI server started")
    if is_mps_available():
        threading.Thread(target=handle_load, daemon=True).start()
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
    threading.Thread(target=handle_load, daemon=True).start()
    return {"ok": True, "msg": "Load started."}


@app.post("/api/model/unload")
def api_unload_model():
    return handle_unload()


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
    prompt: str
    width: int = 1024
    height: int = 1024
    image_b64: str | None = None


@app.post("/api/magic-prompt")
def api_magic_prompt(req: MagicPromptRequest):
    logger.info("Magic prompt request: %dx%d", req.width, req.height)
    from magic_prompt import expand_prompt
    try:
        caption = expand_prompt(req.prompt, req.width, req.height, req.image_b64)
        model = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MODEL", "MiniMaxAI/MiniMax-M3")
        return {"caption": caption, "model": model}
    except Exception as e:
        logger.error("Magic prompt failed: %s", str(e))
        from fastapi.responses import JSONResponse
        return JSONResponse(status_code=500, content={"error": str(e)})


# ── Generation ────────────────────────────────────────────────────

class GenerateRequest(BaseModel):
    caption: dict
    width: int = 1024
    height: int = 1024
    preset: str = "V4_QUALITY_48"
    seed: int = 20260608
    prompt_id: int | None = None


def _run_generate(task_id: str, caption: dict, width: int, height: int, preset: str, seed: int):
    from ideogram4.sampler_configs import PRESETS

    try:
        _tasks[task_id]["msg"] = "Encoding prompt..."

        pipe = get_pipeline()
        if pipe is None:
            raise RuntimeError("Model not loaded.")

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
        logger.info("Task %s done in %.1fs", task_id, gen_s)

        buf = BytesIO()
        images[0].save(buf, format="PNG")
        buf.seek(0)

        timestamp = uuid.uuid4().hex[:12]
        filename = f"{timestamp}.png"
        filepath = OUTPUT_DIR / filename
        filepath.write_bytes(buf.getvalue())
        buf.seek(0)

        hld_text = caption.get("high_level_description", "")

        image_id = add_image(
            hld_text, width, height, preset, seed,
            str(filepath),
            _tasks[task_id].get("prompt_id"),
        )

        logger.info("Task %s → %s (id=%d, %dx%d)", task_id, filename, image_id, width, height)

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
        }

    except Exception as e:
        logger.exception("Generation task %s failed", task_id)
        _tasks[task_id]["state"] = "done"
        _tasks[task_id]["msg"] = f"Error: {e}"
        _tasks[task_id]["image"] = None


@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    logger.info("Generate request: %dx%d, %s, seed=%d, prompt_id=%s",
                 req.width, req.height, req.preset, req.seed, req.prompt_id)

    task_id = uuid.uuid4().hex
    _tasks[task_id] = {
        "state": "running", "msg": "Queued...", "image": None,
        "progress": 0, "total_steps": 0, "prompt_id": req.prompt_id,
    }
    logger.info("Generation task %s started: %dx%d, %s, seed=%d",
                 task_id, req.width, req.height, req.preset, req.seed)

    t = threading.Thread(
        target=_run_generate,
        args=(task_id, req.caption, req.width, req.height, req.preset, req.seed),
        daemon=True,
    )
    t.start()
    return {"task_id": task_id}


@app.get("/api/status/{task_id}")
def api_task_status(task_id: str):
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
    from fastapi.responses import FileResponse
    import os
    full = os.path.join("outputs", path)
    if os.path.isfile(full):
        return FileResponse(full)
    return {"error": "not found"}


# ── Images API ────────────────────────────────────────────────────

@app.get("/api/images")
def api_get_images(prompt_id: int | None = None):
    return get_images(prompt_id=prompt_id)


@app.post("/api/images")
def api_add_image(req: dict):
    class AddReq(BaseModel):
        hld: str = ""
        width: int = 1024
        height: int = 1024
        preset: str = "V4_QUALITY_48"
        seed: int = 0
        file_path: str
    body = AddReq(**req)
    img_id = add_image(body.hld, body.width, body.height, body.preset, body.seed, body.file_path)
    return {"id": img_id}


@app.delete("/api/images/{image_id}")
def api_delete_image(image_id: int):
    ok = delete_image(image_id)
    return {"ok": ok}


@app.get("/api/images/{image_id}/file")
def api_serve_image(image_id: int):
    rows = get_images()
    for r in rows:
        if r.get("id") == image_id:
            from fastapi.responses import FileResponse
            path = r["file_path"]
            import os
            if os.path.isfile(path):
                return FileResponse(path)
    return {"error": "not found"}


# ── Prompts API ──────────────────────────────────────────────────

@app.get("/api/prompts")
def api_get_prompts():
    return get_prompts()


@app.post("/api/prompts")
def api_save_prompt(req: dict):
    class PReq(BaseModel):
        hld: str
        form_json: str
    body = PReq(**req)
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
def api_save_last_form(req: dict):
    save_last_form(req["form_json"])
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
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
