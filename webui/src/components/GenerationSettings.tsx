import { useAppState } from "@/state/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { FormState } from "@/state/types";
import {
  DIMENSION_STEP,
  MAX_DIMENSION,
  MIN_DIMENSION,
  MLX_LOAD_ESTIMATE_SECONDS,
  RESOLUTION_PRESETS,
  STEPS_MAP,
  estimateTime,
} from "@/state/types";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Shuffle } from "lucide-react";
import { LoRASelector } from "./LoRASelector";

const PRESETS: FormState["preset"][] = ["V4_TURBO_12", "V4_DEFAULT_20", "V4_QUALITY_48"];

function snap128(n: number): number {
  n = Math.round(n / DIMENSION_STEP) * DIMENSION_STEP;
  return Math.max(MIN_DIMENSION, Math.min(MAX_DIMENSION, n));
}

function formatTime(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return `${m}m ${s}s`;
}

function RatioPreview({ w, h, size = 64 }: { w: number; h: number; size?: number }) {
  const ratio = w / h;
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio >= 1 ? size / ratio : size;
  const isUltrawide = ratio >= 2.5;
  const isTall = ratio <= 0.6;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <div
        className="rounded-[3px] border border-foreground/30 transition-colors duration-200"
        style={{ width, height }}
      />
      <div
        className={cn(
          "absolute inset-0 m-auto flex items-center justify-center text-[10px] font-mono tabular-nums text-muted-foreground",
          isUltrawide && "tracking-widest scale-[0.85]",
          isTall && "-rotate-90 scale-[0.85]",
        )}
      >
        {w}×{h}
      </div>
    </div>
  );
}

export function GenerationSettings() {
  const { state, dispatch } = useAppState();
  const { form, modelState } = state;
  const steps = STEPS_MAP[form.preset];
  const genTime = estimateTime(form.w, form.h, steps);
  const loadTime = modelState !== "loaded" ? MLX_LOAD_ESTIMATE_SECONDS : 0;
  const totalTime = genTime + loadTime;

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Generation Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center rounded-lg border border-border bg-muted/20 p-3">
            <RatioPreview w={form.w} h={form.h} size={64} />
          </div>
          <div className="flex-1 space-y-1.5">
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-20">
                Ratio
              </span>
              <span className="text-[13px] font-mono tabular-nums font-medium">
                {(form.w / form.h).toFixed(3)}:1
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-20">
                Pixels
              </span>
              <span className="text-[13px] font-mono tabular-nums font-medium">
                {form.w}×{form.h}
              </span>
            </div>
            <div className="flex items-baseline gap-2">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground w-20">
                Megapixels
              </span>
              <span className="text-[13px] font-mono tabular-nums font-medium">
                {((form.w * form.h) / 1e6).toFixed(2)} MP
              </span>
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="text-[13px] font-medium block">Ratio</Label>
          <div className="grid grid-cols-2 gap-1.5">
            {RESOLUTION_PRESETS.map(({ name, w, h }) => {
              const active = form.w === w && form.h === h;
              const ratio = w / h;
              const previewW = ratio >= 1 ? 24 : 24 * ratio;
              const previewH = ratio >= 1 ? 24 / ratio : 24;
              return (
                <Button
                  key={name}
                  variant={active ? "default" : "secondary"}
                  size="sm"
                  className="h-10 text-xs font-medium w-full justify-start"
                  onClick={() => dispatch({ type: "SET_FORM", form: { w, h } })}
                >
                  <span
                    aria-hidden="true"
                    className="mr-2 inline-block rounded-[2px] border border-current/30 shrink-0"
                    style={{ width: previewW, height: previewH, minWidth: 6, minHeight: 6 }}
                  />
                  <span className="flex flex-col items-start leading-tight">
                    <span className="text-[11px] font-medium">{name}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums">{w}×{h}</span>
                  </span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="customW" className="text-[13px] font-medium">Width</Label>
            <Input
              id="customW"
              type="number"
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              step={DIMENSION_STEP}
              value={form.w}
              onChange={(e) => {
                let v = Number(e.target.value);
                v = snap128(v);
                dispatch({ type: "SET_FORM", form: { w: v } });
              }}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="customH" className="text-[13px] font-medium">Height</Label>
            <Input
              id="customH"
              type="number"
              min={MIN_DIMENSION}
              max={MAX_DIMENSION}
              step={DIMENSION_STEP}
              value={form.h}
              onChange={(e) => {
                let v = Number(e.target.value);
                v = snap128(v);
                dispatch({ type: "SET_FORM", form: { h: v } });
              }}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="preset" className="text-[13px] font-medium">Quality</Label>
            <Select
              value={form.preset}
              onValueChange={(v) => v &&
                dispatch({ type: "SET_FORM", form: { preset: v as FormState["preset"] } })
              }
            >
              <SelectTrigger id="preset">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESETS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="format" className="text-[13px] font-medium">Format</Label>
            <Select
              value={form.format}
              onValueChange={(v) => v &&
                dispatch({ type: "SET_FORM", form: { format: v as FormState["format"] } })
              }
            >
              <SelectTrigger id="format">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="webp">WebP (lossless)</SelectItem>
                <SelectItem value="png">PNG</SelectItem>
                <SelectItem value="jpeg">JPEG</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="seed" className="text-[13px] font-medium">Seed</Label>
          <div className="flex gap-1">
            <Input
              id="seed"
              value={form.seed}
              onChange={(e) =>
                dispatch({ type: "SET_FORM", form: { seed: e.target.value } })
              }
              placeholder="random"
            />
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="shrink-0"
              onClick={() =>
                dispatch({ type: "SET_FORM", form: { seed: String(Math.floor(Math.random() * 2**32)) } })
              }
              title="Random seed"
            >
              <Shuffle className="size-4" />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-2 rounded-md bg-muted/50 px-3 py-2">
          <span className="text-xs text-muted-foreground">Estimated:</span>
          <Badge variant="outline" className="text-xs font-mono">
            {modelState !== "loaded" ? `load ~${formatTime(loadTime)} + gen ${formatTime(genTime)}` : `gen ${formatTime(genTime)}`}
          </Badge>
          {totalTime > genTime && (
            <span className="text-[11px] text-muted-foreground ml-auto">
              ({formatTime(totalTime)} total)
            </span>
          )}
        </div>

        <LoRASelector />
      </CardContent>
    </Card>
  );
}
