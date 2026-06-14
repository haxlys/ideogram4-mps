interface ModelStatusResponse {
  state: "idle" | "loading" | "loaded";
}

interface LoadResponse {
  ok: boolean;
  msg?: string;
}

interface GenerateRequest {
  caption: object;
  width: number;
  height: number;
  preset: string;
  seed: number;
  format: string;
  prompt_id?: number | null;
}

interface GenerateResponse {
  task_id: string;
}

interface TaskImage {
  id: number;
  url: string;
  hld: string;
  time: string;
  prompt_id?: number | null;
}

interface TaskStatusResponse {
  state: "running" | "done";
  msg?: string;
  image?: TaskImage | null;
  progress?: number;
  total_steps?: number;
}

interface VerifyResponse {
  valid: boolean;
  warnings: string[];
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, options);
  if (!res.ok) {
    let msg = `HTTP ${res.status}: ${res.statusText}`;
    try {
      const body = await res.json();
      if (body.error) msg = body.error;
    } catch {
      // Keep the generic HTTP message if the response is not JSON.
    }
    throw new Error(msg);
  }
  return res.json();
}

export async function getModelStatus() {
  return request<ModelStatusResponse>("/api/model/status");
}

export async function loadModel() {
  return request<LoadResponse>("/api/model/load", { method: "POST" });
}

export async function unloadModel() {
  return request<LoadResponse>("/api/model/unload", { method: "POST" });
}

export async function submitGenerate(data: GenerateRequest) {
  return request<GenerateResponse>("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

export async function getTaskStatus(taskId: string) {
  return request<TaskStatusResponse>(`/api/status/${taskId}`);
}

export async function verifyCaption(caption: object) {
  return request<VerifyResponse>("/api/verify", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ caption }),
  });
}

interface MagicPromptResponse {
  caption: object;
  model: string;
}

export async function magicPrompt(prompt: string, width: number, height: number, imagesB64?: string[] | null) {
  return request<MagicPromptResponse>("/api/magic-prompt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ prompt, width, height, images_b64: imagesB64 }),
  });
}

interface ImageRow { id: number; created_at: string; hld: string; width: number; height: number; preset: string; seed: number; file_path: string; prompt_id?: number | null; }
interface PromptRow { id: number; saved_at: string; hld: string; form_json: string; }

export async function getImages(promptId?: number) { return request<ImageRow[]>(`/api/images${promptId != null ? `?prompt_id=${promptId}` : ''}`); }
export async function getPrompts() { return request<PromptRow[]>('/api/prompts'); }
export async function savePromptApi(hld: string, formJson: string) { return request<{id:number}>('/api/prompts', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({hld, form_json: formJson}) }); }
export async function deletePromptApi(promptId: number) { return request<{ok:boolean}>(`/api/prompts/${promptId}`, { method: 'DELETE' }); }
export async function saveLastFormApi(formJson: string) { return request<{ok:boolean}>('/api/form', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({form_json: formJson}) }); }

interface LoraEntry { name: string; path: string; format: string; size_mb: number; }
interface LoraStatus { applied: string | null; strength: number; available: LoraEntry[]; }

export async function getLoraStatus() { return request<LoraStatus>('/api/lora/status'); }
export async function applyLora(name: string, strength: number) { return request<{ok: boolean; msg: string}>('/api/lora/apply', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({name, strength}) }); }
export async function removeLora() { return request<{ok: boolean; msg: string}>('/api/lora/remove', { method: 'POST' }); }
