from __future__ import annotations

import base64
import json
import math
import requests

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
    MAGIC_PROMPT_MANAGED_LLAMA,
    MAGIC_PROMPT_LOCAL_LLAMA_CTX,
)


def aspect_ratio_from_size(width: int, height: int) -> str:
    divisor = math.gcd(width, height) or 1
    return f"{width // divisor}:{height // divisor}"


def _load_sections(_filename: str) -> dict[str, str]:
    return {
        "system": LOCAL_SYSTEM_PROMPT,
        "user": "TARGET IMAGE ASPECT RATIO: {{aspect_ratio}} (width:height).\n\n{{original_prompt}}",
    }


def _caption_verifier():
    from mflux.models.ideogram4.model.ideogram4_text_encoder.caption import Ideogram4CaptionVerifier

    return Ideogram4CaptionVerifier()


def verify_caption(caption: dict) -> list[str]:
    try:
        return _caption_verifier().verify(caption)
    except Exception:
        return []


def reorder_caption_keys(caption: dict) -> dict:
    verifier = _caption_verifier()

    def ordered(value: dict, order) -> dict:
        known = [key for key in order if key in value]
        extra = [key for key in value if key not in order]
        return {key: value[key] for key in (*known, *extra)}

    if not isinstance(caption, dict):
        return caption

    sd = caption.get("style_description")
    if isinstance(sd, dict):
        try:
            caption["style_description"] = ordered(sd, verifier._style_description_key_order(sd))
        except Exception:
            pass

    cd = caption.get("compositional_deconstruction")
    if isinstance(cd, dict):
        cd = ordered(cd, verifier.compositional_deconstruction_key_order)
        elements = cd.get("elements")
        if isinstance(elements, list):
            next_elements = []
            for element in elements:
                if isinstance(element, dict):
                    try:
                        element = ordered(element, verifier._element_key_order(element))
                    except Exception:
                        pass
                next_elements.append(element)
            cd["elements"] = next_elements
        caption["compositional_deconstruction"] = cd

    return caption


def strip_aspect_ratio_and_bboxes(caption: str, *, strip_bboxes: bool = True) -> str:
    data = json.loads(caption)
    data.pop("aspect_ratio", None)
    if strip_bboxes:
        elements = data.get("compositional_deconstruction", {}).get("elements", [])
        if isinstance(elements, list):
            for element in elements:
                if isinstance(element, dict):
                    element.pop("bbox", None)
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"))


def _magic_provider() -> str:
    if MAGIC_PROMPT_PROVIDER:
        return MAGIC_PROMPT_PROVIDER
    if MAGIC_PROMPT_LOCAL_LLAMA or MAGIC_PROMPT_MANAGED_LLAMA:
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


def _effective_max_tokens() -> int:
    limit = MAGIC_PROMPT_MAX_TOKENS
    if _is_llama_cpp_provider() and MAGIC_PROMPT_LOCAL_LLAMA_CTX > 0:
        cap = max(512, int(MAGIC_PROMPT_LOCAL_LLAMA_CTX * 0.55))
        limit = min(limit, cap)
    return limit


def _guess_image_mime(data: bytes) -> str:
    if len(data) >= 3 and data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if len(data) >= 8 and data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if len(data) >= 12 and data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if len(data) >= 6 and data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    return "image/jpeg"


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
    payload[token_param] = _effective_max_tokens()

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
    warnings = verify_caption(caption)
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

GEMMA4_SYSTEM_PROMPT = LOCAL_SYSTEM_PROMPT + """
Additional rules for Gemma multimodal input:
- When reference images are attached, treat them as primary visual guidance.
- Mirror subject, palette, and composition cues from attached images unless user text overrides them.
- Keep JSON compact; prefer shorter string values over verbose prose.
- Never emit markdown, XML-style tags, or channel tokens in the response.
"""


def _build_messages(prompt: str, aspect_ratio: str, *, has_images: bool = False) -> list[dict]:
    profile = _prompt_profile()
    if profile == "gemma4":
        if has_images:
            return _build_gemma4_messages(prompt, aspect_ratio)
        return _build_local_messages(prompt, aspect_ratio)
    if profile == "compact_json":
        return _build_local_messages(prompt, aspect_ratio)
    return _build_augmented_messages(prompt, aspect_ratio)


def _build_augmented_messages(prompt: str, aspect_ratio: str) -> list[dict]:
    sections = _load_sections("v1.txt")
    system = sections["system"]

    old_contract = "## OUTPUT CONTRACT — exactly three top-level keys, in this order:"
    if old_contract in system:
        system = system.replace(old_contract, OUTPUT_CONTRACT_OVERRIDE.strip())
    elif OUTPUT_CONTRACT_OVERRIDE.strip() not in system:
        system += "\n\n" + OUTPUT_CONTRACT_OVERRIDE

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


def _build_gemma4_messages(prompt: str, aspect_ratio: str) -> list[dict]:
    user = (
        f"TARGET IMAGE ASPECT RATIO: {aspect_ratio} (width:height).\n\n"
        f"USER IDEA:\n{prompt}"
    )
    return [
        {"role": "system", "content": GEMMA4_SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ]


def expand_prompt(prompt: str, width: int, height: int, images_b64: list[str] | None = None) -> dict:
    api_key = MAGIC_PROMPT_API_KEY
    model = MAGIC_PROMPT_MODEL
    if not api_key and _magic_provider() not in {"llama_cpp", "llama-cpp", "llamacpp", "openai_compatible"}:
        raise RuntimeError("IDEOGRAM4_MAGIC_PROMPT_API_KEY is not set")

    aspect_ratio = aspect_ratio_from_size(width, height)
    messages = _build_messages(prompt, aspect_ratio, has_images=bool(images_b64))

    if images_b64:
        content: list[dict] = [{"type": "text", "text": messages[-1]["content"]}]
        for b64 in images_b64:
            mime = _guess_image_mime(base64.b64decode(b64))
            content.append({"type": "image_url", "image_url": {"url": f"data:{mime};base64,{b64}"}})
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
