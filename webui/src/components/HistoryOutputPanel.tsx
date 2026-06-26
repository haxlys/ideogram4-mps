import { useCallback, useState } from "react";
import { useConfirm } from "@/components/ConfirmDialogProvider";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ImageLoraMeta } from "@/components/ImageLoraMeta";
import { ImagePreviewLightbox } from "@/components/ImagePreviewLightbox";
import { PreviewableImage } from "@/components/PreviewableImage";
import { useHistoryImages, type HistoryImageItem } from "@/hooks/useHistoryImages";
import { downloadImageFile, formSeedFromImage } from "@/lib/image";
import { deleteImage } from "@/state/storage";
import { useAppState } from "@/state/context";
import { cn } from "@/lib/utils";
import { Download, ImageIcon, Maximize2, Trash2 } from "lucide-react";
import { toast } from "sonner";

function formatImageTimestamp(createdAt: string | undefined): string {
  if (!createdAt) return "";
  const date = new Date(createdAt.includes("T") ? createdAt : `${createdAt.replace(" ", "T")}Z`);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function HistoryOutputPanel() {
  const confirm = useConfirm();
  const { state, dispatch } = useAppState();
  const { promptId, images, previewImageId, loading, removeImageLocally } = useHistoryImages();
  const [previewImage, setPreviewImage] = useState<HistoryImageItem | null>(null);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const activeImage = state.resultImage;

  const handleSelect = useCallback((image: HistoryImageItem) => {
    dispatch({ type: "SHOW_RESULT", entry: image, pinned: true });
    const seed = formSeedFromImage(image.seed);
    if (seed) {
      dispatch({ type: "SET_FORM", form: { seed } });
    }
  }, [dispatch]);

  const handleDelete = useCallback(async (image: HistoryImageItem) => {
    if (promptId == null) return;
    const proceed = await confirm({
      title: `Delete image #${image.id}?`,
      description: "This removes the image from this history entry.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!proceed) return;

    try {
      await deleteImage(image.id);
      dispatch({ type: "REMOVE_IMAGE", imageId: image.id });
      removeImageLocally(image.id);
      setPreviewImage((prev) => (prev?.id === image.id ? null : prev));

      if (state.resultImage?.id === image.id) {
        const remaining = images.filter((entry) => entry.id !== image.id);
        const next = remaining[0] ?? null;
        dispatch({ type: "SHOW_RESULT", entry: next });
        const seed = next ? formSeedFromImage(next.seed) : undefined;
        if (seed) {
          dispatch({ type: "SET_FORM", form: { seed } });
        }
      }

      dispatch({ type: "REFRESH_HISTORY" });
      dispatch({ type: "REFRESH_FAVORITES" });
      toast.success("Image deleted");
    } catch {
      toast.error("Failed to delete image");
    }
  }, [confirm, dispatch, images, promptId, removeImageLocally, state.resultImage]);

  const handleDownload = useCallback(async () => {
    if (!activeImage) return;
    try {
      await downloadImageFile(activeImage.url, `ideogram4-${activeImage.id}.png`);
    } catch {
      toast.error("Failed to download image");
    }
  }, [activeImage]);

  if (promptId == null) return null;

  const alt = activeImage?.hld?.slice(0, 100) ?? "Generated image";

  return (
    <>
      <section
        aria-label="Result"
        className="flex min-h-[min(52vh,480px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card md:max-h-full"
      >
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          <div className="flex shrink-0 items-center justify-between border-b border-border bg-muted/30 px-4 py-2.5">
            <div>
              <h2 className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
                Result
                {images.length > 0 && (
                  <Badge variant="secondary" className="h-5 px-1.5 text-caption tabular-nums">
                    {images.length}
                  </Badge>
                )}
              </h2>
              <p className="mt-0.5 text-caption text-muted-foreground">
                Preview and browse generated versions
              </p>
            </div>
            {activeImage && (
              <div className="flex items-center gap-0.5">
                <FavoriteButton
                  imageId={activeImage.id}
                  className="text-amber-500 hover:text-amber-600"
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Open preview"
                  onClick={() => setLightboxOpen(true)}
                >
                  <Maximize2 className="size-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Download"
                  onClick={() => void handleDownload()}
                >
                  <Download className="size-3.5" />
                </Button>
              </div>
            )}
          </div>

        <div className="surface-canvas p-4">
          {activeImage ? (
            <PreviewableImage
              src={activeImage.url}
              alt={alt}
              onPreview={() => setLightboxOpen(true)}
              hint="Open image preview"
              className="mx-auto max-h-[min(50vh,520px)] w-full rounded-lg border border-border/60 shadow-sm"
              imageClassName="h-auto max-h-[min(50vh,520px)] w-full object-contain"
            />
          ) : (
            <div className="flex min-h-[220px] flex-col items-center justify-center px-4 py-10 text-center">
              <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-muted">
                <ImageIcon className="size-4 text-muted-foreground" />
              </div>
              <p className="text-body-sm font-medium text-foreground">No image selected</p>
              <p className="mt-1 max-w-xs text-caption text-muted-foreground">
                {loading
                  ? "Loading images…"
                  : images.length > 0
                    ? "Pick a version below or regenerate."
                    : "Regenerate to create the first version."}
              </p>
            </div>
          )}
        </div>

        {activeImage && (
          <div className="border-t border-border px-4 py-3">
            <ImageLoraMeta image={activeImage} />
            {activeImage.hld && (
              <p className="mt-2 line-clamp-2 text-caption leading-relaxed text-muted-foreground">
                {activeImage.hld}
              </p>
            )}
          </div>
        )}

        <div className="border-t border-border bg-muted/20 px-3 py-3">
          {loading && images.length === 0 ? (
            <p className="py-2 text-center text-caption text-muted-foreground">Loading versions…</p>
          ) : images.length === 0 ? (
            <p className="py-2 text-center text-caption text-muted-foreground">
              No versions yet
            </p>
          ) : (
            <ul
              aria-label="Image versions"
              className="flex list-none gap-2 overflow-x-auto pb-1"
            >
              {images.map((image) => {
                const selected = activeImage?.id === image.id;
                const isLatest = previewImageId === image.id;

                return (
                  <li
                    key={image.id}
                    className={cn(
                      "group relative shrink-0 w-[88px] rounded-lg border p-1 transition-colors",
                      selected
                        ? "border-foreground/25 bg-background shadow-sm"
                        : "border-transparent bg-background/60 hover:border-border hover:bg-background",
                    )}
                  >
                    <button
                      type="button"
                      className="relative block w-full overflow-hidden rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      onClick={() => handleSelect(image)}
                      aria-label={`Show image ${image.id}`}
                      aria-pressed={selected}
                    >
                      <img
                        src={image.url}
                        alt={image.hld?.slice(0, 40) ?? `Image ${image.id}`}
                        className="aspect-square w-full object-cover"
                      />
                      {selected && (
                        <span className="absolute inset-x-0 bottom-0 bg-foreground/80 py-0.5 text-center text-[9px] font-medium text-background">
                          Active
                        </span>
                      )}
                    </button>

                    <div className="mt-1 space-y-0.5 px-0.5">
                      <div className="flex items-center justify-between gap-0.5">
                        <span className="truncate text-[10px] font-medium text-foreground">
                          #{image.id}
                        </span>
                        {isLatest && (
                          <Badge variant="outline" className="h-4 px-1 text-[8px]">
                            New
                          </Badge>
                        )}
                      </div>
                      <p className="truncate text-[9px] text-muted-foreground">
                        {formatImageTimestamp(image.createdAt) || image.time}
                      </p>
                    </div>

                    <div className="absolute top-1 right-1 flex gap-0.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 bg-background/90 shadow-sm"
                        aria-label={`Preview image ${image.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          setPreviewImage(image);
                        }}
                      >
                        <Maximize2 className="size-2.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        className="size-6 bg-background/90 text-muted-foreground shadow-sm hover:text-destructive"
                        aria-label={`Delete image ${image.id}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDelete(image);
                        }}
                      >
                        <Trash2 className="size-2.5" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        </div>
      </section>

      <ImagePreviewLightbox
        image={previewImage ?? activeImage}
        open={lightboxOpen || previewImage != null}
        onOpenChange={(open) => {
          if (!open) {
            setLightboxOpen(false);
            setPreviewImage(null);
          }
        }}
      />
    </>
  );
}
