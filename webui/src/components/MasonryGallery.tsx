import type { ReactNode } from "react";

export function MasonryGallery({ children }: { children: ReactNode }) {
  return (
    <div
      className="columns-2 gap-2 sm:columns-4 sm:gap-3 [@media(min-width:900px)]:columns-6 [&>*]:mb-2 sm:[&>*]:mb-3"
      style={{ contentVisibility: "auto" }}
    >
      {children}
    </div>
  );
}