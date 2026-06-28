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

export interface AppliedLoraEntry {
  name: string;
  strength: number;
}

export interface ImageEntry {
  id: number;
  url: string;
  hld: string;
  time: string;
  prompt_id?: number | null;
  seed?: number;
  preset?: string;
  /** True when prompt_id references an existing history row. */
  historyLinked?: boolean;
  lora_name?: string | null;
  lora_strength?: number | null;
  applied_loras?: AppliedLoraEntry[] | null;
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

export interface PendingHistoryLink {
  imageId: number;
  /** When set, reuses an existing history row instead of creating a new one. */
  promptId?: number;
  hld: string;
  formJson: string;
}

/** Whether a finished image updates an existing history row or creates a new one. */
export type HistoryLinkMode = "regenerate" | "new";

export interface GenJob {
  id: string;
  /** Target history row for regenerate jobs; omitted for new-history jobs until link completes. */
  promptId?: number;
  /** How this job should attach to history after generation. */
  historyLinkMode: HistoryLinkMode;
  formSnapshot: FormState;
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
  /** Image saved to gallery but PATCH link to history failed. */
  historyLinkFailed?: boolean;
  linkError?: string;
  pendingLink?: PendingHistoryLink;
}

export const MAX_GEN_QUEUE_SIZE = 20;
export type MagicExpandStatus = "idle" | "running" | "done" | "error";

export interface MagicExpandPayload {
  prompt: string;
  width: number;
  height: number;
  imagesB64: string[] | null;
  /** After a successful LLM expand, enqueue image generation automatically. */
  enqueueAfter?: boolean;
}

export interface MagicExpandState {
  status: MagicExpandStatus;
  requestId: number;
  model: string | null;
  error: string | null;
  /** Set while status is "running"; cleared on success, failure, or dismiss. */
  pending: MagicExpandPayload | null;
}


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
  | { type: "UPDATE_JOB"; id: string; patch: Partial<Pick<GenJob, "status" | "msg" | "progress" | "totalSteps" | "taskId" | "result" | "error" | "promptId" | "historyLinkFailed" | "linkError" | "pendingLink">> }
  | { type: "REMOVE_JOB"; id: string }
  | { type: "REORDER_JOB"; id: string; direction: "up" | "down" }
  | { type: "CLEAR_QUEUED_JOBS" }
  | { type: "CLEAR_FINISHED_JOBS" }
  | { type: "SET_QUEUE_EXPANDED"; expanded: boolean }
  | { type: "ADD_IMAGE"; entry: ImageEntry }
  | { type: "SET_IMAGES"; entries: ImageEntry[] }
  | { type: "REMOVE_IMAGE"; imageId: number }
  | { type: "REMOVE_IMAGES_BY_PROMPT"; promptId: number }
  | { type: "SHOW_RESULT"; entry: ImageEntry | null; pinned?: boolean }
  | { type: "REFRESH_HISTORY" }
  | { type: "MAGIC_EXPAND_START"; payload: MagicExpandPayload }
  | { type: "MAGIC_EXPAND_SUCCEEDED"; rawJson: string; model: string }
  | { type: "MAGIC_EXPAND_FAILED"; error: string }
  | { type: "MAGIC_EXPAND_DISMISS" }
  | { type: "REFRESH_FAVORITES" };

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
  preset: "V4_TURBO_12",
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
