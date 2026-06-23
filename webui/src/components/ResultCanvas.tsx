import { useCallback, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { Button } from "@/components/ui/button";
import { ImageLoraMeta } from "@/components/ImageLoraMeta";
import { ImagePreviewLightbox } from "@/components/ImagePreviewLightbox";
import { PreviewableImage } from "@/components/PreviewableImage";
import { FavoriteButton } from "@/components/FavoriteButton";
import { downloadImageFile } from "@/lib/image";
import { Download, History, ImageIcon, Maximize2, X } from "lucide-react";
import { toast } from "sonner";

export function ResultCanvas() {
  const { state, dispatch } = useAppState();
  const navigate = useNavigate();
  const [previewOpen, setPreviewOpen] = useState(false);
  const image = state.resultImage;

  const handleOpenHistory = useCallback(() => {
    const promptId = image?.historyLinked ? image.prompt_id : null;
    if (promptId == null) return;
    navigate({ to: "/history/$promptId", params: { promptId: String(promptId) } });
  }, [image, navigate]);

  const handleDownload = useCallback(async () => {
    if (!image) return;
    try {
      await downloadImageFile(image.url, `ideogram4-${image.id}.png`);
    } catch {
      toast.error("Failed to download image");
    }
  }, [image]);

  if (!image) {
    return (
      <section
        aria-label="Result canvas"
        className="flex min-h-[min(52vh,420px)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-card"
      >
        <div className="border-b border-border bg-muted/30 px-4 py-2.5">
          <h2 className="text-body-sm font-semibold text-foreground">Preview</h2>
          <p className="mt-0.5 text-caption text-muted-foreground">
            Your generated image appears here
          </p>
        </div>
        <div className="flex flex-1 flex-col items-center justify-center surface-canvas px-6 py-10 text-center">
          <div className="mb-5 flex size-14 items-center justify-center rounded-2xl border border-border/60 bg-background/80 shadow-card">
            <ImageIcon className="size-6 text-muted-foreground" />
          </div>
          <h3 className="text-title font-semibold text-foreground">Ready to create</h3>
          <p className="mt-2 max-w-[16rem] text-body-sm leading-relaxed text-muted-foreground">
            Write a prompt on the left, then tap Generate to see your image.
          </p>
          <ol className="mt-6 flex max-w-[15rem] flex-col gap-2 text-left text-caption text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-generate-muted text-[10px] font-semibold text-generate">
                1
              </span>
              <span>Describe your scene in Quick or Form mode</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-generate-muted text-[10px] font-semibold text-generate">
                2
              </span>
              <span>Pick resolution and aspect ratio</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full bg-generate-muted text-[10px] font-semibold text-generate">
                3
              </span>
              <span>Generate and preview here</span>
            </li>
          </ol>
        </div>
      </section>
    );
  }

  const alt = image.hld?.slice(0, 100) ?? "Generated image";
  const promptId = image.historyLinked ? image.prompt_id : null;

  return (
    <>
      <section
        aria-label="Result canvas"
        className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
      >
        <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-2.5">
          <h2 className="flex items-center gap-2 text-body-sm font-semibold text-foreground">
            <span className="size-1.5 rounded-full bg-emerald-500" />
            Result
          </h2>
          <div className="flex items-center gap-0.5">
            <FavoriteButton
              imageId={image.id}
              className="text-amber-500 hover:text-amber-600"
            />
            {promptId != null && (
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label="Open in history"
                onClick={handleOpenHistory}
              >
                <History className="size-3.5" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Open preview"
              onClick={() => setPreviewOpen(true)}
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label="Dismiss"
              onClick={() => dispatch({ type: "SHOW_RESULT", entry: null })}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>

        <div className="surface-canvas p-4">
          <PreviewableImage
            src={image.url}
            alt={alt}
            onPreview={() => setPreviewOpen(true)}
            hint="Open image preview"
            className="mx-auto max-h-[min(60vh,640px)] w-auto rounded-lg border border-border/60 shadow-sm"
            imageClassName="h-auto max-h-[min(60vh,640px)] w-full object-contain"
          />
        </div>

        <div className="border-t border-border px-4 py-3">
          <ImageLoraMeta image={image} />
          {image.hld && (
            <p className="mt-2 line-clamp-2 text-caption leading-relaxed text-muted-foreground">
              {image.hld}
            </p>
          )}
        </div>
      </section>

      <ImagePreviewLightbox
        image={image}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />
    </>
  );
}