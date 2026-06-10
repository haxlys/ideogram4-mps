from __future__ import annotations

import json
import os
import requests

from ideogram4.magic_prompt import (
    _load_sections,
    build_messages,
    strip_aspect_ratio_and_bboxes,
    reorder_caption_keys,
    aspect_ratio_from_size,
)


BASE_URL = "https://api.commandcode.ai/provider/v1"
DEFAULT_MODEL = "deepseek/deepseek-v4-flash"


def _get_config():
    api_key = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_API_KEY", "")
    model = os.environ.get("IDEOGRAM4_MAGIC_PROMPT_MODEL", DEFAULT_MODEL)
    return api_key, model


def _chat_completion(messages: list[dict], model: str, api_key: str, timeout: float = 120.0) -> str:
    resp = requests.post(
        f"{BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "max_tokens": 16384,
            "temperature": 1.0,
        },
        timeout=timeout,
    )
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices")
    if not choices:
        raise RuntimeError(f"No choices in response: {data}")
    content = choices[0].get("message", {}).get("content")
    if not content:
        raise RuntimeError(f"Empty message in response: {choices[0]}")
    return content


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if not text.startswith("```"):
        return text
    lines = text.splitlines()
    if lines and lines[0].startswith("```"):
        lines = lines[1:]
    if lines and lines[-1].strip() == "```":
        lines = lines[:-1]
    return "\n".join(lines).strip()


def expand_prompt(prompt: str, width: int, height: int) -> dict:
    api_key, model = _get_config()
    if not api_key:
        raise RuntimeError("IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set")

    aspect_ratio = aspect_ratio_from_size(width, height)
    messages = build_messages("v1.txt", prompt, aspect_ratio)

    raw = _chat_completion(messages, model, api_key)
    raw = _strip_code_fences(raw)

    caption_str = strip_aspect_ratio_and_bboxes(raw, strip_bboxes=True)
    caption = json.loads(caption_str)
    caption = reorder_caption_keys(caption)
    return caption
