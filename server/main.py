#!/usr/bin/env python3
"""FastAPI server — WebUI API gateway and persistence layer.
Model load/unload, LoRA, and generation are delegated to model_daemon.py.
"""
import base64
import binascii
import json
import logging
import os
import threading
import time

import requests
from urllib.parse import urlparse

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field, field_validator, model_validator

from config import (
    SERVER_HOST, SERVER_PORT, SERVER_LOG_LEVEL, CORS_ORIGINS, CORS_ALLOW_CREDENTIALS,
    DEFAULT_PRESET, DEFAULT_SERVER_FORMAT, DEFAULT_SEED,
    MAGIC_PROMPT_API_KEY, MAGIC_PROMPT_MODEL, MAGIC_PROMPT_BASE_URL,
    MAGIC_PROMPT_PROVIDER, MAGIC_PROMPT_LOCAL_LLAMA, MAGIC_PROMPT_MANAGED_LLAMA,
    MIN_IMAGE_SIZE, MAX_IMAGE_SIZE, IMAGE_SIZE_MULTIPLE, MAX_CAPTION_JSON_BYTES,
    MAGIC_PROMPT_MAX_CHARS, MAGIC_PROMPT_MAX_IMAGES, MAGIC_PROMPT_MAX_IMAGE_BYTES,
    MAX_FORM_JSON_BYTES,
    MODEL_DAEMON_URL, MODEL_DAEMON_TIMEOUT,
)
from db import (
    init_db, get_images, get_image, delete_image, get_prompts, save_prompt,
    delete_prompt, get_last_form, save_last_form, add_image, OUTPUT_DIR,
    get_prompt, resolve_image_path, get_image_by_file_path,
)
from logger import get_logger, get_log_file

logger = get_logger("server")

app = FastAPI(title="Ideogram 4 MLX Server")


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
_TASK_TTL_SECONDS = 60 * 60


def _cleanup_tasks_locked():
    cutoff = time.time() - _TASK_TTL_SECONDS
    for task_id, task in list(_tasks.items()):
        if task.get("state") == "done" and task.get("done_at", task.get("created_at", 0)) < cutoff:
            del _tasks[task_id]


def _daemon_url(path: str) -> str:
    return f"{MODEL_DAEMON_URL}{path if path.startswith('/') else '/' + path}"


def _daemon_json(method: str, path: str, *, json_body: object | None = None, timeout: float | None = None):
    try:
        resp = requests.request(
            method,
            _daemon_url(path),
            json=json_body,
            timeout=timeout or MODEL_DAEMON_TIMEOUT,
        )
    except requests.RequestException as e:
        logger.warning("Model daemon request failed: %s %s: %s", method, path, e)
        return JSONResponse(status_code=503, content={"error": f"Model daemon unreachable: {e}"})

    try:
        data = resp.json()
    except ValueError:
        data = {"error": resp.text or resp.reason}

    if resp.status_code >= 400:
        return JSONResponse(status_code=resp.status_code, content=data)
    return data


def _task_image_from_row(row: dict, hld: str = "") -> dict:
    return {
        "id": row["id"],
        "url": f"/api/images/{row['id']}/file",
        "hld": row.get("hld") or hld,
        "time": time.strftime("%H:%M:%S"),
        "prompt_id": row.get("prompt_id"),
    }


def _persist_daemon_artifact(task_id: str, meta: dict) -> dict:
    fmt = str(meta.get("format") or DEFAULT_SERVER_FORMAT).lower()
    if fmt not in ALLOWED_FORMATS:
        fmt = DEFAULT_SERVER_FORMAT
    filename = f"{task_id}.{fmt}"

    existing = get_image_by_file_path(filename)
    if existing is not None:
        return _task_image_from_row(existing, str(meta.get("hld", "")))

    try:
        resp = requests.get(_daemon_url(f"/artifact/{task_id}"), timeout=MODEL_DAEMON_TIMEOUT)
    except requests.RequestException as e:
        raise RuntimeError(f"Model daemon artifact fetch failed: {e}") from e
    if resp.status_code >= 400:
        raise RuntimeError(f"Model daemon artifact fetch failed: HTTP {resp.status_code}")

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    filepath = OUTPUT_DIR / filename
    filepath.write_bytes(resp.content)

    image_id = add_image(
        str(meta.get("hld", "")),
        int(meta.get("width", 1024)),
        int(meta.get("height", 1024)),
        str(meta.get("preset", DEFAULT_PRESET)),
        int(meta.get("seed", 0)),
        filename,
        meta.get("prompt_id"),
        meta.get("lora_name"),
        meta.get("lora_strength"),
    )
    row = get_image(image_id) or {
        "id": image_id,
        "hld": str(meta.get("hld", "")),
        "prompt_id": meta.get("prompt_id"),
    }
    logger.info("Persisted daemon artifact %s as image id=%s", filename, image_id)
    return _task_image_from_row(row, str(meta.get("hld", "")))


