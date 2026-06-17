import { useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";
import { useAppState } from "@/state/context";
import type { FormElement } from "@/state/types";
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
import { Plus, Trash2, X } from "lucide-react";

const BBOX_MAX = 1000;
const BBOX_MIN_SIZE = 20;
const DEFAULT_BOX_SIZE = 420;
const BBOX_FIELD_META = [
  ["yMin", "Top"],
  ["xMin", "Left"],
  ["yMax", "Bottom"],
  ["xMax", "Right"],
] as const;

type BBoxField = (typeof BBOX_FIELD_META)[number][0];
type ResizeHandle = "nw" | "ne" | "sw" | "se";

interface BBox {
  yMin: number;
  xMin: number;
  yMax: number;
  xMax: number;
}

interface DragState {
  pointerId: number;
  mode: "move" | "resize";
  handle: ResizeHandle | null;
  startX: number;
  startY: number;
  startBox: BBox;
}

const RESIZE_HANDLES: Array<{
  handle: ResizeHandle;
  label: string;
  className: string;
}> = [
  { handle: "nw", label: "top left", className: "-left-1.5 -top-1.5 cursor-nwse-resize" },
  { handle: "ne", label: "top right", className: "-right-1.5 -top-1.5 cursor-nesw-resize" },
  { handle: "sw", label: "bottom left", className: "-bottom-1.5 -left-1.5 cursor-nesw-resize" },
  { handle: "se", label: "bottom right", className: "-bottom-1.5 -right-1.5 cursor-nwse-resize" },
];

function clamp(value: number, min = 0, max = BBOX_MAX) {
  return Math.min(max, Math.max(min, value));
}

function parseBbox(value: string): BBox | null {
  const parts = value.split(",").map((part) => Number(part.trim()));
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) return null;

  const [yMin, xMin, yMax, xMax] = parts.map((part) => clamp(Math.round(part)));
  if (yMin > yMax || xMin > xMax) return null;

  return { yMin, xMin, yMax, xMax };
}

function formatBbox(box: BBox) {
  return [box.yMin, box.xMin, box.yMax, box.xMax].map((value) => String(Math.round(value))).join(",");
}

function defaultBox(): BBox {
  const start = Math.round((BBOX_MAX - DEFAULT_BOX_SIZE) / 2);
  const end = start + DEFAULT_BOX_SIZE;
  return { yMin: start, xMin: start, yMax: end, xMax: end };
}

function centerBoxAt(x: number, y: number, baseBox?: BBox | null): BBox {
  const width = baseBox ? Math.max(baseBox.xMax - baseBox.xMin, DEFAULT_BOX_SIZE) : DEFAULT_BOX_SIZE;
  const height = baseBox ? Math.max(baseBox.yMax - baseBox.yMin, DEFAULT_BOX_SIZE) : DEFAULT_BOX_SIZE;
  const xMin = clamp(Math.round(x - width / 2), 0, BBOX_MAX - width);
  const yMin = clamp(Math.round(y - height / 2), 0, BBOX_MAX - height);
  return {
    yMin,
    xMin,
    yMax: yMin + height,
    xMax: xMin + width,
  };
}

function moveBox(box: BBox, dx: number, dy: number): BBox {
  const width = box.xMax - box.xMin;
  const height = box.yMax - box.yMin;
  const xMin = clamp(Math.round(box.xMin + dx), 0, BBOX_MAX - width);
  const yMin = clamp(Math.round(box.yMin + dy), 0, BBOX_MAX - height);
  return {
    yMin,
    xMin,
    yMax: yMin + height,
    xMax: xMin + width,
  };
}

