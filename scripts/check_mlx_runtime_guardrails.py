#!/usr/bin/env python3
"""Static guardrails for the MLX runtime migration."""

from __future__ import annotations

import re
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
RUNTIME_FILES = [ROOT / "ideogram4_mlx.py", *sorted((ROOT / "server").glob("*.py"))]
BANNED_PATTERNS = [
    re.compile(r"\bsafetensors\.torch\b"),
    re.compile(r"\bfrom\s+ideogram4\b"),
    re.compile(r"\bimport\s+ideogram4\b"),
    re.compile(r"\bimport\s+torch\b"),
    re.compile(r"\bfrom\s+torch\b"),
]
DIRECT_MLX_CALL = re.compile(r"runtime\.(load|unload|apply_loras|remove_loras|generate)\(")


def fail(msg: str) -> None:
    print(f"FAIL: {msg}", file=sys.stderr)
    raise SystemExit(1)


def main() -> None:
    for path in RUNTIME_FILES:
        text = path.read_text()
        rel = path.relative_to(ROOT)
        for pattern in BANNED_PATTERNS:
            match = pattern.search(text)
            if match:
                fail(f"{rel} contains banned legacy runtime dependency: {match.group(0)}")

    daemon = (ROOT / "server" / "model_daemon.py").read_text()
    if "ThreadPoolExecutor(max_workers=1" not in daemon:
        fail("server/model_daemon.py must keep a single MLX worker thread")
    if "_run_on_mlx_thread" not in daemon:
        fail("server/model_daemon.py must route MLX runtime work through _run_on_mlx_thread")
    direct = DIRECT_MLX_CALL.search(daemon)
    if direct:
        fail(f"server/model_daemon.py calls {direct.group(0)} directly instead of the MLX worker")

    print("MLX runtime guardrails passed.")


if __name__ == "__main__":
    main()
