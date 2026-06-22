import { useCallback, useEffect, useMemo, useState } from "react";
import { getImages } from "@/api/client";
import {
  findLatestDoneJobResult,
  historyPreviewImageId,
  imageEntryFromRow,
  sortHistoryImagesByCreatedAt,
} from "@/lib/image";
import { loadPromptHistory } from "@/state/storage";
import { useAppState } from "@/state/context";
import type { ImageEntry } from "@/state/types";

export interface HistoryImageItem extends ImageEntry {
  createdAt: string;
}

interface HistoryImagesSnapshot {
  promptId: number;
  items: HistoryImageItem[];
  savedAt: string | null;
  loading: boolean;
}

export function useHistoryImages() {
  const { state } = useAppState();
  const promptId = state.selectedPromptId;
  const [snapshot, setSnapshot] = useState<HistoryImagesSnapshot | null>(null);

  useEffect(() => {
    if (promptId == null) return;

    let cancelled = false;
    const activePromptId = promptId;

    queueMicrotask(() => {
      if (cancelled) return;
      setSnapshot({
        promptId: activePromptId,
        items: [],
        savedAt: null,
        loading: true,
      });
    });

    (async () => {
      try {
        const entries = await loadPromptHistory();
        if (cancelled) return;

        const entry = entries.find((row) => row._id === activePromptId);
        if (!entry?._id) {
          setSnapshot({
            promptId: activePromptId,
            items: [],
            savedAt: null,
            loading: false,
          });
          return;
        }

        const rows = await getImages({ promptId: entry._id });
        if (cancelled) return;

        setSnapshot({
          promptId: activePromptId,
          items: sortHistoryImagesByCreatedAt(rows).map((row) => ({
            ...imageEntryFromRow({ ...row, prompt_id: entry._id }),
            createdAt: row.created_at,
          })),
          savedAt: entry._savedAt,
          loading: false,
        });
      } catch {
        if (!cancelled) {
          setSnapshot({
            promptId: activePromptId,
            items: [],
            savedAt: null,
            loading: false,
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [promptId, state.historyRefresh]);

  const synced = useMemo(() => {
    if (promptId == null || snapshot?.promptId !== promptId) {
      return { items: [] as HistoryImageItem[], savedAt: null as string | null, loading: false };
    }
    return {
      items: snapshot.items,
      savedAt: snapshot.savedAt,
      loading: snapshot.loading,
    };
  }, [promptId, snapshot]);

  const { items, savedAt, loading } = synced;

  const images = useMemo(() => {
    if (promptId == null) return [];

    const merged = [...items];
    for (const job of state.genQueue) {
      if (
        job.promptId === promptId
        && job.status === "done"
        && job.result?.historyLinked
        && !job.historyLinkFailed
        && !merged.some((img) => img.id === job.result!.id)
      ) {
        const resultId = job.result!.id;
        const inApiSnapshot = items.some((item) => item.id === resultId);
        // Drop stale queue results once API data is current (e.g. deleted images).
        if (!loading && !inApiSnapshot) continue;

        merged.unshift({
          ...job.result,
          createdAt: new Date(job.createdAt).toISOString(),
        });
      }
    }
    return merged;
  }, [items, loading, promptId, state.genQueue]);

  const removeImageLocally = useCallback((imageId: number) => {
    setSnapshot((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.filter((item) => item.id !== imageId),
      };
    });
  }, []);

  const previewImageId = useMemo(() => {
    if (promptId == null) return null;

    if (savedAt && items.length > 0) {
      const picked = historyPreviewImageId(
        items.map((item) => ({
          id: item.id,
          hld: item.hld,
          created_at: item.createdAt,
        })),
        savedAt,
      );
      if (picked != null) return picked;
    }

    return findLatestDoneJobResult(state.genQueue, promptId)?.id ?? images[0]?.id ?? null;
  }, [images, items, promptId, savedAt, state.genQueue]);

  return {
    promptId,
    images,
    previewImageId,
    loading,
    removeImageLocally,
  };
}