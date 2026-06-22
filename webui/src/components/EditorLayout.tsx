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
    <ScrollArea className="flex-1">
      <div className="mx-auto max-w-7xl px-4 py-6 lg:py-8">
        <div className="sticky top-0 z-10 -mx-4 mb-6 flex justify-end border-b border-border/60 bg-background/90 px-4 py-3 backdrop-blur-md lg:static lg:z-auto lg:mx-0 lg:mb-6 lg:border-0 lg:bg-transparent lg:px-0 lg:py-0 lg:backdrop-blur-none">
          <GenerationActions className="w-full sm:w-auto" />
        </div>

        <div className="flex flex-col gap-6 md:flex-row md:items-start">
          <div className="min-w-0 flex-1 space-y-6">
            <GenerationSettings />
            <PromptSection />
          </div>

          <aside className="min-w-0 w-full md:w-[min(100%,380px)] md:shrink-0 md:sticky md:top-[var(--header-height)] md:max-h-[calc(100dvh-var(--header-height))] md:overflow-y-auto md:py-1">
            <ResultCanvas />
          </aside>
        </div>
      </div>
    </ScrollArea>
  );
}