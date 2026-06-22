import { randomSeedString } from "@/lib/seed";
import { presetLabel } from "@/lib/presetLabels";
import { useAppState } from "@/state/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
import { Clock, Shuffle } from "lucide-react";
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

function RatioPreview({ w, h, size = 44 }: { w: number; h: number; size?: number }) {
  const ratio = w / h;
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio >= 1 ? size / ratio : size;
  const isUltrawide = ratio >= 2.5;
  const isTall = ratio <= 0.6;

  return (
    <div
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      <div
        className="rounded-[3px] border border-foreground/30 bg-background transition-colors duration-200"
        style={{ width, height }}
      />
      <div
        className={cn(
          "absolute inset-0 m-auto flex items-center justify-center text-[9px] font-mono tabular-nums text-muted-foreground",
          isUltrawide && "scale-[0.8] tracking-widest",
          isTall && "-rotate-90 scale-[0.8]",
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
  const estLabel = modelState !== "loaded"
    ? `load ~${formatTime(loadTime)} + gen ${formatTime(genTime)}`
    : `gen ${formatTime(genTime)}`;

  return (
    <section
      aria-label="Settings"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
    >
      <div className="border-b border-border bg-muted/30 px-4 py-2.5">
        <h2 className="text-body-sm font-semibold text-foreground">Settings</h2>
        <p className="mt-0.5 text-caption text-muted-foreground">
          Resolution, quality, and generation options
        </p>
      </div>

      <div className="space-y-4 p-4">
        <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/20 p-3 md:flex-row md:items-center">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            <RatioPreview w={form.w} h={form.h} />
            <div className="min-w-0">
              <p className="text-body-sm font-medium tabular-nums text-foreground">
                {form.w}×{form.h}
              </p>
              <p className="text-caption text-muted-foreground">
                {((form.w * form.h) / 1e6).toFixed(2)} MP · {(form.w / form.h).toFixed(2)}:1
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center md:shrink-0">
            <div className="min-w-0 sm:w-44">
              <Label htmlFor="preset" className="sr-only">Quality</Label>
              <Select
                value={form.preset}
                onValueChange={(v) => v &&
                  dispatch({ type: "SET_FORM", form: { preset: v as FormState["preset"] } })
                }
              >
                <SelectTrigger id="preset" className="h-8 w-full bg-background text-body-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PRESETS.map((p) => (
                    <SelectItem key={p} value={p}>
                      {presetLabel(p)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div
              className="flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-caption text-muted-foreground"
              title={totalTime > genTime ? `${formatTime(totalTime)} total` : undefined}
            >
              <Clock className="size-3 shrink-0" />
              <span className="font-mono tabular-nums text-foreground">{estLabel}</span>
              {totalTime > genTime && (
                <span className="hidden text-muted-foreground lg:inline">
                  · {formatTime(totalTime)}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-2">
          <Label className="block text-body-sm font-medium">Aspect ratio</Label>
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
            {RESOLUTION_PRESETS.map(({ name, w, h }) => {
              const active = form.w === w && form.h === h;
              const ratio = w / h;
              const previewW = ratio >= 1 ? 16 : 16 * ratio;
              const previewH = ratio >= 1 ? 16 / ratio : 16;

              return (
                <Button
                  key={name}
                  variant={active ? "default" : "outline"}
                  size="sm"
                  className="h-8 justify-start px-2 text-caption font-medium"
                  onClick={() => dispatch({ type: "SET_FORM", form: { w, h } })}
                >
                  <span
                    aria-hidden="true"
                    className="mr-1.5 inline-block shrink-0 rounded-[2px] border border-current/30"
                    style={{ width: previewW, height: previewH, minWidth: 5, minHeight: 5 }}
                  />
                  <span className="truncate">{name}</span>
                </Button>
              );
            })}
          </div>
        </div>

        <div className="space-y-4 border-t border-border pt-4">
          <h3 className="text-body-sm font-medium text-foreground">Advanced options</h3>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="customW" className="text-body-sm font-medium">Width</Label>
              <Input
                id="customW"
                type="number"
                className="h-8"
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
              <Label htmlFor="customH" className="text-body-sm font-medium">Height</Label>
              <Input
                id="customH"
                type="number"
                className="h-8"
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
            <div className="space-y-1.5">
              <Label htmlFor="format" className="text-body-sm font-medium">Format</Label>
              <Select
                value={form.format}
                onValueChange={(v) => v &&
                  dispatch({ type: "SET_FORM", form: { format: v as FormState["format"] } })
                }
              >
                <SelectTrigger id="format" className="h-8 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="webp">WebP (lossless)</SelectItem>
                  <SelectItem value="png">PNG</SelectItem>
                  <SelectItem value="jpeg">JPEG</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2 lg:col-span-1">
              <Label htmlFor="seed" className="text-body-sm font-medium">Seed</Label>
              <div className="flex gap-1">
                <Input
                  id="seed"
                  className="h-8"
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
                  className="size-8 shrink-0"
                  onClick={() =>
                    dispatch({ type: "SET_FORM", form: { seed: randomSeedString() } })
                  }
                  title="Random seed"
                >
                  <Shuffle className="size-3.5" />
                </Button>
              </div>
            </div>
          </div>

          <LoRASelector />
        </div>
      </div>
    </section>
  );
}