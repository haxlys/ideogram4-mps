import { useEffect, useReducer } from "react";
import { useAppState } from "@/state/context";
import {
  applyLoraStack,
  downloadLoraPreset,
  getLoraDownloadStatus,
  getLoraOperationStatus,
  getLoraPresets,
  getLoraStatus,
  removeLora as removeLoraApi,
} from "@/api/client";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Download, Layers2, Sparkles, X } from "lucide-react";

interface AppliedLora { name: string; strength: number; format?: string; }
interface LoraPresetEntry {
  name: string;
  repo?: string;
  filename?: string;
  strength: number;
  installed: boolean;
  format?: string | null;
  size_mb?: number | null;
}
interface LoraPreset {
  id: string;
  label: string;
  installed: boolean;
  loras: LoraPresetEntry[];
}
interface LoraOperationUiState {
  msg: string;
  phase: string;
  progress: number | null;
}
interface LoraUiState {
  presets: LoraPreset[];
  applied: string | null;
  appliedLoras: AppliedLora[];
  loading: boolean;
  loadingPreset: string | null;
  downloadingPreset: string | null;
  loraOperation: LoraOperationUiState | null;
}
type LoraUiAction =
  | { type: "HYDRATE"; presets: LoraPreset[]; applied: string | null; appliedLoras: AppliedLora[] }
  | { type: "SET_LOADING"; loading: boolean; loadingPreset?: string | null; loraOperation?: LoraOperationUiState | null }
  | { type: "SET_DOWNLOADING"; presetId: string | null }
  | { type: "SET_OPERATION"; operation: LoraOperationUiState | null };

const initialLoraUiState: LoraUiState = {
  presets: [],
  applied: null,
  appliedLoras: [],
  loading: false,
  loadingPreset: null,
  downloadingPreset: null,
  loraOperation: null,
};

function loraUiReducer(state: LoraUiState, action: LoraUiAction): LoraUiState {
  switch (action.type) {
    case "HYDRATE":
      return {
        ...state,
        presets: action.presets,
        applied: action.applied,
        appliedLoras: action.appliedLoras,
      };
    case "SET_LOADING":
      return {
        ...state,
        loading: action.loading,
        loadingPreset: action.loadingPreset === undefined ? state.loadingPreset : action.loadingPreset,
        loraOperation: action.loraOperation === undefined ? state.loraOperation : action.loraOperation,
      };
    case "SET_DOWNLOADING":
      return { ...state, downloadingPreset: action.presetId };
    case "SET_OPERATION":
      return { ...state, loraOperation: action.operation };
  }
}

function stackKey(loras: Array<{ name: string; strength: number }>) {
  return loras.map((l) => `${l.name}:${l.strength}`).join("|");
}

function friendlyName(name: string) {
  return name
    .replace("Realism_Engine_Ideogram_", "Realism ")
    .replace("Realism_Engine_", "Realism ")
    .replace(".safetensors", "")
    .replace("zjourneyv", "zjourney V");
}

