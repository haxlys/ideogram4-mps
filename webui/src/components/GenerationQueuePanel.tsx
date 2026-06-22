import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { useQueueManagement } from "@/hooks/useQueueManagement";
import { ImagePreviewLightbox } from "@/components/ImagePreviewLightbox";
import {
  canOpenHistoryFromJob,
  canPreviewJobResult,
  findPrimaryActiveJob,
  isDoneJob,
  isHistoryLinkFailed,
  isQueuedJob,
  partitionJobsForDisplay,
  type GenQueueFilter,
} from "@/lib/queue";
import type { GenJob, GenJobStatus, ImageEntry } from "@/state/types";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Spinner } from "@/components/ui/spinner";
import {
  ChevronDown,
  ChevronUp,
  X,
  ExternalLink,
  ArrowUp,
  ArrowDown,
  Ban,
  RefreshCw,
  Maximize2,
} from "lucide-react";

const STATUS_LABELS: Record<GenJobStatus, string> = {
  queued: "Queued",
  waiting: "Waiting",
  submitting: "Submitting",
  running: "Running",
  cancelling: "Cancelling",
  done: "Done",
  error: "Error",
  cancelled: "Cancelled",
};

function statusVariant(
  status: GenJobStatus,
  historyLinkFailed = false,
): "default" | "secondary" | "destructive" | "outline" {
  if (status === "error" || historyLinkFailed) return "destructive";
  if (status === "cancelled") return "outline";
  if (status === "done") return "secondary";
  if (status === "running" || status === "submitting" || status === "cancelling") return "default";
  return "outline";
}

function statusLabel(job: GenJob): string {
  if (isHistoryLinkFailed(job)) return "Link failed";
  return STATUS_LABELS[job.status];
}

