export type InspectorMode = "tracking" | "alignment" | "reference";
export type LayoutState = {
  tools: boolean;
  toolsWidth: number;
  viewerRatio: number;
  focus: "all" | "viewer" | "chart";
  mode: InspectorMode;
};
export function layoutState(value: unknown): LayoutState {
  const v =
    value && typeof value === "object" ? (value as Partial<LayoutState>) : {};
  const number = (n: unknown, fallback: number, lo: number, hi: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(lo, Math.min(hi, n))
      : fallback;
  return {
    tools: false,
    toolsWidth: number(v.toolsWidth, 360, 328, 480),
    viewerRatio: number(v.viewerRatio, 0.46, 0.15, 0.85),
    focus: "all",
    mode:
      v.mode === "alignment" || v.mode === "reference" ? v.mode : "tracking",
  };
}
export function paneSizes(height: number, timeline: number, ratio: number) {
  const available = Math.max(0, height - timeline - 12);
  const viewer = Math.max(
    150,
    Math.min(Math.max(150, available - 230), available * ratio),
  );
  return { viewer, chart: Math.max(230, available - viewer) };
}
