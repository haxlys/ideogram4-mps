import type { FormState, GenJob, GenJobStatus } from "./types";

const QUEUE_STATE_KEY = "ideogram4_gen_queue_state";

const ACTIVE_STATUSES: GenJobStatus[] = [
  "queued",
  "waiting",
  "submitting",
  "running",
  "cancelling",
];

interface PersistedQueueState {
  genQueue: GenJob[];
  genQueueExpanded: boolean;
}

function isGenJobStatus(value: unknown): value is GenJobStatus {
  return (
    value === "queued"
    || value === "waiting"
    || value === "submitting"
    || value === "running"
    || value === "cancelling"
    || value === "done"
    || value === "error"
    || value === "cancelled"
  );
}

function isFormSnapshot(value: unknown): value is FormState {
  return Boolean(value && typeof value === "object" && "w" in value && "h" in value);
}

function parseGenJob(raw: unknown): GenJob | null {
  if (!raw || typeof raw !== "object") return null;
  const job = raw as Partial<GenJob>;
  if (
    typeof job.id !== "string"
    || typeof job.label !== "string"
    || !isGenJobStatus(job.status)
    || typeof job.msg !== "string"
    || typeof job.progress !== "number"
    || typeof job.totalSteps !== "number"
    || typeof job.createdAt !== "number"
    || !job.request
    || typeof job.request !== "object"
  ) {
    return null;
  }
  if (job.promptId != null && typeof job.promptId !== "number") return null;
  if (!isFormSnapshot(job.formSnapshot)) return null;

  const historyLinkMode = job.historyLinkMode === "regenerate" || job.historyLinkMode === "new"
    ? job.historyLinkMode
    : job.promptId != null
      ? "regenerate"
      : "new";

  return { ...job, historyLinkMode } as GenJob;
}

function normalizeRestoredJob(job: GenJob): GenJob {
  if (job.status === "submitting" || job.status === "waiting") {
    return { ...job, status: "queued", msg: "Queued" };
  }
  if (job.status === "running" || job.status === "cancelling") {
    return { ...job, status: "error", msg: "Interrupted by reload", error: "Interrupted by reload" };
  }
  return job;
}

export function loadQueueState(): PersistedQueueState {
  try {
    const raw = localStorage.getItem(QUEUE_STATE_KEY);
    if (!raw) return { genQueue: [], genQueueExpanded: false };

    const parsed = JSON.parse(raw) as Partial<PersistedQueueState>;
    let genQueue = Array.isArray(parsed.genQueue)
      ? parsed.genQueue.map(parseGenJob).filter((job): job is GenJob => job != null).map(normalizeRestoredJob)
      : [];

    const seen = new Set<string>();
    const deduped: GenJob[] = [];
    for (const job of genQueue) {
      if (job.status === "queued" || job.status === "waiting") {
        const key = JSON.stringify({
          c: job.request.caption,
          w: job.request.width,
          h: job.request.height,
          p: job.request.preset,
          f: job.request.format,
          m: job.historyLinkMode,
          pid: job.promptId ?? null,
        });
        if (seen.has(key)) continue;
        seen.add(key);
      }
      deduped.push(job);
    }
    genQueue = deduped;

    const hasActiveJobs = genQueue.some((job) => ACTIVE_STATUSES.includes(job.status));

    return {
      genQueue,
      genQueueExpanded: hasActiveJobs ? true : Boolean(parsed.genQueueExpanded),
    };
  } catch {
    return { genQueue: [], genQueueExpanded: false };
  }
}

export function saveQueueState(genQueue: GenJob[], genQueueExpanded: boolean) {
  try {
    const payload: PersistedQueueState = { genQueue, genQueueExpanded };
    localStorage.setItem(QUEUE_STATE_KEY, JSON.stringify(payload));
  } catch {
    // Ignore quota or serialization errors.
  }
}