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
    <div className={cn("flex flex-col items-end gap-2 sm:flex-row sm:items-center", className)}>
      <p className="hidden text-caption text-muted-foreground lg:block lg:mr-1">
        New seed regeneration or save as a new entry
      </p>
      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button
          variant="generate"
          size="lg"
          className="h-11 min-w-[10rem] px-4 text-body-sm font-semibold tracking-[-0.01em]"
          disabled={!canGenerate}
          onClick={() => void enqueue({ historyLink: "regenerate", newSeed: true })}
        >
          {hasPendingJobs ? (
            <ListPlus className="mr-2 size-4" />
          ) : (
            <RefreshCw className="mr-2 size-4" />
          )}
          {hasPendingJobs ? "Queue Regeneration" : "Regenerate"}
        </Button>
        <Button
          variant="outline"
          className="h-10 px-4 text-body-sm font-medium"
          disabled={!canGenerate}
          onClick={() => void enqueue({ historyLink: "new", newSeed: true })}
        >
          {hasPendingJobs ? (
            <ListPlus className="mr-2 size-4" />
          ) : (
            <Plus className="mr-2 size-4" />
          )}
          {hasPendingJobs ? "Queue as New Entry" : "Save as New Entry"}
        </Button>
      </div>
    </div>
  );
}