import { useCallback } from "react";
import { cancelTask } from "@/api/client";
import { useAppState } from "@/state/context";
import type { GenJob } from "@/state/types";
import { toast } from "sonner";

function isFinishedStatus(status: GenJob["status"]) {
  return status === "done" || status === "error" || status === "cancelled";
}

export function useQueueManagement() {
  const { state, dispatch } = useAppState();

  const cancelJob = useCallback(
    async (job: GenJob) => {
      if (job.status === "queued" || job.status === "waiting") {
        dispatch({ type: "REMOVE_JOB", id: job.id });
        return;
      }

      if (isFinishedStatus(job.status)) {
        dispatch({ type: "REMOVE_JOB", id: job.id });
        return;
      }

      if (job.status === "submitting") {
        dispatch({
          type: "UPDATE_JOB",
          id: job.id,
          patch: { status: "cancelled", msg: "Cancelled", error: "Cancelled" },
        });
        return;
      }

      if (job.status === "running" || job.status === "cancelling") {
        if (!job.taskId) {
          dispatch({
            type: "UPDATE_JOB",
            id: job.id,
            patch: { status: "cancelled", msg: "Cancelled", error: "Cancelled" },
          });
          return;
        }

        dispatch({
          type: "UPDATE_JOB",
          id: job.id,
          patch: { status: "cancelling", msg: "Cancelling…" },
        });

        try {
          await cancelTask(job.taskId);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          toast.error(`Cancel failed: ${msg}`);
          dispatch({
            type: "UPDATE_JOB",
            id: job.id,
            patch: { status: "running", msg: "Cancel failed — still running" },
          });
        }
      }
    },
    [dispatch],
  );

  const moveJobUp = useCallback(
    (jobId: string) => {
      dispatch({ type: "REORDER_JOB", id: jobId, direction: "up" });
    },
    [dispatch],
  );

  const moveJobDown = useCallback(
    (jobId: string) => {
      dispatch({ type: "REORDER_JOB", id: jobId, direction: "down" });
    },
    [dispatch],
  );

  const clearQueued = useCallback(() => {
    const count = state.genQueue.filter(
      (job) => job.status === "queued" || job.status === "waiting",
    ).length;
    if (count === 0) return;
    dispatch({ type: "CLEAR_QUEUED_JOBS" });
    toast.success(`Removed ${count} queued job${count === 1 ? "" : "s"}`);
  }, [dispatch, state.genQueue]);

  const clearFinished = useCallback(() => {
    dispatch({ type: "CLEAR_FINISHED_JOBS" });
  }, [dispatch]);

  const cancelActive = useCallback(async () => {
    const active = state.genQueue.find(
      (job) => job.status === "running" || job.status === "submitting" || job.status === "cancelling",
    );
    if (!active) return;
    await cancelJob(active);
  }, [cancelJob, state.genQueue]);

  const canMoveUp = useCallback(
    (job: GenJob) => {
      if (job.status !== "queued") return false;
      const idx = state.genQueue.findIndex((entry) => entry.id === job.id);
      return state.genQueue.slice(0, idx).some((entry) => entry.status === "queued");
    },
    [state.genQueue],
  );

  const canMoveDown = useCallback(
    (job: GenJob) => {
      if (job.status !== "queued") return false;
      const idx = state.genQueue.findIndex((entry) => entry.id === job.id);
      return state.genQueue.slice(idx + 1).some((entry) => entry.status === "queued");
    },
    [state.genQueue],
  );

  return {
    cancelJob,
    moveJobUp,
    moveJobDown,
    clearQueued,
    clearFinished,
    cancelActive,
    canMoveUp,
    canMoveDown,
  };
}