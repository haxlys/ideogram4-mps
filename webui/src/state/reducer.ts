import type { AppAction, FormState, ImageEntry, ModelState } from "./types";
import { DEFAULT_FORM } from "./types";
import { buildCaptionJson, captionToForm } from "@/validation/caption";

export interface AppState {
  modelState: ModelState;
  form: FormState;
  genStatus: import("./types").GenStatus;
  genStatusMsg: string;
  taskId: string | null;
  progress: number;
  totalSteps: number;
  images: ImageEntry[];
  selectedPreset: string | null;
  resultImage: ImageEntry | null;
}

export const initialState: AppState = {
  modelState: "idle",
  form: DEFAULT_FORM,
  genStatus: "idle",
  genStatusMsg: "",
  taskId: null,
  progress: 0,
  totalSteps: 0,
  images: [],
  selectedPreset: null,
  resultImage: null,
};

export function appReducer(state: AppState, action: AppAction): AppState {
  switch (action.type) {
    case "SET_MODEL_STATE":
      return { ...state, modelState: action.state };

    case "SET_FORM":
      if ("rawJson" in action.form) {
        const jsonValue = action.form.rawJson ?? "";
        if (!jsonValue.trim()) return { ...state, form: { ...state.form, rawJson: "" } };
        try {
          const caption = JSON.parse(jsonValue);
          const patch = captionToForm(caption);
          const { rawJson: _, ...formPatch } = patch;
          return { ...state, form: { ...state.form, ...formPatch, rawJson: jsonValue } };
        } catch {
          return { ...state, form: { ...state.form, ...action.form } };
        }
      }
      const nextForm = { ...state.form, ...action.form };
      const syncedJson = JSON.stringify(buildCaptionJson(nextForm), null, 2);
      return { ...state, form: { ...nextForm, rawJson: syncedJson } };

    case "RESTORE_FORM": {
      const loaded = action.form;
      if (loaded.rawJson && loaded.rawJson.trim()) {
        try {
          const caption = JSON.parse(loaded.rawJson);
          const patch = captionToForm(caption);
          const { rawJson: _, ...formPatch } = patch;
          return { ...state, form: { ...loaded, ...formPatch } };
        } catch { /* keep form as-is */ }
      }
      const syncedJson = JSON.stringify(buildCaptionJson(loaded), null, 2);
      return { ...state, form: { ...loaded, rawJson: syncedJson } };
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

    case "SET_GEN_STATUS":
      return {
        ...state,
        genStatus: action.status,
        genStatusMsg: action.msg ?? "",
        taskId: action.taskId !== undefined ? action.taskId : state.taskId,
        progress: action.progress ?? state.progress,
        totalSteps: action.totalSteps ?? state.totalSteps,
      };

    case "ADD_IMAGE":
      return {
        ...state,
        images: [action.entry, ...state.images].slice(0, 20),
      };

    case "SET_IMAGES":
      return { ...state, images: action.entries };

    case "SHOW_RESULT":
      return { ...state, resultImage: action.entry };

    default:
      return state;
  }
}
