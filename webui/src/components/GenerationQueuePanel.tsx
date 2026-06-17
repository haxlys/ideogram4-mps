import { Link } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useQueueManagement } from "@/hooks/useQueueManagement";
import type { GenJob, GenJobStatus } from "@/state/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Spinner } from "@/components/ui/spinner";
import {
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Ban,
} from "lucide-react";

const STATUS_LABELS: Record<GenJobStatus, string> = {
  queued: "Queued",
  submitting: "Submitting",
  running: "Running",
  cancelling: "Cancelling",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

function statusVariant(status: GenJobStatus): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error") return "destructive";
  if (status === "cancelled") return "outline";
  if (status === "done") return "secondary";
  if (status === "running" || status === "submitting" || status === "cancelling") return "default";
  return "outline";
}

function JobRow({
  job,
  onCancel,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
}: {
  job: GenJob;
  onCancel: (job: GenJob) => void;
  onMoveUp: (jobId: string) => void;
  onMoveDown: (jobId: string) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
}) {
  const showProgress =
    job.status === "running" || job.status === "submitting" || job.status === "cancelling";
  const canCancel =
    job.status === "queued"
    || job.status === "submitting"
    || job.status === "running"
    || job.status === "cancelling";

  return (
    <div className="flex items-start gap-2 px-4 py-2.5 border-b border-border/60 last:border-b-0">
      {job.status === "queued" && (
        <div className="flex flex-col gap-0.5 shrink-0 pt-0.5">
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Move up"
            disabled={!canMoveUp}
            onClick={() => onMoveUp(job.id)}
          >
            <ArrowUp className="size-3" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-6"
            aria-label="Move down"
            disabled={!canMoveDown}
            onClick={() => onMoveDown(job.id)}
          >
            <ArrowDown className="size-3" />
          </Button>
        </div>
      )}

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-center gap-2 min-w-0">
          <Badge variant={statusVariant(job.status)} className="shrink-0 text-[10px] px-1.5 py-0">
            {STATUS_LABELS[job.status]}
          </Badge>
          <span className="text-xs font-medium truncate">{job.label}</span>
        </div>
        <p className="text-[11px] text-muted-foreground truncate">{job.msg}</p>
        {showProgress && (
          <div className="space-y-1">
            <Progress value={job.progress > 0 ? job.progress : null} className="h-1" />
            {job.progress > 0 && (
              <div className="text-right text-[10px] text-muted-foreground tabular-nums">
                {job.progress}%
              </div>
            )}
          </div>
        )}
        {job.status === "error" && job.error && (
          <p className="text-[11px] text-destructive truncate">{job.error}</p>
        )}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {job.status === "done" && (
          <Link
            to="/history/$promptId"
            params={{ promptId: String(job.promptId) }}
            aria-label="View result"
            className="inline-flex items-center justify-center size-8 rounded-md text-foreground hover:bg-muted transition-colors"
          >
            <ExternalLink className="size-3.5" />
          </Link>
        )}
        {(canCancel || job.status === "error" || job.status === "cancelled") && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={
              job.status === "queued"
                ? "Remove from queue"
                : job.status === "error" || job.status === "cancelled"
                  ? "Dismiss"
                  : "Cancel generation"
            }
            onClick={() => void onCancel(job)}
          >
            <X className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

export function GenerationQueuePanel() {
  const { state, dispatch } = useAppState();
  const {
    cancelJob,
    moveJobUp,
    moveJobDown,
    clearQueued,
    clearFinished,
    cancelActive,
    canMoveUp,
    canMoveDown,
  } = useQueueManagement();
  const { genQueue, genQueueExpanded } = state;

  if (genQueue.length === 0) return null;

  const activeJob = genQueue.find(
    (job) => job.status === "running" || job.status === "submitting" || job.status === "cancelling",
  );
  const queuedCount = genQueue.filter((job) => job.status === "queued").length;
  const finishedCount = genQueue.filter(
    (job) => job.status === "done" || job.status === "error" || job.status === "cancelled",
  ).length;

  return (
    <div className="shrink-0 border-t border-border bg-background/95 backdrop-blur-sm">
      <button
        type="button"
        className="flex w-full items-center gap-3 px-4 h-11 text-left hover:bg-muted/40 transition-colors"
        onClick={() =>
          dispatch({ type: "SET_QUEUE_EXPANDED", expanded: !genQueueExpanded })
        }
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {(activeJob?.status === "running"
            || activeJob?.status === "submitting"
            || activeJob?.status === "cancelling") && (
            <Spinner className="size-3.5 shrink-0" />
          )}
          <span className="text-xs font-medium truncate">
            {activeJob
              ? activeJob.label
              : `${genQueue.length} generation${genQueue.length === 1 ? "" : "s"}`}
          </span>
          {activeJob && (
            <span className="text-[11px] text-muted-foreground truncate hidden sm:inline">
              {activeJob.msg}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {queuedCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              {queuedCount} queued
            </Badge>
          )}
          {activeJob && activeJob.progress > 0 && (
            <span className="text-[11px] text-muted-foreground tabular-nums">
              {activeJob.progress}%
            </span>
          )}
          {genQueueExpanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronUp className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {!genQueueExpanded && activeJob && activeJob.progress > 0 && (
        <div className="px-4 pb-2">
          <Progress value={activeJob.progress} className="h-1" />
        </div>
      )}

      {genQueueExpanded && (
        <div className="border-t border-border/60">
          <div className="flex items-center justify-between gap-2 px-4 py-2 bg-muted/30">
            <span className="text-[11px] font-medium text-muted-foreground">
              Generation queue ({genQueue.length})
            </span>
            <div className="flex items-center gap-1">
              {activeJob && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px] text-destructive hover:text-destructive"
                  onClick={() => void cancelActive()}
                >
                  <Ban className="size-3 mr-1" />
                  Cancel active
                </Button>
              )}
              {queuedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={clearQueued}
                >
                  Clear queued
                </Button>
              )}
              {finishedCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-[11px]"
                  onClick={clearFinished}
                >
                  Clear finished
                </Button>
              )}
            </div>
          </div>
          <ScrollArea className="max-h-52">
            {genQueue.map((job) => (
              <JobRow
                key={job.id}
                job={job}
                onCancel={cancelJob}
                onMoveUp={moveJobUp}
                onMoveDown={moveJobDown}
                canMoveUp={canMoveUp(job)}
                canMoveDown={canMoveDown(job)}
              />
            ))}
          </ScrollArea>
          {!activeJob && queuedCount > 0 && (
            <p className="px-4 py-2 text-[11px] text-muted-foreground border-t border-border/60">
              Waiting to start…
            </p>
          )}
        </div>
      )}
    </div>
  );
}