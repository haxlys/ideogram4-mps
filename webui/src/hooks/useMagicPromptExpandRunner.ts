import { useEffect, useRef } from "react";
import { useNavigate } from "@tanstack/react-router";
import { toast } from "sonner";
import { useAppState } from "@/state/context";
import { subscribeMagicExpand } from "@/lib/magicExpandRunner";

/** Mount once at app root so LLM expand completes after leaving Quick Prompt. */
export function useMagicPromptExpandRunner() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const notifiedRequestIds = useRef(new Set<number>());
  const { status, requestId, pending } = state.magicExpand;

  useEffect(() => {
    if (status !== "running") return;

    if (!pending) {
      dispatch({ type: "MAGIC_EXPAND_FAILED", error: "Missing expansion request." });
      return;
    }

    return subscribeMagicExpand(requestId, pending, {
      onSuccess: (result) => {
        dispatch({
          type: "MAGIC_EXPAND_SUCCEEDED",
          rawJson: result.rawJson,
          model: result.model,
        });
        if (notifiedRequestIds.current.has(requestId)) return;
        notifiedRequestIds.current.add(requestId);
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
  }, [dispatch, navigate, pending, requestId, status]);
}
