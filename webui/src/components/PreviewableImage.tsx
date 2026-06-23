import { Maximize2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface PreviewableImageProps {
  src: string;
  alt: string;
  onPreview: () => void;
  className?: string;
  imageClassName?: string;
  hint?: string;
  caption?: string;
  loading?: "lazy" | "eager";
}

export function PreviewableImage({
  src,
  alt,
  onPreview,
  className,
  imageClassName,
  hint = "Click to preview",
  caption,
  loading = "eager",
}: PreviewableImageProps) {
  return (
    <button
      type="button"
      className={cn(
        "group relative block w-full overflow-hidden rounded-lg bg-muted/30",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
        className,
      )}
      onClick={onPreview}
      aria-label={hint}
    >
      <img
        src={src}
        alt={alt}
        loading={loading}
        decoding="async"
        className={cn(
          "w-full cursor-zoom-in object-contain transition-transform duration-200 ease-out group-hover:scale-[1.015]",
          imageClassName,
        )}
      />
      {caption && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 truncate bg-gradient-to-t from-black/75 to-black/20 px-2 pb-1.5 pt-6 text-[11px] text-white">
          {caption}
        </div>
      )}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/0 transition-colors duration-200 group-hover:bg-black/20 group-focus-visible:bg-black/20"
      >
        <span className="flex size-9 translate-y-0.5 items-center justify-center rounded-full bg-background/92 text-foreground opacity-80 shadow-md ring-1 ring-black/10 transition-all duration-200 group-hover:translate-y-0 group-hover:opacity-100 group-focus-visible:translate-y-0 group-focus-visible:opacity-100 sm:opacity-0">
          <Maximize2 className="size-4" />
        </span>
      </div>
    </button>
  );
}