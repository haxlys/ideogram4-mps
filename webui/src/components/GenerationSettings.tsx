import type { ReactNode } from "react";
import { randomSeedString } from "@/lib/seed";
import { aspectRatioFromSize } from "@/lib/aspectRatio";
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

function RatioPreview({ w, h, size = 32 }: { w: number; h: number; size?: number }) {
  const ratio = w / h;
  const width = ratio >= 1 ? size : size * ratio;
  const height = ratio >= 1 ? size / ratio : size;

  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-md border border-border/80 bg-background p-1"
      style={{ width: size + 8, height: size + 8 }}
    >
      <div
        className="rounded-[2px] border border-foreground/35 bg-muted/60"
        style={{ width, height, minWidth: 5, minHeight: 5 }}
      />
    </div>
  );
}

function SettingsGroup({
  title,
  description,
  children,
  className,
  dense = false,
}: {
  title: string;
  description?: string;
  children: ReactNode;
  className?: string;
  dense?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-lg border border-border bg-muted/20",
        dense ? "gap-2 p-2.5" : "gap-3 p-3",
        className,
      )}
    >
      <div>
        <p className={cn("font-medium text-foreground", dense ? "text-caption" : "text-body-sm")}>
          {title}
        </p>
        {description ? (
          <p
            className={cn(
              "text-muted-foreground",
              dense ? "mt-0.5 text-[11px] leading-snug" : "mt-0.5 text-caption",
            )}
          >
            {description}
          </p>
        ) : null}
      </div>
      <div className={dense ? "space-y-2" : "space-y-3"}>{children}</div>
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

  const resolutionBlock = (
    <>
      <div className="flex min-w-0 items-center gap-2">
        <RatioPreview w={form.w} h={form.h} size={28} />
        <div className="min-w-0">
          <p className="text-caption font-medium tabular-nums text-foreground">
            {form.w}×{form.h}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {((form.w * form.h) / 1e6).toFixed(2)} MP · {aspectRatioFromSize(form.w, form.h)}
          </p>
        </div>
      </div>

      <div className="space-y-1.5">
        <Label className="text-[11px] font-medium text-muted-foreground">Presets</Label>
        <div className="grid grid-cols-2 gap-1.5">
          {RESOLUTION_PRESETS.map(({ name, w, h }) => {
            const active = form.w === w && form.h === h;
            const ratio = w / h;
            const previewW = ratio >= 1 ? 14 : 14 * ratio;
            const previewH = ratio >= 1 ? 14 / ratio : 14;

            return (
              <Button
                key={name}
                variant={active ? "generate" : "outline"}
                size="sm"
                className={cn(
                  "h-auto min-h-8 w-full flex-row items-center gap-2 px-2 py-1.5 text-left",
                  !active && "hover:border-generate/25 hover:bg-generate-muted/50",
                )}
                onClick={() => dispatch({ type: "SET_FORM", form: { w, h } })}
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded border",
                    active
                      ? "border-generate-foreground/25 bg-generate-foreground/10"
                      : "border-border/80 bg-muted/50",
                  )}
                >
                  <span
                    className="rounded-[2px] border border-current/40"
                    style={{ width: previewW, height: previewH, minWidth: 4, minHeight: 4 }}
                  />
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate text-[11px] font-medium">{name}</span>
                  <span
                    className={cn(
                      "block text-[10px] tabular-nums",
                      active ? "text-generate-foreground/85" : "text-muted-foreground",
                    )}
                  >
                    {w}×{h}
                  </span>
                </span>
              </Button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label htmlFor="customW" className="text-[11px] font-medium text-muted-foreground">
            Width
          </Label>
          <Input
            id="customW"
            type="number"
            className="h-8 bg-background text-body-sm"
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
        <div className="space-y-1">
          <Label htmlFor="customH" className="text-[11px] font-medium text-muted-foreground">
            Height
          </Label>
          <Input
            id="customH"
            type="number"
            className="h-8 bg-background text-body-sm"
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
    </>
  );

  const qualityBlock = (
    <div className="space-y-1">
      <Label htmlFor="preset" className="text-[11px] font-medium text-muted-foreground">
        Preset
      </Label>
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
  );

  const outputBlock = (
    <div className="grid grid-cols-2 gap-2">
      <div className="space-y-1">
        <Label htmlFor="format" className="text-[11px] font-medium text-muted-foreground">
          Format
        </Label>
        <Select
          value={form.format}
          onValueChange={(v) => v &&
            dispatch({ type: "SET_FORM", form: { format: v as FormState["format"] } })
          }
        >
          <SelectTrigger id="format" className="h-8 w-full bg-background text-body-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="webp">WebP (lossless)</SelectItem>
            <SelectItem value="png">PNG</SelectItem>
            <SelectItem value="jpeg">JPEG</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="seed" className="text-[11px] font-medium text-muted-foreground">
          Seed
        </Label>
        <div className="flex gap-1">
          <Input
            id="seed"
            className="h-8 min-w-0 flex-1 bg-background text-body-sm"
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
  );

  return (
    <section
      aria-label="Settings"
      className="overflow-hidden rounded-2xl border border-border bg-card shadow-card"
    >
      <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/30 px-4 py-2 lg:px-3 lg:py-2">
        <div className="min-w-0">
          <h2 className="text-body-sm font-semibold text-foreground">Settings</h2>
          <p className="mt-0.5 text-caption text-muted-foreground lg:text-[11px]">
            Resolution, quality, LoRA, and output
          </p>
        </div>
        <p
          className="shrink-0 pt-0.5 text-right text-[11px] leading-snug text-muted-foreground/65 tabular-nums"
          title={loadTime > 0 ? `About ${formatTime(totalTime)} including model load` : undefined}
        >
          Est. {formatTime(genTime)}
          {loadTime > 0 ? (
            <>
              <br />
              <span className="text-muted-foreground/50">load ~{formatTime(loadTime)}</span>
            </>
          ) : null}
        </p>
      </div>

      {/* Mobile: stacked — Quality, Resolution, LoRA, Output */}
      <div className="space-y-3 p-4 lg:hidden">
        <SettingsGroup title="Quality" description="Steps and denoise time">
          {qualityBlock}
        </SettingsGroup>
        <SettingsGroup title="Resolution" description="Presets and custom size">
          {resolutionBlock}
        </SettingsGroup>
        <SettingsGroup title="LoRA" description="Reloads model when changed">
          <LoRASelector embedded />
        </SettingsGroup>
        <SettingsGroup title="Output" description="Format and seed">
          {outputBlock}
        </SettingsGroup>
      </div>

      {/* Desktop: 2×2 — TL Quality, TR Output, BL Resolution, BR LoRA */}
      <div className="hidden gap-2.5 p-3 lg:grid lg:grid-cols-2 lg:items-start">
        <SettingsGroup dense title="Quality" description="Steps · affects estimate">
          {qualityBlock}
        </SettingsGroup>
        <SettingsGroup dense title="Output" description="Format & seed">
          {outputBlock}
        </SettingsGroup>
        <SettingsGroup dense title="Resolution" description="128px steps">
          {resolutionBlock}
        </SettingsGroup>
        <SettingsGroup dense title="LoRA" description="Realism / zJourney">
          <LoRASelector embedded dense />
        </SettingsGroup>
      </div>
    </section>
  );
}