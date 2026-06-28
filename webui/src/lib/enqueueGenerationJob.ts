import type { Dispatch } from "react";
import { verifyCaption } from "@/api/client";
import type { AppAction, FormState, GenJob, HistoryLinkMode } from "@/state/types";
import { MAX_GEN_QUEUE_SIZE } from "@/state/types";
import { randomSeed } from "@/lib/seed";
import { getCaptionForGeneration, getCaptionHld } from "@/validation/caption";
import { findDuplicatePendingJob, generationRequestFingerprint, queuedJobCount } from "@/lib/genQueueDedupe";

export interface EnqueueGenerationInput {
  form: FormState;
  genQueue: GenJob[];
  modelLoaded: boolean;
  selectedPromptId: number | null;
  historyLink: HistoryLinkMode;
  newSeed?: boolean;
  skipVerify?: boolean;
  /** Overrides form.rawJson for this job (e.g. fresh Magic Prompt output). */
  captionRawJson?: string;
  confirmWarnings?: (warnings: string[]) => Promise<boolean>;
}

export type EnqueueGenerationResult =
  | { ok: true; job: GenJob }
  | { ok: false; reason: string };

export async function enqueueGenerationJob(
  dispatch: Dispatch<AppAction>,
  input: EnqueueGenerationInput,
): Promise<EnqueueGenerationResult> {
  if (!input.modelLoaded) {
    return { ok: false, reason: "Model is not loaded. Please load the model first." };
  }
  if (queuedJobCount(input.genQueue) >= MAX_GEN_QUEUE_SIZE) {
    return { ok: false, reason: `Queue is full (max ${MAX_GEN_QUEUE_SIZE}).` };
  }
  if (input.historyLink === "regenerate" && input.selectedPromptId == null) {
    return { ok: false, reason: "Open a history entry to regenerate." };
  }

  const formForJob: FormState = input.captionRawJson != null && input.captionRawJson.trim()
    ? { ...input.form, rawJson: input.captionRawJson }
    : input.form;

  let caption: Record<string, unknown>;
  try {
    caption = getCaptionForGeneration(formForJob);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Raw JSON is invalid." };
  }

  if (!input.skipVerify && !formForJob.rawJson.trim()) {
    try {
      const verifyRes = await verifyCaption(caption);
      if (!verifyRes.valid && verifyRes.warnings.length > 0 && input.confirmWarnings) {
        const proceed = await input.confirmWarnings(verifyRes.warnings);
        if (!proceed) return { ok: false, reason: "Cancelled." };
      }
    } catch {
      // Verification is best-effort.
    }
  }

  const historyLinkMode = input.historyLink;
  const promptIdForJob = historyLinkMode === "regenerate" ? input.selectedPromptId ?? undefined : undefined;
  const fingerprint = generationRequestFingerprint(
    caption,
    formForJob.w,
    formForJob.h,
    formForJob.preset,
    formForJob.format,
    historyLinkMode,
    promptIdForJob,
  );
  if (findDuplicatePendingJob(input.genQueue, fingerprint)) {
    return { ok: false, reason: "This generation is already queued or running." };
  }

  const resolvedSeed = input.newSeed
    ? randomSeed()
    : input.form.seed.trim()
      ? Number(input.form.seed)
      : randomSeed();
  const seedForForm = String(resolvedSeed);

  const label = getCaptionHld(caption, formForJob.hld).trim() || "Untitled";
  const formSnapshot: FormState = {
    ...formForJob,
    seed: seedForForm,
    hld: getCaptionHld(caption, formForJob.hld),
  };
  const job: GenJob = {
    id: crypto.randomUUID(),
    promptId: input.historyLink === "regenerate" ? input.selectedPromptId ?? undefined : undefined,
    historyLinkMode: input.historyLink,
    formSnapshot,
    label: label.length > 80 ? `${label.slice(0, 77)}…` : label,
    status: "queued",
    msg: "Queued",
    progress: 0,
    totalSteps: 0,
    createdAt: Date.now(),
    request: {
      caption,
      width: formForJob.w,
      height: formForJob.h,
      preset: formForJob.preset,
      seed: resolvedSeed,
      format: formForJob.format,
    },
  };

  dispatch({ type: "ENQUEUE_JOB", job });
  return { ok: true, job };
}