@app.on_event("startup")
def startup():
    init_db()
    logger.info("FastAPI server started")


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
    result = _daemon_json("GET", "/model/status", timeout=5)
    if isinstance(result, JSONResponse):
        return {"state": "idle", "msg": "Model daemon unreachable."}
    return result


@app.post("/api/model/load")
def api_load_model():
    logger.info("Model load requested via API")
    return _daemon_json("POST", "/model/load", timeout=5)


@app.post("/api/model/unload")
def api_unload_model():
    return _daemon_json("POST", "/model/unload", timeout=MODEL_DAEMON_TIMEOUT)


# ── LoRA endpoints ───────────────────────────────────────────────

@app.get("/api/lora/status")
def api_lora_status():
    return _daemon_json("GET", "/lora/status", timeout=5)


@app.get("/api/lora/presets")
def api_lora_presets():
    return _daemon_json("GET", "/lora/presets", timeout=5)


@app.post("/api/lora/download")
def api_download_lora(req: dict):
    return _daemon_json("POST", "/lora/download", json_body=req, timeout=5)


@app.get("/api/lora/download/{task_id}")
def api_lora_download_status(task_id: str):
    return _daemon_json("GET", f"/lora/download/{task_id}", timeout=5)


@app.post("/api/lora/apply")
def api_apply_lora(req: dict):
    return _daemon_json("POST", "/lora/apply", json_body=req, timeout=5)


@app.post("/api/lora/remove")
def api_remove_lora():
    return _daemon_json("POST", "/lora/remove", timeout=5)


@app.get("/api/lora/operation/{task_id}")
def api_lora_operation_status(task_id: str):
    return _daemon_json("GET", f"/lora/operation/{task_id}", timeout=5)


# ── Validation / Magic prompt ─────────────────────────────────────

class VerifyRequest(BaseModel):
    caption: dict


@app.post("/api/verify")
def api_verify(req: VerifyRequest):
    try:
        from magic_prompt import verify_caption

        warnings = verify_caption(req.caption)
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
_KEY_OPTIONAL_PROVIDERS = {"openai_compatible", "llama_cpp", "llama-cpp", "llamacpp"}
_MAGIC_PROMPT_ENABLE_ENV_KEYS = {
    "IDEOGRAM4_MAGIC_PROMPT_API_KEY",
    "IDEOGRAM4_MAGIC_PROMPT_PROVIDER",
    "IDEOGRAM4_MAGIC_PROMPT_MODEL",
    "IDEOGRAM4_MAGIC_PROMPT_BASE_URL",
    "IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA",
    "IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA",
    "IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL",
}


def _magic_prompt_enabled() -> bool:
    return any(os.environ.get(name, "").strip() for name in _MAGIC_PROMPT_ENABLE_ENV_KEYS)


def _is_local_magic_prompt_host(url: str) -> bool:
    host = urlparse(url).hostname or ""
    return host in {"127.0.0.1", "localhost", "::1"}


def _magic_prompt_health_url() -> str:
    base = MAGIC_PROMPT_BASE_URL.rstrip("/")
    if base.endswith("/v1"):
        base = base[:-3]
    return f"{base}/health"


def _magic_prompt_models_url() -> str:
    base = MAGIC_PROMPT_BASE_URL.rstrip("/")
    if not base.endswith("/v1"):
        base = f"{base}/v1"
    return f"{base}/models"


def _check_magic_prompt_llm(provider: str) -> tuple[bool, str | None]:
    headers: dict[str, str] = {}
    if MAGIC_PROMPT_API_KEY:
        headers["Authorization"] = f"Bearer {MAGIC_PROMPT_API_KEY}"

    if provider in {"llama_cpp", "llama-cpp", "llamacpp"} or _is_local_magic_prompt_host(MAGIC_PROMPT_BASE_URL):
        try:
            resp = requests.get(_magic_prompt_health_url(), timeout=3)
            if resp.status_code == 200:
                return True, None
            return False, f"LLM health check returned HTTP {resp.status_code}"
        except Exception as e:
            return False, str(e)

    try:
        resp = requests.get(_magic_prompt_models_url(), headers=headers, timeout=5)
        if resp.status_code < 500:
            return True, None
        return False, f"LLM probe returned HTTP {resp.status_code}"
    except Exception as e:
        return False, str(e)


