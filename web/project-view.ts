export const viewControls = [
  "axis",
  "units",
  "curve",
  "duration",
  "duration-mode",
  "bezier-x1",
  "bezier-y1",
  "bezier-x2",
  "bezier-y2",
  "spring-stiffness",
  "spring-damping",
  "spring-velocity",
] as const;
export interface ProjectView {
  controls: Record<string, string>;
  time: number;
  window: [number, number] | null;
  vertical: [number, number] | null;
  selected: string;
}
export function finiteRange(value: unknown): value is [number, number] {
  return (
    Array.isArray(value) &&
    value.length === 2 &&
    value.every(
      (n) =>
        typeof n === "number" &&
        Number.isFinite(n) &&
        Math.abs(n) <= 86_400_000,
    ) &&
    value[0] < value[1]
  );
}
