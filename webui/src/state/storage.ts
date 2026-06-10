import type { FormState, ImageEntry, PromptEntry } from "./types";
import { DEFAULT_FORM } from "./types";
import {
  getImages,
  getPrompts,
  savePromptApi,
  saveLastFormApi,
  deletePromptApi,
} from "@/api/client";

const LAST_FORM_KEY = "ideogram4_last_form";
let _imagesCache: ImageEntry[] | null = null;
let _promptsCache: PromptEntry[] | null = null;

export function invalidateImageCache() {
  _imagesCache = null;
}

export function loadLastForm(): FormState {
  try {
    const raw = localStorage.getItem(LAST_FORM_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* ignore */ }
  return DEFAULT_FORM;
}

export function saveLastForm(form: FormState) {
  localStorage.setItem(LAST_FORM_KEY, JSON.stringify(form));
  saveLastFormApi(JSON.stringify(form)).catch(() => {});
}

export async function savePrompt(form: FormState): Promise<number> {
  const entry: PromptEntry = { ...form, _savedAt: new Date().toISOString() };
  const result = await savePromptApi(form.hld || "(empty)", JSON.stringify(entry));
  _promptsCache = null;
  return result.id;
}

export async function loadPromptHistory(): Promise<PromptEntry[]> {
  if (_promptsCache) return _promptsCache;
  try {
    const rows = await getPrompts();
    _promptsCache = rows.flatMap((r) => {
      try { const p = JSON.parse(r.form_json) as PromptEntry; p._id = r.id; return [p]; }
      catch { return []; }
    });
    return _promptsCache;
  } catch {
    return [];
  }
}

export async function loadImages(): Promise<ImageEntry[]> {
  if (_imagesCache) return _imagesCache;
  try {
    const rows = await getImages();
    _imagesCache = rows.map((r) => ({
      id: r.id,
      url: `/api/images/${r.id}/file`,
      hld: r.hld,
      time: r.created_at ? new Date(r.created_at).toLocaleTimeString() : "",
      prompt_id: r.prompt_id,
    }));
    return _imagesCache;
  } catch {
    return [];
  }
}

export async function deletePrompt(promptId: number) {
  await deletePromptApi(promptId);
  if (_promptsCache) {
    _promptsCache = _promptsCache.filter((p) => p._id !== promptId);
  }
}
