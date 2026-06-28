import type { AppAction, FormState, ImageEntry, MagicExpandState, ModelState, ModelStatus } from "./types";
import { DEFAULT_FORM, MAX_GEN_QUEUE_SIZE } from "./types";
import { buildCaptionJson, captionToForm } from "@/validation/caption";
import { queuedJobCount } from "@/lib/genQueueDedupe";

import type { GenJob } from "./types";

export interface AppState {
  modelState: ModelState;
  modelStatus: ModelStatus | null;
  form: FormState;
  genQueue: GenJob[];
  genQueueExpanded: boolean;
  images: ImageEntry[];
  selectedPreset: string | null;
  resultImage: ImageEntry | null;
  resultImagePinned: boolean;
  selectedPromptId: number | null;
  historyRefresh: number;
  favoritesRefresh: number;
  magicExpand: MagicExpandState;
}

export const initialState: AppState = {
  modelState: "idle",
  modelStatus: null,
  form: DEFAULT_FORM,
  genQueue: [],
  genQueueExpanded: false,
  images: [],
  selectedPreset: null,
  resultImage: null,
  resultImagePinned: false,
  selectedPromptId: null,
  historyRefresh: 0,
  favoritesRefresh: 0,
  magicExpand: { status: "idle", requestId: 0, model: null, error: null, pending: null },
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_MODEL_STATE":
      return {
        ...state,
        modelState: action.state,
        modelStatus: action.state === "idle"
          ? null
          : state.modelStatus
            ? { ...state.modelStatus, state: action.state }
            : null,
      };

    case "SET_MODEL_STATUS":
      return { ...state, modelState: action.status.state, modelStatus: action.status };

    case "SET_FORM": {
      if ("rawJson" in action.form) {
        const jsonValue = action.form.rawJson ?? "";
        if (!jsonValue.trim()) return { ...state, form: { ...state.form, rawJson: "" } };
        try {
          const caption = JSON.parse(jsonValue);
          const patch = captionToForm(caption);
          const { rawJson: ignoredRawJson, ...formPatch } = patch;
          void ignoredRawJson;
          return { ...state, form: { ...state.form, ...formPatch, rawJson: jsonValue } };
        } catch {
          return { ...state, form: { ...state.form, ...action.form } };
        }
      }
      const nextForm = { ...state.form, ...action.form };
      const syncedJson = JSON.stringify(buildCaptionJson(nextForm), null, 2);
      return { ...state, form: { ...nextForm, rawJson: syncedJson } };
    }

    case "RESTORE_FORM": {
      const loaded = action.form;
      const selectedPromptId = action.promptId ?? null;
      const promptChanged = selectedPromptId !== state.selectedPromptId;
      const resultImage = selectedPromptId == null ? null : state.resultImage;
      const resultImagePinned = selectedPromptId == null || promptChanged
        ? false
        : state.resultImagePinned;
      if (loaded.rawJson && loaded.rawJson.trim()) {
        try {
          const caption = JSON.parse(loaded.rawJson);
          const patch = captionToForm(caption);
          const { rawJson: ignoredRawJson, ...formPatch } = patch;
          void ignoredRawJson;
          return {
            ...state,
            form: { ...loaded, ...formPatch },
            selectedPromptId,
            resultImage,
            resultImagePinned,
          };
        } catch { /* keep form as-is */ }
      }
      const syncedJson = JSON.stringify(buildCaptionJson(loaded), null, 2);
      return {
        ...state,
        form: { ...loaded, rawJson: syncedJson },
        selectedPromptId,
        resultImage,
        resultImagePinned,
      };
    }

    case "ADD_ELEMENT": {
      const id = crypto.randomUUID();
      const els = [...state.form.els, { id, type: "obj" as const, text: "", bbox: "", desc: "" }];
      const form = { ...state.form, els, rawJson: JSON.stringify(buildCaptionJson({ ...state.form, els }), null, 2) };
      return { ...state, form };
    }

    case "REMOVE_ELEMENT":
      if (state.form.els.length <= 1) return state;
      {
        const els = state.form.els.filter((_, i) => i !== action.index);
        const form = { ...state.form, els, rawJson: JSON.stringify(buildCaptionJson({ ...state.form, els }), null, 2) };
        return { ...state, form };
      }

    case "UPDATE_ELEMENT": {
      const els = state.form.els.map((el, i) =>
        i === action.index ? { ...el, [action.field]: action.value } : el,
      );
      const form = { ...state.form, els, rawJson: JSON.stringify(buildCaptionJson({ ...state.form, els }), null, 2) };
      return { ...state, form };
    }

    case "MAGIC_EXPAND_START":
      return {
        ...state,
        magicExpand: {
          status: "running",
          requestId: state.magicExpand.requestId + 1,
          model: null,
          error: null,
          pending: action.payload,
        },
      };

    case "MAGIC_EXPAND_SUCCEEDED": {
      const jsonValue = action.rawJson;
      let nextForm = { ...state.form, rawJson: jsonValue };
      if (jsonValue.trim()) {
        try {
          const caption = JSON.parse(jsonValue);
          const patch = captionToForm(caption);
          const { rawJson: ignoredRawJson, ...formPatch } = patch;
          void ignoredRawJson;
          nextForm = { ...state.form, ...formPatch, rawJson: jsonValue };
        } catch {
          nextForm = { ...state.form, rawJson: jsonValue };
        }
      }
      return {
        ...state,
        form: nextForm,
        magicExpand: {
          status: "done",
          requestId: state.magicExpand.requestId,
          model: action.model,
          error: null,
          pending: null,
        },
      };
    }

    case "MAGIC_EXPAND_FAILED":
      return {
        ...state,
        magicExpand: {
          status: "error",
          requestId: state.magicExpand.requestId,
          model: null,
          error: action.error,
          pending: null,
        },
      };

    case "MAGIC_EXPAND_DISMISS":
      return {
        ...state,
        magicExpand: { status: "idle", requestId: state.magicExpand.requestId, model: null, error: null, pending: null },
      };

    case "ENQUEUE_JOB":
      if (queuedJobCount(state.genQueue) >= MAX_GEN_QUEUE_SIZE) return state;
      return {
        ...state,
        genQueue: [...state.genQueue, action.job],
        genQueueExpanded: true,
      };

    case "UPDATE_JOB":
      return {
        ...state,
        genQueue: state.genQueue.map((job) =>
          job.id === action.id ? { ...job, ...action.patch } : job,
        ),
      };

    case "REMOVE_JOB":
      return {
        ...state,
        genQueue: state.genQueue.filter((job) => job.id !== action.id),
      };

    case "REORDER_JOB": {
      const queue = [...state.genQueue];
      const idx = queue.findIndex((job) => job.id === action.id);
      if (idx === -1 || queue[idx].status !== "queued") return state;

      let swapIdx = -1;
      if (action.direction === "up") {
        for (let i = idx - 1; i >= 0; i--) {
          if (queue[i].status === "queued") {
            swapIdx = i;
            break;
          }
        }
      } else {
        for (let i = idx + 1; i < queue.length; i++) {
          if (queue[i].status === "queued") {
            swapIdx = i;
            break;
          }
        }
      }
      if (swapIdx === -1) return state;

      const nextQueue = [...queue];
      [nextQueue[idx], nextQueue[swapIdx]] = [nextQueue[swapIdx], nextQueue[idx]];
      return { ...state, genQueue: nextQueue };
    }

    case "CLEAR_QUEUED_JOBS":
      return {
        ...state,
        genQueue: state.genQueue.filter(
          (job) => job.status !== "queued" && job.status !== "waiting",
        ),
      };

    case "CLEAR_FINISHED_JOBS":
      return {
        ...state,
        genQueue: state.genQueue.filter(
          (job) =>
            job.status !== "done"
            && job.status !== "error"
            && job.status !== "cancelled",
        ),
      };

    case "SET_QUEUE_EXPANDED":
      return { ...state, genQueueExpanded: action.expanded };

    case "ADD_IMAGE":
      if (action.entry.prompt_id == null) return state;
      return {
        ...state,
        images: [action.entry, ...state.images.filter((img) => img.id !== action.entry.id)],
      };

    case "SET_IMAGES":
      return { ...state, images: action.entries };

    case "REMOVE_IMAGE":
      return {
        ...state,
        images: state.images.filter((img) => img.id !== action.imageId),
        resultImage: state.resultImage?.id === action.imageId ? null : state.resultImage,
        resultImagePinned: state.resultImage?.id === action.imageId
          ? false
          : state.resultImagePinned,
        genQueue: state.genQueue.map((job) =>
          job.result?.id === action.imageId ? { ...job, result: undefined } : job,
        ),
      };

    case "REMOVE_IMAGES_BY_PROMPT":
      return {
        ...state,
        images: state.images.filter((img) => img.prompt_id !== action.promptId),
        resultImage: state.resultImage?.prompt_id === action.promptId ? null : state.resultImage,
        genQueue: state.genQueue.map((job) =>
          job.promptId === action.promptId && job.result
            ? { ...job, result: undefined }
            : job,
        ),
      };

    case "SHOW_RESULT":
      return {
        ...state,
        resultImage: action.entry,
        resultImagePinned: action.entry == null ? false : (action.pinned ?? false),
      };

    case "REFRESH_HISTORY":
      return { ...state, historyRefresh: state.historyRefresh + 1 };

    case "REFRESH_FAVORITES":
      return { ...state, favoritesRefresh: state.favoritesRefresh + 1 };

    default:
      return state;
  }
}
