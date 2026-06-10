import { useState } from "react";
import { useAppState } from "@/state/context";
import { magicPrompt } from "@/api/client";
import { captionToForm } from "@/validation/caption";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { toast } from "sonner";
import { Wand2 } from "lucide-react";

export function QuickPrompt() {
  const { state, dispatch } = useAppState();
  const [text, setText] = useState("");
  const [expanding, setExpanding] = useState(false);

  const handleExpand = async () => {
    const trimmed = text.trim();
    if (!trimmed) {
      toast.error("Please enter a prompt first");
      return;
    }
    setExpanding(true);
    try {
      const res = await magicPrompt(trimmed, state.form.w, state.form.h);
      const formPatch = captionToForm(res.caption as Record<string, unknown>);
      dispatch({ type: "SET_FORM", form: formPatch });
      toast.success(`Expanded with ${res.model}`);
    } catch (e) {
      toast.error(`Failed to expand prompt: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExpanding(false);
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Quick Prompt</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          placeholder="Describe your image in natural language… e.g. a Korean woman in hanbok drinking tea in an autumn garden"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-[80px] resize-y"
          disabled={expanding}
        />
        <Button
          variant="secondary"
          className="w-full"
          onClick={handleExpand}
          disabled={expanding}
        >
          {expanding ? (
            <Spinner className="mr-2 size-4" />
          ) : (
            <Wand2 className="mr-2 size-4" />
          )}
          {expanding ? "Expanding…" : "Expand to Structured Prompt"}
        </Button>
      </CardContent>
    </Card>
  );
}
