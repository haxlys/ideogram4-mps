import { loadModel, unloadModel } from "@/api/client";
import { useAppState } from "@/state/context";
import { useModelPolling } from "@/hooks/useModelPolling";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

function shortRepo(repo?: string) {
  if (!repo) return "ideogram-4-mlx-q8";
  return repo.split("/").pop() || repo;
}

function formatGb(value?: number | null) {
  if (value == null) return null;
  return `${value.toFixed(1)}G`;
}

export function ModelPanel() {
  const { state, dispatch } = useAppState();
  const { startPolling } = useModelPolling();
  const isLoading = state.modelState === "loading";
  const isLoaded = state.modelState === "loaded";
  const status = state.modelStatus;
  const backend = (status?.backend ?? "mlx").toUpperCase();
  const quantization = status?.quantization_bits ? `q${status.quantization_bits}` : "q8";
  const activeMemory = formatGb(status?.mlx_memory?.active_gb);
  const peakMemory = formatGb(status?.mlx_memory?.peak_gb);
  const statusTitle = [
    status?.model_repo ? `repo: ${status.model_repo}` : null,
    status?.model_path ? `path: ${status.model_path}` : null,
    activeMemory ? `active: ${activeMemory}` : null,
    peakMemory ? `peak: ${peakMemory}` : null,
    status?.msg ? `status: ${status.msg}` : null,
  ].filter(Boolean).join("\n");

  async function handleLoad() {
    dispatch({ type: "SET_MODEL_STATE", state: "loading" });
    try {
      await loadModel();
      startPolling();
    } catch {
      dispatch({ type: "SET_MODEL_STATE", state: "idle" });
      toast.error("Failed to start model load.");
    }
  }

  async function handleUnload() {
    if (!confirm("Unload MLX model? This frees the local model memory.")) return;
    try {
      await unloadModel();
      dispatch({ type: "SET_MODEL_STATE", state: "idle" });
    } catch {
      toast.error("Failed to unload model.");
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-2" title={statusTitle || undefined}>
      <span
        className={cn(
          "inline-block h-2 w-2 shrink-0 rounded-full",
          isLoaded
            ? "bg-emerald-500"
            : isLoading
              ? "bg-amber-400 animate-pulse"
              : "bg-muted-foreground/40",
        )}
      />
      <div className="hidden min-w-0 items-center gap-1.5 sm:flex">
        <span className="rounded border border-border px-1.5 py-0.5 text-[10px] font-semibold leading-none text-muted-foreground">
          {backend} {quantization}
        </span>
        <span className="max-w-[150px] truncate text-[11px] text-muted-foreground">
          {shortRepo(status?.model_repo)}
        </span>
        {isLoaded && activeMemory ? (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-mono leading-none text-muted-foreground">
            {activeMemory}
          </span>
        ) : null}
      </div>
      {state.modelState === "loaded" ? (
        <Button variant="ghost" size="sm" className="h-7 px-2 text-[11px] text-muted-foreground hover:text-destructive" onClick={handleUnload}>
          Unload
        </Button>
      ) : (
        <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-[11px]" onClick={handleLoad} disabled={isLoading}>
          {isLoading ? <Spinner className="size-3" /> : null}
          {isLoading ? "Loading..." : "Load"}
        </Button>
      )}
    </div>
  );
}
