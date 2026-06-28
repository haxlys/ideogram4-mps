import { useState } from "react";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { createRootRoute, Outlet, useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { DEFAULT_FORM } from "@/state/types";
import { ModelPanel } from "@/components/ModelPanel";
import { GenerationQueuePanel } from "@/components/GenerationQueuePanel";
import { useMagicPromptExpandRunner } from "@/hooks/useMagicPromptExpandRunner";
import { useGenerationQueue } from "@/hooks/useGenerationQueue";
import { PromptHistory } from "@/components/PromptHistory";
import { FavoritesProvider } from "@/state/favoritesContext";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";
import { SidebarNavLinks } from "@/components/SidebarNavLinks";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeft, Plus, History } from "lucide-react";

export const Route = createRootRoute({
  component: RootLayout,
});

/** Hooks that need ConfirmDialogProvider (enqueue / magic expand). */
function AppRuntimeHooks() {
  useGenerationQueue();
  useMagicPromptExpandRunner();
  return null;
}

function RootLayout() {
  const { dispatch } = useAppState();
  const isLgUp = useMediaQuery("(min-width: 1024px)");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(false);
  const sidebarCollapsed = isLgUp ? desktopSidebarCollapsed : !mobileSidebarOpen;
  const navigate = useNavigate();


  const openSidebar = () => {
    if (isLgUp) setDesktopSidebarCollapsed(false);
    else setMobileSidebarOpen(true);
  };

  const closeSidebar = () => {
    if (isLgUp) setDesktopSidebarCollapsed(true);
    else setMobileSidebarOpen(false);
  };

  const closeMobileSidebar = () => {
    if (!isLgUp) setMobileSidebarOpen(false);
  };

  const handleCreateNew = () => {
    dispatch({ type: "RESTORE_FORM", form: DEFAULT_FORM, promptId: undefined });
    navigate({ to: "/" });
    closeMobileSidebar();
  };

  return (
    <FavoritesProvider>
      <ConfirmDialogProvider>
        <AppRuntimeHooks />
        <TooltipProvider>
          <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            {!sidebarCollapsed && !isLgUp && (
              <button
                type="button"
                className="fixed inset-0 z-40 bg-foreground/20 backdrop-blur-[1px] lg:hidden"
                aria-label="Close sidebar"
                onClick={closeSidebar}
              />
            )}
            <aside
              className={cn(
                "flex w-64 flex-col shrink-0 border-r border-border bg-card/95 transition-transform duration-200",
                "max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:shadow-elevated",
                sidebarCollapsed
                  ? "max-lg:-translate-x-full lg:w-0 lg:overflow-hidden lg:border-r-0"
                  : "max-lg:translate-x-0",
              )}
            >
              <div className="flex items-center gap-2 border-b border-border px-3 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <svg aria-hidden="true" className="size-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                    <rect x="3" y="3" width="18" height="18" rx="5" />
                    <circle cx="12" cy="12" r="4" />
                    <path d="M12 3v3M12 18v3M3 12h3M18 12h3" />
                  </svg>
                  <div className="flex items-baseline gap-1.5 min-w-0">
                    <h1 className="text-body font-semibold tracking-[-0.02em] text-foreground truncate">
                      Ideogram 4
                    </h1>
                    <span className="rounded-md bg-primary px-1 py-px text-caption font-bold uppercase text-primary-foreground leading-none shrink-0">
                      MLX
                    </span>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="ml-auto shrink-0"
                  aria-label="Close sidebar"
                  onClick={closeSidebar}
                >
                  <PanelLeftClose className="size-3.5" />
                </Button>
              </div>

              <div className="px-3 py-3 space-y-3 border-b border-border">
                <Button
                  variant="generate"
                  size="sm"
                  className="h-9 w-full justify-start rounded-lg text-body-sm font-medium"
                  onClick={handleCreateNew}
                >
                  <Plus className="mr-2 size-3.5" />
                  Create New Image
                </Button>
                <SidebarNavLinks onNavigate={closeMobileSidebar} />
              </div>

              <div className="flex-1 flex flex-col min-h-0">
                <div className="flex items-center px-3 py-2.5">
                  <h2 className="text-body-sm font-medium text-muted-foreground flex items-center gap-1.5">
                    <History className="size-3.5" />
                    History
                  </h2>
                </div>
                <PromptHistory sidebar />
              </div>
            </aside>

            <div className="flex flex-1 flex-col min-w-0">
              <header className="sticky top-0 z-50 shrink-0 border-b border-border bg-background/85 backdrop-blur-md">
                <a
                  href="#main-content"
                  className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[100] focus:px-3 focus:py-1.5 focus:bg-background focus:border focus:rounded focus:text-sm focus:shadow-lg"
                >
                  Skip to content
                </a>
                <div
                  className="flex items-center gap-3 px-4"
                  style={{ height: "var(--header-height)" }}
                >
                  {sidebarCollapsed && (
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label="Open sidebar"
                      onClick={openSidebar}
                    >
                      <PanelLeft className="size-4" />
                    </Button>
                  )}
                  <div className="flex-1" />
                  <ThemeToggle />
                  <ModelPanel />
                </div>
              </header>

              <main
                id="main-content"
                tabIndex={-1}
                className="flex-1 flex flex-col min-h-0 overflow-hidden"
              >
                <Outlet />
              </main>

              <GenerationQueuePanel />
              <Toaster richColors />
            </div>
          </div>
        </TooltipProvider>
      </ConfirmDialogProvider>
    </FavoritesProvider>
  );
}
