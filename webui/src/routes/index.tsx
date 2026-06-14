import { useCallback, useEffect } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { useGeneratePolling } from "@/hooks/useGeneratePolling";
import { submitGenerate, verifyCaption } from "@/api/client";
import { getCaptionForGeneration, getCaptionHld } from "@/validation/caption";
import { savePrompt, loadLastForm } from "@/state/storage";
import { CaptionEditor } from "@/components/CaptionEditor";
import { GenerationSettings } from "@/components/GenerationSettings";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Play } from "lucide-react";

export const Route = createFileRoute("/")({
  component: EditorPage,
});

function EditorPage() {
  const { state, dispatch } = useAppState();
  const { startPolling } = useGeneratePolling();
  const navigate = useNavigate();

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

    let caption: Record<string, unknown>;
    try {
      caption = getCaptionForGeneration(state.form);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Raw JSON is invalid.");
      return;
    }

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
        // Verification is best-effort; generation can still proceed.
      }
    }

    savePrompt({
      ...state.form,
      hld: getCaptionHld(caption, state.form.hld),
    }).then((promptId) => {
      dispatch({ type: "REFRESH_HISTORY" });
      dispatch({ type: "SET_GEN_STATUS", status: "submitting", msg: "Submitting…" });

      submitGenerate({
        caption,
        width: state.form.w,
        height: state.form.h,
        preset: state.form.preset,
        seed: Number(state.form.seed) || Math.floor(Math.random() * 2**32),
        format: state.form.format,
        prompt_id: promptId,
      }).then((res) => {
        dispatch({ type: "SET_GEN_STATUS", status: "running", msg: "Starting…", taskId: res.task_id });
        startPolling(res.task_id);
        navigate({ to: "/history/$promptId", params: { promptId: String(promptId) } });
      }).catch((e) => {
        dispatch({ type: "SET_GEN_STATUS", status: "error", msg: String(e) });
      });
    }).catch((e) => {
      dispatch({ type: "SET_GEN_STATUS", status: "error", msg: String(e) });
    });
  }, [state, dispatch, startPolling, navigate]);

  const isGenerating = state.genStatus === "submitting" || state.genStatus === "running";
  const canGenerate = state.modelState === "loaded" && !isGenerating;

  return (
    <ScrollArea className="flex-1">
      <main className="mx-auto max-w-5xl px-4 py-8">
        <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
          <CaptionEditor />

          <div className="sticky top-[53px] max-h-[calc(100dvh-53px)] overflow-y-auto space-y-5 py-8 px-1">
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
          </div>
        </div>
      </main>
    </ScrollArea>
  );
}