function JobRow({
  job,
  onCancel,
  onMoveUp,
  onMoveDown,
  onRetryLink,
  onPreview,
  canMoveUp,
  canMoveDown,
  pinned = false,
}: {
  job: GenJob;
  onCancel: (job: GenJob) => void;
  onMoveUp: (jobId: string) => void;
  onMoveDown: (jobId: string) => void;
  onRetryLink: (job: GenJob) => void;
  onPreview: (image: ImageEntry) => void;
  canMoveUp: boolean;
  canMoveDown: boolean;
  pinned?: boolean;
}) {
  const linkFailed = isHistoryLinkFailed(job);
  const showProgress =
    job.status === "running" || job.status === "submitting" || job.status === "cancelling";
  const canCancel =
    job.status === "queued"
    || job.status === "waiting"
    || job.status === "submitting"
    || job.status === "running"
    || job.status === "cancelling";

  return (
    <div
      className={
        "flex items-start gap-2 px-4 py-2.5 border-b border-border/60 last:border-b-0 "
        + (pinned ? "bg-background shadow-[0_1px_0_0_var(--border)]" : "")
      }
    >
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
          <Badge
            variant={statusVariant(job.status, linkFailed)}
            className="shrink-0 text-[10px] px-1.5 py-0"
          >
            {statusLabel(job)}
          </Badge>
          <Badge variant="outline" className="shrink-0 text-[10px] px-1.5 py-0">
            {job.historyLinkMode === "regenerate" ? "Regenerate" : "New Seed"}
          </Badge>
          <span className="text-xs font-medium truncate">{job.label}</span>
        </div>
        <p
          className={
            "text-[11px] truncate "
            + (linkFailed ? "text-destructive" : "text-muted-foreground")
          }
        >
          {job.msg}
        </p>
        {linkFailed && job.linkError && (
          <p className="text-[11px] text-destructive/90 truncate">{job.linkError}</p>
        )}
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
        {linkFailed && job.pendingLink && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Retry history link"
            onClick={() => void onRetryLink(job)}
          >
            <RefreshCw className="size-3.5" />
          </Button>
        )}
        {canPreviewJobResult(job) && job.result && (
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Preview image"
            onClick={() => onPreview(job.result!)}
          >
            <Maximize2 className="size-3.5" />
          </Button>
        )}
        {canOpenHistoryFromJob(job) && (
          <Link
            to="/history/$promptId"
            params={{ promptId: String(job.promptId) }}
            aria-label="View in history"
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
              job.status === "queued" || job.status === "waiting"
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

const QUEUE_FILTERS: { value: GenQueueFilter; label: string }[] = [
  { value: "all", label: "All" },
  { value: "queue", label: "Queue" },
  { value: "done", label: "Done" },
];

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
    retryHistoryLink,
  } = useQueueManagement();
  const [queueFilter, setQueueFilter] = useState<GenQueueFilter>("all");
  const [previewImage, setPreviewImage] = useState<ImageEntry | null>(null);
  const { genQueue, genQueueExpanded } = state;
  const { activeJobs, scrollableJobs } = partitionJobsForDisplay(genQueue, queueFilter);

  if (genQueue.length === 0) return null;

  const activeJob = findPrimaryActiveJob(genQueue);
  const queuedCount = genQueue.filter(isQueuedJob).length;
  const finishedCount = genQueue.filter(isDoneJob).length;
  const showClearQueued = queuedCount > 0 && (queueFilter === "all" || queueFilter === "queue");
  const showClearFinished = finishedCount > 0 && (queueFilter === "all" || queueFilter === "done");

  return (
    <>
    <div className="shrink-0 border-t border-border bg-background/95 shadow-elevated backdrop-blur-md">
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
            || activeJob?.status === "cancelling"
            || activeJob?.status === "waiting") && (
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
        <div className="border-t border-border/60 flex max-h-[min(45dvh,360px)] flex-col overflow-hidden">
          <div className="shrink-0 space-y-2 border-b border-border/60 bg-muted/30 px-4 py-2">
            <div className="flex items-center justify-between gap-2">
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
                {showClearQueued && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-[11px]"
                    onClick={clearQueued}
                  >
                    Clear queued
                  </Button>
                )}
                {showClearFinished && (
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
            <div
              role="group"
              aria-label="Filter generation queue"
              className="inline-flex items-center gap-0.5 rounded-md border border-border/60 bg-background/80 p-0.5"
            >
              {QUEUE_FILTERS.map(({ value, label }) => {
                const count =
                  value === "all"
                    ? genQueue.length
                    : value === "queue"
                      ? queuedCount
                      : finishedCount;

                return (
                  <Button
                    key={value}
                    type="button"
                    variant={queueFilter === value ? "secondary" : "ghost"}
                    size="sm"
                    className="h-6 px-2 text-[10px] font-medium"
                    aria-pressed={queueFilter === value}
                    onClick={() => setQueueFilter(value)}
                  >
                    {label}
                    <span className="ml-1 tabular-nums text-muted-foreground">{count}</span>
                  </Button>
                );
              })}
            </div>
          </div>
          {activeJobs.length > 0 && (
            <div
              role="list"
              aria-label="Active generation jobs"
              className="shrink-0 border-b border-border/60 bg-muted/20"
            >
              {activeJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  pinned
                  onCancel={cancelJob}
                  onMoveUp={moveJobUp}
                  onMoveDown={moveJobDown}
                  onRetryLink={retryHistoryLink}
                  onPreview={setPreviewImage}
                  canMoveUp={canMoveUp(job)}
                  canMoveDown={canMoveDown(job)}
                />
              ))}
            </div>
          )}
          <div
            role="list"
            aria-label="Generation queue items"
            className="h-0 min-h-0 flex-1 overflow-y-auto overscroll-contain"
          >
            {scrollableJobs.length === 0 && queueFilter !== "all" ? (
              <p className="px-4 py-6 text-center text-[11px] text-muted-foreground">
                No {queueFilter === "done" ? "done" : "queued"} jobs
              </p>
            ) : (
              scrollableJobs.map((job) => (
                <JobRow
                  key={job.id}
                  job={job}
                  onCancel={cancelJob}
                  onMoveUp={moveJobUp}
                  onMoveDown={moveJobDown}
                  onRetryLink={retryHistoryLink}
                  onPreview={setPreviewImage}
                  canMoveUp={canMoveUp(job)}
                  canMoveDown={canMoveDown(job)}
                />
              ))
            )}
          </div>
          {!activeJob && queuedCount > 0 && queueFilter !== "done" && (
            <p className="shrink-0 px-4 py-2 text-[11px] text-muted-foreground border-t border-border/60">
              Waiting to start…
            </p>
          )}
        </div>
      )}
    </div>

    <ImagePreviewLightbox
      image={previewImage}
      open={previewImage != null}
      onOpenChange={(open) => {
        if (!open) setPreviewImage(null);
      }}
    />
    </>
  );
}