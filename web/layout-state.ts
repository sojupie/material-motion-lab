export interface LayoutState {
  toolsWidth: number;
  viewerRatio: number;
  libraryRatio: number;
  focus: "all" | "viewer" | "chart";
}
export function layoutState(value: unknown): LayoutState {
  const v =
    value !== null && typeof value === "object"
      ? (value as Partial<LayoutState>)
      : {};
  const number = (n: unknown, fallback: number, lo: number, hi: number) =>
    typeof n === "number" && Number.isFinite(n)
      ? Math.max(lo, Math.min(hi, n))
      : fallback;
  return {
    toolsWidth: number(v.toolsWidth, 480, 320, 1600),
    viewerRatio: number(v.viewerRatio, 0.46, 0, 1),
    libraryRatio: number(v.libraryRatio, 0.75, 0, 1),
    focus: "all",
  };
}
export function paneSizes(
  height: number,
  timeline: number,
  ratio: number,
  library = false,
) {
  const minViewer = library ? 240 : 180;
  const minChart = 340;
  const available = Math.max(0, height - timeline - 24);
  // The chart keeps its own minimum and the workspace scrolls when necessary.
  const viewer = Math.max(minViewer, Math.min(available, available * ratio));
  return { viewer, chart: Math.max(minChart, available - viewer) };
}
export function toolsWidth(requested: number, available: number) {
  const minimum = 320;
  return Math.max(
    minimum,
    Math.min(Math.max(minimum, available - 372), requested),
  );
}
export function viewerRatio(viewer: number, delta: number, available: number) {
  return Math.max(0, Math.min(1, (viewer + delta) / Math.max(1, available)));
}
