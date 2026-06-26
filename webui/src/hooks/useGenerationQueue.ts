import { useCallback, useEffect, useRef, type MutableRefObject } from "react";
import { useNavigate } from "@tanstack/react-router";
import { ApiError, cancelTask, getTaskStatus, submitGenerate } from "@/api/client";
import { useAppState } from "@/state/context";
import { invalidatePromptsCache, promptPayloadFromForm } from "@/state/storage";
import type { AppAction, GenJob, ImageEntry } from "@/state/types";
import { imageEntryFromTask } from "@/lib/image";
import {
  attachHistoryWithRetry,
  historyLinkErrorDetail,
  type AttachHistoryPayload,
} from "@/lib/historyLink";
import { toast } from "sonner";

const POLL_INTERVAL_MS = 1000;
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

function linkedEntryFromTask(
  data: { image: NonNullable<Awaited<ReturnType<typeof getTaskStatus>>["image"]> },
  promptId: number,
): ImageEntry {
  return imageEntryFromTask({
    id: data.image!.id ?? Date.now(),
    url: data.image!.url ?? "",
    hld: data.image!.hld ?? "",
    time: data.image!.time ?? new Date().toLocaleTimeString(),
    prompt_id: promptId,
    historyLinked: true,
    lora_name: data.image!.lora_name,
    lora_strength: data.image!.lora_strength,
    seed: data.image!.seed,
    preset: data.image!.preset,
    applied_loras: data.image!.applied_loras,
  });
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

      const scheduleNextPoll = () => {
        if (pollingJobIdRef.current !== jobId || pollingTaskIdRef.current !== taskId) return;
        pollIntervalRef.current = setTimeout(() => {
          pollIntervalRef.current = null;
          void pollOnce();
        }, POLL_INTERVAL_MS);
      };

      const pollOnce = async () => {
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
            scheduleNextPoll();
            return;
          }

          if (data.state === "done" && data.image) {
            stopPolling();
            processingRef.current = false;

            const reusePromptId = currentJob?.promptId;
            const createdNewPrompt = reusePromptId == null;
            let promptId: number | undefined;
            let imageLinked = false;
            let historyLinkFailed = false;
            let linkError: string | undefined;
            let pendingLink: GenJob["pendingLink"];
            let attachPayload: AttachHistoryPayload | undefined;

            if (currentJob?.formSnapshot && data.image.id != null) {
              const imageId = data.image.id;
              attachPayload = {
                promptId: reusePromptId,
                ...promptPayloadFromForm(currentJob.formSnapshot),
              };
              try {
                const attached = await attachHistoryWithRetry(imageId, attachPayload);
                promptId = attached.prompt_id;
                imageLinked = true;
              } catch (linkErr) {
                historyLinkFailed = true;
                linkError = historyLinkErrorDetail(linkErr);
                pendingLink = {
                  imageId,
                  promptId: reusePromptId,
                  hld: attachPayload.hld,
                  formJson: attachPayload.formJson,
                };
              }
            }

            const entry = imageLinked && promptId != null
              ? linkedEntryFromTask({ image: data.image }, promptId)
              : imageEntryFromTask({
                  id: data.image.id ?? Date.now(),
                  url: data.image.url ?? "",
                  hld: data.image.hld ?? "",
                  time: data.image.time ?? new Date().toLocaleTimeString(),
                  prompt_id: null,
                  historyLinked: false,
                  lora_name: data.image.lora_name,
                  lora_strength: data.image.lora_strength,
                  seed: data.image.seed,
                  preset: data.image.preset,
                  applied_loras: data.image.applied_loras,
                });

            dispatch({
              type: "UPDATE_JOB",
              id: jobId,
              patch: {
                status: "done",
                msg: historyLinkFailed ? "History link failed" : "Done",
                progress: 100,
                result: entry,
                promptId,
                historyLinkFailed: historyLinkFailed || undefined,
                linkError,
                pendingLink,
              },
            });
            if (imageLinked) {
              dispatch({ type: "ADD_IMAGE", entry });
            }
            invalidatePromptsCache();
            dispatch({ type: "REFRESH_HISTORY" });

            const latest = stateRef.current;
            if (imageLinked && promptId != null) {
              if (latest.selectedPromptId === promptId) {
                dispatch({ type: "SHOW_RESULT", entry });
              }
              if (createdNewPrompt) {
                navigate({
                  to: "/history/$promptId",
                  params: { promptId: String(promptId) },
                });
              }
            }

            const label = latest.genQueue.find((job) => job.id === jobId)?.label ?? "Image";
            if (historyLinkFailed) {
              toast.error(
                `"${label}" generated but history link failed (${linkError}).`,
                {
                  duration: 12_000,
                  action: pendingLink
                    ? {
                        label: "Retry",
                        onClick: () => {
                          void attachHistoryWithRetry(pendingLink!.imageId, {
                            promptId: pendingLink!.promptId,
                            hld: pendingLink!.hld,
                            formJson: pendingLink!.formJson,
                          })
                            .then((attached) => {
                              const linkedEntry: ImageEntry = {
                                ...entry,
                                prompt_id: attached.prompt_id,
                                historyLinked: true,
                              };
                              dispatch({
                                type: "UPDATE_JOB",
                                id: jobId,
                                patch: {
                                  msg: "Done",
                                  result: linkedEntry,
                                  promptId: attached.prompt_id,
                                  historyLinkFailed: undefined,
                                  linkError: undefined,
                                  pendingLink: undefined,
                                },
                              });
                              dispatch({ type: "ADD_IMAGE", entry: linkedEntry });
                              invalidatePromptsCache();
                              dispatch({ type: "REFRESH_HISTORY" });
                              if (latest.selectedPromptId === attached.prompt_id) {
                                dispatch({ type: "SHOW_RESULT", entry: linkedEntry });
                              }
                              if (createdNewPrompt) {
                                navigate({
                                  to: "/history/$promptId",
                                  params: { promptId: String(attached.prompt_id) },
                                });
                              }
                              toast.success("Image linked to history.");
                            })
                            .catch((retryError) => {
                              toast.error(
                                `Link retry failed (${historyLinkErrorDetail(retryError)}).`,
                              );
                            });
                        },
                      }
                    : undefined,
                },
              );
            } else if (imageLinked && promptId != null) {
              const readyLabel = currentJob?.historyLinkMode === "regenerate"
                ? `"${label}" regenerated`
                : `"${label}" saved to history`;
              toast.success(readyLabel, {
                action: {
                  label: "View",
                  onClick: () => {
                    navigate({
                      to: "/history/$promptId",
                      params: { promptId: String(promptId) },
                    });
                  },
                },
              });
            }
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
            scheduleNextPoll();
          }
        }
      };

      void pollOnce();
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
