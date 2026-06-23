import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/favorites")({
  component: FavoritesLayout,
});

function FavoritesLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}