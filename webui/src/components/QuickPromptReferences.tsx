import type { DragEvent, RefObject } from "react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { ImageIcon, Paperclip, X } from "lucide-react";

interface QuickPromptReferencesProps {
  fileRef: RefObject<HTMLInputElement | null>;
  previews: string[];
  dragging: boolean;
  expanding: boolean;
  onAddFiles: (files: FileList | File[]) => void;
  onRemoveImage: (index: number) => void;
  onDrop: (event: DragEvent) => void;
  onDraggingChange: (dragging: boolean) => void;
}

export function QuickPromptReferences({
  fileRef,
  previews,
  dragging,
  expanding,
  onAddFiles,
  onRemoveImage,
  onDrop,
  onDraggingChange,
}: QuickPromptReferencesProps) {
  return (
    <details className="group ml-auto text-caption">
      <summary className="flex cursor-pointer list-none items-center gap-1 text-muted-foreground marker:content-none [&::-webkit-details-marker]:hidden">
        <Paperclip className="size-3.5" />
        References
        {previews.length > 0 && (
          <Badge variant="secondary" className="h-4 px-1 text-[10px] tabular-nums">
            {previews.length}
          </Badge>
        )}
      </summary>
      <div className="mt-2 space-y-2 rounded-lg border border-dashed border-border p-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          multiple
          className="hidden"
          aria-label="Attach reference images"
          onChange={(e) => onAddFiles(e.target.files ?? [])}
        />
        {previews.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {previews.map((src, index) => (
              <div
                key={src}
                className="relative h-14 w-20 overflow-hidden rounded-md border border-border bg-muted/30"
              >
                <img src={src} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5"
                  onClick={() => onRemoveImage(index)}
                  disabled={expanding}
                  aria-label="Remove reference"
                >
                  <X className="size-2.5" />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="flex h-14 w-20 items-center justify-center rounded-md border border-dashed border-border text-muted-foreground hover:border-foreground/40"
              onClick={() => fileRef.current?.click()}
              disabled={expanding}
              aria-label="Add reference image"
            >
              <ImageIcon className="size-4" />
            </button>
          </div>
        ) : (
          <button
            type="button"
            className={cn(
              "w-full rounded-md border border-dashed px-3 py-3 text-caption text-muted-foreground transition-colors",
              dragging ? "border-foreground bg-muted" : "border-border hover:border-foreground/40",
            )}
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => {
              e.preventDefault();
              onDraggingChange(true);
            }}
            onDragLeave={() => onDraggingChange(false)}
            onDrop={onDrop}
            disabled={expanding}
          >
            Drop or click to attach
          </button>
        )}
      </div>
    </details>
  );
}
