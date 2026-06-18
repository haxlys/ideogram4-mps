import { useReducer, useRef, useCallback, useEffect, useState } from "react";
import { useAppState } from "@/state/context";
import { getMagicPromptStatus, magicPrompt } from "@/api/client";
import { aspectRatioFromSize } from "@/lib/aspectRatio";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { AlertCircle, Check, CheckCircle2, Copy, ImageIcon, Plus, Wand2, X } from "lucide-react";

interface MagicPromptStatus {
  enabled: boolean;
  configured: boolean;
  provider: string;
  model: string;
  base_url: string;
  auth_configured: boolean;
  managed_local_llama: boolean;
  missing_env: string[];
  llm_reachable: boolean;
  llm_error: string | null;
}

interface QuickPromptState {
  text: string;
  expanding: boolean;
  previews: string[];
  dragging: boolean;
  settings: {
    checked: boolean;
    status: MagicPromptStatus | null;
    error: string | null;
  };
}

type QuickPromptAction =
  | { type: "SET_TEXT"; text: string }
  | { type: "SET_EXPANDING"; expanding: boolean }
  | { type: "ADD_PREVIEWS"; previews: string[] }
  | { type: "REMOVE_PREVIEW"; index: number }
  | { type: "CLEAR_PREVIEWS" }
  | { type: "SET_DRAGGING"; dragging: boolean }
  | { type: "SET_SETTINGS"; settings: QuickPromptState["settings"] };

const initialQuickPromptState: QuickPromptState = {
  text: "",
  expanding: false,
  previews: [],
  dragging: false,
  settings: { checked: false, status: null, error: null },
};

