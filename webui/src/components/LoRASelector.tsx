import { useEffect, useState } from "react";
import { useAppState } from "@/state/context";
import { getLoraStatus, applyLora as applyLoraApi, removeLora as removeLoraApi } from "@/api/client";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";

interface LoraEntry { name: string; path: string; format: string; size_mb: number; }

export function LoRASelector() {
  const { state } = useAppState();
  const [loras, setLoras] = useState<LoraEntry[]>([]);
  const [applied, setApplied] = useState<string | null>(null);
  const [strength, setStrength] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [loadingName, setLoadingName] = useState<string | null>(null);

  useEffect(() => {
    getLoraStatus().then((s) => {
      setLoras(s.available);
      setApplied(s.applied);
      setStrength(s.strength);
    }).catch(() => {
      // LoRA support is optional; hide the selector when status is unavailable.
    });
  }, [state.modelState]);

  const handleApply = async (name: string) => {
    setLoadingName(name);
    setLoading(true);
    try {
      const res = await applyLoraApi(name, strength);
      if (res.ok) {
        setApplied(name);
        toast.success(res.msg);
      } else {
        toast.error(res.msg);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
      setLoadingName(null);
    }
  };

  const handleRemove = async () => {
    setLoading(true);
    try {
      const res = await removeLoraApi();
      if (res.ok) {
        setApplied(null);
        toast.success(res.msg);
      } else {
        toast.error(res.msg);
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setLoading(false);
    }
  };

  if (loras.length === 0) return null;

  return (
    <div className="space-y-2 pt-1 border-t border-border">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3 text-muted-foreground" />
        <Label className="text-[13px] font-medium">LoRA</Label>
        {applied && (
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {loading && loadingName == null ? <Spinner className="size-2.5 animate-spin mr-1 inline-block" /> : null}
            {applied}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {loras.map((l) => {
          const active = applied === l.name;
          return (
            <Button
              key={l.name}
              variant={active ? "default" : "secondary"}
              size="sm"
              className="h-8 text-[11px] font-medium w-full justify-between"
              onClick={() => active ? handleRemove() : handleApply(l.name)}
              disabled={loading || state.modelState !== "loaded"}
            >
              {loading && loadingName === l.name ? (
                <Spinner className="size-3 animate-spin" />
              ) : (
                <span className="truncate">{l.name.replace(".safetensors", "")}</span>
              )}
              <span className="text-[10px] text-muted-foreground ml-1 shrink-0">
                {l.size_mb > 1000 ? `${(l.size_mb / 1000).toFixed(1)}G` : `${l.size_mb.toFixed(0)}M`}
              </span>
            </Button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        <Label className="text-[11px] text-muted-foreground shrink-0">Strength</Label>
        <Input
          type="number"
          min={0.1}
          max={1.5}
          step={0.1}
          value={strength}
          onChange={(e) => setStrength(Number(e.target.value) || 0.6)}
          className="h-7 w-16 text-[11px] text-center"
          disabled={loading}
        />
      </div>
    </div>
  );
}
