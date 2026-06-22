import { useCallback, useEffect, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { useAppState } from "@/state/context";
import {
  deleteAllOrphanImages,
  deleteImage,
  invalidateImageCache,
  loadLinkedImages,
  loadOrphanImages,
} from "@/state/storage";
import { getImageStats, type ImageStats } from "@/api/client";
import { GalleryImageCard } from "@/components/GalleryImageCard";
import { ImagePreviewLightbox } from "@/components/ImagePreviewLightbox";
import { MasonryGallery } from "@/components/MasonryGallery";
import { Button } from "@/components/ui/button";
import { galleryImageHistoryPromptId } from "@/lib/gallery";
import type { ImageEntry } from "@/state/types";
import { AlertTriangle, ChevronDown, ChevronRight, Trash2 } from "lucide-react";
import { toast } from "sonner";

function GalleryGrid({
  images,
  onPreview,
  onDelete,
  deleteLabel = "Delete image",
}: {
  images: ImageEntry[];
  onPreview: (img: ImageEntry) => void;
  onDelete?: (img: ImageEntry) => void;
  deleteLabel?: string;
}) {
  return (
    <MasonryGallery>
      {images.map((img) => (
        <GalleryImageCard
          key={img.id}
          src={img.url}
          alt={img.hld?.slice(0, 60) ?? "Generated image"}
          imageId={img.id}
          historyPromptId={galleryImageHistoryPromptId(img)}
          caption={img.hld?.slice(0, 32)}
          previewHint={`Preview ${img.hld?.slice(0, 40) ?? "image"}`}
          onPreview={() => onPreview(img)}
          onDelete={onDelete ? () => onDelete(img) : undefined}
          deleteLabel={deleteLabel}
        />
      ))}
    </MasonryGallery>
  );
}

export function ResultGallery() {
  const confirm = useConfirm();
  const { state, dispatch } = useAppState();
  const [previewImage, setPreviewImage] = useState<ImageEntry | null>(null);
  const [previewImages, setPreviewImages] = useState<ImageEntry[]>([]);
  const [orphans, setOrphans] = useState<ImageEntry[]>([]);
  const [stats, setStats] = useState<ImageStats | null>(null);
  const [orphansOpen, setOrphansOpen] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  const [orphanLoadIssue, setOrphanLoadIssue] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invalidateImageCache();
    Promise.all([
      loadLinkedImages(),
      loadOrphanImages(),
      getImageStats().catch(() => null),
    ]).then(([linked, orphanRows, imageStats]) => {
      if (cancelled) return;
      const linkedIds = new Set(linked.map((img) => img.id));
      const orphansOnly = orphanRows.filter((img) => !linkedIds.has(img.id));
      dispatch({ type: "SET_IMAGES", entries: linked });
      setOrphans(orphansOnly);
      setStats(imageStats);
      setOrphanLoadIssue(
        imageStats != null
        && imageStats.orphans > 0
        && orphansOnly.length === 0,
      );
    });
    return () => {
      cancelled = true;
    };
  }, [dispatch, state.historyRefresh, state.favoritesRefresh]);

  const openPreview = useCallback((image: ImageEntry, images: ImageEntry[]) => {
    setPreviewImages(images);
    setPreviewImage(image);
  }, []);

  const handleDeleteImage = useCallback(async (
    image: ImageEntry,
    options?: { orphan?: boolean },
  ) => {
    const proceed = await confirm({
      title: options?.orphan
        ? "Delete unlinked image?"
        : `Delete image #${image.id}?`,
      description: options?.orphan
        ? "This cannot be undone."
        : "This permanently removes the image from the gallery and its history entry.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!proceed) return;

    try {
      await deleteImage(image.id);
      dispatch({ type: "REMOVE_IMAGE", imageId: image.id });
      setOrphans((prev) => prev.filter((img) => img.id !== image.id));
      setPreviewImages((prev) => prev.filter((entry) => entry.id !== image.id));
      setPreviewImage((prev) => (prev?.id === image.id ? null : prev));
      setStats((prev) => {
        if (!prev) return prev;
        return {
          ...prev,
          total: Math.max(0, prev.total - 1),
          orphans: options?.orphan
            ? Math.max(0, prev.orphans - 1)
            : prev.orphans,
        };
      });
      dispatch({ type: "REFRESH_HISTORY" });
      dispatch({ type: "REFRESH_FAVORITES" });
      toast.success(options?.orphan ? "Unlinked image deleted" : "Image deleted");
    } catch {
      toast.error("Failed to delete image");
    }
  }, [confirm, dispatch]);

  const handleDeleteAllOrphans = useCallback(async () => {
    const count = stats?.orphans ?? orphans.length;
    if (count === 0) return;
    const proceed = await confirm({
      title: `Delete all ${count} unlinked image(s)?`,
      description: "This cannot be undone.",
      confirmLabel: "Delete all",
      destructive: true,
    });
    if (!proceed) return;
    setCleaning(true);
    try {
      const deleted = await deleteAllOrphanImages();
      setOrphans([]);
      setStats((prev) =>
        prev
          ? {
              ...prev,
              total: prev.total - deleted,
              orphans: 0,
              null_prompt_id: 0,
              dangling: 0,
            }
          : prev,
      );
      toast.success(`Deleted ${deleted} unlinked image(s)`);
    } catch {
      toast.error("Failed to delete unlinked images");
    } finally {
      setCleaning(false);
    }
  }, [confirm, orphans.length, stats?.orphans]);

  const orphanCount = stats?.orphans ?? orphans.length;

  return (
    <>
      {state.images.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border surface-canvas px-4 py-14 text-center">
          <p className="text-title font-semibold text-foreground">No images yet</p>
          <p className="mt-2 text-body-sm text-muted-foreground">
            Generated images linked to history will appear here.
          </p>
        </div>
      ) : (
        <GalleryGrid
          images={state.images}
          onPreview={(img) => openPreview(img, state.images)}
          onDelete={(img) => void handleDeleteImage(img)}
        />
      )}

      {orphanCount > 0 && (
        <section className="mt-8 rounded-xl border border-border bg-card shadow-card">
          <button
            type="button"
            className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-muted/30 transition-colors rounded-xl"
            onClick={() => setOrphansOpen((open) => !open)}
          >
            {orphansOpen ? (
              <ChevronDown className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
            )}
            <AlertTriangle className="size-4 shrink-0 text-amber-600" />
            <div className="min-w-0 flex-1">
              <p className="text-body-sm font-medium text-foreground">
                Maintenance · Unlinked images ({orphanCount})
              </p>
              <p className="text-caption text-muted-foreground">
                Not connected to a history entry
                {stats != null && stats.null_prompt_id > 0 && stats.dangling > 0
                  ? ` — ${stats.null_prompt_id} without prompt, ${stats.dangling} stale link`
                  : stats != null && stats.null_prompt_id > 0
                    ? ` — ${stats.null_prompt_id} without prompt`
                    : stats != null && stats.dangling > 0
                      ? ` — ${stats.dangling} stale link`
                      : ""}
              </p>
              {orphanLoadIssue && (
                <p className="mt-1 text-[11px] text-amber-700">
                  Backend may need a restart to load the full unlinked list. Run{" "}
                  <code className="rounded bg-amber-500/10 px-1 py-0.5 text-[10px]">./run.sh backend</code>.
                </p>
              )}
            </div>
            <Button
              variant="destructive"
              size="sm"
              className="shrink-0"
              disabled={cleaning}
              onClick={(e) => {
                e.stopPropagation();
                void handleDeleteAllOrphans();
              }}
            >
              <Trash2 className="size-3.5" />
              Delete all
            </Button>
          </button>

          {orphansOpen && (
            <div className="border-t border-amber-500/20 px-4 pb-4 pt-3">
              <MasonryGallery>
                {orphans.map((img) => (
                  <GalleryImageCard
                    key={img.id}
                    src={img.url}
                    alt={img.hld?.slice(0, 60) ?? "Unlinked image"}
                    imageId={img.id}
                    historyPromptId={galleryImageHistoryPromptId(img)}
                    borderClassName="border-amber-500/30"
                    caption={
                      img.prompt_id != null
                        ? `Stale #${img.prompt_id}`
                        : img.hld?.slice(0, 32)
                    }
                    previewHint={
                      img.prompt_id != null
                        ? `Unlinked image (stale prompt #${img.prompt_id})`
                        : "Preview unlinked image"
                    }
                    onPreview={() => openPreview(img, orphans)}
                    onDelete={() => void handleDeleteImage(img, { orphan: true })}
                    deleteLabel="Delete unlinked image"
                  />
                ))}
              </MasonryGallery>
            </div>
          )}
        </section>
      )}

      <ImagePreviewLightbox
        image={previewImage}
        images={previewImages}
        onImageChange={setPreviewImage}
        open={previewImage != null}
        onOpenChange={(open) => {
          if (!open) {
            setPreviewImage(null);
            setPreviewImages([]);
          }
        }}
      />
    </>
  );
}