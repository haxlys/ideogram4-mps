import { useCallback, useEffect, useMemo } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { ImageLoraMeta } from "@/components/ImageLoraMeta";
import { downloadImageFile } from "@/lib/image";
import type { ImageEntry } from "@/state/types";
import { FavoriteButton } from "@/components/FavoriteButton";
import { ChevronLeft, ChevronRight, Download, History, X } from "lucide-react";
import { toast } from "sonner";

interface ImagePreviewLightboxProps {
  image: ImageEntry | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  images?: ImageEntry[];
  onImageChange?: (image: ImageEntry) => void;
}

export function ImagePreviewLightbox({
  image,
  open,
  onOpenChange,
  images,
  onImageChange,
}: ImagePreviewLightboxProps) {
  const navigate = useNavigate();
  const alt = image?.hld?.slice(0, 120) ?? "Generated image";
  const promptId = image?.historyLinked ? image.prompt_id : null;

  const currentIndex = useMemo(() => {
    if (!image || !images?.length) return -1;
    return images.findIndex((entry) => entry.id === image.id);
  }, [image, images]);

  const canNavigate = images != null && images.length > 1 && onImageChange != null && currentIndex >= 0;
  const canGoPrevious = canNavigate && currentIndex > 0;
  const canGoNext = canNavigate && currentIndex < images.length - 1;

  const goToPrevious = useCallback(() => {
    if (!canGoPrevious || !images || !onImageChange) return;
    onImageChange(images[currentIndex - 1]!);
  }, [canGoPrevious, currentIndex, images, onImageChange]);

  const goToNext = useCallback(() => {
    if (!canGoNext || !images || !onImageChange) return;
    onImageChange(images[currentIndex + 1]!);
  }, [canGoNext, currentIndex, images, onImageChange]);

  useEffect(() => {
    if (!open || !canNavigate) return;

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        goToPrevious();
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        goToNext();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open, canNavigate, goToNext, goToPrevious]);

  const handleDownload = useCallback(async () => {
    if (!image) return;
    try {
      await downloadImageFile(image.url, `ideogram4-${image.id}.png`);
    } catch {
      toast.error("Failed to download image");
    }
  }, [image]);

  const handleOpenHistory = useCallback(() => {
    if (promptId == null) return;
    onOpenChange(false);
    navigate({ to: "/history/$promptId", params: { promptId: String(promptId) } });
  }, [promptId, onOpenChange, navigate]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/88 supports-backdrop-filter:backdrop-blur-sm"
        className="fixed inset-0 top-0 left-0 z-50 flex h-dvh w-dvw max-h-none max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 bg-transparent p-0 shadow-none ring-0 duration-200 sm:max-w-none"
      >
        <div className="flex shrink-0 items-center justify-between gap-3 px-4 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-[12px] text-white/70">
              {image?.hld ? image.hld.slice(0, 80) : "Image preview"}
            </p>
            {canNavigate && (
              <p className="mt-0.5 text-[10px] tabular-nums text-white/45">
                {currentIndex + 1} / {images.length}
              </p>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <span className="mr-1 hidden text-[10px] text-white/45 sm:inline">
              {canNavigate ? "← → navigate · Esc to close" : "Esc to close"}
            </span>
            {image && (
              <FavoriteButton
                imageId={image.id}
                className="text-amber-300 hover:bg-white/12 hover:text-amber-200"
              />
            )}
            {promptId != null && (
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-white/85 hover:bg-white/12 hover:text-white"
                aria-label="Open in history"
                onClick={handleOpenHistory}
              >
                <History className="size-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white/85 hover:bg-white/12 hover:text-white"
              aria-label="Download image"
              onClick={() => void handleDownload()}
              disabled={!image}
            >
              <Download className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              className="text-white/85 hover:bg-white/12 hover:text-white"
              aria-label="Close preview"
              onClick={() => onOpenChange(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>

        <div className="relative flex min-h-0 flex-1 items-center justify-center px-3 pb-2 sm:px-14">
          {canGoPrevious && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 left-2 z-10 -translate-y-1/2 bg-black/35 text-white hover:bg-black/55 hover:text-white sm:left-4"
              aria-label="Previous image"
              onClick={goToPrevious}
            >
              <ChevronLeft className="size-5" />
            </Button>
          )}
          {image && (
            <img
              key={image.id}
              src={image.url}
              alt={alt}
              className="max-h-[calc(100dvh-9.5rem)] max-w-full cursor-zoom-out rounded-md object-contain shadow-2xl shadow-black/50"
              style={{ width: "auto" }}
              fetchPriority="high"
            />
          )}
          {canGoNext && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="absolute top-1/2 right-2 z-10 -translate-y-1/2 bg-black/35 text-white hover:bg-black/55 hover:text-white sm:right-4"
              aria-label="Next image"
              onClick={goToNext}
            >
              <ChevronRight className="size-5" />
            </Button>
          )}
        </div>

        {image && (
          <div className="shrink-0 border-t border-white/10 bg-black/45 px-4 py-3 backdrop-blur-md sm:px-6">
            <div className="flex items-start justify-between gap-3">
              <ImageLoraMeta image={image} tone="on-dark" className="min-w-0 flex-1" />
              {promptId != null && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-white/85 hover:bg-white/12 hover:text-white"
                  onClick={handleOpenHistory}
                >
                  <History className="size-3.5" />
                  Open in History
                </Button>
              )}
            </div>
            {image.hld && (
              <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-white/75">
                {image.hld}
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}