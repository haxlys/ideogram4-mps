#!/usr/bin/env python3
"""Generate a 50-image prompt-rule lab against the local Ideogram 4 daemon."""

from __future__ import annotations

import argparse
import json
import statistics
import sys
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, cast
from urllib.error import HTTPError
from urllib.request import Request, urlopen

from PIL import Image, ImageChops, ImageDraw


@dataclass(frozen=True)
class Scenario:
    sid: str
    slug: str
    title: str
    medium: str
    hld: str
    aesthetics: str
    lighting: str
    photo_or_art: str
    palette: list[str]
    background: str
    subject: str
    bbox: list[int]
    width: int
    height: int
    plain: str
    anti: str


SCENARIOS: list[Scenario] = [
    Scenario(
        "S01",
        "chef_portrait",
        "Editorial chef portrait",
        "photograph",
        "A professional editorial portrait photograph of an adult chef in a working restaurant kitchen, composed and natural.",
        "photorealistic editorial portrait, restrained color, believable skin texture",
        "large diffused window light, soft contrast, neutral white balance",
        "eye-level portrait, natural perspective, moderate background separation",
        ["#F2E6D0", "#2F2A24", "#B85C38", "#D9C7A3", "#FFFFFF"],
        "A warm restaurant kitchen with stainless counters, tiled wall, soft steam, and prep bowls receding into the background.",
        "An adult chef wearing a clean white jacket and dark apron, calm expression, hands lightly resting near a wooden prep counter.",
        [80, 210, 965, 790],
        384,
        512,
        "A professional editorial portrait of an adult chef in a warm restaurant kitchen, natural daylight, calm expression.",
        "A movie still frame of an adult chef, full-bleed no border no letterbox no checkerboard, cinematic frame.",
    ),
    Scenario(
        "S02",
        "field_watch",
        "Product watch photograph",
        "photograph",
        "A refined product photograph of a rugged field watch on a slate table beside a folded canvas strap.",
        "premium product photography, tactile materials, crisp detail",
        "softbox from upper left, controlled shadows, subtle rim highlights",
        "macro product photograph, 70mm lens, shallow depth of field",
        ["#0F1115", "#4E5A4A", "#C8A45D", "#D7D2C4", "#2A2F35"],
        "A dark slate tabletop with fine texture, a folded olive canvas strap, and a soft shadow gradient reaching the image edges.",
        "A rugged field watch with brushed steel case, black dial, luminous markers, and tan stitching on the strap.",
        [210, 160, 800, 850],
        512,
        384,
        "A premium product photo of a rugged field watch on dark slate with a folded canvas strap, soft studio light.",
        "A product ad frame with no border, no matte, no checkerboard, full-bleed watch image centered on a square canvas.",
    ),
    Scenario(
        "S03",
        "sailboat_sunset",
        "Sailboat landscape",
        "photograph",
        "A wide landscape photograph of a lone sailboat crossing calm water at sunset.",
        "serene, cinematic, natural color, quiet atmosphere",
        "golden hour backlight, warm haze, soft reflections",
        "wide angle landscape photograph, f/8, natural horizon",
        ["#FFB35C", "#F7D7A1", "#294B6A", "#102033", "#E9EEF2"],
        "A calm bay stretching to a low horizon, warm sunset sky, thin clouds, and rippled water continuing beyond every edge.",
        "A small white sailboat with one triangular sail, placed off center on the water, leaving a faint wake.",
        [410, 420, 660, 610],
        512,
        320,
        "A lone white sailboat on calm water at sunset, wide landscape, warm reflections.",
        "A cinematic movie still frame of a sailboat, no border no letterbox no black bars, full-bleed frame.",
    ),
    Scenario(
        "S04",
        "business_card",
        "Business card layout",
        "graphic_design",
        "A clean modern business card layout for a small robotics studio named ORBITAL WORKS.",
        "minimal, professional, geometric, high legibility",
        "even diffuse studio lighting, flat lay clarity",
        "flat vector design, generous whitespace, precise sans-serif typography",
        ["#FFFFFF", "#F3F5F7", "#1E2329", "#2166FF", "#14B8A6"],
        "A solid off-white card surface with subtle paper grain and a clean margin around the design.",
        "Business card typography reading ORBITAL WORKS with a small circular orbit mark, contact lines, and blue accent rules.",
        [145, 110, 840, 890],
        512,
        320,
        "A clean modern business card for ORBITAL WORKS, minimal geometric typography, blue accent.",
        "A graphic design frame, full-bleed no border no crop no checkerboard, business card mockup centered.",
    ),
    Scenario(
        "S05",
        "storybook_lighthouse",
        "Storybook lighthouse",
        "illustration",
        "A cozy storybook illustration of a red lighthouse on a grassy cliff with small houses below.",
        "warm, whimsical, gentle texture, hand-drawn charm",
        "soft morning light, pastel sky, mild shadows",
        "children's book illustration, gouache texture, rounded shapes",
        ["#E94B4B", "#F6E7B4", "#76A66B", "#5A7FA3", "#FFF8EA"],
        "A pastel coastal cliff with grass, wildflowers, a calm sea, and small houses extending naturally to the edges.",
        "A red and white lighthouse on a grassy cliff, glowing lantern room, tiny path winding toward village houses.",
        [80, 250, 910, 760],
        384,
        512,
        "A cozy children's book illustration of a red lighthouse on a grassy cliff above the sea.",
        "A storybook frame with no border no matte no checkerboard, full-bleed illustration of a lighthouse.",
    ),
    Scenario(
        "S06",
        "toy_robot",
        "Toy robot render",
        "3d_render",
        "A playful 3D render of a small toy robot carrying a potted plant across a sunny desk.",
        "playful, polished, tactile, friendly character design",
        "bright soft daylight, gentle ambient occlusion, clean shadows",
        "stylized 3D render, rounded forms, toy-like materials",
        ["#FFD166", "#06D6A0", "#118AB2", "#EF476F", "#F8F9FA"],
        "A sunny wooden desk with pencils, paper, soft dust motes, and a blurred window glow filling the frame.",
        "A small rounded toy robot with blue body panels holding a terracotta pot with a green sprout.",
        [145, 245, 880, 760],
        384,
        384,
        "A playful 3D toy robot carrying a potted plant on a sunny desk, bright friendly render.",
        "A render frame, no border no transparent checkerboard, full-bleed toy robot centered.",
    ),
    Scenario(
        "S07",
        "cafe_menu",
        "Cafe menu poster",
        "graphic_design",
        "A vintage cafe menu poster for a fictional cafe named MORNING TIDE.",
        "vintage, legible, balanced hierarchy, warm print texture",
        "flat even lighting, scanned poster feel",
        "screen-printed graphic poster, serif headline, small decorative flourishes",
        ["#F7E7C6", "#3A2A1A", "#C75D2C", "#2C6E6B", "#FFFFFF"],
        "A warm cream paper background with faint print grain and subtle edge-to-edge texture.",
        "Poster text reading MORNING TIDE, COFFEE, TOAST, PASTRY, with small cup icon and simple price lines.",
        [60, 120, 940, 880],
        384,
        512,
        "A vintage cafe menu poster for MORNING TIDE with coffee, toast, pastry, cream paper, print texture.",
        "A poster frame with no border no crop no checkerboard, full-bleed cafe menu design.",
    ),
    Scenario(
        "S08",
        "reading_room",
        "Reading room interior",
        "photograph",
        "A wide interior photograph of a quiet reading room with walnut shelves and green banker lamps.",
        "architectural editorial photography, calm, detailed, inviting",
        "late afternoon window light mixed with warm lamp glow",
        "wide interior photograph, straight verticals, 24mm lens",
        ["#2F3A2F", "#6B4F35", "#C7A86B", "#EEE7D8", "#1B1B1B"],
        "A reading room with walnut bookshelves, tall windows, polished wood tables, green lamps, and floorboards reaching every edge.",
        "A long central reading table with green banker lamps, open books, and empty chairs aligned in perspective.",
        [220, 130, 780, 900],
        512,
        320,
        "A quiet reading room interior with walnut shelves, green banker lamps, warm afternoon light.",
        "A cinematic frame of a reading room, no border no letterbox no black bars, full-bleed architecture.",
    ),
    Scenario(
        "S09",
        "fashion_full_body",
        "Full-body fashion portrait",
        "photograph",
        "A full-body editorial fashion portrait of an adult model in a cobalt coat walking through a glass atrium.",
        "modern editorial fashion, clean lines, confident motion",
        "cool diffused daylight through glass ceiling, soft floor reflections",
        "full-body fashion photograph, 50mm, eye-level, natural perspective",
        ["#1F4ED8", "#D9E3F0", "#2B2B2B", "#F4F4F0", "#8EA4B8"],
        "A glass atrium with pale stone floor, steel columns, diffuse daylight, and architectural lines extending beyond the crop.",
        "An adult model in a cobalt blue coat, black trousers, and polished shoes, walking confidently with full body visible.",
        [45, 330, 985, 680],
        320,
        512,
        "A full-body editorial fashion portrait of an adult model in a cobalt coat walking in a glass atrium.",
        "A fashion movie still, no border no matte no letterbox, full-bleed full-body portrait frame.",
    ),
    Scenario(
        "S10",
        "rain_alley",
        "Rainy alley production photo",
        "photograph",
        "A moody night production photograph of a narrow rain-soaked alley with neon reflections and a cyclist in the distance.",
        "moody, atmospheric, realistic, restrained neon",
        "wet pavement reflections, practical shop light, soft blue ambient shadows",
        "night street photograph, cinema lens, natural camera crop",
        ["#101720", "#1E3A5F", "#E04F5F", "#F5C542", "#D8E1E8"],
        "A narrow alley with wet brick walls, small shop signs, puddles, steam, and reflections continuing outside the camera crop.",
        "A distant cyclist in a rain jacket moving through the alley, small in frame, partially rim-lit by shop lights.",
        [430, 430, 760, 600],
        512,
        320,
        "A moody rainy night alley with neon reflections and a distant cyclist, realistic production photograph.",
        "A movie still frame of a rainy alley, no border no letterbox no checkerboard, full-bleed cinematic frame.",
    ),
]


