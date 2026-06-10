import { useAppState } from "@/state/context";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Plus, Trash2 } from "lucide-react";

export function Composition() {
  const { state, dispatch } = useAppState();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Composition</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1.5">
          <Label htmlFor="bg" className="text-[13px] font-medium">Background *</Label>
          <Textarea
            id="bg"
            placeholder="Describe the background…"
            value={state.form.bg}
            onChange={(e) => dispatch({ type: "SET_FORM", form: { bg: e.target.value } })}
            className="min-h-[60px] resize-y"
          />
        </div>

        <Separator />

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <Label className="text-[13px] font-medium">Elements</Label>
            <Button variant="outline" size="sm" onClick={() => dispatch({ type: "ADD_ELEMENT" })}>
              <Plus className="mr-1 size-3.5" />
              Add
            </Button>
          </div>

          {state.form.els.map((el, i) => (
            <div key={el.id} className="rounded-lg border border-border bg-muted/30 p-3 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-muted-foreground">#{i + 1}</span>
                {state.form.els.length > 1 && (
                  <Button
                    variant="ghost"
                    size="icon-xs"
                    onClick={() => dispatch({ type: "REMOVE_ELEMENT", index: i })}
                    aria-label="Remove element"
                  >
                    <Trash2 className="size-3.5 text-destructive" />
                  </Button>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-xs">Type / BBox</Label>
                  <div className="flex gap-1.5">
                    <Select
                      value={el.type}
                      onValueChange={(v) => v &&
                        dispatch({ type: "UPDATE_ELEMENT", index: i, field: "type", value: v })
                      }
                    >
                      <SelectTrigger className="h-9 w-20 text-xs shrink-0">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="obj">obj</SelectItem>
                        <SelectItem value="text">text</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      className="h-9 min-w-0 text-xs"
                      placeholder="0,0,512,512"
                      value={el.bbox}
                      onChange={(e) =>
                        dispatch({
                          type: "UPDATE_ELEMENT",
                          index: i,
                          field: "bbox",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                </div>
                {el.type === "text" && (
                  <div className="space-y-1">
                    <Label className="text-xs">Text</Label>
                    <Input
                      className="h-9 text-xs"
                      placeholder="Text content…"
                      value={el.text}
                      onChange={(e) =>
                        dispatch({
                          type: "UPDATE_ELEMENT",
                          index: i,
                          field: "text",
                          value: e.target.value,
                        })
                      }
                    />
                  </div>
                )}
              </div>

              <div className="space-y-1">
                <Label className="text-xs">{el.type === "obj" ? "Description" : "Full Description"}</Label>
                <Textarea
                  className="min-h-[50px] resize-y text-xs"
                  placeholder="Describe this element in detail…"
                  value={el.desc}
                  onChange={(e) =>
                    dispatch({
                      type: "UPDATE_ELEMENT",
                      index: i,
                      field: "desc",
                      value: e.target.value,
                    })
                  }
                />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
