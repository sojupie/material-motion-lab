import { $ } from "./api";
import { required } from "./errors";
import { LEFT,RIGHT } from "./timeline-renderer";
import type { Measurement } from "./types";
import type { VideoView } from "./video";

export interface GraphPoint {
  t: number;
  v: number | null;
  frame: number;
  manual: boolean;
}
export interface GraphSeries {
  view: VideoView;
  points: GraphPoint[];
  distance: number;
}
interface PlotOptions {
  svg: HTMLElement;
  data: GraphSeries[];
  reports: ReadonlyMap<string, Measurement>;
  progress: boolean;
  bounds: [number, number];
  scale: [number, number];
  width: number;
  height: number;
  isPanning: () => boolean;
  onSelect: (view: VideoView, time?: number) => void;
  onHover: (view: VideoView, point: GraphPoint) => void;
  onLeave: () => void;
  paintPlayhead: () => void;
}
export function renderGraphPlot({
  svg,
  data,
  reports,
  progress,
  bounds: [min, max],
  scale: [low, high],
  width,
  height,
  isPanning,
  onSelect,
  onHover,
  onLeave,
  paintPlayhead,
}: PlotOptions) {
  const left = LEFT;
  const right = RIGHT;
  const bottom = height - 56;
  const plotHeight = bottom - 24;
  const X = (t: number) =>
    left + ((t - min) / (max - min)) * (width - left - right);
  const Y = (v: number) => bottom - ((v - low) / (high - low)) * plotHeight;
  const ns = "http://www.w3.org/2000/svg";
  const el = (
    name: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) => {
    const node = document.createElementNS(ns, name);
    for (const [key, value] of Object.entries(attrs)) {
      node.setAttribute(key, String(value));
    }
    if (
      name === "circle" ||
      (name === "path" && /\b(trace|reference)\b/.test(String(attrs.class)))
    ) {
      node.setAttribute("clip-path", "url(#displacement-plot)");
    }
    if (text !== undefined && text !== "") {
      node.textContent = text;
    }
    svg.append(node);
    return node;
  };
  const defs = document.createElementNS(ns, "defs");
  const clip = document.createElementNS(ns, "clipPath");
  clip.id = "displacement-plot";
  const rect = document.createElementNS(ns, "rect");
  for (const [name, value] of Object.entries({
    x: left,
    y: 24,
    width: width - left - right,
    height: plotHeight,
  })) {
    rect.setAttribute(name, String(value));
  }
  clip.append(rect);
  defs.append(clip);
  svg.append(defs);
  el(
    "text",
    { x: left, y: 14, class: "tick" },
    progress ? "Progress (%)" : "Pixels",
  );
  const ticks = width < 500 ? 3 : 6;
  for (let i = 0; i <= ticks; i++) {
    const t = min + ((max - min) * i) / ticks;
    const x = X(t);
    el("line", { x1: x, x2: x, y1: 24, y2: bottom, class: "grid" });
    el(
      "text",
      {
        x,
        y: bottom + 25,
        "text-anchor": i === ticks ? "end" : i === 0 ? "start" : "middle",
        class: "tick",
      },
      (t / 1000).toFixed(max - min < 1000 ? 3 : 2),
    );
  }
  for (let i = 0; i < 5; i++) {
    const value = low + ((high - low) * i) / 4;
    const y = Y(value);
    el("line", { x1: left, x2: width - right, y1: y, y2: y, class: "grid" });
    el(
      "text",
      { x: left - 8, y: y + 4, "text-anchor": "end", class: "tick" },
      value.toFixed(1),
    );
  }
  if (min <= 0 && max >= 0) {
    el("line", {
      x1: X(0),
      x2: X(0),
      y1: 24,
      y2: bottom,
      class: "alignment-line",
    });
  }
  for (const d of data) {
    const cls = d.view.prefix === "a" ? "trace" : "reference";
    const rangeStart =
      required(d.view.project!.times[d.view.first]) + d.view.offset;
    const rangeEnd =
      required(d.view.project!.times[d.view.last]) + d.view.offset;
    for (const [t, label] of [
      [rangeStart, "In"],
      [rangeEnd, "Out"],
    ] as const) {
      if (t >= min && t <= max) {
        el("line", {
          x1: X(t),
          x2: X(t),
          y1: 24,
          y2: bottom,
          class: `range-boundary ${cls}`,
        });
        el(
          "text",
          { x: X(t) + 3, y: 35, class: "range-label" },
          `${d.view.prefix.toUpperCase()} ${label}`,
        );
      }
    }
    if (d.view.sync !== null) {
      const t = required(d.view.project!.times[d.view.sync]) + d.view.offset;
      if (t >= min && t <= max) {
        el("path", {
          d: `M${X(t) - 4},18 L${X(t)},12 L${X(t) + 4},18 L${X(t)},24Z`,
          class: "sync-marker",
        });
      }
    }
    let path = "";
    let activePath = "";
    let activePen = false;
    let pen = false;
    for (const s of d.points) {
      if (s.v === null || s.t < min || s.t > max) {
        pen = false;
        activePen = false;
        if (s.v === null && s.t >= min && s.t <= max) {
          el("line", {
            x1: X(s.t),
            x2: X(s.t),
            y1: bottom + 2,
            y2: bottom + 9,
            class: "weak-mark",
          });
        }
        continue;
      }
      path += `${pen ? "L" : "M"}${X(s.t)},${Y(s.v)}`;
      pen = true;
      if (s.frame >= d.view.first && s.frame <= d.view.last) {
        activePath += `${activePen ? "L" : "M"}${X(s.t)},${Y(s.v)}`;
        activePen = true;
      } else {
        activePen = false;
      }
      const dot = el("circle", {
        cx: X(s.t),
        cy: Y(s.v),
        r: s.manual ? 4 : 2,
        class: s.manual ? `manual-mark ${cls}` : cls,
      });
      dot.dataset.frame = String(s.frame);
      dot.dataset.view = d.view.prefix;
      dot.setAttribute("tabindex", "-1");
      dot.setAttribute("role", "button");
      dot.setAttribute(
        "aria-label",
        `${d.view.prefix.toUpperCase()} frame ${s.frame}, ${s.v.toFixed(3)} ${progress ? "percent" : "pixels"}`,
      );
      const inspect = () => {
        if (isPanning()) {
          return;
        }
        onSelect(d.view, s.t);
      };
      dot.addEventListener("click", inspect);
      dot.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          inspect();
        }
      });
      dot.addEventListener("pointerenter", () => {
        if (isPanning()) {
          return;
        }
        onHover(d.view, s);
        dot.classList.add("hover-sample");
      });
      dot.addEventListener("pointerleave", () => {
        onLeave();
        dot.classList.remove("hover-sample");
        paintPlayhead();
      });
      if (s.frame < d.view.first || s.frame > d.view.last) {
        dot.classList.add("outside-range");
      }
      if (s.frame === d.view.index && !d.view.outside) {
        dot.classList.add("current-sample");
      }
      if (s.manual) {
        const title = document.createElementNS(ns, "title");
        title.textContent = `${d.view.prefix.toUpperCase()}: manual anchor at frame ${s.frame}`;
        dot.append(title);
      }
    }
    const trace = el("path", {
      d: path,
      class: `${cls} outside-range${d.view.dirty ? " stale-trace" : ""}`,
      "data-view": d.view.prefix,
    });
    trace.addEventListener("click", () => {
      onSelect(d.view);
    });
    const activeTrace = el("path", {
      d: activePath,
      class: cls + (d.view.dirty ? " stale-trace" : ""),
      "data-view": d.view.prefix,
    });
    activeTrace.addEventListener("click", () => {
      onSelect(d.view);
    });
    const report = reports.get(d.view.prefix);
    if (
      report &&
      !d.view.dirty &&
      report.start === d.view.first &&
      report.end === d.view.last
    ) {
      let expected = "";
      for (const point of report.points) {
        const t =
          point.t +
          required(d.view.project!.times[d.view.first]) +
          d.view.offset;
        if (t < min || t > max) {
          continue;
        }
        const value = progress
          ? (point.value / report.displacement) * 100
          : point.value;
        expected += `${expected ? "L" : "M"}${X(t)},${Y(value)}`;
      }
      el("path", {
        d: expected,
        class: `expected-path ${cls}`,
        "pointer-events": "none",
      });
    }
  }
  for (const dot of svg.querySelectorAll("[data-frame]")) {
    svg.append(dot);
  }
  el("line", {
    id: "graph-playhead",
    x1: 0,
    x2: 0,
    y1: 24,
    y2: bottom,
    class: "playhead",
  });
  paintPlayhead();

  el(
    "text",
    { x: width / 2, y: height - 6, "text-anchor": "middle", class: "tick" },
    "Workspace time (s)",
  );
  el("rect", {
    x: 0,
    y: 24,
    width: left,
    height: plotHeight,
    fill: "transparent",
    "data-y-axis": "",
    class: "vertical-axis-pan",
    tabindex: 0,
    role: "button",
    "aria-label":
      "Pan vertical axis. Drag or use up and down arrows. Home fits motion.",
  });
}