def request_json(method: str, url: str, payload: Any | None = None, timeout: int = 30) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    req = Request(url, data=data, method=method, headers={"Content-Type": "application/json"})
    with urlopen(req, timeout=timeout) as res:
        return json.loads(res.read().decode("utf-8"))


def request_bytes(url: str, timeout: int = 60) -> bytes:
    with urlopen(url, timeout=timeout) as res:
        return res.read()


def caption_full(scene: Scenario) -> dict[str, Any]:
    style: dict[str, Any]
    if scene.medium == "photograph":
        style = {
            "aesthetics": scene.aesthetics,
            "lighting": scene.lighting,
            "photo": scene.photo_or_art,
            "medium": scene.medium,
            "color_palette": scene.palette,
        }
    else:
        style = {
            "aesthetics": scene.aesthetics,
            "lighting": scene.lighting,
            "medium": scene.medium,
            "art_style": scene.photo_or_art,
            "color_palette": scene.palette,
        }
    return {
        "high_level_description": scene.hld,
        "style_description": style,
        "compositional_deconstruction": {
            "background": scene.background,
            "elements": [
                {
                    "type": "obj",
                    "bbox": scene.bbox,
                    "desc": scene.subject,
                }
            ],
        },
    }


def caption_light(scene: Scenario) -> dict[str, Any]:
    return {
        "high_level_description": scene.hld,
        "compositional_deconstruction": {
            "background": scene.background,
            "elements": [{"type": "obj", "desc": scene.subject}],
        },
    }


