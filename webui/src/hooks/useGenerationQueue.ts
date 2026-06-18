import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, cancelTask, getTaskStatus, submitGenerate } from "@/api/client";
import { useAppState } from "@/state/context";
import type { AppAction, GenJob, ImageEntry } from "@/state/types";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 2000;
const BUSY_RETRY_MS = 2000;

function isActiveJob(job: GenJob) {
  return (
    job.status === "waiting"
    || job.status === "submitting"
    || job.status === "running"
    || job.status === "cancelling"
  );
}

function scheduleQueueRetry(
  retryTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>,
  processingRef: MutableRefObject<boolean>,
  dispatch: (action: AppAction) => void,
  jobId: string,
  delayMs = BUSY_RETRY_MS,
) {
  clearQueueRetry(retryTimeoutRef);
  retryTimeoutRef.current = setTimeout(() => {
    retryTimeoutRef.current = null;
    dispatch({
      type: "UPDATE_JOB",
      id: jobId,
      patch: { status: "queued", msg: "Queued" },
    });
    processingRef.current = false;
  }, delayMs);
}

function clearQueueRetry(retryTimeoutRef: MutableRefObject<ReturnType<typeof setTimeout> | null>) {
  if (!retryTimeoutRef.current) return;
  clearTimeout(retryTimeoutRef.current);
  retryTimeoutRef.current = null;
}

function isAbortStatus(status: GenJob["status"] | undefined) {
  return status === "cancelled" || status === "cancelling";
}