export function renderGraphSummary({
  views,
  progress,
  distance,
  reports,
  errors,
  preset,
}: {
  views: VideoView[];
  progress: boolean;
  distance: (view: VideoView) => number;
  reports: ReadonlyMap<string, Measurement>;
  errors: ReadonlyMap<string, string>;
  preset: string;
}) {
  for (const view of views) {
    const result = $(`${view.prefix}-result`);
    result.hidden = !view.project;
    if (!view.project) {
      continue;
    }
    if (progress && Math.abs(distance(view)) < 1e-6) {
      result.textContent = `${view.prefix.toUpperCase()}: progress needs different measured positions at the tracking range boundaries.`;
      continue;
    }
    const report = reports.get(view.prefix);
    const error = errors.get(view.prefix);
    if (preset === "none") {
      const p = view.project;
      const selected = p.samples.filter(
        (s) => s.frame >= view.first && s.frame <= view.last,
      );
      result.textContent = `${view.prefix.toUpperCase()}: ${selected.filter((s) => s.valid).length} valid samples, ${selected.filter((s) => !s.valid).length} weak matches in range.`;
    } else if (view.dirty) {
      result.textContent = `${view.prefix.toUpperCase()}: tracking settings changed; update measurements before comparing curves.`;
    } else if (error !== undefined && error !== "") {
      result.textContent = `${view.prefix.toUpperCase()}: ${error}`;
    } else if (
      report &&
      report.start === view.first &&
      report.end === view.last
    ) {
      const factor = progress ? 100 / Math.abs(report.displacement) : 1;
      const unit = progress ? "%" : "px";
      result.textContent = `${view.prefix.toUpperCase()}: ${report.reference?.kind === "spring" ? "spring" : `reference ${report.duration.toFixed(1)} ms`}; RMSE ${(report.rmse * factor).toFixed(3)} ${unit}; maximum error ${(report.maxError * factor).toFixed(3)} ${unit}; ${report.samples} valid samples, ${report.weak} weak matches.`;
    } else {
      result.textContent = "";
    }
  }
}
