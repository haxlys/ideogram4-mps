import { useState } from "react";
import { useAppState } from "@/state/context";
import { SceneDesc } from "./SceneDesc";
import { StyleSettings } from "./StyleSettings";
import { Composition } from "./Composition";
import { QuickPrompt } from "./QuickPrompt";
import { Textarea } from "@/components/ui/textarea";

export function CaptionEditor() {
  const { state, dispatch } = useAppState();
  const [tab, setTab] = useState<"form" | "json">("form");

  return (
    <div className="space-y-4">
      <div className="flex gap-1 rounded-lg bg-muted p-1 w-fit">
        <button
          type="button"
          className={"rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors " + (tab === "form" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setTab("form")}
        >
          Form
        </button>
        <button
          type="button"
          className={"rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors " + (tab === "json" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")}
          onClick={() => setTab("json")}
        >
          JSON
        </button>
      </div>

      {tab === "form" ? (
        <div className="space-y-5">
          <QuickPrompt />
          <SceneDesc />
          <StyleSettings />
          <Composition />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Textarea
              placeholder='{"high_level_description": "...", "compositional_deconstruction": {...}}'
              value={state.form.rawJson}
              onChange={(e) => dispatch({ type: "SET_FORM", form: { rawJson: e.target.value } })}
              className="min-h-[400px] resize-y font-mono text-[13px]"
            />
          </div>
        </div>
      )}
    </div>
  );
}
