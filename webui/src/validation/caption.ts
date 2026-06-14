import type { FormState, FormElement } from "@/state/types";

export function captionToForm(caption: Record<string, unknown>): Partial<FormState> {
  const sd = (caption.style_description as Record<string, unknown>) || {};
  const cd = (caption.compositional_deconstruction as Record<string, unknown>) || {};
  const elsRaw = (cd.elements as Array<Record<string, unknown>>) || [];

  const els: FormElement[] = elsRaw.filter((el) => el.desc || el.text || el.type).map((el) => ({
    id: crypto.randomUUID(),
    type: (el.type === "text" ? "text" : "obj") as FormElement["type"],
    text: String(el.text || ""),
    bbox: Array.isArray(el.bbox) ? (el.bbox as number[]).join(",") : "",
    desc: String(el.desc || ""),
  }));

  if (els.length === 0) {
    els.push({ id: crypto.randomUUID(), type: "obj", text: "", bbox: "", desc: "" });
  }

  const cpArr = Array.isArray(sd.color_palette) ? sd.color_palette as string[] : [];

  return {
    hld: String(caption.high_level_description || ""),
    aes: String(sd.aesthetics || ""),
    light: String(sd.lighting || ""),
    med: String(sd.medium || "photograph") as FormState["med"],
    cam: String(sd.photo || sd.art_style || ""),
    cp: cpArr.join(", "),
    bg: String(cd.background || ""),
    els,
  };
}

export function buildCaptionJson(form: FormState) {
  const cp = form.cp
    .split(",")
    .flatMap((s) => {
      const t = s.trim();
      return t ? [t] : [];
    });

  const style = {
    aesthetics: form.aes || undefined,
    lighting: form.light || undefined,
    medium: form.med,
    ...(form.med === "photograph"
      ? { photo: form.cam || undefined }
      : { art_style: form.cam || undefined }),
    ...(cp.length > 0 ? { color_palette: cp } : {}),
  };

  const elements: Record<string, unknown>[] = [];
  for (const el of form.els) {
    if (!el.type && !el.desc && !el.text) continue;
    const obj: Record<string, unknown> = { type: el.type };
    if (el.text) obj.text = el.text;
    if (el.bbox.trim()) obj.bbox = el.bbox.split(",").map(Number);
    if (el.desc) obj.desc = el.desc;
    elements.push(obj);
  }

  return {
    high_level_description: form.hld,
    style_description: style,
    compositional_deconstruction: {
      background: form.bg,
      elements,
    },
  };
}

export function getCaptionForGeneration(form: FormState) {
  const raw = form.rawJson.trim();
  if (!raw) return buildCaptionJson(form);

  const caption = JSON.parse(raw);
  if (!caption || typeof caption !== "object" || Array.isArray(caption)) {
    throw new Error("Raw JSON must be a JSON object.");
  }
  return caption as Record<string, unknown>;
}

export function getCaptionHld(caption: Record<string, unknown>, fallback = "") {
  return typeof caption.high_level_description === "string"
    ? caption.high_level_description
    : fallback;
}
