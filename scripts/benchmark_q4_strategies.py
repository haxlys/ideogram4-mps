#!/usr/bin/env python3
"""Run q4 strategy benchmarks through the direct MLX CLI path."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_PYTHON = Path(sys.executable)
PROMPT_FILE = ROOT / "examples" / "caption.json"
OUTPUT_DIR = ROOT / "examples" / "benchmarks" / "q4-strategies"


@dataclass(frozen=True)
class Strategy:
    id: str
    model: str
    width: int
    height: int
    preset: str
    seed: int
    fmt: str = "webp"
    quality: int | None = 90
    cache_limit_gb: float | None = None
    note: str = ""


STRATEGIES: list[Strategy] = [
    Strategy(
        "s01_q8_512_default20_baseline",
        "q8",
        512,
        512,
        "V4_DEFAULT_20",
        20260608,
        note="q8 balanced baseline",
    ),
    Strategy(
        "s02_q4_512_default20_model_swap",
        "q4",
        512,
        512,
        "V4_DEFAULT_20",
        20260608,
        note="same case with q4",
    ),
    Strategy(
        "s03_q4_512_turbo12",
        "q4",
        512,
        512,
        "V4_TURBO_12",
        20260608,
        note="q4 plus turbo preset",
    ),
    Strategy(
        "s04_q4_512_quality48",
        "q4",
        512,
        512,
        "V4_QUALITY_48",
        20260608,
        note="q4 quality preset at small size",
    ),
    Strategy(
        "s05_q4_768_turbo12",
        "q4",
        768,
        768,
        "V4_TURBO_12",
        20260608,
        note="q4 768 turbo compromise",
    ),
    Strategy(
        "s06_q4_768_default20",
        "q4",
        768,
        768,
        "V4_DEFAULT_20",
        20260608,
        note="q4 768 balanced compromise",
    ),
    Strategy(
        "s07_q4_512_default20_cache2g",
        "q4",
        512,
        512,
        "V4_DEFAULT_20",
        20260608,
        cache_limit_gb=2,
        note="q4 with 2GB MLX cache cap",
    ),
    Strategy(
        "s08_q4_512_default20_cache0g",
        "q4",
        512,
        512,
        "V4_DEFAULT_20",
        20260608,
        cache_limit_gb=0,
        note="q4 with MLX cache disabled",
    ),
    Strategy(
        "s09_q4_1024_turbo12",
        "q4",
        1024,
        1024,
        "V4_TURBO_12",
        20260608,
        note="q4 1024 turbo",
    ),
    Strategy(
        "s10_q4_1024_quality48",
        "q4",
        1024,
        1024,
        "V4_QUALITY_48",
        20260608,
        note="q4 1024 quality target",
    ),
]


def env_path(name: str) -> Path | None:
    value = os.environ.get(name, "").strip()
    return Path(value) if value else None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--python", type=Path, default=DEFAULT_PYTHON)
    parser.add_argument(
        "--q4-path",
        type=Path,
        default=env_path("IDEOGRAM4_Q4_MODEL_PATH") or env_path("IDEOGRAM4_MODEL_PATH"),
        help="Local q4 model root containing split_model.json.",
    )
    parser.add_argument(
        "--q8-path",
        type=Path,
        default=env_path("IDEOGRAM4_Q8_MODEL_PATH"),
        help="Local q8 model root containing split_model.json, used for the baseline.",
    )
    parser.add_argument("--out-dir", type=Path, default=OUTPUT_DIR)
    parser.add_argument("--only", nargs="*", default=None, help="Strategy ids to run.")
    parser.add_argument("--keep-images", action="store_true")
    return parser.parse_args()


def model_path(strategy: Strategy, args: argparse.Namespace) -> Path | None:
    return args.q4_path if strategy.model == "q4" else args.q8_path


def validate_inputs(args: argparse.Namespace, strategies: list[Strategy]) -> None:
    if not args.python.is_file():
        raise SystemExit(f"Python not found: {args.python}")
    if not PROMPT_FILE.is_file():
        raise SystemExit(f"Prompt file not found: {PROMPT_FILE}")
    for strategy in strategies:
        path = model_path(strategy, args)
        if path is None:
            env_name = (
                "IDEOGRAM4_Q4_MODEL_PATH"
                if strategy.model == "q4"
                else "IDEOGRAM4_Q8_MODEL_PATH"
            )
            raise SystemExit(f"Set --{strategy.model}-path or {env_name} for {strategy.id}.")
        if not (path / "split_model.json").is_file():
            raise SystemExit(f"Model root must contain split_model.json: {path}")


def run_strategy(strategy: Strategy, args: argparse.Namespace) -> dict[str, Any]:
    out_base = args.out_dir / strategy.id
    out_file = out_base.with_suffix(f".{strategy.fmt}")
    log_file = out_base.with_suffix(".log")
    for path in (out_file, log_file):
        path.unlink(missing_ok=True)

    env = os.environ.copy()
    env["IDEOGRAM4_MODEL_PATH"] = str(model_path(strategy, args))
    if strategy.cache_limit_gb is None:
        env.pop("IDEOGRAM4_MLX_CACHE_LIMIT_GB", None)
    else:
        env["IDEOGRAM4_MLX_CACHE_LIMIT_GB"] = str(strategy.cache_limit_gb)

    cmd = [
        str(args.python),
        str(ROOT / "ideogram4_mlx.py"),
        "--daemon",
        "off",
        "--prompt-file",
        str(PROMPT_FILE),
        "--width",
        str(strategy.width),
        "--height",
        str(strategy.height),
        "--preset",
        strategy.preset,
        "--seed",
        str(strategy.seed),
        "--format",
        strategy.fmt,
        "--out",
        str(out_base),
        "--model-path",
        str(model_path(strategy, args)),
    ]
    if strategy.quality is not None:
        cmd.extend(["--quality", str(strategy.quality)])

    started = time.time()
    proc = subprocess.run(
        cmd,
        cwd=ROOT,
        env=env,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        check=False,
    )
    wall_seconds = time.time() - started

    meta: dict[str, Any] = {}
    if log_file.is_file():
        meta = json.loads(log_file.read_text())

    image_bytes = out_file.stat().st_size if out_file.is_file() else None
    if out_file.is_file() and not args.keep_images:
        out_file.unlink()

    return {
        "strategy": asdict(strategy),
        "ok": proc.returncode == 0,
        "returncode": proc.returncode,
        "wall_seconds": round(wall_seconds, 3),
        "generation_seconds": meta.get("generation_seconds"),
        "steps": meta.get("steps"),
        "quantization_bits": meta.get("quantization_bits"),
        "output_file": str(out_file),
        "image_bytes": image_bytes,
        "log_file": str(log_file) if log_file.is_file() else None,
        "stdout_tail": proc.stdout[-4000:],
    }


def main() -> None:
    args = parse_args()
    strategies = STRATEGIES
    if args.only:
        wanted = set(args.only)
        strategies = [strategy for strategy in strategies if strategy.id in wanted]
        missing = wanted - {strategy.id for strategy in strategies}
        if missing:
            raise SystemExit(f"Unknown strategy id(s): {', '.join(sorted(missing))}")

    validate_inputs(args, strategies)
    args.out_dir.mkdir(parents=True, exist_ok=True)

    summary_path = args.out_dir / "summary.json"
    results: list[dict[str, Any]] = []
    for index, strategy in enumerate(strategies, 1):
        print(f"[{index}/{len(strategies)}] {strategy.id}: {strategy.note}", flush=True)
        result = run_strategy(strategy, args)
        results.append(result)
        summary_path.write_text(json.dumps(results, ensure_ascii=False, indent=2))
        status = "ok" if result["ok"] else "failed"
        print(
            f"  {status}: generation={result['generation_seconds']}s "
            f"wall={result['wall_seconds']}s q={result['quantization_bits']}",
            flush=True,
        )
        if not result["ok"]:
            print(result["stdout_tail"], file=sys.stderr)
            raise SystemExit(result["returncode"])

    print(f"Wrote {summary_path}")


if __name__ == "__main__":
    main()
