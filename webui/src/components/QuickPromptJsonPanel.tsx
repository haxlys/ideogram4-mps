import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, Copy } from "lucide-react";

interface QuickPromptJsonPanelProps {
  generatedJson: string;
  ready: boolean;
  copied: boolean;
  onCopy: () => void;
}

export function QuickPromptJsonPanel({
  generatedJson,
  ready,
  copied,
  onCopy,
}: QuickPromptJsonPanelProps) {
  return (
    <Accordion defaultValue={[]}>
      <AccordionItem value="json" className="border-t border-border/60">
        <div className="flex items-center gap-2">
          <AccordionTrigger className="flex-1 py-2.5 hover:no-underline">
            <span className="flex items-center gap-2">
              Caption JSON
              {ready && (
                <Badge variant="outline" className="h-4 px-1.5 text-[10px] font-normal">
                  ready
                </Badge>
              )}
            </span>
          </AccordionTrigger>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 shrink-0 px-2"
            onClick={() => onCopy()}
            aria-label="Copy caption JSON"
          >
            {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          </Button>
        </div>
        <AccordionContent className="pb-2">
          <pre className="max-h-48 overflow-y-auto overflow-x-hidden whitespace-pre-wrap break-words rounded-md bg-muted/40 p-2 font-mono text-caption leading-relaxed text-foreground">
            {generatedJson}
          </pre>
        </AccordionContent>
      </AccordionItem>
    </Accordion>
  );
}
