export type Region = [number, number, number, number];
export type Sample = {
  frame: number;
  t: number;
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  score: number;
  valid: boolean;
  manual: boolean;
};
export type Anchor = { frame: number; region: Region };
export type Method = "feature" | "edge-x" | "edge-y";
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
export type Measurement = {
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
export type Workspace = { schema: 1; tracks: WorkspaceTrack[] };
