#!/usr/bin/env python3
"""Check whether the local Ideogram 4 MLX environment is ready to run."""

from __future__ import annotations

import json
import os
import shutil
import socket
import subprocess
import sys
from pathlib import Path
from urllib.request import urlopen


ROOT = Path(__file__).resolve().parent.parent
VENV_PYTHON = ROOT / ".venv" / "bin" / "python"
WEBUI = ROOT / "webui"
REQUIREMENTS = ROOT / "server" / "requirements.txt"

failures: list[str] = []
warnings: list[str] = []


def env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def truthy(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def say(kind: str, msg: str) -> None:
    print(f"[{kind}] {msg}")


def ok(msg: str) -> None:
    say("OK", msg)


def warn(msg: str) -> None:
    warnings.append(msg)
    say("WARN", msg)


def fail(msg: str) -> None:
    failures.append(msg)
    say("FAIL", msg)


def run(cmd: list[str], timeout: int = 30) -> subprocess.CompletedProcess[str]:
    return subprocess.run(cmd, cwd=ROOT, text=True, capture_output=True, timeout=timeout, check=False)


def port_is_open(port: int) -> bool:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.settimeout(0.2)
        return sock.connect_ex(("127.0.0.1", port)) == 0


def http_ok(url: str, timeout: float = 2.0) -> bool:
    try:
        with urlopen(url, timeout=timeout) as response:
            return 200 <= response.status < 300
    except Exception:
        return False


def check_python() -> None:
    if not VENV_PYTHON.exists():
        fail(f"Missing virtualenv Python: {VENV_PYTHON}. Run: python3 -m venv .venv")
        return
    ok(f"Found virtualenv Python: {VENV_PYTHON}")

    code = """
import importlib.metadata as md
mods = ["fastapi", "uvicorn", "mlx", "mflux", "huggingface_hub", "PIL"]
missing = []
for mod in mods:
    try:
        __import__(mod)
    except Exception as exc:
        missing.append(f"{mod}: {exc}")
if missing:
    raise SystemExit("\\n".join(missing))
for pkg in ["mlx", "mflux"]:
    try:
        print(f"{pkg}={md.version(pkg)}")
    except Exception:
        pass
"""
    result = run([str(VENV_PYTHON), "-c", code])
    if result.returncode:
        fail("Python dependencies are not ready. Run: .venv/bin/python -m pip install -r server/requirements.txt")
        print(result.stderr.strip() or result.stdout.strip())
    else:
        ok("Python MLX/mflux dependencies import successfully")
        if result.stdout.strip():
            print(result.stdout.strip())

    req = REQUIREMENTS.read_text()
    if "8d80b9cb53688b62a2f814604b9f8b48987c5acd" in req:
        ok("mflux is pinned to the MLXBits q8 loader commit")
    else:
        warn("mflux pin does not reference the expected PR #445 commit")


def check_webui() -> None:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        fail("pnpm was not found in PATH")
        return
    ok(f"Found pnpm: {pnpm}")
    if not (WEBUI / "node_modules").is_dir():
        warn("webui/node_modules is missing. Run: cd webui && pnpm install")
    else:
        ok("WebUI dependencies appear installed")


def check_lsp_optional() -> None:
    pyright = ROOT / ".venv" / "bin" / "pyright-langserver"
    tsserver = WEBUI / "node_modules" / ".bin" / "typescript-language-server"
    if pyright.is_file():
        ok(f"OMP LSP (optional): pyright-langserver at {pyright}")
    else:
        warn(
            "OMP LSP (optional): pyright-langserver missing. "
            "Run: .venv/bin/python -m pip install -r server/requirements-dev.txt"
        )
    if tsserver.is_file():
        ok(f"OMP LSP (optional): typescript-language-server at {tsserver}")
    else:
        warn(
            "OMP LSP (optional): typescript-language-server missing. "
            "Run: cd webui && pnpm install"
        )


def check_model() -> None:
    model_path = env("IDEOGRAM4_MODEL_PATH")
    model_repo = env("IDEOGRAM4_MODEL_REPO", "MLXBits/ideogram-4-mlx-q8")
    revision = env("IDEOGRAM4_MODEL_REVISION")
    if model_path:
        root = Path(model_path).expanduser()
        split = root / "split_model.json"
        if not split.is_file():
            fail(f"IDEOGRAM4_MODEL_PATH must contain split_model.json: {root}")
            return
        try:
            metadata = json.loads(split.read_text())
        except Exception as exc:
            fail(f"Invalid split_model.json at {split}: {exc}")
            return
        bits = metadata.get("quantization_bits")
        ok(f"Local MLX model is ready: {root} (quantization_bits={bits})")
    else:
        warn(f"No IDEOGRAM4_MODEL_PATH set; daemon will download/verify {model_repo} revision={revision or 'default'}")


def check_lora() -> None:
    lora_dir = Path(env("IDEOGRAM4_LORA_DIR", "models/loras"))
    if not lora_dir.is_absolute():
        lora_dir = ROOT / lora_dir
    if not lora_dir.exists():
        warn(f"LoRA directory does not exist yet: {lora_dir}")
        return
    count = len(list(lora_dir.glob("*.safetensors")))
    ok(f"LoRA directory is readable: {lora_dir} ({count} safetensors files)")


def check_magic_prompt() -> None:
    provider = env("IDEOGRAM4_MAGIC_PROMPT_PROVIDER")
    if not provider:
        ok("Magic Prompt provider is not configured; text generation can still run without it")
        return

    ok(f"Magic Prompt provider configured: {provider}")
    if truthy(env("IDEOGRAM4_MAGIC_PROMPT_MANAGED_LLAMA")) or truthy(env("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA")):
        llama_server = shutil.which("llama-server")
        if not llama_server:
            fail("Managed local Magic Prompt is enabled but llama-server was not found in PATH")
        else:
            ok(f"Found llama-server: {llama_server}")
        model = env("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MODEL")
        mmproj = env("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_MMPROJ")
        if model and not Path(model).is_file():
            fail(f"Local Magic Prompt model not found: {model}")
        elif model:
            ok(f"Local Magic Prompt model exists: {model}")
        if mmproj and not Path(mmproj).is_file():
            fail(f"Local Magic Prompt mmproj not found: {mmproj}")
        elif mmproj:
            ok(f"Local Magic Prompt mmproj exists: {mmproj}")

    base_url = env("IDEOGRAM4_MAGIC_PROMPT_BASE_URL", "http://127.0.0.1:18082/v1")
    health_url = base_url.removesuffix("/v1").rstrip("/") + "/health"
    if http_ok(health_url):
        ok(f"Magic Prompt LLM is reachable: {health_url}")
    else:
        warn(f"Magic Prompt LLM is not currently reachable: {health_url}")


def check_ports() -> None:
    ports = {
        "Magic Prompt LLM": int(env("IDEOGRAM4_MAGIC_PROMPT_LOCAL_LLAMA_PORT", "18082")),
        "FastAPI": int(env("IDEOGRAM4_SERVER_PORT", "8000")),
        "Model daemon": int(env("IDEOGRAM4_MODEL_DAEMON_PORT", "8001")),
        "WebUI": int(env("IDEOGRAM4_WEBUI_PORT", "5173")),
    }
    for label, port in ports.items():
        state = "listening" if port_is_open(port) else "free"
        ok(f"{label} port {port}: {state}")


def check_memory_policy() -> None:
    autoload = env("IDEOGRAM4_MODEL_DAEMON_AUTOLOAD", "0")
    cache_limit = env("IDEOGRAM4_MLX_CACHE_LIMIT_GB")
    if truthy(autoload):
        warn("IDEOGRAM4_MODEL_DAEMON_AUTOLOAD is enabled; this loads ~29GB of MLX model memory at startup")
    else:
        ok("Model daemon autoload is disabled; use WebUI Load or POST /api/model/load when needed")
    if cache_limit:
        ok(f"MLX cache limit is configured: {cache_limit} GB")
    else:
        warn("IDEOGRAM4_MLX_CACHE_LIMIT_GB is unset; MLX will use its default cache behavior")


def main() -> int:
    print("Ideogram 4 MLX environment doctor")
    print(f"Root: {ROOT}")
    print("")
    check_python()
    check_webui()
    check_lsp_optional()
    check_model()
    check_lora()
    check_magic_prompt()
    check_ports()
    check_memory_policy()
    print("")
    print(f"Summary: {len(failures)} failure(s), {len(warnings)} warning(s)")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
