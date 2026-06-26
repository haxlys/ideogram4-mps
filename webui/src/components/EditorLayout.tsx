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
        <div className="mx-auto max-w-7xl px-4 pt-3 pb-24 md:pb-24 md:pt-4 lg:pb-8 lg:pt-3">

          <div className="flex flex-col gap-5 md:flex-row md:items-start md:gap-6">
            <div className="min-w-0 flex-1 space-y-5">
              <PromptSection />
              <GenerationSettings />
            </div>

            <aside className="min-w-0 w-full md:sticky md:top-3 md:flex md:max-h-[calc(100dvh-var(--header-height)-1.5rem)] md:min-h-0 md:w-[min(100%,400px)] md:shrink-0 md:self-start md:flex-col md:gap-3">
              <ResultCanvas />
              <div className="hidden lg:block">
                <GenerationActions className="w-full [&>div:first-child]:flex-col [&>div:first-child]:sm:flex-row [&>div:first-child]:gap-2 [&_button]:min-w-0 [&_button]:flex-1" />
              </div>
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