def caption_schema_drift(scene: Scenario) -> str:
    # Deliberately violates several recommendations while staying parseable.
    payload = {
        "aspect_ratio": f"{scene.width}:{scene.height}",
        "style_description": {
            "medium": scene.medium,
            "color_palette": ", ".join(scene.palette[:3]),
            "lighting": scene.lighting,
            "aesthetics": scene.aesthetics,
            "photo": scene.photo_or_art,
            "art_style": scene.photo_or_art,
        },
        "high_level_description": scene.hld,
        "compositional_deconstruction": {
            "elements": [
                {
                    "desc": scene.subject,
                    "bbox": [float(v) for v in scene.bbox],
                    "type": "obj",
                }
            ],
            "background": scene.background,
        },
    }
    return json.dumps(payload, ensure_ascii=False)


def caption_antipattern(scene: Scenario) -> dict[str, Any]:
    base = caption_full(scene)
    base["high_level_description"] = scene.anti
    base["compositional_deconstruction"]["background"] = (
        scene.background
        + " The image must be full-bleed with no border, no letterbox, no matte, no checkerboard, and no frame."
    )
    return base


def build_cases() -> list[dict[str, Any]]:
    cases = []
    variants = [
        ("V01", "official_full", "official JSON full schema", caption_full),
        ("V02", "json_light", "JSON with optional style/bbox/palette omitted", caption_light),
        ("V03", "plain_text", "plain detailed text", lambda s: s.plain),
        ("V04", "schema_drift", "JSON schema drift anti-control", caption_schema_drift),
        ("V05", "frame_terms", "frame/negative wording anti-pattern", caption_antipattern),
    ]
    index = 1
    for scene in SCENARIOS:
        for vid, vslug, label, builder in variants:
            cases.append(
                {
                    "index": index,
                    "scenario_id": scene.sid,
                    "scenario": scene.slug,
                    "scenario_title": scene.title,
                    "variant_id": vid,
                    "variant": vslug,
                    "variant_label": label,
                    "width": scene.width,
                    "height": scene.height,
                    "seed": 2026062600 + index,
                    "caption": builder(scene),
                }
            )
            index += 1
    return cases


