import { useState } from "react";
import { createRootRoute, Link, Outlet, useMatchRoute, useNavigate } from "@tanstack/react-router";
import { useAppState } from "@/state/context";
import { DEFAULT_FORM } from "@/state/types";
import { ModelPanel } from "@/components/ModelPanel";
import { GenerationQueuePanel } from "@/components/GenerationQueuePanel";
import { useGenerationQueue } from "@/hooks/useGenerationQueue";
import { PromptHistory } from "@/components/PromptHistory";
import { FavoritesProvider, useFavorites } from "@/state/favoritesContext";
import { ConfirmDialogProvider } from "@/components/ConfirmDialogProvider";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import { PanelLeftClose, PanelLeft, Plus, History, LayoutGrid, Star } from "lucide-react";

export const Route = createRootRoute({
  component: RootLayout,
});

function SidebarNavLink({
  to,
  active,
  children,
}: {
  to: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      to={to}
      className={cn(
        "relative flex items-center h-8 px-3 text-body-sm font-medium rounded-lg transition-colors hover:bg-accent text-foreground no-underline",
        active && "bg-accent text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-foreground" />
      )}
      {children}
    </Link>
  );
}

function SidebarNavLinks() {
  const { entries } = useFavorites();
  const matchRoute = useMatchRoute();
  const galleryActive = Boolean(matchRoute({ to: "/gallery" }));
  const favoritesActive = Boolean(
    matchRoute({ to: "/favorites" })
    || matchRoute({ to: "/favorites/$favoriteId" }),
  );

  return (
    <nav className="space-y-0.5" aria-label="Main navigation">
      <SidebarNavLink to="/gallery" active={galleryActive}>
        <LayoutGrid className="size-3.5 mr-2" />
        Gallery
      </SidebarNavLink>
      <SidebarNavLink to="/favorites" active={favoritesActive}>
        <Star className="size-3.5 mr-2" />
        <span className="flex-1">Favorites</span>
        {entries.length > 0 && (
          <Badge variant="secondary" className="h-4 min-w-4 px-1 text-caption tabular-nums">
            {entries.length}
          </Badge>
        )}
      </SidebarNavLink>
    </nav>
  );
}

function RootLayout() {
  const { state, dispatch } = useAppState();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const navigate = useNavigate();

  useGenerationQueue();

  const handleCreateNew = () => {
    dispatch({ type: "RESTORE_FORM", form: DEFAULT_FORM, promptId: undefined });
    navigate({ to: "/" });
  };

  const queuePadding = state.genQueue.length > 0
    ? state.genQueueExpanded
      ? "pb-[min(45dvh,360px)]"
      : "pb-11"
    : "";

  return (
    <FavoritesProvider>
      <ConfirmDialogProvider>
        <TooltipProvider>
          <div className="flex h-dvh bg-background text-foreground">
            <aside
              className={cn(
                "flex flex-col shrink-0 border-r border-border bg-card/50 transition-all duration-200",
                sidebarCollapsed ? "w-0 overflow-hidden border-r-0" : "w-64",
              )}
            >
              <div className="px-3 py-3 flex items-center gap-2 border-b border-border">
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
                  onClick={() => setSidebarCollapsed(true)}
                >
                  <PanelLeftClose className="size-3.5" />
                </Button>
              </div>

              <div className="px-3 py-3 space-y-3 border-b border-border">
                <Button
                  size="sm"
                  className="h-9 text-body-sm font-medium w-full justify-start rounded-lg shadow-card"
                  onClick={handleCreateNew}
                >
                  <Plus className="size-3.5 mr-2" />
                  Create New Image
                </Button>
                <SidebarNavLinks />
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
                      onClick={() => setSidebarCollapsed(false)}
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
                className={cn("flex-1 flex flex-col min-h-0 overflow-hidden", queuePadding)}
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