@app.get("/api/magic-prompt/status")
def api_magic_prompt_status():
    provider = (
        MAGIC_PROMPT_PROVIDER
        or ("llama_cpp" if MAGIC_PROMPT_LOCAL_LLAMA or MAGIC_PROMPT_MANAGED_LLAMA else "openai_compatible")
    )
    enabled = _magic_prompt_enabled()
    local_llama_enabled = MAGIC_PROMPT_LOCAL_LLAMA or MAGIC_PROMPT_MANAGED_LLAMA
    missing_env: list[str] = []

    if not enabled:
        llm_reachable, llm_error = False, None
    elif local_llama_enabled:
        local_model = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL", "").strip()
        if not local_model:
            missing_env.append("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL")
        llm_reachable, llm_error = _check_magic_prompt_llm(provider) if len(missing_env) == 0 else (False, None)
    elif provider not in _KEY_OPTIONAL_PROVIDERS and not MAGIC_PROMPT_API_KEY:
        missing_env.append("IDEOGRAM4_MAGIC_PROMPT_API_KEY")
        llm_reachable, llm_error = False, None
    else:
        llm_reachable, llm_error = _check_magic_prompt_llm(provider)

    return {
        "enabled": enabled,
        "configured": enabled and len(missing_env) == 0 and llm_reachable,
        "provider": provider,
        "model": MAGIC_PROMPT_MODEL,
        "base_url": MAGIC_PROMPT_BASE_URL,
        "auth_configured": bool(MAGIC_PROMPT_API_KEY),
        "managed_local_llama": local_llama_enabled,
        "missing_env": missing_env,
        "llm_reachable": llm_reachable,
        "llm_error": llm_error,
    }


@app.post("/api/magic-prompt")
def api_magic_prompt(req: MagicPromptRequest):
    logger.info("Magic prompt request: %dx%d", req.width, req.height)
    from magic_prompt import expand_prompt
    try:
        if not _magic_prompt_enabled():
            return JSONResponse(
                status_code=400,
                content={"error": "Magic Prompt is disabled. Configure IDEOGRAM4_MAGIC_PROMPT_* to enable it."},
            )
        caption = expand_prompt(req.prompt, req.width, req.height, req.images_b64)
        return {"caption": caption, "model": _MAGIC_MODEL}
    except Exception as e:
        logger.error("Magic prompt failed: %s", str(e))
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


@app.post("/api/generate")
def api_generate(req: GenerateRequest):
    logger.info("Generate request: %dx%d, %s, seed=%d, prompt_id=%s",
                 req.width, req.height, req.preset, req.seed, req.prompt_id)

    with _tasks_lock:
        _cleanup_tasks_locked()

    result = _daemon_json("POST", "/generate", json_body=req.model_dump(), timeout=5)
    if isinstance(result, JSONResponse):
        return result

    task_id = result.get("task_id")
    if not task_id:
        return JSONResponse(status_code=502, content={"error": "Model daemon did not return a task id."})
    with _tasks_lock:
        _tasks[task_id] = {
            "state": "running", "msg": "Queued...", "image": None,
            "progress": 0, "total_steps": 0, "prompt_id": req.prompt_id,
            "created_at": time.time(),
        }
    logger.info("Daemon generation task %s started: %dx%d, %s, seed=%d",
                 task_id, req.width, req.height, req.preset, req.seed)
    return result


@app.post("/api/cancel/{task_id}")
def api_cancel_task(task_id: str):
    logger.info("Cancel requested for task %s", task_id)
    return _daemon_json("POST", f"/cancel/{task_id}", timeout=5)


@app.get("/api/status/{task_id}")
def api_task_status(task_id: str):
    with _tasks_lock:
        _cleanup_tasks_locked()
        local_task = _tasks.get(task_id)

    daemon_status = _daemon_json("GET", f"/status/{task_id}", timeout=5)
    if isinstance(daemon_status, JSONResponse):
        return daemon_status

    image = local_task.get("image") if local_task else None
    meta = daemon_status.get("image_meta") or {}

    if daemon_status.get("state") == "done" and daemon_status.get("has_artifact") and not image:
        try:
            image = _persist_daemon_artifact(task_id, meta)
            with _tasks_lock:
                task = _tasks.setdefault(task_id, {"created_at": time.time()})
                task.update({
                    "state": "done",
                    "msg": daemon_status.get("msg", ""),
                    "image": image,
                    "progress": daemon_status.get("progress", 100),
                    "total_steps": daemon_status.get("total_steps", 0),
                    "done_at": time.time(),
                })
        except Exception as e:
            logger.exception("Failed to persist daemon artifact for task %s", task_id)
            return {
                "state": "done",
                "msg": f"Error: {e}",
                "image": None,
                "progress": daemon_status.get("progress", 0),
                "total_steps": daemon_status.get("total_steps", 0),
            }

    return {
        "state": daemon_status.get("state", "done"),
        "msg": daemon_status.get("msg", ""),
        "image": image,
        "progress": daemon_status.get("progress", 0),
        "total_steps": daemon_status.get("total_steps", 0),
        "error": daemon_status.get("error"),
        "cancelled": daemon_status.get("cancelled", False),
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
