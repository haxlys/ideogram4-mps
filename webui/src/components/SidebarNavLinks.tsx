import type { ReactNode } from "react";
import { Link, useMatchRoute } from "@tanstack/react-router";
import { Badge } from "@/components/ui/badge";
import { useFavorites } from "@/state/favoritesContext";
import { cn } from "@/lib/utils";
import { LayoutGrid, Star } from "lucide-react";

function SidebarNavLink({
  to,
  active,
  onNavigate,
  children,
}: {
  to: string;
  active: boolean;
  onNavigate?: () => void;
  children: ReactNode;
}) {
  return (
    <Link
      to={to}
      onClick={onNavigate}
      className={cn(
        "relative flex h-8 items-center rounded-lg px-3 text-body-sm font-medium text-foreground no-underline transition-colors hover:bg-accent",
        active && "bg-generate-muted font-medium text-foreground",
      )}
    >
      {active && (
        <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-full bg-generate" />
      )}
      {children}
    </Link>
  );
}

export function SidebarNavLinks({ onNavigate }: { onNavigate?: () => void }) {
  const { entries } = useFavorites();
  const matchRoute = useMatchRoute();
  const galleryActive = Boolean(matchRoute({ to: "/gallery" }));
  const favoritesActive = Boolean(
    matchRoute({ to: "/favorites" })
    || matchRoute({ to: "/favorites/$favoriteId" }),
  );

  return (
    <nav className="space-y-0.5" aria-label="Main navigation">
      <SidebarNavLink to="/gallery" active={galleryActive} onNavigate={onNavigate}>
        <LayoutGrid className="size-3.5 mr-2" />
        Gallery
      </SidebarNavLink>
      <SidebarNavLink to="/favorites" active={favoritesActive} onNavigate={onNavigate}>
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
