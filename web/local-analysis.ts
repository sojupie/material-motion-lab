import { required } from "./errors";
import type { ProgressReporter } from "./processing-progress";
import type {
Anchor,
Axis,
Measurement,
Method,
MotionReference,
Project,
Region,
Sample,
} from "./types";
import { sampleValue } from "./types";

export function validateReference(value: unknown): MotionReference {
  const r = value as
    | (Omit<MotionReference, "kind" | "curve"> & {
        kind: string;
        curve: number[];
      })
    | null
    | undefined;
  if (!r || !["bezier", "emphasized", "spring"].includes(r.kind)) {
    throw new Error("Unknown reference kind.");
  }
  if (r.kind === "spring") {
    if (
      !Number.isFinite(r.stiffness) ||
      r.stiffness! <= 0 ||
      r.stiffness! > 1e6 ||
      !Number.isFinite(r.damping) ||
      r.damping! < 0 ||
      r.damping! > 100 ||
      !Number.isFinite(r.velocity ?? 0) ||
      Math.abs(r.velocity ?? 0) > 1000
    ) {
      throw new Error("Invalid spring parameters.");
    }
  } else if (
    r.kind === "bezier" &&
    (!Array.isArray(r.curve) ||
      r.curve.length !== 4 ||
      r.curve.some((v) => !Number.isFinite(v)) ||
      required(r.curve[0]) < 0 ||
      required(r.curve[0]) > 1 ||
      required(r.curve[2]) < 0 ||
      required(r.curve[2]) > 1 ||
      Math.abs(required(r.curve[1])) > 10 ||
      Math.abs(required(r.curve[3])) > 10)
  ) {
    throw new Error("Invalid Bézier coordinates.");
  }
  return r as MotionReference;
}
export function referenceAt(
  r: MotionReference,
  ms: number,
  duration: number,
): number {
  if (ms <= 0) {
    return 0;
  }
  if (r.kind === "spring") {
    const t = ms / 1000;
    const w = Math.sqrt(r.stiffness!);
    const z = r.damping!;
    const v = r.velocity ?? 0;
    if (z < 1) {
      const wd = w * Math.sqrt(1 - z * z);
      return (
        1 +
        Math.exp(-z * w * t) *
          (-Math.cos(wd * t) + ((v - z * w) / wd) * Math.sin(wd * t))
      );
    }
    if (z === 1) {
      return 1 + Math.exp(-w * t) * (-1 + (v - w) * t);
    }
    const root = Math.sqrt(z * z - 1);
    const a = -w / (z + root);
    const b = -w * (z + root);
    const c = (v + b) / (a - b);
    return 1 + c * Math.exp(a * t) + (-1 - c) * Math.exp(b * t);
  }
  const t = ms / duration;
  if (t >= 1) {
    return 1;
  }
  const p =
    r.kind === "emphasized"
      ? t <= 0.166666
        ? [0, 0, 0.05, 0, 0.133333, 0.06, 0.166666, 0.4]
        : [0.166666, 0.4, 0.208333, 0.82, 0.25, 1, 1, 1]
      : [0, 0, ...r.curve, 1, 1];
  const at = (u: number, a: number) => {
    const v = 1 - u;
    return (
      v * v * v * required(p[a]) +
      3 * v * v * u * required(p[a + 2]) +
      3 * v * u * u * required(p[a + 4]) +
      u * u * u * required(p[a + 6])
    );
  };
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (at(mid, 0) < t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return at((lo + hi) / 2, 1);
}
export interface MeasureOptions {
  axis: Axis;
  start: number;
  end: number;
  reference: MotionReference;
  duration: number;
  fit?: boolean;
}
export function measure(p: Project, o: MeasureOptions): Measurement {
  validateReference(o.reference);
  const { axis, start, end, reference } = o;
  let { duration } = o;
  if (
    !["x", "y", "width", "height"].includes(axis) ||
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end <= start ||
    end >= p.times.length
  ) {
    throw new Error("Choose a valid measurement interval.");
  }
  if (reference.kind === "spring") {
    if (o.fit !== undefined && o.fit) {
      throw new Error("Springs use physical time.");
    }
    duration = required(p.times[end]) - required(p.times[start]);
  } else if (!Number.isFinite(duration) || duration < 1 || duration > 60_000) {
    throw new Error("Reference duration must be 1–60000 ms.");
  }
  const rows = p.samples.filter((s) => s.frame >= start && s.frame <= end);
  const selected = rows.filter((s) => s.valid && sampleValue(s, axis) !== null);
  const from = sampleValue(
    selected.find((s) => s.frame === start),
    axis,
  );
  const to = sampleValue(
    selected.find((s) => s.frame === end),
    axis,
  );
  if (from === null || to === null) {
    throw new Error("First and last frames need valid tracking samples.");
  }
  const distance = to - from;
  if (Math.abs(distance) < 1e-6) {
    throw new Error(
      "Choose an interval with different start and end positions.",
    );
  }
  if (selected.length < 3) {
    throw new Error("At least three valid samples are needed.");
  }
  const zero = required(p.times[start]);
  const errorAt = (d: number): [number, number] => {
    let sum = 0;
    let max = 0;
    for (const s of selected) {
      const delta = Math.abs(
        sampleValue(s, axis)! -
          from -
          distance * referenceAt(reference, s.t - zero, d),
      );
      sum += delta * delta;
      max = Math.max(max, delta);
    }
    return [Math.sqrt(sum / selected.length), max];
  };
  if (o.fit !== undefined && o.fit) {
    const lower = 1;
    const upper = Math.min(
      60_000,
      Math.max(2, (required(p.times[end]) - zero) * 2),
    );
    const step = (upper - lower) / 240;
    let best = Infinity;
    let chosen = duration;
    for (let i = 0; i <= 240; i++) {
      const d = lower + i * step;
      const e = required(errorAt(d)[0]);
      if (e < best) {
        best = e;
        chosen = d;
      }
    }
    let lo = Math.max(lower, chosen - step);
    let hi = Math.min(upper, chosen + step);
    for (let i = 0; i < 60; i++) {
      const a = lo + (hi - lo) / 3;
      const b = hi - (hi - lo) / 3;
      if (required(errorAt(a)[0]) < required(errorAt(b)[0])) {
        hi = b;
      } else {
        lo = a;
      }
    }
    duration = (lo + hi) / 2;
  }
  const [rmse, maxError] = errorAt(duration);
  const extent = Math.max(duration, required(p.times[end]) - zero);
  const steps = Math.max(120, Math.min(15_000, Math.ceil(extent / 4)));
  const points = [];
  for (let i = 0; i <= steps; i++) {
    const t = (extent * i) / steps;
    points.push({ t, value: distance * referenceAt(reference, t, duration) });
  }
  return {
    reference,
    start,
    end,
    duration,
    rmse,
    maxError,
    samples: selected.length,
    weak: rows.length - selected.length,
    displacement: distance,
    points,
  };
}
export function region(value: unknown, w: number, h: number): Region {
  if (
    !Array.isArray(value) ||
    value.length !== 4 ||
    value.some((v) => !Number.isFinite(v))
  ) {
    throw new Error("Invalid tracking region.");
  }
  const r = value.map((coordinate: unknown) => {
    if (typeof coordinate !== "number") {
      throw new TypeError("Invalid tracking coordinate.");
    }
    return Math.round(coordinate);
  }) as Region;
  if (
    r[0] < 0 ||
    r[1] < 0 ||
    r[2] < 4 ||
    r[3] < 4 ||
    r[0] + r[2] > w ||
    r[1] + r[3] > h
  ) {
    throw new Error("Select a region at least 4 × 4 pixels inside the frame.");
  }
  return r;
}
export function parabola(a: number, b: number, c: number) {
  const den = a - 2 * b + c;
  return den >= -1e-9
    ? 0
    : Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / den));
}
export function edgePeak(
  profile: number[],
  polarity: number,
  expected: number,
): [number, number, number] {
  const g = profile.map((_, i) =>
    i > 0 && i + 1 < profile.length
      ? (required(profile[i + 1]) - required(profile[i - 1])) / 2
      : 0,
  );
  let best = -1;
  let weight = -1;
  for (let i = 1; i + 1 < g.length; i++) {
    if (polarity && required(g[i]) * polarity <= 0) {
      continue;
    }
    const v =
      Math.abs(required(g[i])) /
      (expected >= 0 ? 1 + 0.01 * Math.abs(i - expected) : 1);
    if (v > weight) {
      best = i;
      weight = v;
    }
  }
  if (best < 0) {
    return [0, 0, 0];
  }
  const strength = Math.abs(required(g[best]));
  const offset =
    best > 1 && best + 2 < g.length
      ? parabola(
          Math.abs(required(g[best - 1])),
          strength,
          Math.abs(required(g[best + 1])),
        )
      : 0;
  return [best + offset, strength, Math.sign(required(g[best]))];
}
export interface Gray {
  data: Uint8Array;
  width: number;
  height: number;
}
function profile(
  g: Gray,
  r: Region,
  horizontal: boolean,
  lo: number,
  hi: number,
) {
  const rows = [];
  for (let i = lo; i < hi; i++) {
    let total = 0;
    if (horizontal) {
      for (let y = r[1]; y < r[1] + r[3]; y++) {
        total += required(g.data[y * g.width + i]);
      }
      rows.push(total / r[3]);
    } else {
      for (let x = r[0]; x < r[0] + r[2]; x++) {
        total += required(g.data[i * g.width + x]);
      }
      rows.push(total / r[2]);
    }
  }
  return rows;
}
export interface TrackOptions {
  region: Region;
  start: number;
  end: number;
  anchors?: Anchor[];
  search: number;
  threshold: number;
  method: Method;
}
export async function track(
  p: Project,
  o: TrackOptions,
  frame: (i: number) => Promise<Gray>,
  patchMatch?: (
    gray: Gray,
    template: Gray,
    rect: number[],
  ) => Promise<{ x: number; y: number; score: number; dx: number; dy: number }>,
  progress: ProgressReporter = () => {},
): Promise<Project> {
  if (
    !["feature", "edge-x", "edge-y", "width", "height"].includes(o.method) ||
    !Number.isInteger(o.start) ||
    !Number.isInteger(o.end) ||
    o.start < 0 ||
    o.end < o.start ||
    o.end >= p.times.length ||
    !Number.isFinite(o.search) ||
    o.search < 4 ||
    o.search > 1000 ||
    !Number.isFinite(o.threshold) ||
    o.threshold < 0 ||
    o.threshold > 1
  ) {
    throw new Error("Invalid tracking settings.");
  }
  const selection = region(o.region, p.width, p.height);
  const fixed = new Map<number, Region>();
  for (const a of o.anchors ?? p.anchors) {
    if (a.frame >= o.start && a.frame <= o.end) {
      fixed.set(a.frame, region(a.region, p.width, p.height));
    }
  }
  fixed.set(o.start, selection);
  let r = [...selection] as Region;
  const positions: [number, number] = [0, 0];
  const strengths: [number, number] = [0, 0];
  const signs: [number, number] = [0, 0];
  let template: Gray | undefined;
  const samples: Sample[] = [];
  const horizontal = o.method === "edge-x" || o.method === "width";
  const span = o.method === "width" || o.method === "height";
  for (let i = o.start; i <= o.end; i++) {
    progress("Tracking selected range…", i - o.start, o.end - o.start + 1);
    const g = await frame(i);
    const anchor = fixed.get(i);
    const manual = Boolean(anchor);
    if (anchor) {
      r = [...anchor];
    }
    let valid = true;
    let score = 1;
    let x = r[0];
    let y = r[1];
    let measuredWidth: number | undefined;
    let measuredHeight: number | undefined;
    if (o.method === "feature") {
      if (manual) {
        const data = new Uint8Array(r[2] * r[3]);
        for (let yy = 0; yy < r[3]; yy++) {
          data.set(
            g.data.subarray(
              (r[1] + yy) * g.width + r[0],
              (r[1] + yy) * g.width + r[0] + r[2],
            ),
            yy * r[2],
          );
        }
        template = { data, width: r[2], height: r[3] };
        const mean = data.reduce((a, b) => a + b, 0) / data.length;
        if (
          Math.sqrt(
            data.reduce((a, b) => a + (b - mean) ** 2, 0) / data.length,
          ) < 2
        ) {
          throw new Error(`Frame ${i}: include an edge or texture.`);
        }
      } else {
        const t = template!;
        const left = Math.max(0, r[0] - o.search);
        const right = Math.min(g.width, r[0] + t.width + o.search);
        const top = Math.max(0, r[1] - o.search);
        const bottom = Math.min(g.height, r[1] + t.height + o.search);
        if (!patchMatch) {
          throw new Error("Patch matching engine unavailable.");
        }
        const result = await patchMatch(g, t, [
          left,
          top,
          right - left,
          bottom - top,
        ]);
        score = result.score;
        valid = score >= o.threshold;
        if (valid) {
          r[0] = result.x;
          r[1] = result.y;
          x = result.x + result.dx;
          y = result.y + result.dy;
        }
      }
    } else {
      const strip = [...r] as Region;
      const limit = horizontal ? p.width : p.height;
      if (span) {
        const a = horizontal ? 1 : 0;
        const b = horizontal ? 3 : 2;
        strip[a] += Math.floor(r[b] / 5);
        strip[b] = Math.max(4, Math.floor((r[b] * 3) / 5));
      }
      for (const e of span ? ([0, 1] as const) : ([0] as const)) {
        let expected = required(positions[e]);
        let lo: number;
        let hi: number;
        if (manual && !span) {
          lo = r[horizontal ? 0 : 1];
          hi = lo + r[horizontal ? 2 : 3];
          expected = -1;
        } else {
          expected = manual
            ? r[horizontal ? 0 : 1] + e * r[horizontal ? 2 : 3]
            : expected;
          const radius = manual ? Math.min(o.search, 8) : o.search;
          lo = Math.max(0, Math.floor(expected) - radius - 1);
          hi = Math.min(limit, Math.ceil(expected) + radius + 2);
        }
        const [peak, strength, sign] = edgePeak(
          profile(g, strip, horizontal, lo, hi),
          manual ? 0 : signs[e],
          expected < 0 ? -1 : expected - lo,
        );
        const ratio = manual ? 1 : strength / required(strengths[e]);
        if (strength < 2 || ratio < o.threshold) {
          valid = false;
        }
        if (manual) {
          strengths[e] = strength;
          signs[e] = sign;
        }
        score = Math.min(score, ratio);
        if (strength >= 2 && ratio >= o.threshold) {
          positions[e] = lo + peak;
        }
      }
      if (span && required(positions[1]) <= required(positions[0])) {
        valid = false;
      }
      if (manual && !valid) {
        throw new Error(`Frame ${i}: select distinct straight edges.`);
      }
      if (horizontal) {
        x = required(positions[0]);
        if (span) {
          measuredWidth = required(positions[1]) - required(positions[0]);
        }
      } else {
        y = required(positions[0]);
        if (span) {
          measuredHeight = required(positions[1]) - required(positions[0]);
        }
      }
    }
    samples.push({
      frame: i,
      t: required(p.times[i]),
      x: valid ? x : null,
      y: valid ? y : null,
      width: r[2],
      height: r[3],
      score: Number.isFinite(score) ? score : 0,
      valid,
      manual,
      measuredWidth,
      measuredHeight,
    });
  }
  progress(
    "Tracking selected range…",
    o.end - o.start + 1,
    o.end - o.start + 1,
  );
  return {
    ...p,
    selection,
    samples,
    anchors: [...fixed]
      .toSorted((a, b) => a[0] - b[0])
      .map(([frame, region]) => ({ frame, region })),
    settings: {
      start: o.start,
      end: o.end,
      search: o.search,
      threshold: o.threshold,
      method: o.method,
      precision: "subpixel",
    },
  };
}
