import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useEnqueueGeneration } from "@/hooks/useEnqueueGeneration";
import { useAppState } from "@/state/context";
import { subscribeMagicExpand } from "@/lib/magicExpandRunner";

export function useMagicPromptExpandRunner() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const { enqueue } = useEnqueueGeneration();
  const enqueuedForRequestId = useRef<number | null>(null);
  const notifiedRequestIds = useRef(new Set<number>());
  const { status, requestId, pending } = state.magicExpand;

  useEffect(() => {
    if (status !== "running") return;

    if (!pending) {
      dispatch({ type: "MAGIC_EXPAND_FAILED", error: "Missing expansion request." });
      return;
    }

    const shouldEnqueueAfter = pending.enqueueAfter === true;

    return subscribeMagicExpand(requestId, pending, {
      onSuccess: (result) => {
        dispatch({
          type: "MAGIC_EXPAND_SUCCEEDED",
          rawJson: result.rawJson,
          model: result.model,
        });
        if (notifiedRequestIds.current.has(requestId)) return;
        notifiedRequestIds.current.add(requestId);
        if (shouldEnqueueAfter) {
          if (enqueuedForRequestId.current === requestId) return;
          enqueuedForRequestId.current = requestId;
          void enqueue({
            historyLink: "new",
            newSeed: true,
            skipVerify: true,
            captionRawJson: result.rawJson,
            silent: true,
          }).then((enqueueResult) => {
            if (enqueueResult.ok) {
              toast.success(`Structured with ${result.model} — generation queued`);
            }
          });
          return;
        }

        toast.success(`Expanded with ${result.model}`, {
          duration: 12_000,
          action: {
            label: "Open editor",
            onClick: () => navigate({ to: "/" }),
          },
        });
      },
      onError: (e) => {
        const message = e instanceof Error ? e.message : String(e);
        dispatch({ type: "MAGIC_EXPAND_FAILED", error: message });
        if (notifiedRequestIds.current.has(requestId)) return;
        notifiedRequestIds.current.add(requestId);
        toast.error(`Failed to expand prompt: ${message}`, { duration: 10_000 });
      },
    });
  }, [dispatch, enqueue, navigate, pending, requestId, status]);
}
