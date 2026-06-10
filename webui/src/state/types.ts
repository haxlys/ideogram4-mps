export type ModelState = "idle" | "loading" | "loaded";

export type Medium = "photograph" | "illustration" | "3d_render" | "painting" | "graphic_design";

export type ElementType = "obj" | "text";

export interface FormElement {
  id: string;
  type: ElementType;
  text: string;
  bbox: string;
  desc: string;
}

export interface FormState {
  hld: string;
  aes: string;
  light: string;
  cam: string;
  med: Medium;
  cp: string;
  bg: string;
  els: FormElement[];
  w: number;
  h: number;
  preset: "V4_TURBO_12" | "V4_DEFAULT_20" | "V4_QUALITY_48";
  seed: string;
  rawJson: string;
}

export type GenStatus = "idle" | "submitting" | "running" | "done" | "error";

export interface UIState {
  genStatus: GenStatus;
  genStatusMsg: string;
  taskId: string | null;
  progress: number;
  totalSteps: number;
}

export interface ImageEntry {
  id: number;
  url: string;
  hld: string;
  time: string;
  prompt_id?: number | null;
}

export interface PromptEntry extends FormState {
  _savedAt: string;
  _id?: number;
}

export type AppAction =
  | { type: "SET_MODEL_STATE"; state: ModelState }
  | { type: "SET_FORM"; form: Partial<FormState> }
  | { type: "RESTORE_FORM"; form: FormState }
  | { type: "ADD_ELEMENT" }
  | { type: "REMOVE_ELEMENT"; index: number }
  | { type: "UPDATE_ELEMENT"; index: number; field: keyof FormElement; value: string }
  | { type: "SET_GEN_STATUS"; status: GenStatus; msg?: string; taskId?: string | null; progress?: number; totalSteps?: number }
  | { type: "ADD_IMAGE"; entry: ImageEntry }
  | { type: "SET_IMAGES"; entries: ImageEntry[] }
  | { type: "SHOW_RESULT"; entry: ImageEntry | null };

export const DEFAULT_FORM: FormState = {
  hld: "",
  aes: "",
  light: "",
  cam: "",
  med: "photograph",
  cp: "",
  bg: "",
  els: [{ id: "el-1", type: "obj", text: "", bbox: "", desc: "" }],
  w: 1024,
  h: 1024,
  preset: "V4_QUALITY_48",
  seed: "",
  rawJson: "",
};

export const RESOLUTION_PRESETS: { name: string; w: number; h: number }[] = [
  { name: "Square", w: 1024, h: 1024 },
  { name: "Landscape", w: 1536, h: 1024 },
  { name: "Portrait", w: 1024, h: 1536 },
  { name: "Widescreen", w: 1920, h: 1088 },
  { name: "Ultrawide", w: 2048, h: 768 },
  { name: "Phone", w: 1024, h: 1792 },
  { name: "Social", w: 1584, h: 396 },
];

export const STEPS_MAP: Record<FormState["preset"], number> = {
  V4_TURBO_12: 12,
  V4_DEFAULT_20: 20,
  V4_QUALITY_48: 48,
};

export function estimateTime(w: number, h: number, steps: number): number {
  return (w * h) * (350 / (1024 * 1024)) * (steps / 48);
}
