import { useAppState } from "@/state/context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ColorPaletteField } from "@/components/ColorPaletteField";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Medium } from "@/state/types";

const MEDIUMS: Medium[] = ["photograph", "illustration", "3d_render", "painting", "graphic_design"];

const PHOTO_PRESETS = [
  { label: "Shallow DOF 85mm", value: "shallow depth of field, eye-level, 85mm f/1.4" },
  { label: "Wide landscape", value: "wide angle, f/8, long exposure" },
  { label: "Natural 50mm", value: "50mm f/1.8, natural perspective" },
  { label: "35mm bokeh", value: "35mm f/1.4, bokeh" },
  { label: "Telephoto 200mm", value: "telephoto 200mm f/2.8, compressed background" },
  { label: "Macro close-up", value: "macro 100mm f/2.8, extreme close-up" },
  { label: "Tilt-shift", value: "tilt-shift, selective focus, miniature effect" },
  { label: "Fisheye", value: "fisheye, ultra wide, dramatic" },
  { label: "Low angle", value: "low angle, 24mm, heroic perspective" },
  { label: "Studio portrait", value: "studio lighting, 85mm f/5.6, sharp focus" },
  { label: "Cinematic", value: "anamorphic, 35mm, cinematic, shallow depth of field" },
  { label: "Full body 50mm", value: "full body shot, eye-level, 50mm f/2.8" },
  { label: "Full body wide", value: "full body, 35mm f/4, environmental portrait" },
  { label: "Vintage film", value: "vintage 35mm film, grainy, warm tones" },
];

const ART_STYLE_PRESETS = [
  { label: "Watercolor", value: "watercolor, soft edges, painterly" },
  { label: "Flat vector", value: "flat vector illustration, bold outlines" },
  { label: "Oil painting", value: "oil painting, impasto, textured brushstrokes" },
  { label: "Ghibli inspired", value: "Studio Ghibli inspired" },
  { label: "3D realistic", value: "photorealistic 3D render" },
  { label: "Low poly 3D", value: "low poly 3D" },
  { label: "Isometric", value: "isometric 3D" },
  { label: "Pencil sketch", value: "pencil sketch, hand-drawn" },
  { label: "Line art", value: "minimalist line art" },
  { label: "Vintage poster", value: "vintage poster, screen print" },
  { label: "Pixel art", value: "pixel art, retro" },
  { label: "Comic book", value: "comic book style, halftone dots" },
];

export function StyleSettings() {
  const { state, dispatch } = useAppState();

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-[15px] font-semibold tracking-[-0.01em]">Style Settings</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="aes" className="text-[13px] font-medium">Aesthetics</Label>
            <Input
              id="aes"
              placeholder="e.g. cinematic, ultra realistic, 4k"
              value={state.form.aes}
              onChange={(e) => dispatch({ type: "SET_FORM", form: { aes: e.target.value } })}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="light" className="text-[13px] font-medium">Lighting</Label>
            <Input
              id="light"
              placeholder="e.g. soft diffused studio lighting"
              value={state.form.light}
              onChange={(e) => dispatch({ type: "SET_FORM", form: { light: e.target.value } })}
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="med" className="text-[13px] font-medium">Medium</Label>
            <Select
              value={state.form.med}
              onValueChange={(v) => v && dispatch({ type: "SET_FORM", form: { med: v as Medium } })}
            >
              <SelectTrigger id="med">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {MEDIUMS.map((m) => (
                  <SelectItem key={m} value={m}>
                    {m}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="cam-preset" className="text-[13px] font-medium">
              {state.form.med === "photograph" ? "Photo (camera/style)" : "Art Style"}
            </Label>
            <Select
              value={state.form.cam}
              onValueChange={(v) => v && dispatch({ type: "SET_FORM", form: { cam: v } })}
            >
              <SelectTrigger id="cam-preset">
                <SelectValue placeholder={state.form.med === "photograph" ? "Choose preset…" : "Choose preset…"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="">— manual entry —</SelectItem>
                {(state.form.med === "photograph" ? PHOTO_PRESETS : ART_STYLE_PRESETS).map((p) => (
                  <SelectItem key={p.label} value={p.value}>
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Input
              id="cam"
              placeholder="Or type freeform…"
              value={state.form.cam}
              onChange={(e) => dispatch({ type: "SET_FORM", form: { cam: e.target.value } })}
            />
          </div>
        </div>

        <ColorPaletteField
          id="cp"
          value={state.form.cp}
          onChange={(cp) => dispatch({ type: "SET_FORM", form: { cp } })}
        />
      </CardContent>
    </Card>
  );
}
