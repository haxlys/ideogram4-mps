from __future__ import annotations

import gc
import json
import time
from pathlib import Path
from typing import Any, Callable

try:
    from .config import (
        DEFAULT_LORA_STRENGTH,
        DEFAULT_PRESET,
        LORA_DIR,
        MLX_CACHE_LIMIT_GB,
        MODEL_PATH,
        MODEL_REPO,
        MODEL_REVISION,
    )
except ImportError:  # pragma: no cover - used when server scripts run directly.
    from config import (  # type: ignore
        DEFAULT_LORA_STRENGTH,
        DEFAULT_PRESET,
        LORA_DIR,
        MLX_CACHE_LIMIT_GB,
        MODEL_PATH,
        MODEL_REPO,
        MODEL_REVISION,
    )


ProgressCallback = Callable[[int, str, str], None]
CancelCallback = Callable[[], bool]


class GenerationCancelled(Exception):
    pass


class MlxRuntime:
    def __init__(self, logger):
        self.logger = logger
        self._model = None
        self._model_root: Path | None = None
        self._state = "idle"
        self._state_msg = ""
        self._quantization_bits: int | None = None
        self._split_metadata: dict[str, Any] = {}
        self._lora_stack: list[dict[str, Any]] = []

    def is_available(self) -> tuple[bool, str | None]:
        try:
            import mlx.core  # noqa: F401
            from mflux.models.ideogram4.model.ideogram4_text_encoder.caption import (  # noqa: F401
                Ideogram4CaptionVerifier,
            )
            from mflux.models.ideogram4.variants.txt2img.ideogram4 import Ideogram4  # noqa: F401
        except Exception as exc:
            return False, str(exc)
        return True, None

    def status(self) -> dict[str, Any]:
        return {
            "state": self._state,
            "msg": self._state_msg,
            "backend": "mlx",
            "model_repo": MODEL_REPO,
            "model_path": str(self._model_root or MODEL_PATH or ""),
            "model_revision": MODEL_REVISION,
            "quantization_bits": self._quantization_bits,
            "mlx_memory": self.memory_status(),
            "applied_loras": self._public_lora_stack(),
        }

    def memory_status(self) -> dict[str, float | int | None]:
        try:
            import mlx.core as mx
        except Exception:
            return {}

        def _call(name: str) -> int | None:
            fn = getattr(mx, name, None)
            if fn is None:
                return None
            try:
                return int(fn())
            except Exception:
                return None

        active = _call("get_active_memory")
        peak = _call("get_peak_memory")
        cache = _call("get_cache_memory")
        return {
            "active_gb": round(active / 1_000_000_000, 3) if active is not None else None,
            "peak_gb": round(peak / 1_000_000_000, 3) if peak is not None else None,
            "cache_gb": round(cache / 1_000_000_000, 3) if cache is not None else None,
            "cache_limit_gb": MLX_CACHE_LIMIT_GB,
        }

    def load(self, progress_cb: ProgressCallback | None = None) -> dict[str, Any]:
        if self._model is not None and self._state == "loaded":
            return {"ok": True, "msg": "MLX model already loaded."}

        self._state = "loading"
        self._state_msg = "Resolving MLX model..."
        self._emit(progress_cb, 1, self._state_msg, "resolve")

        try:
            self._configure_mlx_cache()
            root = self._resolve_model_root(progress_cb)
            self._model_root = root
            self._split_metadata = self._read_split_metadata(root)
            self._quantization_bits = self._split_metadata.get("quantization_bits")

            lora_paths = [item["path"] for item in self._lora_stack]
            lora_scales = [float(item["strength"]) for item in self._lora_stack]

            self._state_msg = "Loading MLX model..."
            self._emit(progress_cb, 20, self._state_msg, "load")
            self.logger.info(
                "Loading MLX Ideogram 4 model from %s (loras=%s)",
                root,
                [Path(path).name for path in lora_paths],
            )
            t0 = time.time()

            from mflux.models.common.config import ModelConfig
            from mflux.models.ideogram4.variants.txt2img.ideogram4 import Ideogram4

            self._model = Ideogram4(
                model_config=ModelConfig.ideogram4_fp8(),
                quantize=None,
                model_path=str(root),
                lora_paths=lora_paths or None,
                lora_scales=lora_scales or None,
            )
            self._state = "loaded"
            self._state_msg = f"MLX model loaded in {time.time() - t0:.1f}s."
            self._emit(progress_cb, 100, self._state_msg, "done")
            return {"ok": True, "msg": self._state_msg}
        except Exception as exc:
            self.logger.exception("MLX model load failed")
            self._model = None
            self._state = "idle"
            self._state_msg = str(exc)
            self._clear_mlx_cache()
            return {"ok": False, "msg": str(exc)}

    def unload(self) -> dict[str, Any]:
        self.logger.info("Unloading MLX model")
        self._model = None
        self._state = "idle"
        self._state_msg = ""
        gc.collect()
        self._clear_mlx_cache()
        return {"ok": True, "msg": "MLX model unloaded."}

    def generate(
        self,
        *,
        caption: dict | str,
        width: int,
        height: int,
        preset: str,
        seed: int,
        progress_cb: ProgressCallback | None = None,
        cancel_cb: CancelCallback | None = None,
    ):
        if self._model is None:
            raise RuntimeError("MLX model not loaded.")
        if cancel_cb and cancel_cb():
            raise GenerationCancelled()

        prompt = self._caption_to_prompt(caption)
        self._reset_callbacks(progress_cb, cancel_cb)
        self._emit(progress_cb, 1, f"Preparing MLX generation ({width}x{height})...", "prepare")

        t0 = time.time()
        image = self._model.generate_image(
            seed=seed,
            prompt=prompt,
            width=width,
            height=height,
            preset=preset,
            warn_on_caption_issues=False,
        )
        if cancel_cb and cancel_cb():
            raise GenerationCancelled()

        generation_seconds = time.time() - t0
        pil_image = getattr(image, "image", image)
        self._emit(progress_cb, 100, f"Done in {generation_seconds:.1f}s", "done")
        return pil_image, {
            "generation_seconds": round(generation_seconds, 1),
            "steps": self.preset_step_count(preset),
            "quantization_bits": self._quantization_bits,
        }

    def preset_step_count(self, preset: str) -> int:
        try:
            from mflux.models.ideogram4.model.ideogram4_scheduler import Ideogram4Scheduler

            return int(Ideogram4Scheduler.get_preset(preset).num_steps)
        except Exception:
            return {"V4_TURBO_12": 12, "V4_DEFAULT_20": 20, "V4_QUALITY_48": 48}.get(
                preset or DEFAULT_PRESET,
                0,
            )

    def list_loras(self) -> list[dict[str, Any]]:
        if not LORA_DIR.is_dir():
            return []
        result = []
        for path in sorted(LORA_DIR.iterdir()):
            if path.suffix != ".safetensors" or not path.is_file():
                continue
            result.append(
                {
                    "name": path.name,
                    "path": str(path),
                    "format": "mflux-native",
                    "size_mb": round(path.stat().st_size / (1024 * 1024), 1),
                }
            )
        return result

    def get_lora_presets(self) -> list[dict[str, Any]]:
        presets = []
        for lora in self.list_loras():
            strength = DEFAULT_LORA_STRENGTH
            presets.append(
                {
                    "id": lora["name"],
                    "label": self._friendly_lora_name(lora["name"]),
                    "installed": True,
                    "loras": [
                        {
                            "name": lora["name"],
                            "strength": strength,
                            "installed": True,
                            "format": lora["format"],
                            "size_mb": lora["size_mb"],
                        }
                    ],
                }
            )
        return presets

    def get_lora_status(self) -> dict[str, Any]:
        applied = " + ".join(item["name"] for item in self._lora_stack) or None
        return {
            "applied": applied,
            "strength": self._lora_stack[0]["strength"] if len(self._lora_stack) == 1 else 0.0,
            "applied_loras": self._public_lora_stack(),
            "available": self.list_loras(),
        }

    def apply_loras(
        self,
        loras: list[dict[str, Any]],
        progress_cb: ProgressCallback | None = None,
    ) -> dict[str, Any]:
        requested = self._resolve_lora_stack(loras)
        was_loaded = self._model is not None
        self._lora_stack = requested
        if was_loaded:
            self.unload()
            result = self.load(progress_cb=progress_cb)
            if not result.get("ok"):
                return result
        return {
            "ok": True,
            "msg": f"LoRA stack active: {' + '.join(item['name'] for item in requested)}",
            "applied_loras": self._public_lora_stack(),
        }

    def remove_loras(self, progress_cb: ProgressCallback | None = None) -> dict[str, Any]:
        if not self._lora_stack:
            return {"ok": False, "msg": "No LoRA applied."}
        was_loaded = self._model is not None
        self._lora_stack = []
        if was_loaded:
            self.unload()
            result = self.load(progress_cb=progress_cb)
            if not result.get("ok"):
                return result
        return {"ok": True, "msg": "LoRA removed.", "applied_loras": []}

    def download_lora_preset(self, _preset_id: str) -> list[dict[str, Any]]:
        raise ValueError("MLX runtime supports local mflux-compatible .safetensors LoRA files only.")

    def _resolve_model_root(self, progress_cb: ProgressCallback | None) -> Path:
        if MODEL_PATH is not None:
            root = Path(MODEL_PATH).expanduser()
            self._validate_mlx_model_root(root)
            return root

        self._emit(progress_cb, 5, f"Downloading/verifying {MODEL_REPO}...", "download")
        from huggingface_hub import snapshot_download

        root = Path(snapshot_download(repo_id=MODEL_REPO, revision=MODEL_REVISION))
        self._validate_mlx_model_root(root)
        return root

    @staticmethod
    def _validate_mlx_model_root(root: Path) -> None:
        if not root.exists():
            raise FileNotFoundError(f"Model path does not exist: {root}")
        if not (root / "split_model.json").is_file():
            raise ValueError(f"Expected MLX split_model.json in model root: {root}")

    @staticmethod
    def _read_split_metadata(root: Path) -> dict[str, Any]:
        try:
            value = json.loads((root / "split_model.json").read_text())
        except Exception as exc:
            raise ValueError(f"Invalid split_model.json in {root}") from exc
        if not isinstance(value, dict):
            raise ValueError(f"split_model.json must be an object: {root}")
        return value

    @staticmethod
    def _caption_to_prompt(caption: dict | str) -> dict | str:
        if isinstance(caption, dict):
            return caption
        try:
            parsed = json.loads(caption)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            pass
        return str(caption)

    def _reset_callbacks(
        self,
        progress_cb: ProgressCallback | None,
        cancel_cb: CancelCallback | None,
    ) -> None:
        from mflux.callbacks.callback_registry import CallbackRegistry

        self._model.callbacks = CallbackRegistry()
        self._model.callbacks.register(_GenerationProgressCallback(progress_cb, cancel_cb))

    def _resolve_lora_stack(self, loras: list[dict[str, Any]]) -> list[dict[str, Any]]:
        requested = []
        for item in loras:
            name = str(item.get("name", "")).strip()
            strength = float(item.get("strength", DEFAULT_LORA_STRENGTH))
            if not name:
                raise ValueError("Missing LoRA name.")
            path = (LORA_DIR / name).resolve()
            lora_root = LORA_DIR.resolve()
            if lora_root not in path.parents or not path.is_file() or path.suffix != ".safetensors":
                raise ValueError(f"LoRA not found: {name}")
            requested.append(
                {
                    "name": name,
                    "path": str(path),
                    "strength": strength,
                    "format": "mflux-native",
                }
            )
        if not requested:
            raise ValueError("No LoRAs requested.")
        return requested

    def _public_lora_stack(self) -> list[dict[str, Any]]:
        return [
            {"name": item["name"], "strength": item["strength"], "format": item.get("format", "mflux-native")}
            for item in self._lora_stack
        ]

    @staticmethod
    def _friendly_lora_name(name: str) -> str:
        return name.removesuffix(".safetensors").replace("_", " ")

    def _configure_mlx_cache(self) -> None:
        if MLX_CACHE_LIMIT_GB is None:
            return
        import mlx.core as mx

        mx.set_cache_limit(int(MLX_CACHE_LIMIT_GB * 1_000_000_000))
        mx.clear_cache()
        reset = getattr(mx, "reset_peak_memory", None)
        if reset is not None:
            reset()

    @staticmethod
    def _clear_mlx_cache() -> None:
        try:
            import mlx.core as mx

            mx.clear_cache()
        except Exception:
            pass

    @staticmethod
    def _emit(progress_cb: ProgressCallback | None, progress: int, msg: str, phase: str) -> None:
        if progress_cb:
            progress_cb(max(0, min(int(progress), 100)), msg, phase)


class _GenerationProgressCallback:
    def __init__(self, progress_cb: ProgressCallback | None, cancel_cb: CancelCallback | None):
        self.progress_cb = progress_cb
        self.cancel_cb = cancel_cb

    def call_before_loop(self, seed, prompt, latents, config, **_kwargs) -> None:
        self._check_cancelled()
        MlxRuntime._emit(self.progress_cb, 2, "Starting MLX denoising...", "generate")

    def call_in_loop(self, t, seed, prompt, latents, config, time_steps) -> None:
        self._check_cancelled()
        total = max(1, int(getattr(config, "num_inference_steps", 1)))
        progress = min(99, int((int(t) + 1) / total * 100))
        MlxRuntime._emit(
            self.progress_cb,
            progress,
            f"Generating ({int(t) + 1}/{total} steps)...",
            "generate",
        )

    def call_after_loop(self, seed, prompt, latents, config) -> None:
        self._check_cancelled()
        MlxRuntime._emit(self.progress_cb, 99, "Decoding image...", "decode")

    def _check_cancelled(self) -> None:
        if self.cancel_cb and self.cancel_cb():
            raise GenerationCancelled()
