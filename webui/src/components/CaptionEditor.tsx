import { useState } from "react";
import { useAppState } from "@/state/context";
import { SceneDesc } from "./SceneDesc";
import { StyleSettings } from "./StyleSettings";
import { Composition } from "./Composition";
import { QuickPrompt } from "./QuickPrompt";
import { Button } from "@/components/ui/button";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { Braces, FileText, Info, Wand2 } from "lucide-react";

const TABS = [
  { id: "quick" as const, label: "Quick", icon: Wand2 },
  { id: "form" as const, label: "Form", icon: FileText },
  { id: "json" as const, label: "JSON", icon: Braces },
];

export function CaptionEditor() {
  const { state, dispatch } = useAppState();
  const [tab, setTab] = useState<"quick" | "form" | "json">("quick");
  const [guideOpen, setGuideOpen] = useState(false);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex gap-1 rounded-xl bg-muted p-1 w-fit shadow-card">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-body-sm font-medium transition-colors",
                tab === id
                  ? "bg-card text-foreground shadow-sm ring-1 ring-border"
                  : "text-muted-foreground hover:bg-card/80 hover:text-foreground",
              )}
              onClick={() => setTab(id)}
            >
              <Icon className="size-3.5" />
              {label}
            </button>
          ))}
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                aria-label="Open prompt writing guide"
                onClick={() => setGuideOpen(true)}
              />
            }
          >
            <Info />
          </TooltipTrigger>
          <TooltipContent side="left">Prompt writing guide</TooltipContent>
        </Tooltip>
      </div>

      {tab === "quick" ? (
        <QuickPrompt />
      ) : tab === "form" ? (
        <Accordion defaultValue={["scene", "style"]}>
          <AccordionItem value="scene">
            <AccordionTrigger>Scene description</AccordionTrigger>
            <AccordionContent>
              <SceneDesc />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="style">
            <AccordionTrigger>Style settings</AccordionTrigger>
            <AccordionContent>
              <StyleSettings />
            </AccordionContent>
          </AccordionItem>
          <AccordionItem value="composition">
            <AccordionTrigger>Composition & layout</AccordionTrigger>
            <AccordionContent>
              <Composition />
            </AccordionContent>
          </AccordionItem>
        </Accordion>
      ) : (
        <div className="space-y-3">
          <Textarea
            placeholder='{"high_level_description": "...", "compositional_deconstruction": {...}}'
            value={state.form.rawJson}
            onChange={(e) => dispatch({ type: "SET_FORM", form: { rawJson: e.target.value } })}
            className="min-h-[400px] resize-y font-mono text-body-sm"
          />
        </div>
      )}

      <PromptGuideDialog open={guideOpen} onOpenChange={setGuideOpen} />
    </div>
  );
}

function PromptGuideDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Structured Prompt Guide</DialogTitle>
          <DialogDescription>
            Use the form as a structured caption, not as a loose text prompt.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-5 text-body-sm leading-6 text-foreground">
          <section className="space-y-2">
            <h3 className="text-body font-semibold">1. Keep the medium consistent</h3>
            <p className="text-muted-foreground">
              Choose the medium first. Use <code>photograph</code> with a camera or lens value in <code>Photo</code>. Use non-photo media with a true <code>Art Style</code>, such as watercolor, oil painting, realistic 3D render, or clean editorial design.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-body font-semibold">2. Use each field for the right job</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li><strong>High-Level Description</strong>: subject, scene, and composition.</li>
              <li><strong>Style Settings</strong>: medium, lens feel, lighting, color palette, and rendering style.</li>
              <li><strong>Background</strong>: the room, floor, walls, windows, sky, weather, and ambient setting.</li>
              <li><strong>Elements</strong>: the main subjects, props, equipment, signs, and readable text blocks.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-body font-semibold">3. Composition comes from HLD, elements, and bbox</h3>
            <p className="text-muted-foreground">
              Camera presets alone rarely change composition. If you want a close-up, low angle, wide environmental shot, or fisheye framing, say that in the High-Level Description and element descriptions. Add or remove bboxes depending on how tightly you want to lock the layout.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-body font-semibold">4. Use bboxes deliberately</h3>
            <p className="text-muted-foreground">
              A bbox is a strong placement lock. Use it for exact layouts, typography, product placement, and repeatable compositions. Omit it when exploring lens effects, dynamic framing, or natural camera variation.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-body font-semibold">5. Write clean element descriptions</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>One coherent subject should be one element.</li>
              <li>Start with identity, then major visible attributes.</li>
              <li>Do not put lens, bokeh, exposure, render engine, or camera language inside element descriptions.</li>
              <li>Do not split body parts, object parts, floors, shadows, or background surfaces into separate elements.</li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-body font-semibold">6. Avoid safety and schema failures</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
              <li>Use <code>adult</code> for adult human subjects when age could be ambiguous.</li>
              <li>Keep the medium, HLD, and style fields semantically aligned.</li>
              <li>Use uppercase hex colors, such as <code>#1A1A1A</code>.</li>
              <li>Generate one pilot image before running a large batch.</li>
            </ul>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}