def wait_for_model(base_url: str) -> None:
    print("Checking daemon health...")
    print(request_json("GET", f"{base_url}/health"))
    status = request_json("GET", f"{base_url}/model/status")
    if status.get("state") == "loaded":
        print("Model already loaded.")
        return
    print("Starting model load...")
    print(request_json("POST", f"{base_url}/model/load"))
    last = ""
    started = time.time()
    while True:
        status = request_json("GET", f"{base_url}/model/status")
        line = f"{status.get('state')} {status.get('msg')} {status.get('operation') or ''}".strip()
        if line != last:
            print(f"[load] {line}")
            last = line
        if status.get("state") == "loaded":
            print(f"Model loaded after {time.time() - started:.1f}s.")
            return
        if status.get("state") == "idle" and "failed" in str(status.get("msg", "")).lower():
            raise RuntimeError(status.get("msg"))
        time.sleep(2)


def generate_case(base_url: str, case: dict[str, Any], out_dir: Path, preset: str, fmt: str, quality: int) -> dict[str, Any]:
    payload = {
        "caption": case["caption"],
        "width": case["width"],
        "height": case["height"],
        "preset": preset,
        "seed": case["seed"],
        "format": fmt,
        "quality": quality,
    }
    result = request_json("POST", f"{base_url}/generate", payload)
    if "task_id" not in result:
        raise RuntimeError(result)
    task_id = result["task_id"]
    last = ""
    while True:
        status = request_json("GET", f"{base_url}/status/{task_id}", timeout=10)
        msg = f"{status.get('state')} {status.get('progress', 0)}% {status.get('msg', '')}"
        if msg != last:
            print(f"[{case['index']:02d}] {msg}")
            last = msg
        if status.get("state") == "done":
            if status.get("error"):
                raise RuntimeError(status["error"])
            break
        time.sleep(1)
    artifact = request_bytes(f"{base_url}/artifact/{task_id}")
    image_name = (
        f"{case['index']:02d}_{case['scenario_id']}_{case['scenario']}_"
        f"{case['variant_id']}_{case['variant']}.{fmt}"
    )
    image_path = out_dir / "images" / image_name
    image_path.write_bytes(artifact)
    prompt_path = out_dir / "prompts" / image_name.replace(f".{fmt}", ".json")
    prompt_path.write_text(json.dumps(case["caption"], ensure_ascii=False, indent=2), encoding="utf-8")
    return {
        **{k: v for k, v in case.items() if k != "caption"},
        "task_id": task_id,
        "output": str(image_path),
        "prompt_file": str(prompt_path),
        "preset": preset,
        "format": fmt,
        "daemon_meta": status.get("image_meta") or {},
    }


