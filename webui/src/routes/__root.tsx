import { useState } from "react";
import { createRootRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { DEFAULT_FORM } from "@/state/types";
import { ModelPanel } from "@/components/ModelPanel";
import { GenerationQueuePanel } from "@/components/GenerationQueuePanel";
import { useGenerationQueue } from "@/hooks/useGenerationQueue";
import { PromptHistory } from "@/components/PromptHistory";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { PanelLeftClose, PanelLeft, Plus, History, LayoutGrid } from "lucide-react";

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  const { dispatch } = useAppState();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();

  useGenerationQueue();

  const handleCreateNew = () => {
    dispatch({ type: "RESTORE_FORM", form: DEFAULT_FORM, promptId: undefined });
    navigate({ to: "/" });
  };

  return (
    <TooltipProvider>
      <div className="flex h-dvh bg-background text-foreground">
        <aside className={"flex flex-col shrink-0 border-r border-border bg-background transition-all duration-200 " + (sidebarCollapsed ? "w-0 overflow-hidden border-r-0" : "w-64")}>
          <div className="px-3 py-2 flex items-center gap-2 border-b border-border">
            <div className="flex items-center gap-2">
              <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                <rect x="3" y="3" width="18" height="18" rx="5" />
                <circle cx="12" cy="12" r="4" />
                <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
              </svg>
              <div className="flex items-baseline gap-1.5">
                <h1 className="text-[14px] font-semibold tracking-[-0.02em] text-foreground">
                  Ideogram 4
                </h1>
                <span className="rounded-md bg-foreground px-1 py-px text-[10px] font-bold uppercase text-background leading-none">
                  MLX
                </span>
              </div>
            </div>
            <Button
              variant="ghost"
              size="icon-sm"
              className="ml-auto"
              aria-label="Close sidebar"
              onClick={() => setSidebarCollapsed(true)}
            >
              <PanelLeftClose className="size-3.5" />
            </Button>
          </div>
          <div className="px-3 py-2 space-y-1 border-b border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-8 text-xs font-medium w-full justify-start rounded-md"
              onClick={handleCreateNew}
            >
              <Plus className="size-3.5 mr-2" />
              Create New Image
            </Button>
            <Link
              to="/gallery"
              className="flex items-center h-8 px-3 text-xs font-medium rounded-md transition-colors hover:bg-muted text-foreground no-underline [&.active]:bg-muted"
            >
              <LayoutGrid className="size-3.5 mr-2" />
              Gallery
            </Link>
          </div>
          <div className="flex-1 flex flex-col min-h-0">
            <div className="flex items-center px-3 py-2">
              <h2 className="text-[13px] font-medium text-muted-foreground flex items-center gap-1.5">
                <History className="size-3.5" />
                History
              </h2>
            </div>
            <PromptHistory sidebar />
          </div>
        </aside>

        <div className="flex flex-1 flex-col min-w-0">
          <header className="sticky top-0 z-50 shrink-0 bg-background/80 backdrop-blur-sm">
            <a href="#main-content" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-1.5 focus:bg-background focus:border focus:rounded focus:text-sm focus:shadow-lg">
              Skip to content
            </a>
            <div className="flex items-center gap-3 px-4 h-[53px]">
              {sidebarCollapsed && (
                <Button variant="ghost" size="icon-sm" aria-label="Open sidebar" onClick={() => setSidebarCollapsed(false)}>
                  <PanelLeft className="size-4" />
                </Button>
              )}
              <div className="flex-1" />
              <ModelPanel />
            </div>
          </header>

          <main id="main-content" tabIndex={-1} className="flex-1 flex flex-col min-h-0 overflow-hidden">
            <Outlet />
          </main>

          <GenerationQueuePanel />
          <Toaster richColors theme="light" />
        </div>
      </div>
    </TooltipProvider>
  );
}
