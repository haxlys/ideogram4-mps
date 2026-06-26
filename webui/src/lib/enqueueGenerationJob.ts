import type { Dispatch } from "react";
import { verifyCaption } from "@/api/client";
import type { AppAction, FormState, GenJob, HistoryLinkMode } from "@/state/types";
import { MAX_GEN_QUEUE_SIZE } from "@/state/types";
import { randomSeed } from "@/lib/seed";
import { getCaptionForGeneration, getCaptionHld } from "@/validation/caption";

export interface EnqueueGenerationInput {
  form: FormState;
  genQueueLength: number;
  modelLoaded: boolean;
  selectedPromptId: number | null;
  historyLink: HistoryLinkMode;
  newSeed?: boolean;
  skipVerify?: boolean;
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
  if (input.genQueueLength >= MAX_GEN_QUEUE_SIZE) {
    return { ok: false, reason: `Queue is full (max ${MAX_GEN_QUEUE_SIZE}).` };
  }
  if (input.historyLink === "regenerate" && input.selectedPromptId == null) {
    return { ok: false, reason: "Open a history entry to regenerate." };
  }

  let caption: Record<string, unknown>;
  try {
    caption = getCaptionForGeneration(input.form);
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Raw JSON is invalid." };
  }

  if (!input.skipVerify && !input.form.rawJson.trim()) {
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

  const resolvedSeed = input.newSeed
    ? randomSeed()
    : input.form.seed.trim()
      ? Number(input.form.seed)
      : randomSeed();
  const seedForForm = String(resolvedSeed);

  const label = getCaptionHld(caption, input.form.hld).trim() || "Untitled";
  const formSnapshot: FormState = {
    ...input.form,
    seed: seedForForm,
    hld: getCaptionHld(caption, input.form.hld),
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
      width: input.form.w,
      height: input.form.h,
      preset: input.form.preset,
      seed: resolvedSeed,
      format: input.form.format,
    },
  };

  dispatch({ type: "ENQUEUE_JOB", job });
  return { ok: true, job };
}