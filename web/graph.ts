import { $, post } from "./api";
import { milliseconds } from "./timing";
import type { Measurement, Project } from "./types";
import type { VideoView } from "./video";
type Point = { t: number; v: number | null; frame: number; manual: boolean };
export class MotionGraph {
  private window: [number, number] | null = null;
  private domain = { min: 0, max: 1, width: 1000, left: 64, right: 16 };
  private pointer: number | null = null;
  private reports = new Map<string, Measurement>();
  private errors = new Map<string, string>();
  private revision = 0;
  private cache = new Map<
    string,
    { project: Project; key: string; report?: Measurement; error?: string }
  >();
  constructor(
    private views: () => VideoView[],
    private seek: (time: number) => void,
  ) {
    $("axis").onchange = () => void this.refresh();
    $("units").onchange = () => this.paint();
    $("curve").onchange = () => {
      if (this.preset === "md3") {
        const token = getComputedStyle(document.documentElement)
          .getPropertyValue("--md-sys-motion-duration-medium2")
          .trim();
        const ms = milliseconds(token);
        $<HTMLInputElement>("duration").value = String(ms || 300);
      }
      void this.refresh();
    };
    $("duration").onchange = () => void this.refresh();
    $("reset-zoom").onclick = () => {
      this.window = null;
      this.paint();
    };
    $("zoom-interval").onclick = () => {
      const views = this.views().filter(
        (v) =>
          v.project &&
          Number.isInteger(v.first) &&
          Number.isInteger(v.last) &&
          v.first >= 0 &&
          v.last < v.project.times.length &&
          v.first < v.last,
      );
      if (!views.length) return;
      this.window = [
        Math.min(
          ...views.map(
            (v) => v.project!.times[v.first] - v.project!.times[v.zero],
          ),
        ),
        Math.max(
          ...views.map(
            (v) => v.project!.times[v.last] - v.project!.times[v.zero],
          ),
        ),
      ];
      this.paint();
    };
    const svg = $("graph");
    svg.onpointerdown = (e) => {
      this.pointer = e.clientX;
      svg.setPointerCapture(e.pointerId);
    };
    svg.onpointerup = (e) => {
      if (this.pointer === null) return;
      const from = this.at(this.pointer),
        to = this.at(e.clientX),
        drag = Math.abs(e.clientX - this.pointer);
      this.pointer = null;
      if (drag > 8) {
        this.window = [Math.min(from, to), Math.max(from, to)];
        this.paint();
      } else this.seek(to);
    };
    svg.onpointercancel = () => (this.pointer = null);
    new ResizeObserver(() => this.paint()).observe(svg.parentElement!);
  }
  get axis() {
    return $<HTMLSelectElement>("axis").value as "x" | "y";
  }
  get preset() {
    return $<HTMLSelectElement>("curve").value;
  }
  get progress() {
    return $<HTMLSelectElement>("units").value === "progress";
  }
  private curve() {
    if (this.preset === "linear") return [0, 0, 1, 1];
    const text = getComputedStyle(document.documentElement).getPropertyValue(
      "--md-sys-motion-easing-standard",
    );
    const values = text.match(/-?\d*\.?\d+/g)?.map(Number);
    if (!values || values.length !== 4)
      throw Error("MD3 standard easing token is unavailable.");
    return values;
  }
  controls(busy: boolean) {
    for (const key of ["reset-zoom", "zoom-interval"])
      $<HTMLButtonElement>(key).disabled =
        busy || !this.views().some((v) => v.project);
    for (const v of this.views())
      $<HTMLButtonElement>(`fit-${v.prefix}`).disabled =
        busy || this.preset === "none" || !v.project?.samples.length;
    $<HTMLInputElement>("duration").disabled = busy || this.preset === "none";
  }
  reset() {
    this.window = null;
    this.cache.clear();
    void this.refresh();
  }
  async fit(view: VideoView) {
    if (!view.project) return;
    const report = await post<Measurement>(
      `/projects/${view.project.id}/measure`,
      {
        axis: this.axis,
        start: view.zero,
        end: view.last,
        curve: this.curve(),
        duration: Number($<HTMLInputElement>("duration").value),
        fit: true,
      },
    );
    $<HTMLInputElement>("duration").value = report.duration.toFixed(2);
    await this.refresh();
  }
  async refresh() {
    const token = ++this.revision;
    this.reports.clear();
    this.errors.clear();
    $("curve-note").hidden = this.preset === "none";
    $("curve-legend").hidden = this.preset === "none";
    this.controls(document.body.getAttribute("aria-busy") === "true");
    if (this.preset !== "none")
      await Promise.all(
        this.views().map(async (view) => {
          const p = view.project;
          if (!p) return;
          let curve: number[];
          try {
            curve = this.curve();
          } catch (e) {
            this.errors.set(view.prefix, String(e));
            return;
          }
          const payload = {
            axis: this.axis,
            start: view.zero,
            end: view.last,
            curve,
            duration: Number($<HTMLInputElement>("duration").value),
          };
          const key = JSON.stringify(payload);
          let cached = this.cache.get(view.prefix);
          if (!cached || cached.project !== p || cached.key !== key) {
            try {
              cached = {
                project: p,
                key,
                report: await post<Measurement>(
                  `/projects/${p.id}/measure`,
                  payload,
                ),
              };
            } catch (e) {
              cached = {
                project: p,
                key,
                error: e instanceof Error ? e.message : String(e),
              };
            }
            if (token !== this.revision) return;
            this.cache.set(view.prefix, cached);
          }
          if (cached.report) this.reports.set(view.prefix, cached.report);
          if (cached.error) this.errors.set(view.prefix, cached.error);
        }),
      );
    if (token === this.revision) this.paint();
  }
  private series(view: VideoView): {
    points: Point[];
    distance: number;
    origin: number;
  } {
    const p = view.project;
    if (!p) return { points: [], distance: 0, origin: 0 };
    const valid = p.samples.filter((s) => s.valid && s[this.axis] !== null),
      origin =
        valid.findLast((s) => s.frame <= view.zero)?.[this.axis] ??
        valid[0]?.[this.axis] ??
        0;
    const target = p.samples.find((s) => s.frame === view.last && s.valid)?.[
      this.axis
    ];
    const distance =
      target === null || target === undefined ? 0 : target - origin;
    return {
      origin,
      distance,
      points: p.samples.map((s) => ({
        t: s.t - p.times[view.zero],
        v:
          s.valid && s[this.axis] !== null
            ? this.progress
              ? Math.abs(distance) > 1e-6
                ? ((s[this.axis]! - origin) / distance) * 100
                : null
              : s[this.axis]! - origin
            : null,
        frame: s.frame,
        manual: s.manual,
      })),
    };
  }
  private at(clientX: number) {
    const r = $("graph").getBoundingClientRect(),
      x = ((clientX - r.left) / r.width) * this.domain.width;
    return (
      this.domain.min +
      Math.max(
        0,
        Math.min(
          1,
          (x - this.domain.left) /
            (this.domain.width - this.domain.left - this.domain.right),
        ),
      ) *
        (this.domain.max - this.domain.min)
    );
  }
  paint() {
    const svg = $("graph"),
      views = this.views().filter((v) => v.project);
    svg.replaceChildren();
    if (!views.length) return;
    const data = views.map((v) => ({ view: v, ...this.series(v) }));
    const available = data.flatMap((d) => d.points).some((s) => s.v !== null);
    svg.toggleAttribute("hidden", !available);
    $("legend").hidden = !available;
    $("ref-legend").hidden = views.length < 2;
    const fullMin = Math.min(...views.map((v) => -v.project!.times[v.zero])),
      fullMax = Math.max(
        ...views.map(
          (v) => v.project!.times.at(-1)! - v.project!.times[v.zero],
        ),
      );
    const min = this.window?.[0] ?? fullMin,
      max = Math.max(min + 1, this.window?.[1] ?? fullMax);
    const width = Math.max(240, svg.parentElement!.clientWidth),
      left = 64,
      right = 16;
    this.domain = { min, max, width, left, right };
    svg.setAttribute("viewBox", `0 0 ${width} 280`);
    const values = data.flatMap((d) =>
      d.points
        .filter((s) => s.v !== null && s.t >= min && s.t <= max)
        .map((s) => s.v!),
    );
    let low = Math.min(
        ...(this.window && values.length ? values : [0, ...values]),
      ),
      high = Math.max(
        ...(this.window && values.length ? values : [0, ...values]),
      ),
      padding = Math.max(this.progress ? 1 : 0.1, (high - low) * 0.1);
    low -= padding;
    high += padding;
    const X = (t: number) =>
        left + ((t - min) / (max - min)) * (width - left - right),
      Y = (v: number) => 214 - ((v - low) / (high - low)) * 190;
    const ns = "http://www.w3.org/2000/svg";
    const el = (
      name: string,
      attrs: Record<string, string | number>,
      text?: string,
    ) => {
      const node = document.createElementNS(ns, name);
      for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value));
      if (text) node.textContent = text;
      svg.append(node);
      return node;
    };
    el(
      "text",
      { x: left, y: 14, class: "tick" },
      this.progress ? "Progress (%)" : "Displacement (recording px)",
    );
    const ticks = width < 480 ? 3 : 5;
    for (let i = 0; i <= ticks; i++) {
      const t = min + ((max - min) * i) / ticks,
        x = X(t);
      el("line", { x1: x, x2: x, y1: 24, y2: 214, class: "grid" });
      el(
        "text",
        {
          x,
          y: 239,
          "text-anchor": i === ticks ? "end" : i === 0 ? "start" : "middle",
          class: "tick",
        },
        Math.round(t).toString(),
      );
    }
    for (let i = 0; i < 5; i++) {
      const value = low + ((high - low) * i) / 4,
        y = Y(value);
      el("line", { x1: left, x2: width - right, y1: y, y2: y, class: "grid" });
      el(
        "text",
        { x: left - 8, y: y + 4, "text-anchor": "end", class: "tick" },
        value.toFixed(1),
      );
    }
    if (min <= 0 && max >= 0)
      el("line", {
        x1: X(0),
        x2: X(0),
        y1: 24,
        y2: 214,
        class: "alignment-line",
      });
    for (const d of data) {
      const cls = d.view.prefix === "a" ? "trace" : "reference";
      let path = "",
        pen = false;
      for (const s of d.points) {
        if (s.v === null || s.t < min || s.t > max) {
          pen = false;
          if (s.v === null && s.t >= min && s.t <= max)
            el("line", {
              x1: X(s.t),
              x2: X(s.t),
              y1: 216,
              y2: 223,
              class: "weak-mark",
            });
          continue;
        }
        path += (pen ? "L" : "M") + `${X(s.t)},${Y(s.v)}`;
        pen = true;
        const dot = el("circle", {
          cx: X(s.t),
          cy: Y(s.v),
          r: s.manual ? 4 : 2,
          class: s.manual ? "manual-mark " + cls : cls,
        });
        if (s.manual) {
          const title = document.createElementNS(ns, "title");
          title.textContent = `${d.view.prefix.toUpperCase()}: manual anchor at frame ${s.frame}`;
          dot.append(title);
        }
      }
      el("path", { d: path, class: cls });
      const report = this.reports.get(d.view.prefix);
      if (report) {
        let expected = "";
        for (const point of report.points) {
          if (point.t < min || point.t > max) continue;
          const value = this.progress
            ? (point.value / report.displacement) * 100
            : point.value;
          expected += (expected ? "L" : "M") + `${X(point.t)},${Y(value)}`;
        }
        el("path", { d: expected, class: `expected-path ${cls}` });
      }
      if (d.view.time >= min && d.view.time <= max)
        el("line", {
          x1: X(d.view.time),
          x2: X(d.view.time),
          y1: 24,
          y2: 214,
          class:
            "playhead " + (cls === "reference" ? "reference-playhead" : ""),
        });
    }
    el(
      "text",
      { x: width / 2, y: 269, "text-anchor": "middle", class: "tick" },
      "Time from alignment (ms)",
    );
    for (const view of this.views()) {
      const result = $(`${view.prefix}-result`);
      result.hidden = !view.project;
      if (!view.project) continue;
      if (this.progress && Math.abs(this.series(view).distance) < 1e-6) {
        result.textContent = `${view.prefix.toUpperCase()}: progress needs different measured positions at alignment and the last frame.`;
        continue;
      }
      const report = this.reports.get(view.prefix),
        error = this.errors.get(view.prefix);
      if (this.preset === "none") {
        const p = view.project;
        result.textContent = `${view.prefix.toUpperCase()}: ${p.samples.filter((s) => s.valid).length} valid samples, ${p.samples.filter((s) => !s.valid).length} weak matches. Outlined points mark manual anchors.`;
      } else if (error)
        result.textContent = `${view.prefix.toUpperCase()}: ${error}`;
      else if (report) {
        const factor = this.progress ? 100 / Math.abs(report.displacement) : 1,
          unit = this.progress ? "%" : "px";
        result.textContent = `${view.prefix.toUpperCase()}: reference ${report.duration.toFixed(1)} ms; RMSE ${(report.rmse * factor).toFixed(3)} ${unit}; maximum error ${(report.maxError * factor).toFixed(3)} ${unit}; ${report.samples} valid samples, ${report.weak} weak matches.`;
      } else result.textContent = "";
    }
  }
}
