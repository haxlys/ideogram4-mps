import type { LoraPreset } from "@/lib/loraTypes";

export type LoraFamilyId = "realism" | "zjourney";

export interface LoraFamilyMeta {
  id: LoraFamilyId;
  title: string;
  description: string;
}

export const LORA_FAMILIES: LoraFamilyMeta[] = [
  { id: "realism", title: "Realism", description: "Photoreal detail and lighting" },
  { id: "zjourney", title: "zJourney", description: "Stylized illustration LoRAs" },
];

export function loraFamilyFromPreset(preset: LoraPreset): LoraFamilyId | null {
  const raw = (preset.loras[0]?.name ?? preset.id).toLowerCase();
  if (raw.includes("zjourney")) return "zjourney";
  if (raw.includes("realism")) return "realism";
  return null;
}

/** Short version chip, e.g. V4, v2, V1 */
export function loraVersionChip(preset: LoraPreset): string {
  const raw = preset.loras[0]?.name ?? preset.id;
  const ideogram = raw.match(/Ideogram[_\s]*V(\d+)/i);
  if (ideogram) return `V${ideogram[1]}`;
  const engineV = raw.match(/Realism_Engine_V(\d+)/i);
  if (engineV) return `V${engineV[1]}`;
  const zj = raw.match(/zjourneyv(\d+)/i);
  if (zj) return `v${zj[1]}`;
  const anyV = raw.match(/[Vv](\d+)/);
  if (anyV) return `V${anyV[1]}`;
  return preset.label.replace(/\.safetensors$/i, "").slice(0, 12);
}

export function sortPresetsInFamily(a: LoraPreset, b: LoraPreset): number {
  const va = loraVersionChip(a);
  const vb = loraVersionChip(b);
  const na = parseInt(va.replace(/\D/g, ""), 10) || 0;
  const nb = parseInt(vb.replace(/\D/g, ""), 10) || 0;
  if (na !== nb) return na - nb;
  return a.label.localeCompare(b.label);
}

export function groupPresetsByFamily(presets: LoraPreset[]): Map<LoraFamilyId, LoraPreset[]> {
  const map = new Map<LoraFamilyId, LoraPreset[]>();
  for (const family of LORA_FAMILIES) {
    map.set(family.id, []);
  }
  for (const preset of presets) {
    const family = loraFamilyFromPreset(preset);
    if (!family) continue;
    map.get(family)!.push(preset);
  }
  for (const [, list] of map) {
    list.sort(sortPresetsInFamily);
  }
  return map;
}