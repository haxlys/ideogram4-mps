import type { GenerateRequest, ModelStatus } from "@/api/client";

export type ModelState = "idle" | "loading" | "loaded";
export type { ModelStatus };

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
  format: "png" | "webp" | "jpeg";
  rawJson: string;
}

export interface ImageEntry {
  id: number;
  url: string;
  hld: string;
  time: string;
  prompt_id?: number | null;
}

export type GenJobStatus =
  | "queued"
  | "waiting"
  | "submitting"
  | "running"
  | "cancelling"
  | "done"
  | "error"
  | "cancelled";

export interface GenJob {
  id: string;
  promptId: number;
  label: string;
  status: GenJobStatus;
  msg: string;
  progress: number;
  totalSteps: number;
  createdAt: number;
  taskId?: string;
  request: GenerateRequest;
  result?: ImageEntry;
  error?: string;
}

export const MAX_GEN_QUEUE_SIZE = 20;

export interface PromptEntry extends FormState {
  _savedAt: string;
  _id?: number;
}

export type AppAction =
  | { type: "SET_MODEL_STATE"; state: ModelState }
  | { type: "SET_MODEL_STATUS"; status: ModelStatus }
  | { type: "SET_FORM"; form: Partial<FormState> }
  | { type: "RESTORE_FORM"; form: FormState; promptId?: number }
  | { type: "ADD_ELEMENT" }
  | { type: "REMOVE_ELEMENT"; index: number }
  | { type: "UPDATE_ELEMENT"; index: number; field: keyof FormElement; value: string }
  | { type: "ENQUEUE_JOB"; job: GenJob }
  | { type: "UPDATE_JOB"; id: string; patch: Partial<Pick<GenJob, "status" | "msg" | "progress" | "totalSteps" | "taskId" | "result" | "error">> }
  | { type: "REMOVE_JOB"; id: string }
  | { type: "REORDER_JOB"; id: string; direction: "up" | "down" }
  | { type: "CLEAR_QUEUED_JOBS" }
  | { type: "CLEAR_FINISHED_JOBS" }
  | { type: "SET_QUEUE_EXPANDED"; expanded: boolean }
  | { type: "ADD_IMAGE"; entry: ImageEntry }
  | { type: "SET_IMAGES"; entries: ImageEntry[] }
  | { type: "SHOW_RESULT"; entry: ImageEntry | null }
  | { type: "REFRESH_HISTORY" };

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
  format: "webp",
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

export const MIN_DIMENSION = 256;
export const MAX_DIMENSION = 2048;
export const DIMENSION_STEP = 128;
export const MLX_LOAD_ESTIMATE_SECONDS = 3;
export const MLX_BASE_1024_QUALITY48_SECONDS = 375;

export function estimateTime(w: number, h: number, steps: number): number {
  return (w * h) * (MLX_BASE_1024_QUALITY48_SECONDS / (1024 * 1024)) * (steps / 48);
}
