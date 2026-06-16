from __future__ import annotations

import json
import requests

from ideogram4.magic_prompt import (
    _load_sections,
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
    MAGIC_PROMPT_PROVIDER,
    MAGIC_PROMPT_PROMPT_PROFILE,
    MAGIC_PROMPT_RESPONSE_FORMAT,
    MAGIC_PROMPT_TOKEN_PARAM,
    MAGIC_PROMPT_LOCAL_LLAMA,
)


def _magic_provider() -> str:
    if MAGIC_PROMPT_PROVIDER:
        return MAGIC_PROMPT_PROVIDER
    if MAGIC_PROMPT_LOCAL_LLAMA:
        return "llama_cpp"
    return "openai_compatible"


def _is_llama_cpp_provider() -> bool:
    return _magic_provider() in {"llama_cpp", "llama-cpp", "llamacpp"}


def _prompt_profile() -> str:
    if MAGIC_PROMPT_PROMPT_PROFILE:
        return MAGIC_PROMPT_PROMPT_PROFILE
    if _is_llama_cpp_provider():
        return "compact_json"
    return "ideogram_official"


def _chat_completion(messages: list[dict], model: str, api_key: str) -> str:
    headers = {"Content-Type": "application/json"}
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"

    payload = {
        "model": model,
        "messages": messages,
        "temperature": MAGIC_PROMPT_TEMPERATURE,
    }
    token_param = MAGIC_PROMPT_TOKEN_PARAM or "max_tokens"
    if token_param not in {"max_tokens", "max_completion_tokens"}:
        raise RuntimeError(f"Unsupported IDEOGRAM4_MAGIC_PROMPT_TOKEN_PARAM: {token_param}")
    payload[token_param] = MAGIC_PROMPT_MAX_TOKENS

    if MAGIC_PROMPT_RESPONSE_FORMAT == "json_object":
        payload["response_format"] = {"type": "json_object"}
    elif MAGIC_PROMPT_RESPONSE_FORMAT and MAGIC_PROMPT_RESPONSE_FORMAT != "off":
        raise RuntimeError(f"Unsupported IDEOGRAM4_MAGIC_PROMPT_RESPONSE_FORMAT: {MAGIC_PROMPT_RESPONSE_FORMAT}")

    if _is_llama_cpp_provider():
        payload.update({
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_format": "none",
        })

    resp = requests.post(
        f"{MAGIC_PROMPT_BASE_URL}/chat/completions",
        headers=headers,
        json=payload,
        timeout=MAGIC_PROMPT_TIMEOUT,
    )
    resp.raise_for_status()
    data = resp.json()
    choices = data.get("choices")
    if not choices:
        raise RuntimeError(f"No choices in response: {data}")
    message = choices[0].get("message", {})
    content = message.get("content") or message.get("reasoning_content")
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


def _extract_json_object(text: str) -> str:
    start = text.find("{")
    if start < 0:
        raise RuntimeError(f"No JSON object found in response: {text[:300]}")

    depth = 0
    in_string = False
    escaped = False
    for i, ch in enumerate(text[start:], start=start):
        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == '"':
                in_string = False
            continue

        if ch == '"':
            in_string = True
        elif ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                return text[start:i + 1]

    raise RuntimeError(f"Unclosed JSON object in response: {text[:300]}")


def _normalise_caption(caption: dict) -> dict:
    sd = caption.get("style_description")
    if isinstance(sd, dict):
        for src, dst in (
            ("Photo", "photo"),
            ("camera", "photo"),
            ("Camera", "photo"),
            ("camera_lens", "photo"),
            ("lens", "photo"),
            ("Art Style", "art_style"),
            ("art style", "art_style"),
            ("artStyle", "art_style"),
            ("style", "art_style"),
            ("Color Palette", "color_palette"),
            ("color palette", "color_palette"),
            ("palette", "color_palette"),
        ):
            if src in sd and dst not in sd:
                sd[dst] = sd.pop(src)
        medium = sd.get("medium")
        if isinstance(medium, str):
            sd["medium"] = medium.strip().lower().replace(" ", "_")
        palette = sd.get("color_palette")
        if isinstance(palette, str):
            palette = [part.strip() for part in palette.split(",") if part.strip()]
            sd["color_palette"] = palette
        if isinstance(palette, list):
            sd["color_palette"] = [c.upper() if isinstance(c, str) else c for c in palette]
    return caption


