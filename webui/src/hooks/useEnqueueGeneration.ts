import { useCallback, useEffect, useRef } from "react";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { enqueueGenerationJob, type EnqueueGenerationResult } from "@/lib/enqueueGenerationJob";
import { useAppState } from "@/state/context";
import type { GenJob, HistoryLinkMode } from "@/state/types";
import { toast } from "sonner";

export interface EnqueueOptions {
  historyLink: HistoryLinkMode;
  /** When true, picks a fresh seed and updates the form before enqueueing. */
  newSeed?: boolean;
  /** Skip caption verify (e.g. authoritative raw JSON from Magic Prompt). */
  skipVerify?: boolean;
  /** Use this caption JSON for the job (avoids stale form right after Magic Prompt). */
  captionRawJson?: string;
  /** When true, do not show the default success toast (caller shows its own). */
  silent?: boolean;
}

function isPendingJob(job: GenJob) {
  return (
    job.status === "queued"
    || job.status === "waiting"
    || job.status === "submitting"
    || job.status === "running"
  );
}

export function useEnqueueGeneration() {
  const { state, dispatch } = useAppState();
  const confirm = useConfirm();
  const stateRef = useRef(state);

  const hasPendingJobs = state.genQueue.some(isPendingJob);
  const canGenerate = state.modelState === "loaded";
  const hasActiveHistory = state.selectedPromptId != null;

  useEffect(() => {
    stateRef.current = state;
  });

  const enqueue = useCallback(async (options: EnqueueOptions): Promise<EnqueueGenerationResult> => {
    const { historyLink, newSeed = false, skipVerify = false, captionRawJson, silent = false } = options;
    const latest = stateRef.current;
    const latestHasPendingJobs = latest.genQueue.some(isPendingJob);

    const result = await enqueueGenerationJob(dispatch, {
      form: latest.form,
      genQueue: latest.genQueue,
      modelLoaded: latest.modelState === "loaded",
      selectedPromptId: latest.selectedPromptId,
      historyLink,
      newSeed,
      skipVerify,
      captionRawJson,
      confirmWarnings: async (warnings) => confirm({
        title: "Caption verification warnings",
        description: warnings.join("\n"),
        confirmLabel: "Proceed anyway",
      }),
    });

    if (!result.ok) {
      if (result.reason !== "Cancelled.") {
        toast.error(result.reason);
      }
      return result;
    }

    if (newSeed || !latest.form.seed.trim()) {
      dispatch({ type: "SET_FORM", form: { seed: result.job.formSnapshot.seed } });
    }
    if (!silent) {
      const actionLabel = historyLink === "regenerate" ? "Regeneration" : "New generation";
      toast.success(latestHasPendingJobs ? `${actionLabel} added to queue` : `${actionLabel} queued`);
    }
    return result;
  }, [
    confirm,
    dispatch,
  ]);

  return {
    enqueue,
    canGenerate,
    hasPendingJobs,
    hasActiveHistory,
  };
}
