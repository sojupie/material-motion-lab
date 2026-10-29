export const TRIM_TARGET_SIZE = 52;

// Resolve overlapping grab areas by distance to the visible handle, not SVG paint order.
export function nearestTrimHandle(
  centers: { x: number; y: number; width?: number; height?: number }[],
  x: number,
  y: number,
): number {
  let index = -1;
  let distance = Infinity;
  centers.forEach((center, i) => {
    const dx = x - center.x;
    const dy = y - center.y;
    if (
      Math.abs(dx) > (center.width ?? TRIM_TARGET_SIZE) / 2 ||
      Math.abs(dy) > (center.height ?? TRIM_TARGET_SIZE) / 2
    ) {
      return;
    }
    const d = dx * dx + dy * dy;
    if (d < distance) {
      index = i;
      distance = d;
    }
  });
  return index;
}
