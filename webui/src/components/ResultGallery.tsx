import { useEffect, useState } from "react";
import { useAppState } from "@/state/context";
import { invalidateImageCache, loadImages } from "@/state/storage";
import {
  Dialog,
  DialogContent,
} from "@/components/ui/dialog";

export function ResultGallery() {
  const { state, dispatch } = useAppState();
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    invalidateImageCache();
    loadImages().then((saved) => {
      dispatch({ type: "SET_IMAGES", entries: saved });
    });
  }, [dispatch]);

  if (state.images.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card/30 px-4 py-10 text-center text-[13px] text-muted-foreground">
        Generated images will appear here.
      </div>
    );
  }

  return (
    <>
      <div className="masonry-gallery">
        {state.images.map((img) => (
          <button
            key={img.id}
            type="button"
            className="relative overflow-hidden rounded-lg border border-border bg-muted transition-opacity hover:opacity-80 w-full"
            onClick={() => setPreviewUrl(img.url)}
          >
            <img
              src={img.url}
              alt={img.hld?.slice(0, 60) ?? ""}
              className="w-full h-auto"
              loading="lazy"
            />
            <div className="absolute bottom-0 left-0 right-0 truncate bg-black/60 px-2 py-1 text-[11px] text-white">
              {img.hld?.slice(0, 32) ?? ""}
            </div>
          </button>
        ))}
      </div>

      <Dialog open={!!previewUrl} onOpenChange={() => setPreviewUrl(null)}>
        <DialogContent className="max-w-[95vw] w-auto border-border p-2 sm:max-w-[95vw]">
          {previewUrl && (
            <img
              src={previewUrl}
              alt="Preview"
              className="max-h-[90vh] max-w-full rounded object-contain"
              style={{ width: "auto" }}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
