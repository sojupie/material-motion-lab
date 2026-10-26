export type ScaleRange = [number, number];
export function fitScale(values: number[], minimumPadding: number): ScaleRange {
  const finite = values.filter(Number.isFinite);
  const low = finite.length ? Math.min(...finite) : 0;
  const high = finite.length ? Math.max(...finite) : 0;
  const padding = Math.max(minimumPadding, (high - low) * 0.1);
  return [low - padding, high + padding];
}
export function zoomScale([low, high]: ScaleRange, factor: number): ScaleRange {
  const center = (low + high) / 2,
    half = ((high - low) * factor) / 2;
  return [center - half, center + half];
}
export function panScale(
  [low, high]: ScaleRange,
  fraction: number,
): ScaleRange {
  const delta = (high - low) * fraction;
  return [low + delta, high + delta];
}
