import { CaptionEditor } from "@/components/CaptionEditor";
import { Sparkles } from "lucide-react";

export function PromptSection() {
  return (
    <section
      aria-label="Prompt"
      className="overflow-hidden rounded-2xl border border-generate/15 bg-card shadow-card ring-1 ring-generate/5"
    >
      <div className="border-b border-border bg-gradient-to-r from-generate-muted/80 via-muted/30 to-transparent px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-6 items-center justify-center rounded-md bg-generate text-generate-foreground">
            <Sparkles className="size-3.5" />
          </span>
          <div>
            <h2 className="text-body-sm font-semibold text-foreground">Prompt</h2>
            <p className="mt-0.5 text-caption text-muted-foreground">
              Quick, Form, or raw JSON caption
            </p>
          </div>
        </div>
      </div>
      <div className="p-4">
        <CaptionEditor />
      </div>
    </section>
  );
}