function presetSize(preset: LoraPreset) {
  const total = preset.loras.reduce((sum, lora) => {
    const size = lora.size_mb ?? 0;
    return size > 0 ? sum + size : sum;
  }, 0);
  if (total <= 0) return null;
  return total > 1000 ? `${(total / 1000).toFixed(1)}G` : `${total.toFixed(0)}M`;
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function waitForDownload(taskId: string, onUpdate: (operation: LoraOperationUiState) => void): Promise<string> {
  const status = await getLoraDownloadStatus(taskId);
  onUpdate({
    msg: status.msg || "Downloading LoRA files...",
    phase: status.state === "done" ? "done" : "download",
    progress: status.state === "done" ? 100 : null,
  });
  if (status.state === "done") {
    if (status.error) throw new Error(status.error);
    return status.msg;
  }
  await delay(1500);
  return waitForDownload(taskId, onUpdate);
}

export function LoRASelector() {
  const { state } = useAppState();
  const [loraState, dispatchLora] = useReducer(loraUiReducer, initialLoraUiState);
  const { presets, applied, appliedLoras, loading, loadingPreset, downloadingPreset, loraOperation } = loraState;

  const refresh = async () => {
    const [status, presetRes] = await Promise.all([getLoraStatus(), getLoraPresets()]);
    dispatchLora({
      type: "HYDRATE",
      presets: presetRes.presets,
      applied: status.applied,
      appliedLoras: status.applied_loras ?? (status.applied ? [{ name: status.applied, strength: status.strength }] : []),
    });
  };

  useEffect(() => {
    let cancelled = false;
    Promise.all([getLoraStatus(), getLoraPresets()]).then(([status, presetRes]) => {
      if (cancelled) return;
      dispatchLora({
        type: "HYDRATE",
        presets: presetRes.presets,
        applied: status.applied,
        appliedLoras: status.applied_loras ?? (status.applied ? [{ name: status.applied, strength: status.strength }] : []),
      });
    }).catch(() => {
      // LoRA support is optional; hide the selector when status is unavailable.
    });
    return () => {
      cancelled = true;
    };
  }, [state.modelState]);

  const activeKey = stackKey(appliedLoras);

  const waitForLoraOperation = async (taskId: string) => {
    const status = await getLoraOperationStatus(taskId);
    dispatchLora({
      type: "SET_OPERATION",
      operation: {
        msg: status.msg,
        phase: status.phase,
        progress: status.progress > 0 ? status.progress : null,
      },
    });
    if (status.state === "done") {
      if (status.error) throw new Error(status.error);
      if (status.result && !status.result.ok) throw new Error(status.result.msg);
      return status.result ?? { ok: true, msg: status.msg };
    }
    await delay(1000);
    return waitForLoraOperation(taskId);
  };

  const handleApplyPreset = async (preset: LoraPreset) => {
    dispatchLora({
      type: "SET_LOADING",
      loading: true,
      loadingPreset: preset.id,
      loraOperation: { msg: "Queued MLX model reload...", phase: "queued", progress: null },
    });
    try {
      const loras = preset.loras.map((lora) => ({ name: lora.name, strength: lora.strength }));
      const res = await applyLoraStack(loras);
      if (res.ok && res.task_id) {
        const result = await waitForLoraOperation(res.task_id);
        await refresh();
        toast.success(result.msg);
      } else {
        toast.error(res.msg ?? "Failed to start LoRA reload.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      dispatchLora({ type: "SET_LOADING", loading: false, loadingPreset: null, loraOperation: null });
    }
  };

  const handleDownloadPreset = async (preset: LoraPreset) => {
    dispatchLora({ type: "SET_DOWNLOADING", presetId: preset.id });
    dispatchLora({
      type: "SET_OPERATION",
      operation: { msg: `Downloading ${preset.label}...`, phase: "download", progress: null },
    });
    try {
      const res = await downloadLoraPreset(preset.id);
      if (!res.ok || !res.task_id) {
        toast.error(res.msg ?? "Failed to start download.");
        return;
      }
      const msg = await waitForDownload(res.task_id, (operation) => {
        dispatchLora({ type: "SET_OPERATION", operation });
      });
      await refresh();
      toast.success(msg);
    } catch (e) {
      toast.error(String(e));
    } finally {
      dispatchLora({ type: "SET_DOWNLOADING", presetId: null });
      dispatchLora({ type: "SET_OPERATION", operation: null });
    }
  };

  const handleRemove = async () => {
    dispatchLora({
      type: "SET_LOADING",
      loading: true,
      loadingPreset: null,
      loraOperation: { msg: "Queued MLX model reload...", phase: "queued", progress: null },
    });
    try {
      const res = await removeLoraApi();
      if (res.ok && res.task_id) {
        const result = await waitForLoraOperation(res.task_id);
        await refresh();
        toast.success(result.msg);
      } else {
        toast.error(res.msg ?? "Failed to start LoRA removal.");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      dispatchLora({ type: "SET_LOADING", loading: false, loadingPreset: null, loraOperation: null });
    }
  };

  if (presets.length === 0) return null;

  return (
    <div className="space-y-2.5 pt-1 border-t border-border">
      <div className="flex items-center gap-1.5">
        <Sparkles className="size-3 text-muted-foreground" />
        <Label className="text-[13px] font-medium">LoRA</Label>
        {applied && (
          <Badge variant="secondary" className="max-w-[180px] px-1.5 py-0 text-[10px]">
            {loading && loadingPreset == null ? <Spinner className="size-2.5 animate-spin mr-1 inline-block" /> : null}
            <span className="truncate">{appliedLoras.map((lora) => friendlyName(lora.name)).join(" + ")}</span>
          </Badge>
        )}
        {applied && (
          <Button
            variant="ghost"
            size="icon-xs"
            className="ml-auto"
            onClick={handleRemove}
            disabled={loading || downloadingPreset != null || state.modelState !== "loaded"}
            title="Remove LoRA"
          >
            {loading && loadingPreset == null ? <Spinner className="size-3 animate-spin" /> : <X className="size-3" />}
          </Button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {presets.map((preset) => {
          const active = activeKey === stackKey(preset.loras);
          const downloading = downloadingPreset === preset.id;
          const size = presetSize(preset);
          return (
            <Button
              key={preset.id}
              variant={active ? "default" : "secondary"}
              size="sm"
              className="h-8 w-full justify-between text-[11px] font-medium"
              onClick={() => {
                if (!preset.installed) {
                  handleDownloadPreset(preset);
                  return;
                }
                if (active) {
                  handleRemove();
                } else {
                  handleApplyPreset(preset);
                }
              }}
              disabled={loading || (downloadingPreset != null && !downloading) || (preset.installed && state.modelState !== "loaded")}
            >
              {(loading && loadingPreset === preset.id) || downloading ? (
                <Spinner className="size-3 animate-spin" />
              ) : !preset.installed ? (
                <Download className="size-3" />
              ) : (
                <Sparkles className="size-3" />
              )}
              <span className="truncate">{preset.label}</span>
              <span className="ml-1 shrink-0 text-[10px] text-muted-foreground">
                {!preset.installed ? "Download" : size ?? preset.loras.map((lora) => lora.strength).join("+")}
              </span>
            </Button>
          );
        })}
      </div>

      {loraOperation && (
        <div className="space-y-1.5 rounded-md border border-border bg-muted/30 px-2 py-1.5">
          <div className="flex min-w-0 items-center gap-2 text-[11px] text-muted-foreground">
            <Spinner className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{loraOperation.msg}</span>
            <span className="shrink-0 tabular-nums">{loraOperation.progress == null ? "..." : `${loraOperation.progress}%`}</span>
          </div>
          <Progress value={loraOperation.progress} className="h-1" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-1">
        <Layers2 className="size-3 text-muted-foreground" />
        {appliedLoras.length > 0 ? appliedLoras.map((lora) => (
          <Badge key={`${lora.name}-${lora.strength}`} variant="outline" className="h-4 px-1.5 text-[10px]">
            {friendlyName(lora.name)} {lora.strength}
          </Badge>
        )) : (
          <Badge variant="outline" className="h-4 px-1.5 text-[10px]">none</Badge>
        )}
      </div>
    </div>
  );
}