function resizeBox(box: BBox, handle: ResizeHandle, x: number, y: number): BBox {
  const next = { ...box };

  if (handle === "nw" || handle === "sw") {
    next.xMin = clamp(Math.round(x), 0, box.xMax - BBOX_MIN_SIZE);
  }
  if (handle === "ne" || handle === "se") {
    next.xMax = clamp(Math.round(x), box.xMin + BBOX_MIN_SIZE, BBOX_MAX);
  }
  if (handle === "nw" || handle === "ne") {
    next.yMin = clamp(Math.round(y), 0, box.yMax - BBOX_MIN_SIZE);
  }
  if (handle === "sw" || handle === "se") {
    next.yMax = clamp(Math.round(y), box.yMin + BBOX_MIN_SIZE, BBOX_MAX);
  }

  return next;
}

function updateBoxField(box: BBox, field: BBoxField, value: number): BBox {
  const next = { ...box, [field]: clamp(Math.round(value)) };

  if (field === "yMin" && next.yMin > next.yMax) next.yMax = next.yMin;
  if (field === "yMax" && next.yMax < next.yMin) next.yMin = next.yMax;
  if (field === "xMin" && next.xMin > next.xMax) next.xMax = next.xMin;
  if (field === "xMax" && next.xMax < next.xMin) next.xMin = next.xMax;

  return next;
}

function pointerToCanvasPoint(event: PointerEvent<HTMLElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  return {
    x: clamp(((event.clientX - rect.left) / rect.width) * BBOX_MAX),
    y: clamp(((event.clientY - rect.top) / rect.height) * BBOX_MAX),
  };
}

function getResizeHandle(target: EventTarget | null): ResizeHandle | null {
  if (!(target instanceof Element)) return null;
  const rawHandle = target.closest<HTMLElement>("[data-resize-handle]")?.dataset.resizeHandle;
  if (rawHandle === "nw" || rawHandle === "ne" || rawHandle === "sw" || rawHandle === "se") {
    return rawHandle;
  }
  return null;
}

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
                  <Label className="text-xs">Type</Label>
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

              <BBoxEditor
                element={el}
                index={i}
                width={state.form.w}
                height={state.form.h}
                onChange={(value) =>
                  dispatch({
                    type: "UPDATE_ELEMENT",
                    index: i,
                    field: "bbox",
                    value,
                  })
                }
              />

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