export function useGenerationQueue() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const stateRef = useRef(state);

  const processingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollingJobIdRef = useRef<string | null>(null);
  const pollingTaskIdRef = useRef<string | null>(null);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const processQueueRef = useRef<() => Promise<void>>(async () => {});

  const stopPolling = useCallback(() => {
    if (pollIntervalRef.current) {
      clearInterval(pollIntervalRef.current);
      pollIntervalRef.current = null;
    }
    pollingJobIdRef.current = null;
    pollingTaskIdRef.current = null;
  }, []);

  const finishJobCancelled = useCallback(
    (jobId: string) => {
      stopPolling();
      processingRef.current = false;
      dispatch({
        type: "UPDATE_JOB",
        id: jobId,
        patch: { status: "cancelled", msg: "Cancelled", error: "Cancelled" },
      });
    },
    [dispatch, stopPolling],
  );

  const startPolling = useCallback(
    (jobId: string, taskId: string) => {
      if (pollingJobIdRef.current === jobId && pollingTaskIdRef.current === taskId) {
        return;
      }

      stopPolling();
      pollingJobIdRef.current = jobId;
      pollingTaskIdRef.current = taskId;

      let retries = 0;

      pollIntervalRef.current = setInterval(async () => {
        const currentJob = stateRef.current.genQueue.find((job) => job.id === jobId);
        const isCancelling = currentJob?.status === "cancelling";
        if (!currentJob || isAbortStatus(currentJob.status)) {
          finishJobCancelled(jobId);
          return;
        }

        try {
          const data = await getTaskStatus(taskId);
          retries = 0;

          if (data.cancelled || data.error === "Cancelled") {
            finishJobCancelled(jobId);
            return;
          }

          if (data.state === "running") {
            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: {
                status: isCancelling ? "cancelling" : "running",
                msg: data.msg ?? "Generating...",
                progress: data.progress ?? 0,
                totalSteps: data.total_steps ?? 0,
              },
            });
            return;
          }

          if (data.state === "done" && data.image) {
            stopPolling();
            processingRef.current = false;

            const entry: ImageEntry = {
              id: data.image.id ?? Date.now(),
              url: data.image.url ?? "",
              hld: data.image.hld ?? "",
              time: data.image.time ?? new Date().toLocaleTimeString(),
              prompt_id: data.image.prompt_id,
            };

            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: {
                status: "done",
                msg: "Done",
                progress: 100,
                result: entry,
              },
            });
            dispatch({ type: "ADD_IMAGE", entry });
            dispatch({ type: "REFRESH_HISTORY" });

            const latest = stateRef.current;
            if (latest.selectedPromptId === entry.prompt_id) {
              dispatch({ type: "SHOW_RESULT", entry });
            }

            const label = latest.genQueue.find((job) => job.id === jobId)?.label ?? "Image";
            toast.success(`"${label}" is ready`, {
              action: {
                label: "View",
                onClick: () => {
                  if (entry.prompt_id != null) {
                    navigate({
                      to: "/history/$promptId",
                      params: { promptId: String(entry.prompt_id) },
                    });
                  }
                },
              },
            });
            return;
          }

          if (data.state === "done") {
            stopPolling();
            processingRef.current = false;

            if (data.error === "Cancelled" || data.msg === "Cancelled.") {
              finishJobCancelled(jobId);
              return;
            }

            const msg = data.msg ?? data.error ?? "Generation finished without an image.";
            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: { status: "error", msg, error: msg },
            });
            toast.error(msg);
          }
        } catch {
          retries++;
          if (retries >= 3) {
            stopPolling();
            processingRef.current = false;
            const msg = "Network error after 3 retries.";
            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: { status: "error", msg, error: msg },
            });
            toast.error(msg);
          } else {
            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: { status: "running", msg: `Retrying (${retries}/3)...` },
            });
          }
        }
      }, POLL_INTERVAL_MS);
    },
    [dispatch, finishJobCancelled, navigate, stopPolling],
  );

  const processQueue = useCallback(async () => {
    if (processingRef.current) return;

    const queue = stateRef.current.genQueue;
    const active = queue.find(isActiveJob);
    if (active) {
      if ((active.status === "running" || active.status === "cancelling") && active.taskId) {
        startPolling(active.id, active.taskId);
      }
      return;
    }

    const next = queue.find((job) => job.status === "queued");
    if (!next) return;

    processingRef.current = true;
    const jobId = next.id;
    dispatch({
      type: "UPDATE_JOB",
      id: jobId,
      patch: { status: "submitting", msg: "Submitting…" },
    });

    try {
      const res = await submitGenerate(next.request);
      const current = stateRef.current.genQueue.find((job) => job.id === jobId);

      if (!current || isAbortStatus(current.status)) {
        processingRef.current = false;
        if (res.task_id) {
          try {
            await cancelTask(res.task_id);
          } catch {
            // Best-effort cleanup for jobs cancelled during submit.
          }
        }
        if (current?.status === "cancelled") {
          dispatch({ type: "REMOVE_JOB", id: jobId });
        }
        return;
      }

      dispatch({
        type: "UPDATE_JOB",
        id: jobId,
        patch: {
          status: "running",
          taskId: res.task_id,
          msg: "Starting…",
        },
      });
      startPolling(jobId, res.task_id);
    } catch (error) {
      const current = stateRef.current.genQueue.find((job) => job.id === jobId);
      if (current && isAbortStatus(current.status)) {
        processingRef.current = false;
        if (current.status === "cancelled") {
          dispatch({ type: "REMOVE_JOB", id: jobId });
        }
        return;
      }

      if (error instanceof ApiError && error.status === 409) {
        dispatch({
          type: "UPDATE_JOB",
          id: jobId,
          patch: {
            status: "waiting",
            msg: "Waiting for current generation…",
          },
        });
        // Keep processingRef true so useEffect does not immediately retry and spam 409s.
        scheduleQueueRetry(retryTimeoutRef, processingRef, dispatch, jobId);
        return;
      }

      processingRef.current = false;
      const msg = error instanceof Error ? error.message : String(error);
      dispatch({
        type: "UPDATE_JOB",
        id: jobId,
        patch: { status: "error", msg, error: msg },
      });
      toast.error(msg);
    }
  }, [dispatch, startPolling]);

  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    processQueueRef.current = processQueue;
  }, [processQueue]);

  useEffect(() => {
    processQueue();
  }, [state.genQueue, processQueue]);

  useEffect(() => {
    return () => {
      stopPolling();
      clearQueueRetry(retryTimeoutRef);
    };
  }, [stopPolling]);
}