def _verify_caption(caption: dict) -> None:
    try:
        from ideogram4.caption_verifier import CaptionVerifier
        warnings = CaptionVerifier().verify(caption)
    except Exception:
        return
    if warnings:
        raise RuntimeError("Magic prompt produced an invalid caption: " + "; ".join(warnings))


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


LOCAL_SYSTEM_PROMPT = """You convert a user's image idea into a valid Ideogram 4 structured caption.

Return only one valid JSON object. Do not use markdown, code fences, comments, prose, or special channel tokens.

Required JSON shape:
{
  "aspect_ratio": "W:H",
  "high_level_description": "One concise paragraph describing subject, scene, camera framing, and composition.",
  "style_description": {
    "medium": "photograph",
    "aesthetics": "short style phrase",
    "lighting": "short lighting phrase",
    "photo": "short camera or lens phrase",
    "color_palette": ["#RRGGBB", "#RRGGBB", "#RRGGBB"]
  },
  "compositional_deconstruction": {
    "background": "Concrete environment or surface description.",
    "elements": [
      {"type": "obj", "desc": "Main subject or prop description."}
    ]
  }
}

Rules:
- Top-level keys must be exactly: aspect_ratio, high_level_description, style_description, compositional_deconstruction.
- Use exactly one of photo or art_style in style_description. Use photo only when medium is photograph.
- medium must be one of: photograph, illustration, 3d_render, painting, graphic_design.
- color_palette must contain 3 to 8 uppercase hex colors.
- Element type must be obj or text. Text elements may include a text key.
- Do not include bbox unless the user explicitly asks for exact layout placement.
- Use a concrete background unless the user explicitly asks for transparent, alpha, cutout, sticker, no background, or isolated.
- If a human subject is present and age is ambiguous, say adult.
- JSON must parse with json.loads. Quote every key exactly once. No trailing commas.
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


def _build_local_messages(prompt: str, aspect_ratio: str) -> list[dict]:
    user = (
        f"TARGET IMAGE ASPECT RATIO: {aspect_ratio} (width:height).\n\n"
        f"USER IDEA:\n{prompt}"
    )
    return [
        {"role": "system", "content": LOCAL_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def expand_prompt(prompt: str, width: int, height: int, images_b64: list[str] | None = None) -> dict:
    api_key = MAGIC_PROMPT_API_KEY
    model = MAGIC_PROMPT_MODEL
    if not api_key and _magic_provider() not in {"llama_cpp", "llama-cpp", "llamacpp", "openai_compatible"}:
        raise RuntimeError("IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set")

    aspect_ratio = aspect_ratio_from_size(width, height)
    messages = _build_local_messages(prompt, aspect_ratio) if _prompt_profile() in {"compact_json", "gemma4"} else _build_augmented_messages(prompt, aspect_ratio)

    if images_b64:
        content: list[dict] = [{"type": "text", "text": messages[-1]["content"]}]
        for b64 in images_b64:
            content.append({"type": "image_url", "image_url": {"url": f"data:image/png;base64,{b64}"}})
        messages[-1]["content"] = content

    raw = _chat_completion(messages, model, api_key)
    raw = _strip_code_fences(raw)
    raw = _extract_json_object(raw)

    caption_str = strip_aspect_ratio_and_bboxes(raw, strip_bboxes=True)
    caption = json.loads(caption_str)
    caption = _normalise_caption(caption)
    caption = reorder_caption_keys(caption)
    _verify_caption(caption)
    return caption
