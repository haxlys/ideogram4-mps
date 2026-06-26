export interface LoraPresetEntry {
  name: string;
  repo?: string;
  filename?: string;
  strength: number;
  installed: boolean;
  format?: string | null;
  size_mb?: number | null;
}

export interface LoraPreset {
  id: string;
  label: string;
  installed: boolean;
  loras: LoraPresetEntry[];
}

export interface AppliedLora {
  name: string;
  strength: number;
  format?: string;
}