import { useCallback } from "react";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { enqueueGenerationJob } from "@/lib/enqueueGenerationJob";
import { useAppState } from "@/state/context";
import type { GenJob, HistoryLinkMode } from "@/state/types";
import { toast } from "sonner";

export interface EnqueueOptions {
  historyLink: HistoryLinkMode;
  /** When true, picks a fresh seed and updates the form before enqueueing. */
  newSeed?: boolean;
  /** Skip caption verify (e.g. authoritative raw JSON from Magic Prompt). */
  skipVerify?: boolean;
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

  const hasPendingJobs = state.genQueue.some(isPendingJob);
  const canGenerate = state.modelState === "loaded";
  const hasActiveHistory = state.selectedPromptId != null;

  const enqueue = useCallback(async (options: EnqueueOptions) => {
    const { historyLink, newSeed = false, skipVerify = false } = options;

    const result = await enqueueGenerationJob(dispatch, {
      form: state.form,
      genQueueLength: state.genQueue.length,
      modelLoaded: canGenerate,
      selectedPromptId: state.selectedPromptId,
      historyLink,
      newSeed,
      skipVerify,
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
      return;
    }

    if (newSeed || !state.form.seed.trim()) {
      dispatch({ type: "SET_FORM", form: { seed: result.job.formSnapshot.seed } });
    }

    const actionLabel = historyLink === "regenerate" ? "Regeneration" : "New generation";
    toast.success(hasPendingJobs ? `${actionLabel} added to queue` : `${actionLabel} queued`);
  }, [
    canGenerate,
    confirm,
    dispatch,
    hasPendingJobs,
    state.form,
    state.genQueue.length,
    state.selectedPromptId,
  ]);

  return {
    enqueue,
    canGenerate,
    hasPendingJobs,
    hasActiveHistory,
  };
}