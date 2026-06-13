from __future__ import annotations

import json
import requests

from ideogram4.magic_prompt import (
    _load_sections,
    build_messages,
    strip_aspect_ratio_and_bboxes,
    reorder_caption_keys,
    aspect_ratio_from_size,
)

from config import (
    MAGIC_PROMPT_API_KEY,
    MAGIC_PROMPT_MODEL,
    MAGIC_PROMPT_BASE_URL,
    MAGIC_PROMPT_TIMEOUT,
    MAGIC_PROMPT_MAX_TOKENS,
    MAGIC_PROMPT_TEMPERATURE,
)


def _chat_completion(messages: list[dict], model: str, api_key: str) -> str:
    resp = requests.post(
        f"{MAGIC_PROMPT_BASE_URL}/chat/completions",
        headers={
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json",
        },
        json={
            "model": model,
            "messages": messages,
            "max_tokens": MAGIC_PROMPT_MAX_TOKENS,
            "temperature": MAGIC_PROMPT_TEMPERATURE,
        },
        timeout=MAGIC_PROMPT_TIMEOUT,
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


STYLE_INSTRUCTION = """
## STYLE_DESCRIPTION — structured style field (required, after HLD)

Emit a `style_description` object as the second top-level key, right after `high_level_description`. This replaces the inline style prose in HLD — keep HLD focused on subject/composition, move all style detail here:

```json
{"medium":"...","aesthetics":"...","lighting":"...","photo":"..."|"art_style":"...","color_palette":["#RRGGBB",...]}
```

- `medium`: exactly one of photograph / illustration / 3d_render / painting / graphic_design.
- `aesthetics`: short phrase (e.g. "cinematic, ultra realistic, 4k", "flat vector, bold colors").
- `lighting`: short phrase (e.g. "soft diffused daylight", "dramatic rim lighting from left").
- `photo` OR `art_style`: exactly one, depending on medium. photo media get `photo` (camera/lens spec), others get `art_style` (e.g. "watercolor", "Studio Ghibli").
- `color_palette`: array of 3–8 hex colors (#RRGGBB) that dominate the scene.
- All non-array string values are one short phrase each. No long paragraphs.
- UNKNOWN KEY BAN: never add keys not listed above (no `image_style`, `camera`, `render_type`, etc).

## TRANSPARENT BACKGROUND — only when explicitly requested

NEVER emit a transparent background UNLESS the user's idea explicitly asks for it using phrases like "transparent", "transparent background", "cutout", "isolated", "alpha channel", "no background", "PNG with transparency", "sticker style". In all other cases the background MUST describe a real scene, surface, wall, sky, or environment. Default: always a CONCRETE background description. The string `"transparent background"` is restricted to explicit requests only.
"""

OUTPUT_CONTRACT_OVERRIDE = """## OUTPUT CONTRACT — exactly four top-level keys, in this order:
{"aspect_ratio":"W:H","high_level_description":"...","style_description":{...},"compositional_deconstruction":{"background":"...","elements":[...]}}
"""


def _build_augmented_messages(prompt: str, aspect_ratio: str) -> list[dict]:
    sections = _load_sections("v1.txt")
    system = sections["system"]

    old_contract = "## OUTPUT CONTRACT — exactly three top-level keys, in this order:"
    new_contract = "## OUTPUT CONTRACT — exactly four top-level keys, in this order:"
    system = system.replace(old_contract, new_contract)

    old_example = '{"aspect_ratio":"W:H","high_level_description":"...","compositional_deconstruction":{"background":"...","elements":[ ... ]}}'
    new_example = '{"aspect_ratio":"W:H","high_level_description":"...","style_description":{...},"compositional_deconstruction":{"background":"...","elements":[...]}}'
    system = system.replace(old_example, new_example)

    system += STYLE_INSTRUCTION

    template = sections.get("user")
    if template is None:
        template = "TARGET IMAGE ASPECT RATIO: {{aspect_ratio}} (width:height)."
    user = template.replace("{{aspect_ratio}}", aspect_ratio)
    if "{{original_prompt}}" in user:
        user = user.replace("{{original_prompt}}", prompt)
    else:
        user = f"{user}\n\n{prompt}"
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": user},
    ]


def expand_prompt(prompt: str, width: int, height: int, images_b64: list[str] | None = None) -> dict:
    api_key = MAGIC_PROMPT_API_KEY
    model = MAGIC_PROMPT_MODEL
    if not api_key:
        raise RuntimeError("IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set")

    aspect_ratio = aspect_ratio_from_size(width, height)
    messages = _build_augmented_messages(prompt, aspect_ratio)

    if images_b64:
        content: list[dict] = [{"type": "text", "text": messages[-1]["content"]}]
        for b64 in images_b64:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        messages[-1]["content"] = content

    raw = _chat_completion(messages, model, api_key)
    raw = _strip_code_fences(raw)

    caption_str = strip_aspect_ratio_and_bboxes(raw, strip_bboxes=True)
    caption = json.loads(caption_str)
    caption = reorder_caption_keys(caption)
    return caption
