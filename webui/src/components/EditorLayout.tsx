import { useAppState } from "@/state/context";
import { useFormAutosave } from "@/hooks/useFormAutosave";
import { GenerationActions } from "@/components/GenerationActions";
import { GenerationSettings } from "@/components/GenerationSettings";
import { PromptSection } from "@/components/PromptSection";
import { ResultCanvas } from "@/components/ResultCanvas";
import { ScrollArea } from "@/components/ui/scroll-area";

export function EditorLayout() {
  const { state } = useAppState();

  useFormAutosave(state.form);

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <ScrollArea className="flex-1">
        <div className="mx-auto max-w-7xl px-4 py-5 pb-24 md:py-7 md:pb-8 lg:pb-8">
          <div className="mb-5 hidden items-center justify-between gap-4 lg:flex">
            <div>
              <h2 className="text-title font-semibold tracking-[-0.02em] text-foreground">
                Create
              </h2>
              <p className="mt-0.5 text-body-sm text-muted-foreground">
                Describe your image, tune settings, then generate
              </p>
            </div>
            <GenerationActions />
          </div>

          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <div className="min-w-0 flex-1 space-y-5">
              <PromptSection />
              <GenerationSettings />
            </div>

            <aside className="min-w-0 w-full md:w-[min(100%,400px)] md:shrink-0 md:sticky md:top-[calc(var(--header-height)+1rem)] md:max-h-[calc(100dvh-var(--header-height)-2rem)] md:overflow-y-auto">
              <ResultCanvas />
            </aside>
          </div>
        </div>
      </ScrollArea>

      <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40 border-t border-border/70 bg-background/92 px-4 py-3 shadow-elevated backdrop-blur-md lg:hidden">
        <div className="pointer-events-auto mx-auto max-w-7xl">
          <GenerationActions className="w-full" />
        </div>
      </div>
    </div>
  );
}