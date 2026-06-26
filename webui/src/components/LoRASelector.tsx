import { useEffect, useMemo, useReducer } from "react";
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
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { X } from "lucide-react";
import { friendlyLoraName } from "@/lib/lora";
import type { AppliedLora, LoraPreset } from "@/lib/loraTypes";
import {
  groupPresetsByFamily,
  loraFamilyFromPreset,
  LORA_FAMILIES,
  loraVersionChip,
} from "@/lib/loraPresets";
import { cn } from "@/lib/utils";

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

function activeFamilyLabel(appliedLoras: AppliedLora[]): string | null {
  if (appliedLoras.length === 0) return null;
  const name = appliedLoras[0].name;
  const family = name.toLowerCase().includes("zjourney")
    ? "zJourney"
    : name.toLowerCase().includes("realism")
      ? "Realism"
      : null;
  const chip = loraVersionChip({
    id: name,
    label: name,
    installed: true,
    loras: [{ name, strength: appliedLoras[0].strength, installed: true }],
  });
  if (family) return `${family} ${chip}`;
  return friendlyLoraName(name);
}

export function LoRASelector({ embedded = false, dense = false }: { embedded?: boolean; dense?: boolean } = {}) {
  const { state } = useAppState();
  const [loraState, dispatchLora] = useReducer(loraUiReducer, initialLoraUiState);
  const { presets, applied, appliedLoras, loading, loadingPreset, downloadingPreset, loraOperation } = loraState;

  const grouped = useMemo(() => groupPresetsByFamily(presets), [presets]);
  const otherPresets = useMemo(
    () => presets.filter((p) => !loraFamilyFromPreset(p)),
    [presets],
  );

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
  const appliedSummary = activeFamilyLabel(appliedLoras);

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

  const handlePresetClick = (preset: LoraPreset, active: boolean) => {
    if (!preset.installed) {
      void handleDownloadPreset(preset);
      return;
    }
    if (active) {
      void handleRemove();
    } else {
      void handleApplyPreset(preset);
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

  const renderPresetChip = (preset: LoraPreset) => {
    const active = activeKey === stackKey(preset.loras);
    const downloading = downloadingPreset === preset.id;
    const busy = loading && loadingPreset === preset.id;
    const size = presetSize(preset);
    const strength = preset.loras[0]?.strength;

    return (
      <Button
        key={preset.id}
        type="button"
        variant={active ? "generate" : "outline"}
        size="sm"
        className={cn(
          "h-auto min-h-9 min-w-[4.25rem] flex-col gap-0.5 px-2.5 py-1.5 text-center",
          !active && "hover:border-generate/25 hover:bg-generate-muted/40",
        )}
        onClick={() => handlePresetClick(preset, active)}
        disabled={
          loading
          || (downloadingPreset != null && !downloading)
          || (preset.installed && state.modelState !== "loaded")
        }
      >
        <span className={cn("font-semibold tabular-nums leading-none", dense ? "text-[11px]" : "text-body-sm")}>
          {busy || downloading ? <Spinner className="mx-auto size-3.5" /> : loraVersionChip(preset)}
        </span>
        <span
          className={cn(
            "text-[10px] leading-tight tabular-nums",
            active ? "text-generate-foreground/80" : "text-muted-foreground",
          )}
        >
          {!preset.installed
            ? "Download"
            : size ?? (strength != null ? String(strength) : "—")}
        </span>
      </Button>
    );
  };

  const renderFamilyBlock = (title: string, description: string, items: LoraPreset[]) => {
    if (items.length === 0) return null;
    return (
      <div className={cn(dense ? "space-y-1" : "space-y-2")}>
        <div>
          <p className={cn("font-medium text-foreground", dense ? "text-[11px]" : "text-caption")}>{title}</p>
          {!dense ? (
            <p className="text-[11px] leading-snug text-muted-foreground">{description}</p>
          ) : null}
        </div>
        <div className={cn("flex flex-wrap", dense ? "gap-1" : "gap-2")}>{items.map(renderPresetChip)}</div>
      </div>
    );
  };

  return (
    <div className={cn(dense ? "space-y-1.5" : "space-y-3")}>
      <div className="flex items-start justify-between gap-2">
        <p className="min-w-0 text-caption text-muted-foreground">
          {appliedSummary
            ? (
              <>
                Active:{" "}
                <span className="font-medium text-foreground tabular-nums">
                  {appliedSummary}
                  {appliedLoras[0]?.strength != null ? ` · ${appliedLoras[0].strength}` : ""}
                </span>
              </>
            )
            : embedded
              ? "Pick a version below"
              : "Optional style adapter — reloads the model when changed"}
        </p>
        {applied && (
          <Button
            variant="outline"
            size="sm"
            className="h-8 shrink-0 gap-1 px-2 text-caption"
            onClick={() => void handleRemove()}
            disabled={loading || downloadingPreset != null || state.modelState !== "loaded"}
            title="Remove LoRA"
          >
            {loading && loadingPreset == null ? <Spinner className="size-3" /> : <X className="size-3" />}
            Clear
          </Button>
        )}
      </div>

      <div
        className={cn(
          "rounded-lg",
          dense ? "space-y-1.5 p-0" : "space-y-3 p-3",
          embedded ? "border-0 bg-transparent" : "border border-border bg-muted/20",
        )}
      >
        {LORA_FAMILIES.map((family) => {
          const items = grouped.get(family.id) ?? [];
          return renderFamilyBlock(family.title, family.description, items);
        })}
        {otherPresets.length > 0
          ? renderFamilyBlock("Other", "Additional local LoRA files", otherPresets)
          : null}
      </div>

      {loraOperation && (
        <div className="space-y-1.5 rounded-lg border border-border bg-muted/30 px-3 py-2">
          <div className="flex min-w-0 items-center gap-2 text-caption text-muted-foreground">
            <Spinner className="size-3 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{loraOperation.msg}</span>
            <span className="shrink-0 tabular-nums">
              {loraOperation.progress == null ? "…" : `${loraOperation.progress}%`}
            </span>
          </div>
          <Progress value={loraOperation.progress} className="h-1" />
        </div>
      )}
    </div>
  );
}