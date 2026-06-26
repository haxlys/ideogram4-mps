import { useEnqueueGeneration } from "@/hooks/useEnqueueGeneration";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ListPlus, Play, Plus, RefreshCw } from "lucide-react";

interface GenerationActionsProps {
  className?: string;
}

export function GenerationActions({ className }: GenerationActionsProps) {
  const { enqueue, canGenerate, hasPendingJobs, hasActiveHistory } = useEnqueueGeneration();

  if (!hasActiveHistory) {
    return (
      <div className={cn("flex items-center justify-end", className)}>
        <Button
          variant="generate"
          size="lg"
          className="h-11 min-w-[10rem] flex-1 px-6 text-body-sm font-semibold tracking-[-0.01em] sm:flex-none"
          disabled={!canGenerate}
          onClick={() => void enqueue({ historyLink: "new" })}
        >
          {hasPendingJobs ? (
            <ListPlus className="mr-2 size-4" />
          ) : (
            <Play className="mr-2 size-4" />
          )}
          {hasPendingJobs ? "Add to Queue" : "Generate"}
        </Button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex flex-row flex-wrap items-center justify-end gap-2">
        <Button
          variant="generate"
          size="lg"
          className="h-11 min-w-0 flex-1 px-3 text-body-sm font-semibold tracking-[-0.01em] sm:min-w-[10rem] sm:flex-none sm:px-4"
          disabled={!canGenerate}
          onClick={() => void enqueue({ historyLink: "regenerate", newSeed: true })}
        >
          {hasPendingJobs ? (
            <ListPlus className="mr-2 size-4 shrink-0" />
          ) : (
            <RefreshCw className="mr-2 size-4 shrink-0" />
          )}
          <span className="truncate">{hasPendingJobs ? "Queue Regen" : "Regenerate"}</span>
        </Button>
        <Button
          variant="outline"
          className="h-11 min-w-0 flex-1 px-3 text-body-sm font-medium sm:h-10 sm:flex-none sm:px-4"
          disabled={!canGenerate}
          onClick={() => void enqueue({ historyLink: "new", newSeed: true })}
        >
          {hasPendingJobs ? (
            <ListPlus className="mr-2 size-4 shrink-0" />
          ) : (
            <Plus className="mr-2 size-4 shrink-0" />
          )}
          <span className="truncate">{hasPendingJobs ? "Queue New" : "New Entry"}</span>
        </Button>
      </div>
      <p className="text-center text-[11px] leading-snug text-muted-foreground/75 lg:text-right">
        New seed regeneration or save as a new entry
      </p>
    </div>
  );
}