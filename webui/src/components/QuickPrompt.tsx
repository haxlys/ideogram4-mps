import { useReducer, useRef, useCallback, useEffect, useState } from "react";
import { useAppState } from "@/state/context";
import { getMagicPromptStatus } from "@/api/client";
import { useEnqueueGeneration } from "@/hooks/useEnqueueGeneration";
import { hasSubstantiveCaptionJson, magicPromptBlockingReason } from "@/lib/quickPromptFlow";
import { aspectRatioFromSize } from "@/lib/aspectRatio";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { QuickPromptExamples } from "@/components/QuickPromptExamples";
import { QuickPromptJsonPanel } from "@/components/QuickPromptJsonPanel";
import { QuickPromptReferences } from "@/components/QuickPromptReferences";
import { toast } from "sonner";
import { Play, Wand2 } from "lucide-react";

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
  | { type: "ADD_PREVIEWS"; previews: string[] }
  | { type: "REMOVE_PREVIEW"; index: number }
  | { type: "CLEAR_PREVIEWS" }
  | { type: "SET_DRAGGING"; dragging: boolean }
  | { type: "SET_SETTINGS"; settings: QuickPromptState["settings"] };

const initialQuickPromptState: QuickPromptState = {
  text: "",
  previews: [],
  dragging: false,
  settings: { checked: false, status: null, error: null },
};

const PROMPT_SUGGESTIONS = [
  "A candid medium shot of a woman in hanbok drinking tea in an autumn garden",
  "Minimalist product photo of a ceramic mug on a marble surface, soft window light",
  "Editorial portrait of a jazz musician on stage, dramatic rim lighting, film grain",
  "Flat lay of design tools on a warm wooden desk, overhead view, muted palette",
] as const;

