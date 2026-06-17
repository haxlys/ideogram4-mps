import { useEffect } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { useEnqueueGeneration } from "@/hooks/useEnqueueGeneration";
import { loadLastForm } from "@/state/storage";
import { CaptionEditor } from "@/components/CaptionEditor";
import { GenerationSettings } from "@/components/GenerationSettings";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Play, ListPlus } from "lucide-react";

export const Route = createFileRoute("/")({
  component: EditorPage,
});

function EditorPage() {
  const { state, dispatch } = useAppState();
  const { enqueue, canGenerate, hasPendingJobs, buttonLabel } = useEnqueueGeneration();

  useFormAutosave(state.form);

  useEffect(() => {
    const saved = loadLastForm();
    dispatch({ type: "RESTORE_FORM", form: saved });
  }, [dispatch]);

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
          </div>
        </div>
      </main>
    </ScrollArea>
  );
}