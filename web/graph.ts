import { $, post } from "./api";
import { milliseconds } from "./timing";
import type { Measurement, Project } from "./types";
import type { VideoView } from "./video";
import { LEFT, RIGHT } from "./timeline";
type Point = { t: number; v: number | null; frame: number; manual: boolean };
export class MotionGraph {
  private renderKey = "";
  private hovering = false;
  private active: VideoView | null = null;
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
    private bounds: () => [number, number],
    private playhead: () => number,
    private select: (view: VideoView) => void,
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
    $("vertical-scale").onchange = () => this.paint();
    new ResizeObserver(() => this.paint()).observe($("graph").parentElement!);
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
    for (const v of this.views())
      $<HTMLButtonElement>(`fit-${v.prefix}`).disabled =
        busy || this.preset === "none" || !v.project?.samples.length || v.dirty;
    $<HTMLInputElement>("duration").disabled = busy || this.preset === "none";
  }
  setActive(v: VideoView) {
    this.active = v;
    this.paint();
  }
  reset() {
    this.cache.clear();
    this.hovering = false;
    $("sample-info").textContent = "";
    void this.refresh();
  }
  async fit(view: VideoView) {
    if (!view.project) return;
    const report = await post<Measurement>(
      `/projects/${view.project.id}/measure`,
      {
        axis: this.axis,
        start: view.first,
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
    $("reference-controls").hidden = this.preset === "none";
    $("curve-legend").hidden = this.preset === "none";
    this.controls(document.body.getAttribute("aria-busy") === "true");
    if (this.preset !== "none")
      await Promise.all(
        this.views().map(async (view) => {
          const p = view.project;
          if (!p || view.dirty) return;
          let curve: number[];
          try {
            curve = this.curve();
          } catch (e) {
            this.errors.set(view.prefix, String(e));
            return;
          }
          const payload = {
            axis: this.axis,
            start: view.first,
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
    if (token === this.revision) {
      this.renderKey = "";
      this.paint();
    }
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
        valid.findLast((s) => s.frame <= view.first)?.[this.axis] ??
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
        t: s.t + view.offset,
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
  paint() {
    const svg = $("graph"),
      views = this.views().filter((v) => v.project);
    if (!views.length) {
      svg.replaceChildren();
      return;
    }
    const bounds = this.bounds(),
      renderWidth = Math.max(240, svg.parentElement!.clientWidth);
    const key = JSON.stringify([
      bounds,
      renderWidth,
      this.axis,
      this.progress,
      $<HTMLSelectElement>("vertical-scale").value,
      this.active?.prefix,
      this.preset,
      $<HTMLInputElement>("duration").value,
      views.map((v) => [
        v.project!.id,
        v.offset,
        v.first,
        v.last,
        v.sync,
        v.dirty,
      ]),
    ]);
    if (key === this.renderKey) {
      this.paintPlayhead();
      return;
    }
    this.renderKey = key;
    svg.replaceChildren();
    const data = views.map((v) => ({ view: v, ...this.series(v) }));
    const available = data.flatMap((d) => d.points).some((s) => s.v !== null);
    svg.toggleAttribute("hidden", !available);
    $("legend").hidden = !available;
    $("ref-legend").hidden = views.length < 2;
    const [min, max] = this.bounds();
    const width = Math.max(240, svg.parentElement!.clientWidth),
      left = LEFT,
      right = RIGHT;
    svg.setAttribute("viewBox", `0 0 ${width} 220`);
    const values = data.flatMap((d) =>
      d.points
        .filter((s) => s.v !== null && s.t >= min && s.t <= max)
        .map((s) => s.v!),
    );
    let low = Math.min(...(values.length ? values : [0])),
      high = Math.max(...(values.length ? values : [0])),
      padding = Math.max(this.progress ? 1 : 0.1, (high - low) * 0.1);
    low -= padding;
    high += padding;
    const fixed = Number($<HTMLSelectElement>("vertical-scale").value);
    if (Number.isFinite(fixed) && fixed > 0) {
      const active = data.find((d) => d.view === this.active) || data[0];
      const end =
        active.distance * (this.progress ? 100 / (active.distance || 1) : 1);
      low = end - fixed;
      high = end + fixed;
    }
    const X = (t: number) =>
        left + ((t - min) / (max - min)) * (width - left - right),
      Y = (v: number) => 164 - ((v - low) / (high - low)) * 140;
    const ns = "http://www.w3.org/2000/svg";
    const el = (
      name: string,
      attrs: Record<string, string | number>,
      text?: string,
    ) => {
      const node = document.createElementNS(ns, name);
      for (const [key, value] of Object.entries(attrs))
        node.setAttribute(key, String(value));
      if (
        name === "circle" ||
        (name === "path" && /\b(trace|reference)\b/.test(String(attrs.class)))
      )
        node.setAttribute("clip-path", "url(#displacement-plot)");
      if (text) node.textContent = text;
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
      height: 140,
    }))
      rect.setAttribute(name, String(value));
    clip.append(rect);
    defs.append(clip);
    svg.append(defs);
    el(
      "text",
      { x: left, y: 14, class: "tick" },
      this.progress ? "Progress (%)" : "Displacement (recording px)",
    );
    const ticks = width < 500 ? 3 : 6;
    for (let i = 0; i <= ticks; i++) {
      const t = min + ((max - min) * i) / ticks,
        x = X(t);
      el("line", { x1: x, x2: x, y1: 24, y2: 164, class: "grid" });
      el(
        "text",
        {
          x,
          y: 189,
          "text-anchor": i === ticks ? "end" : i === 0 ? "start" : "middle",
          class: "tick",
        },
        (t / 1000).toFixed(max - min < 1000 ? 3 : 2),
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
        y2: 164,
        class: "alignment-line",
      });
    for (const d of data) {
      const cls = d.view.prefix === "a" ? "trace" : "reference";
      const rangeStart = d.view.project!.times[d.view.first] + d.view.offset,
        rangeEnd = d.view.project!.times[d.view.last] + d.view.offset;
      for (const [t, label] of [
        [rangeStart, "In"],
        [rangeEnd, "Out"],
      ] as const)
        if (t >= min && t <= max) {
          el("line", {
            x1: X(t),
            x2: X(t),
            y1: 24,
            y2: 164,
            class: `range-boundary ${cls}`,
          });
          el(
            "text",
            { x: X(t) + 3, y: 35, class: "range-label" },
            `${d.view.prefix.toUpperCase()} ${label}`,
          );
        }
      if (d.view.sync !== null) {
        const t = d.view.project!.times[d.view.sync] + d.view.offset;
        if (t >= min && t <= max)
          el("path", {
            d: `M${X(t) - 4},18 L${X(t)},12 L${X(t) + 4},18 L${X(t)},24Z`,
            class: "sync-marker",
          });
      }
      let path = "",
        activePath = "",
        activePen = false,
        pen = false;
      for (const s of d.points) {
        if (s.v === null || s.t < min || s.t > max) {
          pen = false;
          activePen = false;
          if (s.v === null && s.t >= min && s.t <= max)
            el("line", {
              x1: X(s.t),
              x2: X(s.t),
              y1: 166,
              y2: 173,
              class: "weak-mark",
            });
          continue;
        }
        path += (pen ? "L" : "M") + `${X(s.t)},${Y(s.v)}`;
        pen = true;
        if (s.frame >= d.view.first && s.frame <= d.view.last) {
          activePath += (activePen ? "L" : "M") + `${X(s.t)},${Y(s.v)}`;
          activePen = true;
        } else activePen = false;
        const dot = el("circle", {
          cx: X(s.t),
          cy: Y(s.v),
          r: s.manual ? 4 : 2,
          class: s.manual ? "manual-mark " + cls : cls,
        });
        dot.setAttribute("data-frame", String(s.frame));
        dot.setAttribute("data-view", d.view.prefix);
        dot.setAttribute("tabindex", "-1");
        dot.setAttribute("role", "button");
        dot.setAttribute(
          "aria-label",
          `${d.view.prefix.toUpperCase()} frame ${s.frame}, ${s.v.toFixed(3)} ${this.progress ? "percent" : "pixels"}`,
        );
        const inspect = () => {
          this.active = d.view;
          this.select(d.view);
          this.seek(s.t);
        };
        dot.addEventListener("click", inspect);
        dot.addEventListener("keydown", (e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            inspect();
          }
        });
        dot.addEventListener("pointerenter", () => {
          this.hovering = true;
          const sample = d.view.project!.samples.find(
            (row) => row.frame === s.frame,
          )!;
          $("sample-info").textContent =
            `${d.view.prefix.toUpperCase()}  Frame ${s.frame}  ${(s.t / 1000).toFixed(3)} s  ${s.v!.toFixed(3)} ${this.progress ? "%" : "px"}  ${d.view.project!.settings.method?.startsWith("edge") ? "Edge strength" : "Similarity"} ${sample.score.toFixed(3)}`;
          dot.classList.add("hover-sample");
        });
        dot.addEventListener("pointerleave", () => {
          this.hovering = false;
          dot.classList.remove("hover-sample");
          this.paintPlayhead();
        });
        if (s.frame < d.view.first || s.frame > d.view.last)
          dot.classList.add("outside-range");
        if (s.frame === d.view.index && !d.view.outside)
          dot.classList.add("current-sample");
        if (s.manual) {
          const title = document.createElementNS(ns, "title");
          title.textContent = `${d.view.prefix.toUpperCase()}: manual anchor at frame ${s.frame}`;
          dot.append(title);
        }
      }
      const trace = el("path", {
        d: path,
        class: cls + " outside-range" + (d.view.dirty ? " stale-trace" : ""),
        "data-view": d.view.prefix,
      });
      trace.addEventListener("click", () => {
        this.active = d.view;
        this.select(d.view);
      });
      const activeTrace = el("path", {
        d: activePath,
        class: cls + (d.view.dirty ? " stale-trace" : ""),
        "data-view": d.view.prefix,
      });
      activeTrace.addEventListener("click", () => {
        this.active = d.view;
        this.select(d.view);
      });
      const report = this.reports.get(d.view.prefix);
      if (
        report &&
        !d.view.dirty &&
        report.start === d.view.first &&
        report.end === d.view.last
      ) {
        let expected = "";
        for (const point of report.points) {
          const t =
            point.t + d.view.project!.times[d.view.first] + d.view.offset;
          if (t < min || t > max) continue;
          const value = this.progress
            ? (point.value / report.displacement) * 100
            : point.value;
          expected += (expected ? "L" : "M") + `${X(t)},${Y(value)}`;
        }
        el("path", {
          d: expected,
          class: `expected-path ${cls}`,
          "pointer-events": "none",
        });
      }
    }
    for (const dot of svg.querySelectorAll("[data-frame]")) svg.append(dot);
    el("line", {
      id: "graph-playhead",
      x1: 0,
      x2: 0,
      y1: 24,
      y2: 164,
      class: "playhead",
    });
    this.paintPlayhead();

    el(
      "text",
      { x: width / 2, y: 214, "text-anchor": "middle", class: "tick" },
      "Workspace time (s)",
    );
    for (const view of this.views()) {
      const result = $(`${view.prefix}-result`);
      result.hidden = !view.project;
      if (!view.project) continue;
      if (this.progress && Math.abs(this.series(view).distance) < 1e-6) {
        result.textContent = `${view.prefix.toUpperCase()}: progress needs different measured positions at the tracking range boundaries.`;
        continue;
      }
      const report = this.reports.get(view.prefix),
        error = this.errors.get(view.prefix);
      if (this.preset === "none") {
        const p = view.project;
        const selected = p.samples.filter(
          (s) => s.frame >= view.first && s.frame <= view.last,
        );
        result.textContent = `${view.prefix.toUpperCase()}: ${selected.filter((s) => s.valid).length} valid samples, ${selected.filter((s) => !s.valid).length} weak matches in range.`;
      } else if (view.dirty)
        result.textContent = `${view.prefix.toUpperCase()}: tracking settings changed; update measurements before comparing curves.`;
      else if (error)
        result.textContent = `${view.prefix.toUpperCase()}: ${error}`;
      else if (
        report &&
        report.start === view.first &&
        report.end === view.last
      ) {
        const factor = this.progress ? 100 / Math.abs(report.displacement) : 1,
          unit = this.progress ? "%" : "px";
        result.textContent = `${view.prefix.toUpperCase()}: reference ${report.duration.toFixed(1)} ms; RMSE ${(report.rmse * factor).toFixed(3)} ${unit}; maximum error ${(report.maxError * factor).toFixed(3)} ${unit}; ${report.samples} valid samples, ${report.weak} weak matches.`;
      } else result.textContent = "";
    }
  }
  private paintPlayhead() {
    const svg = $("graph"),
      line = svg.querySelector<SVGLineElement>("#graph-playhead"),
      [min, max] = this.bounds(),
      width = Math.max(240, svg.parentElement!.clientWidth),
      t = this.playhead();
    if (line) {
      line.style.display = t < min || t > max ? "none" : "";
      const x = LEFT + ((t - min) / (max - min)) * (width - LEFT - RIGHT);
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
    }
    for (const dot of svg.querySelectorAll(".current-sample"))
      dot.classList.remove("current-sample");
    for (const v of this.views())
      if (v.project && !v.outside)
        svg
          .querySelector(`[data-view="${v.prefix}"][data-frame="${v.index}"]`)
          ?.classList.add("current-sample");
    if (!this.hovering && this.active?.project) {
      const v = this.active,
        p = v.project!,
        sample = p.samples.find((s) => s.frame === v.index);
      if (v.outside)
        $("sample-info").textContent =
          `${v.prefix.toUpperCase()} is outside the clip at the playhead.`;
      else if (sample?.valid && sample[this.axis] !== null) {
        const first =
          p.samples.findLast(
            (s) => s.valid && s.frame <= v.first && s[this.axis] !== null,
          ) || p.samples.find((s) => s.valid && s[this.axis] !== null);
        const origin = first?.[this.axis] ?? 0,
          end = p.samples.find((s) => s.valid && s.frame === v.last)?.[
            this.axis
          ],
          distance = end === undefined || end === null ? 0 : end - origin;
        const value = this.progress
          ? ((sample[this.axis]! - origin) / (distance || 1)) * 100
          : sample[this.axis]! - origin;
        $("sample-info").textContent =
          `${v.prefix.toUpperCase()}  Frame ${v.index}  ${value.toFixed(3)} ${this.progress ? "%" : "px"}  ${sample.manual ? "Manual anchor" : `${p.settings.method?.startsWith("edge") ? "Edge strength" : "Similarity"} ${sample.score.toFixed(3)}`}`;
      } else
        $("sample-info").textContent =
          `${v.prefix.toUpperCase()}  Frame ${v.index}  No valid measurement.`;
    }
  }
}
