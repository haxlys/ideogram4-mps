import { createFileRoute } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { ResultGallery } from "@/components/ResultGallery";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/gallery")({
  component: GalleryPage,
});

function GalleryPage() {
  const { state } = useAppState();

  return (
    <div className="flex-1 overflow-auto">
      <div className="mx-auto max-w-6xl px-4 py-5 pb-6 md:py-7 md:pb-8">
        <div className="mb-6 flex items-center gap-3">
          <h2 className="text-title font-semibold text-foreground">
            Gallery
          </h2>
          {state.images.length > 0 && (
            <Badge variant="secondary" className="tabular-nums">
              {state.images.length}
            </Badge>
          )}
        </div>
        <ResultGallery />
      </div>
    </div>
  );
}