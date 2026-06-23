/** Column count for masonry gallery based on container width (px). */
export function columnCountForWidth(width: number): number {
  if (width <= 640) return 2;
  if (width <= 900) return 4;
  return 6;
}