import { useEffect, useState, useCallback, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { invalidatePromptsCache, loadPromptHistory, deletePrompt } from "@/state/storage";
import { getImages } from "@/api/client";
import { formSeedFromImage, imageEntryFromRow, pickHistoryPreviewImage } from "@/lib/image";
import { groupByLocalDate } from "@/lib/date";
import type { PromptEntry } from "@/state/types";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { aspectRatioFromSize } from "@/lib/aspectRatio";
import { presetShortLabel } from "@/lib/presetLabels";
import { useFavorites } from "@/state/favoritesContext";
import { MoreVertical, Star, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface PromptHistoryProps {
  sidebar?: boolean;
}

interface HistoryEntryRowProps {
  entry: PromptEntry;
  active: boolean;
  onRestore: (entry: PromptEntry) => void;
  onDelete: (entry: PromptEntry) => void;
}

function HistoryEntryRow({ entry, active, onRestore, onDelete }: HistoryEntryRowProps) {
  const { isFavoritePrompt, toggleFavorite } = useFavorites();
  const favorited = entry._id != null && isFavoritePrompt(entry._id);
  const savedAt = new Date(entry._savedAt);
  const timeLabel = Number.isNaN(savedAt.getTime())
    ? ""
    : savedAt.toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
  const mp = ((entry.w * entry.h) / 1e6).toFixed(2);
  const ratio = aspectRatioFromSize(entry.w, entry.h);
  const titleLine = entry.hld.trim() || "(empty)";


  return (
    <div className="group relative flex items-start gap-1.5 rounded-lg transition-colors">
      <button
        type="button"
        className={
          "relative min-w-0 flex-1 rounded-lg px-3 py-2.5 text-left transition-colors "
          + (active ? "bg-accent" : "hover:bg-accent/60")
        }
        onClick={() => onRestore(entry)}
      >
        {active && (
          <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
        )}
        <div className="min-w-0 space-y-1">
          <div className="line-clamp-2 text-body-sm font-medium leading-snug text-foreground">
            {titleLine}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[10px] text-muted-foreground">
            <span className="rounded-md bg-muted px-1.5 py-0.5 font-medium text-foreground/90">
              {presetShortLabel(entry.preset)}
            </span>
            <span className="tabular-nums">
              {entry.w}×{entry.h}
            </span>
            <span>{ratio}</span>
            <span>{mp} MP</span>

            {timeLabel ? <span className="tabular-nums">{timeLabel}</span> : null}
            {favorited ? (
              <Star className="size-2.5 shrink-0 fill-amber-400 text-amber-500" aria-hidden />
            ) : null}
          </div>
        </div>
      </button>

      <div className="shrink-0 pt-2">
        <DropdownMenu>
          <DropdownMenuTrigger
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-foreground opacity-100 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring max-sm:opacity-100 [@media(hover:none)]:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100 data-popup-open:opacity-100"
            aria-label="Entry actions"
          >
            <MoreVertical className="size-3.5" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" side="bottom" className="min-w-[11rem]">
            {entry._id != null ? (
              <DropdownMenuItem
                onClick={(e) => {
                  e.stopPropagation();
                  void toggleFavorite({ prompt_id: entry._id! });
                }}
              >
                <Star className={favorited ? "fill-amber-400 text-amber-500" : ""} />
                {favorited ? "Remove favorite" : "Add to favorites"}
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-destructive focus:text-destructive data-[highlighted]:bg-destructive/10 data-[highlighted]:text-destructive"
              onClick={(e) => {
                e.stopPropagation();
                onDelete(entry);
              }}
            >
              <Trash2 />
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}

export function PromptHistory({ sidebar }: PromptHistoryProps) {
  const { state, dispatch } = useAppState();
  const [entries, setEntries] = useState<PromptEntry[]>([]);
  const navigate = useNavigate();

  const dateGroups = useMemo(
    () => groupByLocalDate(entries, (entry) => entry._savedAt),
    [entries],
  );

  useEffect(() => {
    invalidatePromptsCache();
    loadPromptHistory().then(setEntries);
  }, [state.historyRefresh]);

  const restore = useCallback(async (entry: PromptEntry) => {
    const { _savedAt, _id, ...form } = entry;
    dispatch({ type: "RESTORE_FORM", form, promptId: _id ?? undefined });
    if (_id != null) {
      try {
        const images = await getImages({ promptId: _id });
        const image = pickHistoryPreviewImage(images, _savedAt);
        if (image) {
          dispatch({
            type: "SHOW_RESULT",
            entry: imageEntryFromRow({ ...image, prompt_id: _id }),
          });
          const seed = formSeedFromImage(image.seed);
          if (seed) {
            dispatch({ type: "SET_FORM", form: { seed } });
          }
        } else {
          dispatch({ type: "SHOW_RESULT", entry: null });
        }
      } catch {
        dispatch({ type: "SHOW_RESULT", entry: null });
      }
    }
    if (sidebar) {
      navigate({ to: "/history/$promptId", params: { promptId: String(_id) } });
    }
  }, [dispatch, sidebar, navigate]);

  const deleteEntry = useCallback(async (entry: PromptEntry) => {
    if (entry._id == null) return;
    const promptId = entry._id;
    try {
      await deletePrompt(promptId);
      setEntries((prev) => prev.filter((p) => p._id !== promptId));
      dispatch({ type: "REMOVE_IMAGES_BY_PROMPT", promptId });
      dispatch({ type: "REFRESH_HISTORY" });
      dispatch({ type: "REFRESH_FAVORITES" });
    } catch {
      toast.error("Failed to delete history entry");
    }
  }, [dispatch]);

  if (entries.length === 0 && sidebar) {
    return (
      <div className="flex flex-1 items-center justify-center px-4 text-center text-[13px] text-muted-foreground">
        No saved prompts yet.
      </div>
    );
  }

  return (
    <ScrollArea className={sidebar ? "flex-1" : undefined}>
      <div className="space-y-4 p-2 pb-3">
        {dateGroups.map((group) => (
          <section key={group.key} aria-label={group.label}>
            <div className="sticky top-0 z-10 -mx-1 mb-1 flex items-center gap-2 bg-background/95 px-2 py-1.5 backdrop-blur-sm">
              <h3 className="text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                {group.label}
              </h3>
              <div className="h-px flex-1 bg-border/60" />
              <span className="text-[10px] tabular-nums text-muted-foreground/70">
                {group.items.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {group.items.map((entry, i) => (
                <HistoryEntryRow
                  key={entry._id ?? `${group.key}-${i}`}
                  entry={entry}
                  active={Boolean(sidebar && entry._id != null && entry._id === state.selectedPromptId)}
                  onRestore={restore}
                  onDelete={deleteEntry}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </ScrollArea>
  );
}
