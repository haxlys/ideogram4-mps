import { useCallback, useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { useEnqueueGeneration } from "@/hooks/useEnqueueGeneration";
import { getImages } from "@/api/client";
import { loadPromptHistory } from "@/state/storage";
import { CaptionEditor } from "@/components/CaptionEditor";
import { GenerationSettings } from "@/components/GenerationSettings";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { toast } from "sonner";
import { Play, ListPlus, X, Download } from "lucide-react";

export const Route = createFileRoute("/history/$promptId")({
  component: HistoryPage,
});

function HistoryPage() {
  const { promptId } = Route.useParams();
  const { state, dispatch } = useAppState();
  const { enqueue, canGenerate, hasPendingJobs, buttonLabel } = useEnqueueGeneration();

  useFormAutosave(state.form);

  useEffect(() => {
    const id = Number(promptId);
    if (!id) return;
    dispatch({ type: "SHOW_RESULT", entry: null });
    loadPromptHistory().then((entries) => {
      const entry = entries.find((e) => e._id === id);
      if (!entry) {
        toast.error("Prompt not found");
        return;
      }
      const { _savedAt: _savedAtValue, _id, ...form } = entry;
      void _savedAtValue;
      dispatch({ type: "RESTORE_FORM", form, promptId: _id ?? undefined });
      getImages(_id!).then((images) => {
        if (images.length > 0) {
          const img = images[0];
          dispatch({
            type: "SHOW_RESULT",
            entry: {
              id: img.id,
              url: `/api/images/${img.id}/file`,
              hld: img.hld,
              time: img.created_at ? new Date(img.created_at).toLocaleTimeString() : "",
              prompt_id: _id,
            },
          });
        }
      }).catch(() => {
        // Missing images should not prevent restoring the prompt.
      });
    });
  }, [promptId, dispatch]);

  const resultImage = state.resultImage;

  const handleDismissResult = () => {
    dispatch({ type: "SHOW_RESULT", entry: null });
  };

  const handleDownload = useCallback(async () => {
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
  }, [resultImage]);

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
              onClick={() => void enqueue()}
            >
              {hasPendingJobs ? (
                <ListPlus className="mr-2 size-4" />
              ) : (
                <Play className="mr-2 size-4" />
              )}
              {buttonLabel}
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