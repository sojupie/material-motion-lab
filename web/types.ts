export type Region = [number, number, number, number];
export type Sample = {
  frame: number;
  t: number;
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  measuredWidth?: number | null;
  measuredHeight?: number | null;
  score: number;
  valid: boolean;
  manual: boolean;
};
export type Anchor = { frame: number; region: Region };
export type Method = "feature" | "edge-x" | "edge-y" | "width" | "height";
export type Project = {
  id: string;
  name: string;
  width: number;
  height: number;
  times: number[];
  zeroFrame: number;
  selection: Region | null;
  anchors: Anchor[];
  samples: Sample[];
  settings: {
    start?: number;
    end?: number;
    search?: number;
    threshold?: number;
    method?: Method;
    precision?: string;
  };
  comparison?: { id: string; zeroFrame: number } | null;
};
export type Entry = { id: string; name: string };
export type MotionReference = {
  id?: string;
  label?: string;
  kind: "bezier" | "emphasized" | "spring";
  curve: [number, number, number, number];
  stiffness?: number;
  damping?: number;
  velocity?: number;
  source?: string;
};
export type Measurement = {
  reference?: MotionReference;
  start: number;
  end: number;
  duration: number;
  rmse: number;
  maxError: number;
  samples: number;
  weak: number;
  displacement: number;
  points: { t: number; value: number }[];
};
export type WorkspaceTrack = {
  id: string;
  offset: number;
  sync: number | null;
  first: number;
  last: number;
};
export type Playback = {
  range: [number, number] | null;
  speed: number;
  loop: boolean;
};
export type Workspace = {
  schema: 1;
  tracks: WorkspaceTrack[];
  playback?: Playback;
};

export type Axis = "x" | "y" | "width" | "height";
export function sampleValue(s: Sample | undefined, axis: Axis): number | null {
  if (!s) return null;
  return axis === "width"
    ? (s.measuredWidth ?? null)
    : axis === "height"
      ? (s.measuredHeight ?? null)
      : s[axis];
}
