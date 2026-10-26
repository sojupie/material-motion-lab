export type InspectorMode = "tracking" | "alignment" | "reference";
export type LayoutState = {
  media: boolean;
  tools: boolean;
  mediaWidth: number;
  toolsWidth: number;
  viewerRatio: number;
  focus: "all" | "viewer" | "chart";
  mode: InspectorMode;
};
export function layoutState(value: unknown, width: number): LayoutState {
  const v =
    value && typeof value === "object" ? (value as Partial<LayoutState>) : {};
  const number = (n: unknown, fallback: number, lo: number, hi: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(lo, Math.min(hi, n))
      : fallback;
  return {
    media: typeof v.media === "boolean" ? v.media : width >= 1600,
    tools: typeof v.tools === "boolean" ? v.tools : width >= 1100,
    mediaWidth: number(v.mediaWidth, 240, 200, 400),
    toolsWidth: number(v.toolsWidth, 360, 328, 480),
    viewerRatio: number(v.viewerRatio, 0.46, 0.15, 0.85),
    focus: v.focus === "viewer" || v.focus === "chart" ? v.focus : "all",
    mode:
      v.mode === "alignment" || v.mode === "reference" ? v.mode : "tracking",
  };
}
export function paneSizes(height: number, timeline: number, ratio: number) {
  const available = Math.max(0, height - timeline - 10);
  const viewer = Math.max(
    150,
    Math.min(Math.max(150, available - 230), available * ratio),
  );
  return { viewer, chart: Math.max(230, available - viewer) };
}
