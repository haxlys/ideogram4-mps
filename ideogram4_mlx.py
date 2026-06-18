#!/usr/bin/env python3
from __future__ import annotations

"""Run Ideogram 4 on Apple Silicon through MLX/mflux."""

import argparse
import json
import logging
import os
import random
import sys
import time
from pathlib import Path

import requests


DEFAULT_DAEMON_URL = os.environ.get("IDEOGRAM4_MODEL_DAEMON_URL", "http://127.0.0.1:8001")


def _get_logger() -> logging.Logger:
    log_dir = Path(os.environ.get("IDEOGRAM4_LOG_DIR", Path(__file__).resolve().parent / "logs"))
    log_dir.mkdir(parents=True, exist_ok=True)
    logger = logging.getLogger("ideogram4_mlx")
    if logger.handlers:
        return logger
    logger.setLevel(logging.DEBUG)
    log_file = log_dir / f"ideogram4_mlx-{time.strftime('%Y%m%d-%H%M%S')}.log"
    fh = logging.FileHandler(str(log_file), encoding="utf-8")
    fh.setLevel(logging.DEBUG)
    fh.setFormatter(logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    sh = logging.StreamHandler()
    sh.setLevel(logging.INFO)
    sh.setFormatter(logging.Formatter("[%(name)s] %(message)s"))
    logger.addHandler(fh)
    logger.addHandler(sh)
    logger.info("Log file: %s", log_file)
    return logger


def _daemon_url(base_url: str, path: str) -> str:
    return f"{base_url.rstrip('/')}{path if path.startswith('/') else '/' + path}"


def _daemon_json(method: str, base_url: str, path: str, *, payload: dict | None = None, timeout: float = 10) -> dict:
    resp = requests.request(method, _daemon_url(base_url, path), json=payload, timeout=timeout)
    try:
        data = resp.json()
    except ValueError:
        data = {"error": resp.text or resp.reason}
    if resp.status_code >= 400:
        raise RuntimeError(data.get("error") or f"HTTP {resp.status_code}: {resp.reason}")
    return data


def _wait_for_daemon_model(base_url: str, logger: logging.Logger) -> None:
    status = _daemon_json("GET", base_url, "/model/status", timeout=5)
    if status.get("state") == "loaded":
        return

    logger.info("Requesting MLX model load from daemon...")
    _daemon_json("POST", base_url, "/model/load", timeout=5)
    last_msg = ""
    for _ in range(1200):
        status = _daemon_json("GET", base_url, "/model/status", timeout=5)
        msg = status.get("msg") or status.get("operation") or status.get("state") or ""
        if msg != last_msg:
            logger.info("Daemon model: %s", msg)
            last_msg = msg
        if status.get("state") == "loaded":
            return
        if status.get("state") == "idle" and status.get("msg"):
            raise RuntimeError(status["msg"])
        time.sleep(1)
    raise RuntimeError("Timed out waiting for daemon model load.")


def _wait_for_lora_operation(base_url: str, task_id: str, logger: logging.Logger) -> None:
    last_msg = ""
    for _ in range(1200):
        status = _daemon_json("GET", base_url, f"/lora/operation/{task_id}", timeout=5)
        msg = status.get("msg", "")
        if msg and msg != last_msg:
            logger.info("Daemon LoRA: %s", msg)
            last_msg = msg
        if status.get("state") == "done":
            if status.get("error"):
                raise RuntimeError(status["error"])
            result = status.get("result") or {}
            if result and not result.get("ok", False):
                raise RuntimeError(result.get("msg", "LoRA operation failed."))
            return
        time.sleep(1)
    raise RuntimeError("Timed out waiting for daemon LoRA operation.")


def _load_prompt(args) -> tuple[str, object]:
    if args.prompt_file:
        prompt = args.prompt_file.read_text().strip()
    elif args.prompt:
        prompt = args.prompt
    else:
        raise ValueError("--prompt or --prompt-file required")

    payload: object = prompt
    try:
        parsed = json.loads(prompt)
        if isinstance(parsed, dict):
            payload = parsed
    except json.JSONDecodeError:
        pass
    return prompt, payload


def _resolve_dimensions(args) -> tuple[int, int]:
    if args.width is not None and args.height is not None:
        width, height = args.width, args.height
    elif args.width is not None or args.height is not None:
        raise ValueError("--width and --height must be set together")
    else:
        width = height = args.resolution
    return 16 * (width // 16), 16 * (height // 16)


def run_via_daemon(args, prompt: str, caption_payload: object, width: int, height: int, logger: logging.Logger) -> bool:
    base_url = args.daemon_url.rstrip("/")
    try:
        _daemon_json("GET", base_url, "/health", timeout=3)
    except Exception as exc:
        if args.daemon == "require":
            raise RuntimeError(f"Model daemon is not reachable at {base_url}: {exc}") from exc
        logger.info("Model daemon is not reachable at %s; falling back to direct MLX mode.", base_url)
        return False

    _wait_for_daemon_model(base_url, logger)

    if args.lora:
        logger.info("Applying daemon LoRA by name: %s (strength=%.2f)", args.lora.name, args.lora_strength)
        res = _daemon_json(
            "POST",
            base_url,
            "/lora/apply",
            payload={"name": args.lora.name, "strength": args.lora_strength},
            timeout=5,
        )
        _wait_for_lora_operation(base_url, res["task_id"], logger)

    payload = {
        "caption": caption_payload,
        "width": width,
        "height": height,
        "preset": args.preset,
        "seed": args.seed,
        "format": args.format,
        "quality": args.quality,
    }
    logger.info("Submitting generation to MLX daemon: %s", base_url)
    res = _daemon_json("POST", base_url, "/generate", payload=payload, timeout=5)
    task_id = res["task_id"]

    last_msg = ""
    started = time.time()
    status = {}
    while True:
        status = _daemon_json("GET", base_url, f"/status/{task_id}", timeout=5)
        msg = status.get("msg", "")
        progress = status.get("progress", 0)
        line = f"{msg} ({progress}%)" if progress else msg
        if line and line != last_msg:
            logger.info("Daemon generation: %s", line)
            last_msg = line
        if status.get("state") == "done":
            break
        time.sleep(1)

    if status.get("error"):
        raise RuntimeError(status["error"])
    if not status.get("has_artifact"):
        raise RuntimeError(status.get("msg") or "Daemon finished without an image artifact.")

    artifact = requests.get(_daemon_url(base_url, f"/artifact/{task_id}"), timeout=60)
    if artifact.status_code >= 400:
        raise RuntimeError(f"Artifact download failed: HTTP {artifact.status_code}")

    out = args.out.with_suffix(f".{args.format}")
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes(artifact.content)

    gen_s = round(time.time() - started, 1)
    meta = status.get("image_meta") or {}
    logger.info("Done via daemon: %.1fs -> %s", gen_s, out)
    _write_log(
        out,
        {
            "preset": args.preset,
            "resolution": [width, height],
            "steps": status.get("total_steps", 0),
            "seed": args.seed,
            "generation_seconds": meta.get("generation_seconds", gen_s),
            "output": str(out),
            "format": args.format,
            "backend": "mlx-daemon",
            "daemon_url": base_url,
            "daemon_task_id": task_id,
            "prompt": prompt,
            "cmd": " ".join(sys.argv),
        },
    )
    return True


def run_direct(args, prompt: str, caption_payload: object, width: int, height: int, logger: logging.Logger) -> None:
    if args.model_repo:
        os.environ["IDEOGRAM4_MODEL_REPO"] = args.model_repo
    if args.model_path:
        os.environ["IDEOGRAM4_MODEL_PATH"] = str(args.model_path)

    from server.mlx_runtime import MlxRuntime

    runtime = MlxRuntime(logger)
    result = runtime.load(progress_cb=lambda _progress, msg, _phase: logger.info("%s", msg))
    if not result.get("ok"):
        raise RuntimeError(result.get("msg", "MLX model load failed."))

    if args.lora:
        lora_result = runtime.apply_loras(
            [{"name": args.lora.name, "strength": args.lora_strength}],
            progress_cb=lambda _progress, msg, _phase: logger.info("%s", msg),
        )
        if not lora_result.get("ok"):
            raise RuntimeError(lora_result.get("msg", "LoRA apply failed."))

    image, meta = runtime.generate(
        caption=caption_payload,
        width=width,
        height=height,
        preset=args.preset,
        seed=args.seed,
        progress_cb=lambda progress, msg, _phase: logger.info("%s (%d%%)", msg, progress),
    )

    out = args.out.with_suffix(f".{args.format}")
    out.parent.mkdir(parents=True, exist_ok=True)
    save_kw = {}
    if args.format in {"webp", "jpeg"}:
        save_kw["quality"] = args.quality or 95
    image.save(out, format=("JPEG" if args.format == "jpeg" else args.format.upper()), **save_kw)
    logger.info("Done: %.1fs -> %s", meta["generation_seconds"], out)
    _write_log(
        out,
        {
            "preset": args.preset,
            "resolution": [width, height],
            "steps": meta.get("steps", 0),
            "seed": args.seed,
            "generation_seconds": meta["generation_seconds"],
            "output": str(out),
            "format": args.format,
            "backend": "mlx-direct",
            "quantization_bits": meta.get("quantization_bits"),
            "prompt": prompt,
            "cmd": " ".join(sys.argv),
        },
    )


def _write_log(out: Path, payload: dict) -> None:
    out.with_suffix(".log").write_text(json.dumps(payload, ensure_ascii=False, indent=2))


def main() -> None:
    parser = argparse.ArgumentParser(description="Ideogram 4 MLX image generation")
    parser.add_argument("--prompt", type=str, help="JSON caption string")
    parser.add_argument("--prompt-file", type=Path, help="File containing JSON caption")
    parser.add_argument("--width", type=int, default=None, help="Output width, multiple of 16")
    parser.add_argument("--height", type=int, default=None, help="Output height, multiple of 16")
    parser.add_argument("--resolution", type=int, default=1024, help="Square resolution if width/height are unset")
    parser.add_argument("--preset", default="V4_QUALITY_48", choices=["V4_QUALITY_48", "V4_DEFAULT_20", "V4_TURBO_12"])
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--format", default="png", choices=["png", "webp", "jpeg"])
    parser.add_argument("--quality", type=int, default=None, help="Lossy quality 1-100 for webp/jpeg")
    parser.add_argument("--out", type=Path, required=True, help="Output image path")
    parser.add_argument("--lora", type=Path, default=None, help="Local LoRA filename/path under IDEOGRAM4_LORA_DIR")
    parser.add_argument("--lora-strength", type=float, default=0.6)
    parser.add_argument("--model-repo", default=None, help="Direct mode only: Hugging Face MLX model repo")
    parser.add_argument("--model-path", type=Path, default=None, help="Direct mode only: local MLX model directory")
    parser.add_argument("--daemon", choices=["auto", "require", "off"], default=os.environ.get("IDEOGRAM4_CLI_DAEMON_MODE", "auto"))
    parser.add_argument("--daemon-url", default=DEFAULT_DAEMON_URL)
    args = parser.parse_args()

    if args.seed is None:
        args.seed = random.randint(0, 2**32 - 1)

    logger = _get_logger()
    try:
        prompt, caption_payload = _load_prompt(args)
        width, height = _resolve_dimensions(args)
        if args.daemon != "off":
            if run_via_daemon(args, prompt, caption_payload, width, height, logger):
                return
        run_direct(args, prompt, caption_payload, width, height, logger)
    except Exception as exc:
        logger.error("%s", exc)
        sys.exit(1)


if __name__ == "__main__":
    main()