function quickPromptReducer(state: QuickPromptState, action: QuickPromptAction): QuickPromptState {
  switch (action.type) {
    case "SET_TEXT":
      return { ...state, text: action.text };
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
      const result = reader.result;
      if (typeof result !== "string") {
        reject(new Error("Failed to read file"));
        return;
      }
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}


function magicStatusHint(status: MagicPromptStatus | null, settingsError: string | null, checked: boolean): string | null {
  if (!checked) return null;
  if (settingsError) return "LLM settings unavailable";
  if (!status) return null;
  if (!status.enabled) return "Magic Prompt disabled in server config";
  if (!status.configured) {
    if (status.missing_env.length > 0) return `Missing: ${status.missing_env.join(", ")}`;
    return status.llm_error ?? "LLM unreachable";
  }
  return null;
}

export function QuickPrompt() {
  const { state: appState, dispatch } = useAppState();
  const { enqueue, canGenerate } = useEnqueueGeneration();
  const [quickState, quickDispatch] = useReducer(quickPromptReducer, initialQuickPromptState);
  const [copied, setCopied] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const imagesRef = useRef<File[]>([]);
  const status = quickState.settings.status;
  const expanding = appState.magicExpand.status === "running";
  const expandThenGenerate = appState.magicExpand.pending?.enqueueAfter === true;
  const targetAspectRatio = aspectRatioFromSize(appState.form.w, appState.form.h);
  const quickTrimmed = quickState.text.trim();
  const hasQuickInput = quickTrimmed.length > 0 || quickState.previews.length > 0;
  const hasReadyJson = hasSubstantiveCaptionJson(appState.form.rawJson);
  const magicBlocked = magicPromptBlockingReason(status);
  const generateNeedsLlm = hasQuickInput && !hasReadyJson;
  const statusProblem = magicStatusHint(status, quickState.settings.error, quickState.settings.checked);
  const showExamples = quickTrimmed.length === 0;

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
      toast.success("Copied JSON");
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy JSON");
    }
  };

  const startMagicExpand = async (enqueueAfter: boolean) => {
    const trimmed = quickState.text.trim();
    const images = imagesRef.current;
    if (!trimmed && images.length === 0) {
      toast.error("Enter a prompt or attach a reference image");
      return;
    }
    const blockReason = magicPromptBlockingReason(status);
    if (blockReason) {
      toast.error(blockReason);
      return;
    }
    if (expanding) {
      toast.message(
        enqueueAfter
          ? "Already structuring — generation will queue when the LLM finishes."
          : "Already expanding — you can leave this page; we will notify you when done.",
      );
      return;
    }

    try {
      const b64s = images.length > 0 ? await Promise.all(images.map(fileToBase64)) : null;
      dispatch({
        type: "MAGIC_EXPAND_START",
        payload: {
          prompt: trimmed || "Describe this image in detail.",
          width: appState.form.w,
          height: appState.form.h,
          imagesB64: b64s,
          enqueueAfter,
        },
      });
      clearAttachedImages();
      toast.message(
        enqueueAfter
          ? "Structuring with LLM, then queueing generation…"
          : "Expanding… You can browse other pages.",
        { duration: 6000 },
      );
    } catch (e) {
      toast.error(`Failed to start expansion: ${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const handleExpand = () => {
    void startMagicExpand(false);
  };

  const handleGenerate = () => {
    if (!canGenerate) return;
    if (hasReadyJson) {
      void enqueue({
        historyLink: "new",
        newSeed: true,
        skipVerify: true,
      });
      return;
    }
    if (hasQuickInput) {
      void startMagicExpand(true);
      return;
    }
    toast.error("Describe your image, or expand / add structured JSON first");
  };

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card/50 p-3 shadow-card sm:p-4">
      {statusProblem && (
        <p className="text-caption leading-snug text-destructive">{statusProblem}</p>
      )}

      <Textarea
        placeholder="Describe the image in plain language…"
        value={quickState.text}
        onChange={(e) => quickDispatch({ type: "SET_TEXT", text: e.target.value })}
        className="min-h-[112px] resize-y border-0 bg-muted/40 px-3 py-2.5 text-body leading-relaxed shadow-none focus-visible:ring-2"
        disabled={expanding}
      />

      {expanding && (
        <p className="flex items-center gap-2 text-caption text-muted-foreground">
          <Spinner className="size-3.5 shrink-0" />
          {expandThenGenerate
            ? "Structuring with LLM, then queueing generation…"
            : "Expanding with LLM — safe to leave; we will notify you."}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {showExamples && (
          <QuickPromptExamples
            suggestions={PROMPT_SUGGESTIONS}
            disabled={expanding}
            onSelect={(suggestion) => quickDispatch({ type: "SET_TEXT", text: suggestion })}
          />
        )}

        <QuickPromptReferences
          fileRef={fileRef}
          previews={quickState.previews}
          dragging={quickState.dragging}
          expanding={expanding}
          onAddFiles={addFiles}
          onRemoveImage={removeImage}
          onDrop={handleDrop}
          onDraggingChange={(dragging) => quickDispatch({ type: "SET_DRAGGING", dragging })}
        />
      </div>

      <div className="flex flex-col gap-2 border-t border-border/60 pt-3 sm:flex-row sm:items-center">
        <p className="text-caption text-muted-foreground sm:mr-auto">
          {targetAspectRatio} · {appState.form.w}×{appState.form.h}
          {status?.configured ? ` · ${status.model}` : null}
        </p>
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={handleExpand}
            disabled={expanding || Boolean(status && !status.configured)}
          >
            {expanding ? <Spinner className="mr-1.5 size-3.5" /> : <Wand2 className="mr-1.5 size-3.5" />}
            {expanding ? "Expanding…" : "Expand"}
          </Button>
          <Button
            variant="generate"
            size="sm"
            className="flex-1 sm:flex-none"
            onClick={handleGenerate}
            disabled={
              !canGenerate
              || expanding
              || (generateNeedsLlm && Boolean(magicBlocked))
              || (!hasReadyJson && !hasQuickInput)
            }
            title={
              !canGenerate
                ? "Load the image model first"
                : expanding
                  ? "Wait for the LLM to finish"
                  : generateNeedsLlm && magicBlocked
                    ? magicBlocked
                    : !hasReadyJson && !hasQuickInput
                      ? "Enter a description or add JSON in the JSON tab"
                      : generateNeedsLlm
                        ? "Runs Magic Prompt LLM, then queues generation"
                        : undefined
            }
          >
            <Play className="mr-1.5 size-3.5" />
            Generate
          </Button>
        </div>
      </div>

      <QuickPromptJsonPanel
        generatedJson={generatedJson}
        ready={hasReadyJson}
        copied={copied}
        onCopy={() => void handleCopyJson()}
      />
    </div>
  );
}
