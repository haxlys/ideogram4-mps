import { useCallback, useEffect, useRef } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { useGeneratePolling } from "@/hooks/useGeneratePolling";
import { submitGenerate, verifyCaption } from "@/api/client";
import { buildCaptionJson } from "@/validation/caption";
import { savePrompt, loadLastForm } from "@/state/storage";
import { CaptionEditor } from "@/components/CaptionEditor";
import { GenerationSettings } from "@/components/GenerationSettings";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Play, X, Download, ExternalLink } from "lucide-react";

export const Route = createFileRoute("/")({
  component: EditorPage,
});

function EditorPage() {
  const { state, dispatch } = useAppState();
  const { startPolling } = useGeneratePolling();

  useFormAutosave(state.form);

  useEffect(() => {
    const saved = loadLastForm();
    dispatch({ type: "RESTORE_FORM", form: saved });
  }, [dispatch]);

  const handleGenerate = useCallback(async () => {
    if (state.modelState !== "loaded") {
      toast.error("Model is not loaded. Please load the model first.");
      return;
    }

    const caption = buildCaptionJson(state.form);

    if (!state.form.rawJson.trim()) {
      try {
        const verifyRes = await verifyCaption(caption);
        if (!verifyRes.valid && verifyRes.warnings.length > 0) {
          const proceed = confirm(
            `Caption verification warnings:\n\n${verifyRes.warnings.join("\n")}\n\nProceed anyway?`,
          );
          if (!proceed) return;
        }
      } catch {
      }
    }

    savePrompt({
      ...state.form,
      hld: state.form.rawJson.trim() ? (caption.high_level_description || state.form.hld) : state.form.hld,
    }).then((promptId) => {
      dispatch({ type: "SET_GEN_STATUS", status: "submitting", msg: "Submitting…" });

      submitGenerate({
        caption,
        width: state.form.w,
        height: state.form.h,
        preset: state.form.preset,
        seed: Number(state.form.seed) || Math.floor(Math.random() * 2**32),
        prompt_id: promptId,
      }).then((res) => {
        dispatch({ type: "SET_GEN_STATUS", status: "running", msg: "Starting…", taskId: res.task_id });
        startPolling(res.task_id);
      }).catch((e) => {
        dispatch({ type: "SET_GEN_STATUS", status: "error", msg: String(e) });
      });
    }).catch((e) => {
      dispatch({ type: "SET_GEN_STATUS", status: "error", msg: String(e) });
    });
  }, [state, dispatch, startPolling]);

  const prevGenStatus = useRef(state.genStatus);

  useEffect(() => {
    if (prevGenStatus.current !== "done" && state.genStatus === "done") {
      toast.success("Image generated successfully", {
        description: "Scroll up to view the result.",
      });
    }
    prevGenStatus.current = state.genStatus;
  }, [state.genStatus]);

  const isGenerating = state.genStatus === "submitting" || state.genStatus === "running";
  const canGenerate = state.modelState === "loaded" && !isGenerating;
  const resultImage = state.resultImage;

  const handleDismissResult = () => {
    dispatch({ type: "SHOW_RESULT", entry: null });
    if (state.genStatus === "done") {
      dispatch({ type: "SET_GEN_STATUS", status: "idle" });
    }
  };

  const handleDownload = async () => {
    if (!resultImage) return;
    try {
      const res = await fetch(resultImage.url);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ideogram4-${resultImage.id}.png`;
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast.error("Failed to download image");
    }
  };

  return (
    <ScrollArea className="flex-1">
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <CaptionEditor />

          <div className="space-y-5">
            <GenerationSettings />

            <Button
              className="w-full h-12 text-[15px] font-semibold tracking-[-0.01em]"
              disabled={!canGenerate}
              onClick={handleGenerate}
            >
              {isGenerating ? (
                <Spinner className="mr-2 size-4" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {isGenerating ? "Generating…" : "Generate"}
            </Button>

            {resultImage && (
              <div className="rounded-xl border border-border bg-card overflow-hidden">
                <div className="flex items-center justify-between px-3 py-2 border-b border-border bg-muted/50">
                  <h2 className="text-[12px] font-semibold tracking-[-0.01em] text-foreground flex items-center gap-1.5">
                    <span className="size-1.5 rounded-full bg-emerald-500" />
                    Result
                  </h2>
                  <div className="flex items-center gap-0.5">
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Download"
                      onClick={handleDownload}
                    >
                      <Download className="size-3" />
                    </Button>
                    <Link
                      to="/gallery"
                      className="inline-flex items-center justify-center size-6 rounded-md hover:bg-muted transition-colors"
                      aria-label="View in gallery"
                    >
                      <ExternalLink className="size-3" />
                    </Link>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Dismiss"
                      onClick={handleDismissResult}
                    >
                      <X className="size-3" />
                    </Button>
                  </div>
                </div>
                <div className="p-3">
                  <img
                    src={resultImage.url}
                    alt={resultImage.hld?.slice(0, 100) ?? "Generated image"}
                    className="w-full rounded-lg object-contain bg-muted/30"
                  />
                  {resultImage.hld && (
                    <p className="mt-1.5 text-[11px] text-muted-foreground leading-relaxed">
                      {resultImage.hld}
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </ScrollArea>
  );
}