def edge_metrics(path: Path) -> dict[str, Any]:
    with Image.open(path) as img:
        rgb = img.convert("RGB")
        w, h = rgb.size
        strip = max(4, min(w, h) // 32)
        strips = {
            "top": rgb.crop((0, 0, w, strip)),
            "bottom": rgb.crop((0, h - strip, w, h)),
            "left": rgb.crop((0, 0, strip, h)),
            "right": rgb.crop((w - strip, 0, w, h)),
        }
        stats = {}
        for name, region in strips.items():
            pixels = list(cast(Any, region.getdata()))
            channel_stds = []
            for channel in range(3):
                vals = [p[channel] for p in pixels]
                channel_stds.append(round(statistics.pstdev(vals), 2))
            stats[name] = round(sum(channel_stds) / 3, 2)
        bg = Image.new("RGB", rgb.size, rgb.getpixel((0, 0)))
        diff = ImageChops.difference(rgb, bg)
        bbox = diff.getbbox()
        if bbox:
            trim_area_ratio = round(((bbox[2] - bbox[0]) * (bbox[3] - bbox[1])) / (w * h), 3)
            trim_bbox = list(bbox)
        else:
            trim_area_ratio = 0
            trim_bbox = None
        low_variance_edges = [name for name, value in stats.items() if value < 8]
        return {
            "width": w,
            "height": h,
            "edge_strip_px": strip,
            "edge_std": stats,
            "low_variance_edges": low_variance_edges,
            "trim_bbox_from_top_left": trim_bbox,
            "trim_area_ratio_from_top_left": trim_area_ratio,
        }


def make_contact_sheet(records: list[dict[str, Any]], out_dir: Path, columns: int = 5) -> Path:
    thumb_w, thumb_h = 180, 180
    label_h = 42
    rows = (len(records) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * thumb_w, rows * (thumb_h + label_h)), "white")
    draw = ImageDraw.Draw(sheet)
    for i, record in enumerate(records):
        x = (i % columns) * thumb_w
        y = (i // columns) * (thumb_h + label_h)
        with Image.open(record["output"]) as img:
            img = img.convert("RGB")
            img.thumbnail((thumb_w, thumb_h), Image.Resampling.LANCZOS)
            px = x + (thumb_w - img.width) // 2
            py = y + (thumb_h - img.height) // 2
            sheet.paste(img, (px, py))
        label = f"{record['index']:02d} {record['scenario_id']} {record['variant_id']}\n{record['variant']}"
        draw.text((x + 4, y + thumb_h + 3), label, fill=(20, 20, 20))
    path = out_dir / "contact_sheet.jpg"
    sheet.save(path, quality=92)
    return path


def write_report(records: list[dict[str, Any]], out_dir: Path, elapsed_s: float) -> None:
    by_variant: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        by_variant.setdefault(record["variant"], []).append(record)
    lines = [
        "# Ideogram 4 Prompt Rule Lab 50",
        "",
        f"- Generated images: {len(records)} / 50",
        "- Matrix: 10 scenarios x 5 prompt strategies",
        "- Preset: `V4_TURBO_12`",
        "- Format: `webp`",
        f"- Elapsed: {elapsed_s:.1f}s",
        "- Contact sheet: [contact_sheet.jpg](contact_sheet.jpg)",
        "",
        "## Variants",
        "",
        "- `V01 official_full`: official JSON full schema with style, palette, bbox",
        "- `V02 json_light`: valid JSON with optional style/bbox/palette omitted",
        "- `V03 plain_text`: detailed plain text prompt",
        "- `V04 schema_drift`: parseable JSON that violates schema/order/type expectations",
        "- `V05 frame_terms`: prompt includes frame/border/checkerboard negative wording",
        "",
        "## Automated Edge Metrics",
        "",
    ]
    for variant, items in by_variant.items():
        low_edges = sum(1 for item in items if item["metrics"]["low_variance_edges"])
        avg_trim = statistics.mean(item["metrics"]["trim_area_ratio_from_top_left"] for item in items)
        lines.append(f"- `{variant}`: low-variance edge flags {low_edges}/{len(items)}, avg trim ratio {avg_trim:.3f}")
    lines.extend(["", "## Records", ""])
    for record in records:
        rel = Path(record["output"]).relative_to(out_dir)
        flags = ",".join(record["metrics"]["low_variance_edges"]) or "-"
        lines.append(
            f"- `{record['index']:02d}` `{record['scenario_id']}` `{record['variant_id']}` "
            f"`{record['variant']}` {record['width']}x{record['height']} "
            f"edge_flags={flags} [image]({rel})"
        )
    (out_dir / "report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--daemon-url", default="http://127.0.0.1:8001")
    parser.add_argument("--out-dir", default="outputs/prompt_rule_lab_50_20260626")
    parser.add_argument("--preset", default="V4_TURBO_12")
    parser.add_argument("--format", default="webp")
    parser.add_argument("--quality", type=int, default=90)
    parser.add_argument("--skip-existing", action="store_true")
    args = parser.parse_args()

    out_dir = Path(args.out_dir).resolve()
    (out_dir / "images").mkdir(parents=True, exist_ok=True)
    (out_dir / "prompts").mkdir(parents=True, exist_ok=True)

    wait_for_model(args.daemon_url.rstrip("/"))
    cases = build_cases()
    records: list[dict[str, Any]] = []
    manifest_path = out_dir / "manifest.jsonl"
    if manifest_path.exists() and not args.skip_existing:
        manifest_path.unlink()
    started = time.time()
    for case in cases:
        image_name = (
            f"{case['index']:02d}_{case['scenario_id']}_{case['scenario']}_"
            f"{case['variant_id']}_{case['variant']}.{args.format}"
        )
        image_path = out_dir / "images" / image_name
        if args.skip_existing and image_path.exists():
            record = {**{k: v for k, v in case.items() if k != "caption"}, "output": str(image_path)}
        else:
            print(f"\nGenerating {case['index']:02d}/50 {case['scenario_id']} {case['variant_id']} {case['variant']}")
            record = generate_case(args.daemon_url.rstrip("/"), case, out_dir, args.preset, args.format, args.quality)
        record["metrics"] = edge_metrics(Path(record["output"]))
        records.append(record)
        with manifest_path.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(record, ensure_ascii=False) + "\n")
    sheet = make_contact_sheet(records, out_dir)
    elapsed = time.time() - started
    write_report(records, out_dir, elapsed)
    print(f"\nDone: {len(records)} images")
    print(f"Output: {out_dir}")
    print(f"Contact sheet: {sheet}")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except HTTPError as exc:
        print(exc.read().decode("utf-8", errors="replace"), file=sys.stderr)
        raise
