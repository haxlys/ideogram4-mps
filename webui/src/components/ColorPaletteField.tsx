import { useCallback, useId, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatColorPalette, normalizeHexColor, parseColorPalette, parseHexColorPalette } from "@/lib/colorPalette";
import { cn } from "@/lib/utils";
import { Plus, X } from "lucide-react";

interface ColorPaletteFieldProps {
  id?: string;
  value: string;
  onChange: (cp: string) => void;
  className?: string;
}

export function ColorPaletteField({ id, value, onChange, className }: ColorPaletteFieldProps) {
  const addInputRef = useRef<HTMLInputElement>(null);
  const fallbackId = useId();
  const fieldId = id ?? fallbackId;
  const tokens = parseColorPalette(value);
  const colors = parseHexColorPalette(value);
  const freeformTokens = tokens.filter((token) => !normalizeHexColor(token));

  const setColors = useCallback(
    (next: string[]) => {
      onChange(formatColorPalette([...next, ...freeformTokens]));
    },
    [freeformTokens, onChange],
  );

  const handleTextChange = (raw: string) => {
    onChange(raw);
  };

  const handleTextBlur = () => {
    const normalized = formatColorPalette(parseColorPalette(value));
    if (normalized !== value.trim()) {
      onChange(normalized);
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Label htmlFor={fieldId} className="text-[13px] font-medium">
        Color palette
      </Label>

      <div className="flex flex-wrap items-center gap-2">
        {colors.map((hex) => (
          <div
            key={hex}
            className="group relative flex flex-col items-center gap-1"
          >
            <label
              className="relative block cursor-pointer rounded-lg ring-1 ring-border/80 ring-offset-2 ring-offset-background transition-shadow hover:ring-foreground/25"
              title={hex}
            >
              <span
                className="block size-10 rounded-lg border border-black/10 shadow-sm dark:border-white/10"
                style={{ backgroundColor: hex }}
              />
              <input
                type="color"
                className="sr-only"
                value={hex}
                onChange={(e) => {
                  const next = normalizeHexColor(e.target.value);
                  if (!next) return;
                  setColors(colors.map((c) => (c === hex ? next : c)));
                }}
              />
            </label>
            <span className="font-mono text-[9px] tabular-nums text-muted-foreground">
              {hex}
            </span>
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="absolute -top-1 -right-1 size-5 rounded-full bg-background opacity-100 shadow-sm ring-1 ring-border sm:opacity-0 sm:group-hover:opacity-100"
              aria-label={`Remove ${hex}`}
              onClick={() => setColors(colors.filter((c) => c !== hex))}
            >
              <X className="size-2.5" />
            </Button>
          </div>
        ))}

        <Button
          type="button"
          variant="outline"
          size="icon"
          className="size-10 shrink-0 rounded-lg border-dashed"
          aria-label="Add color"
          onClick={() => addInputRef.current?.click()}
        >
          <Plus className="size-4 text-muted-foreground" />
        </Button>
        <input
          ref={addInputRef}
          type="color"
          className="sr-only"
          defaultValue="#808080"
          onChange={(e) => {
            const next = normalizeHexColor(e.target.value);
            if (!next || colors.includes(next)) return;
            setColors([...colors, next]);
          }}
        />
      </div>

      <Input
        id={fieldId}
        placeholder="#F5F0EB, #FFFFFF, #1A1A1A"
        value={value}
        onChange={(e) => handleTextChange(e.target.value)}
        onBlur={handleTextBlur}
        className="font-mono text-body-sm"
        spellCheck={false}
      />
      <p className="text-[11px] text-muted-foreground">
        Tap a swatch to change it, or paste comma-separated colors below.
      </p>
    </div>
  );
}
