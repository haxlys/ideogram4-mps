import { useCallback } from "react";
import { verifyCaption } from "@/api/client";
import { useAppState } from "@/state/context";
import { savePrompt } from "@/state/storage";
import type { GenJob } from "@/state/types";
import { MAX_GEN_QUEUE_SIZE } from "@/state/types";
import { getCaptionForGeneration, getCaptionHld } from "@/validation/caption";
import { toast } from "sonner";

function isPendingJob(job: GenJob) {
  return job.status === "queued" || job.status === "submitting" || job.status === "running";
}

export function useEnqueueGeneration() {
  const { state, dispatch } = useAppState();

  const hasPendingJobs = state.genQueue.some(isPendingJob);
  const canGenerate = state.modelState === "loaded";

  const enqueue = useCallback(async () => {
    if (!canGenerate) {
      toast.error("Model is not loaded. Please load the model first.");
      return;
    }

    if (state.genQueue.length >= MAX_GEN_QUEUE_SIZE) {
      toast.error(`Queue is full (max ${MAX_GEN_QUEUE_SIZE}).`);
      return;
    }

    let caption: Record<string, unknown>;
    try {
      caption = getCaptionForGeneration(state.form);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Raw JSON is invalid.");
      return;
    }

    if (!state.form.rawJson.trim()) {
      try {
        const verifyRes = await verifyCaption(caption);
        if (!verifyRes.valid && verifyRes.warnings.length > 0) {
          const proceed = confirm(
            `Caption verification warnings:\n\n${verifyRes.warnings.join("\n")}\n\nProceed anyway?`,
          );
          if (!proceed) return;
        }
      } catch {
        // Verification is best-effort; generation can still proceed.
      }
    }

    try {
      const promptId = await savePrompt({
        ...state.form,
        hld: getCaptionHld(caption, state.form.hld),
      });

      dispatch({ type: "REFRESH_HISTORY" });

      const label = getCaptionHld(caption, state.form.hld).trim() || "Untitled";
      const job: GenJob = {
        id: crypto.randomUUID(),
        promptId,
        label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
        status: "queued",
        msg: "Queued",
        progress: 0,
        totalSteps: 0,
        createdAt: Date.now(),
        request: {
          caption,
          width: state.form.w,
          height: state.form.h,
          preset: state.form.preset,
          seed: Number(state.form.seed) || Math.floor(Math.random() * 2 ** 32),
          format: state.form.format,
          prompt_id: promptId,
        },
      };

      dispatch({ type: "ENQUEUE_JOB", job });
      toast.success(hasPendingJobs ? "Added to queue" : "Generation queued");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  }, [canGenerate, dispatch, hasPendingJobs, state.form, state.genQueue.length]);

  return {
    enqueue,
    canGenerate,
    hasPendingJobs,
    buttonLabel: hasPendingJobs ? "Add to Queue" : "Generate",
  };
}