function quickPromptReducer(state: QuickPromptState, action: QuickPromptAction): QuickPromptState {
  switch (action.type) {
    case "SET_TEXT":
      return { ...state, text: action.text };
    case "SET_EXPANDING":
      return { ...state, expanding: action.expanding };
    case "ADD_PREVIEWS":
      return { ...state, previews: [...state.previews, ...action.previews] };
    case "REMOVE_PREVIEW":
      return { ...state, previews: state.previews.filter((_, i) => i !== action.index) };
    case "CLEAR_PREVIEWS":
      return { ...state, previews: [] };
    case "SET_DRAGGING":
      return { ...state, dragging: action.dragging };
    case "SET_SETTINGS":
      return { ...state, settings: action.settings };
  }
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function QuickPrompt() {
  const { state: appState, dispatch } = useAppState();
  const [quickState, quickDispatch] = useReducer(quickPromptReducer, initialQuickPromptState);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<File[]>([]);
  const status = quickState.settings.status;
  const targetAspectRatio = aspectRatioFromSize(appState.form.w, appState.form.h);
  const canUseMagicPrompt = Boolean(
    status?.configured ||
    (quickState.settings.checked && !quickState.settings.error && !status),
  );

  useEffect(() => {
    let cancelled = false;
    getMagicPromptStatus()
      .then((res) => {
        if (!cancelled) {
          quickDispatch({ type: "SET_SETTINGS", settings: { checked: true, status: res, error: null } });
        }
      })
      .catch((e) => {
        if (!cancelled) {
          quickDispatch({
            type: "SET_SETTINGS",
            settings: { checked: true, status: null, error: e instanceof Error ? e.message : String(e) },
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const addFiles = useCallback((files: FileList | File[]) => {
    const newFiles = Array.from(files).filter((f) => f.type.startsWith("image/"));
    if (newFiles.length === 0) return;
    imagesRef.current = [...imagesRef.current, ...newFiles];
    quickDispatch({ type: "ADD_PREVIEWS", previews: newFiles.map((f) => URL.createObjectURL(f)) });
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    quickDispatch({ type: "SET_DRAGGING", dragging: false });
    addFiles(e.dataTransfer.files);
  }, [addFiles]);

  const removeImage = useCallback((index: number) => {
    imagesRef.current = imagesRef.current.filter((_, i) => i !== index);
    URL.revokeObjectURL(quickState.previews[index]);
    quickDispatch({ type: "REMOVE_PREVIEW", index });
  }, [quickState.previews]);

  const clearAttachedImages = useCallback(() => {
    quickState.previews.forEach((src) => URL.revokeObjectURL(src));
    imagesRef.current = [];
    quickDispatch({ type: "CLEAR_PREVIEWS" });
  }, [quickState.previews]);

  const generatedJson = appState.form.rawJson.trim() || '{\n  "high_level_description": ""\n}';

  const handleCopyJson = async () => {
    try {
      await navigator.clipboard.writeText(generatedJson);
      setCopied(true);
      toast.success("Copied JSON to clipboard");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy JSON");
    }
  };

  const handleExpand = async () => {
    const trimmed = quickState.text.trim();
    const images = imagesRef.current;
    if (!trimmed && images.length === 0) {
      toast.error("Please enter a prompt or attach an image");
      return;
    }
    if (status && !status.enabled) {
      toast.error("Magic Prompt is disabled. Configure IDEOGRAM4_MAGIC_PROMPT_* to enable it.");
      return;
    }
    if (status && !status.configured) {
      const reason = status.missing_env.length > 0
        ? status.missing_env.join(", ")
        : status.llm_error ?? "LLM is not reachable";
      toast.error(`Magic Prompt is not configured: ${reason}`);
      return;
    }
    quickDispatch({ type: "SET_EXPANDING", expanding: true });
    try {
      const b64s = images.length > 0 ? await Promise.all(images.map(fileToBase64)) : null;
      const res = await magicPrompt(trimmed || "Describe this image in detail.", appState.form.w, appState.form.h, b64s);
      dispatch({
        type: "SET_FORM",
        form: { rawJson: JSON.stringify(res.caption, null, 2) },
      });
      clearAttachedImages();
      toast.success(`Expanded with ${res.model}`);
    } catch (e) {
      toast.error(`Failed to expand prompt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      quickDispatch({ type: "SET_EXPANDING", expanding: false });
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-lg border border-border bg-muted/25 p-3">
        <div className="flex items-start gap-2">
          {canUseMagicPrompt ? (
            <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-foreground" />
          ) : (
            <AlertCircle className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 space-y-1">
            <p className="text-[13px] leading-5 text-foreground">
              Quick Prompt uses an LLM to turn natural language and optional image references into Ideogram 4 JSON.
            </p>
            {status ? (
              <p className="text-[12px] leading-5 text-muted-foreground">
                {!status.enabled
                  ? "Magic Prompt disabled. Configure IDEOGRAM4_MAGIC_PROMPT_* to enable natural-language expansion."
                  : status.configured
                  ? `Configured: ${status.provider} / ${status.model}`
                  : status.missing_env.length > 0
                    ? `Missing environment: ${status.missing_env.join(", ")}`
                    : `LLM unreachable: ${status.llm_error ?? "health check failed"}`}
              </p>
            ) : (
              <p className="text-[12px] leading-5 text-muted-foreground">
                {quickState.settings.error
                  ? `Could not read Magic Prompt settings: ${quickState.settings.error}`
                  : quickState.settings.checked
                    ? "Using the configured Magic Prompt provider."
                    : "Checking Magic Prompt settings..."}
              </p>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <p className="text-[13px] font-medium">Quick Prompt</p>
            <Textarea
              placeholder="Describe your image in natural language... e.g. a Korean woman in hanbok drinking tea in an autumn garden"
              value={quickState.text}
              onChange={(e) => quickDispatch({ type: "SET_TEXT", text: e.target.value })}
              className="min-h-[138px] resize-y"
              disabled={quickState.expanding}
            />
          </div>

          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            aria-label="Attach image references"
            onChange={(e) => addFiles(e.target.files ?? [])}
          />

          {quickState.previews.length > 0 ? (
            <div className="space-y-2">
              <div className="flex gap-2 overflow-x-auto pb-1">
                {[...quickState.previews].reverse().map((src, i) => (
                  <div key={src} className="relative h-20 w-28 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                    <img src={src} alt={`Attached ${quickState.previews.length - i}`} className="h-full w-full object-contain" />
                    <button
                      type="button"
                      className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full bg-background/80 backdrop-blur-sm transition-colors hover:bg-background"
                      onClick={() => removeImage(quickState.previews.length - 1 - i)}
                      disabled={quickState.expanding}
                      aria-label={`Remove attached image ${quickState.previews.length - i}`}
                    >
                      <X className="size-2.5" />
                    </button>
                  </div>
                ))}
              </div>
              <button
                type="button"
                className="flex w-full items-center justify-center gap-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-[12px] text-muted-foreground transition-colors hover:border-foreground/50 hover:text-foreground"
                onClick={() => fileRef.current?.click()}
                disabled={quickState.expanding}
              >
                <Plus className="size-3" />
                Add more images
              </button>
            </div>
          ) : (
            <button
              type="button"
              className={"w-full cursor-pointer rounded-lg border-2 border-dashed px-4 py-5 text-center transition-colors " + (quickState.dragging ? "border-foreground bg-muted" : "border-border hover:border-foreground/50")}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => { e.preventDefault(); quickDispatch({ type: "SET_DRAGGING", dragging: true }); }}
              onDragLeave={() => quickDispatch({ type: "SET_DRAGGING", dragging: false })}
              onDrop={handleDrop}
              disabled={quickState.expanding}
            >
              <ImageIcon className="mx-auto mb-1.5 size-5 text-muted-foreground" />
              <p className="text-[12px] text-muted-foreground">
                Drop images or click to attach
              </p>
            </button>
          )}

          <p className="text-[12px] leading-5 text-muted-foreground">
            Target aspect ratio: {targetAspectRatio} ({appState.form.w}×{appState.form.h} from Generation Settings)
          </p>

          <Button
            variant="secondary"
            className="w-full"
            onClick={handleExpand}
            disabled={quickState.expanding || Boolean(status && !status.configured)}
          >
            {quickState.expanding ? (
              <Spinner className="mr-2 size-4" />
            ) : (
              <Wand2 className="mr-2 size-4" />
            )}
            {quickState.expanding ? "Expanding..." : "Expand to JSON"}
          </Button>
        </div>

        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[13px] font-medium">Generated JSON</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleCopyJson}
              aria-label="Copy generated JSON"
            >
              {copied ? (
                <>
                  <Check className="mr-1 size-3.5" />
                  Copied
                </>
              ) : (
                <>
                  <Copy className="mr-1 size-3.5" />
                  Copy
                </>
              )}
            </Button>
          </div>
          <section
            aria-label="Generated JSON view"
            className="max-h-[460px] min-h-[260px] overflow-auto rounded-lg border border-input bg-muted/20 p-3"
          >
            <pre className="whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-foreground">
              {generatedJson}
            </pre>
          </section>
        </div>
      </div>
    </div>
  );
}
