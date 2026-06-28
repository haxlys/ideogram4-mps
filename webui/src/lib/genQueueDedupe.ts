import type { GenJob } from "@/state/types";

const PENDING_STATUSES = new Set<GenJob["status"]>([
  "queued",
  "waiting",
  "submitting",
  "running",
]);

export function isPendingQueueJob(job: GenJob): boolean {
  return PENDING_STATUSES.has(job.status);
}

export function countsTowardQueueLimit(job: GenJob): boolean {
  return job.status === "queued" || job.status === "waiting";
}

export function queuedJobCount(genQueue: GenJob[]): number {
  return genQueue.filter(countsTowardQueueLimit).length;
}

/** Stable key for “same generation request” (seed is intentionally excluded). */
export function generationRequestFingerprint(
  caption: Record<string, unknown>,
  width: number,
  height: number,
  preset: string,
  format: string,
  historyLinkMode: GenJob["historyLinkMode"],
  promptId?: number,
): string {
  return JSON.stringify({
    caption,
    width,
    height,
    preset,
    format,
    historyLinkMode,
    promptId: promptId ?? null,
  });
}

export function findDuplicatePendingJob(
  genQueue: GenJob[],
  fingerprint: string,
): GenJob | undefined {
  return genQueue.find(
    (job) => isPendingQueueJob(job) && generationRequestFingerprint(
      job.request.caption as Record<string, unknown>,
      job.request.width,
      job.request.height,
      job.request.preset,
      job.request.format,
      job.historyLinkMode,
      job.promptId,
    ) === fingerprint,
  );
}
