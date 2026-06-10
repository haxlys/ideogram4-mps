import { useCallback, useRef } from "react";
import { getTaskStatus } from "@/api/client";
import { useAppState } from "@/state/context";
import type { ImageEntry } from "@/state/types";

export function useGeneratePolling() {
  const { dispatch } = useAppState();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startPolling = useCallback(
    (taskId: string) => {
      if (intervalRef.current) clearInterval(intervalRef.current);

      let retries = 0;

      intervalRef.current = setInterval(async () => {
        try {
          const data = await getTaskStatus(taskId);
          retries = 0;

          if (data.state === "running") {
            dispatch({
              type: "SET_GEN_STATUS",
              status: "running",
              msg: data.msg ?? "Generating...",
              progress: data.progress ?? 0,
              totalSteps: data.total_steps ?? 0,
            });
          } else if (data.state === "done" && data.image) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            const entry: ImageEntry = {
              id: data.image.id ?? Date.now(),
              url: data.image.url ?? "",
              hld: data.image.hld ?? "",
              time: data.image.time ?? new Date().toLocaleTimeString(),
              prompt_id: data.image.prompt_id,
            };
            dispatch({ type: "ADD_IMAGE", entry });
            dispatch({ type: "SHOW_RESULT", entry });
            dispatch({
              type: "SET_GEN_STATUS",
              status: "done",
              msg: "Done",
              taskId: null,
            });
          }
        } catch {
          retries++;
          if (retries >= 3) {
            if (intervalRef.current) clearInterval(intervalRef.current);
            intervalRef.current = null;
            dispatch({
              type: "SET_GEN_STATUS",
              status: "error",
              msg: "Network error after 3 retries.",
              taskId: null,
            });
          } else {
            dispatch({ type: "SET_GEN_STATUS", status: "running", msg: `Retrying (${retries}/3)...` });
          }
        }
      }, 2000);

      return () => {
        if (intervalRef.current) clearInterval(intervalRef.current);
      };
    },
    [dispatch],
  );

  return { startPolling };
}