function BBoxEditor({
  element,
  index,
  width,
  height,
  onChange,
}: {
  element: FormElement;
  index: number;
  width: number;
  height: number;
  onChange: (value: string) => void;
}) {
  const dragRef = useRef<DragState | null>(null);
  const box = parseBbox(element.bbox);
  const hasRawValue = element.bbox.trim().length > 0;
  const isInvalid = hasRawValue && !box;
  const previewAspectRatio = `${width} / ${height}`;

  const commitBox = (nextBox: BBox) => onChange(formatBbox(nextBox));

  const handleFieldChange = (field: BBoxField, rawValue: string) => {
    const value = Number(rawValue);
    if (!Number.isFinite(value)) return;
    commitBox(updateBoxField(box ?? defaultBox(), field, value));
  };

  const handlePreviewPointerDown = (event: PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();

    const point = pointerToCanvasPoint(event);
    const activeBox = box;
    const resizeHandle = activeBox ? getResizeHandle(event.target) : null;
    const isInsideBox = activeBox
      && point.x >= activeBox.xMin
      && point.x <= activeBox.xMax
      && point.y >= activeBox.yMin
      && point.y <= activeBox.yMax;
    const nextBox = activeBox && (resizeHandle || isInsideBox)
      ? activeBox
      : centerBoxAt(point.x, point.y, activeBox);

    commitBox(nextBox);
    dragRef.current = {
      pointerId: event.pointerId,
      mode: resizeHandle ? "resize" : "move",
      handle: resizeHandle,
      startX: point.x,
      startY: point.y,
      startBox: nextBox,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events can lack an active browser pointer. Real drags still work.
    }
  };

  const handlePreviewPointerMove = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    const point = pointerToCanvasPoint(event);
    commitBox(
      drag.mode === "resize" && drag.handle
        ? resizeBox(drag.startBox, drag.handle, point.x, point.y)
        : moveBox(drag.startBox, point.x - drag.startX, point.y - drag.startY),
    );
  };

  const stopDragging = (event: PointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    try {
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Ignore capture release failures from synthetic or already-cancelled pointers.
    }
  };

  const handlePreviewKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Backspace" || event.key === "Delete") {
      event.preventDefault();
      onChange("");
      return;
    }

    if (event.key === "Enter" || event.key === " ") {
      if (!box) {
        event.preventDefault();
        commitBox(defaultBox());
      }
      return;
    }

    const arrowDeltas: Record<string, [number, number]> = {
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
    };
    const delta = arrowDeltas[event.key];
    if (!delta) return;

    event.preventDefault();
    const step = event.shiftKey ? 50 : 10;
    commitBox(moveBox(box ?? defaultBox(), delta[0] * step, delta[1] * step));
  };

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <Label className="text-xs">BBox (top, left, bottom, right)</Label>
        <div className="flex shrink-0 gap-1">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => commitBox(defaultBox())}
          >
            Center
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={() => onChange("")}
            disabled={!hasRawValue}
            aria-label={`Clear BBox for element ${index + 1}`}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-1.5">
        {BBOX_FIELD_META.map(([field, label]) => (
          <div key={field} className="space-y-1">
            <Label htmlFor={`bbox-${element.id}-${field}`} className="text-[11px] text-muted-foreground">
              {label}
            </Label>
            <Input
              id={`bbox-${element.id}-${field}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={BBOX_MAX}
              step={1}
              className="h-8 px-2 text-xs"
              value={box ? box[field] : ""}
              placeholder={field === "yMin" || field === "xMin" ? "0" : "1000"}
              onChange={(event) => handleFieldChange(field, event.target.value)}
            />
          </div>
        ))}
      </div>

      {isInvalid && (
        <p className="text-[11px] leading-4 text-destructive">
          BBox must be four numbers from 0 to 1000.
        </p>
      )}

      <button
        type="button"
        className="relative min-h-36 w-full cursor-crosshair touch-none overflow-hidden rounded-lg border border-border bg-muted/40 shadow-inner outline-none transition-colors focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        style={{
          aspectRatio: previewAspectRatio,
          backgroundImage:
            "linear-gradient(to right, rgba(0,0,0,0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0,0,0,0.08) 1px, transparent 1px)",
          backgroundSize: "25% 25%",
        }}
        aria-label={`BBox preview for element ${index + 1}. Drag the box to move it, or drag a corner to resize it.`}
        onPointerDown={handlePreviewPointerDown}
        onPointerMove={handlePreviewPointerMove}
        onPointerUp={stopDragging}
        onPointerCancel={stopDragging}
        onKeyDown={handlePreviewKeyDown}
      >
        <span className="absolute left-2 top-1.5 rounded bg-background/80 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
          {width}x{height}
        </span>
        {box && (
          <span
            className="pointer-events-none absolute cursor-move rounded border-2 border-foreground bg-foreground/10 shadow-[0_0_0_1px_rgba(255,255,255,0.65)_inset]"
            style={{
              left: `${(box.xMin / BBOX_MAX) * 100}%`,
              top: `${(box.yMin / BBOX_MAX) * 100}%`,
              width: `${Math.max(((box.xMax - box.xMin) / BBOX_MAX) * 100, 1)}%`,
              height: `${Math.max(((box.yMax - box.yMin) / BBOX_MAX) * 100, 1)}%`,
            }}
          >
            {RESIZE_HANDLES.map((handle) => (
              <span
                key={handle.handle}
                data-resize-handle={handle.handle}
                aria-hidden="true"
                className={`pointer-events-auto absolute z-10 size-4 rounded-full border-2 border-foreground bg-background shadow-sm ${handle.className}`}
                title={`Resize from ${handle.label}`}
              />
            ))}
          </span>
        )}
      </button>
    </div>
  );
}
