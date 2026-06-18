import { useCallback, useEffect, useRef } from "react";
import { getModelStatus } from "@/api/client";
import { useAppState } from "@/state/context";

export function useModelPolling() {
  const { dispatch } = useAppState();
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const checkStatus = useCallback(async () => {
    try {
      const data = await getModelStatus();
      dispatch({ type: "SET_MODEL_STATUS", status: data });
      return data.state;
    } catch {
      //
    }
  }, [dispatch]);

  const startPolling = useCallback(() => {
    if (intervalRef.current) clearInterval(intervalRef.current);
    intervalRef.current = setInterval(async () => {
      const s = await checkStatus();
      if (s === "loaded" || s === "idle") {
        if (intervalRef.current) clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }, 3000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [checkStatus]);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const state = await checkStatus();
      if (!cancelled && state === "loading") {
        startPolling();
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [checkStatus, startPolling]);

  return { startPolling, checkStatus };
}
