import { sampleValue, type Axis } from "./types";
import { $, post, api } from "./api";
import { fitScale, zoomScale, panScale, type ScaleRange } from "./graph-scale";
import type { Measurement, Project, MotionReference } from "./types";
import type { VideoView } from "./video";
import { syncMaterialControls } from "./material";
import { LEFT, RIGHT } from "./timeline";
type Point = { t: number; v: number | null; frame: number; manual: boolean };
export class MotionGraph {
  private renderKey = "";
  private vertical: ScaleRange | null = null;
  private visibleScale: ScaleRange = [0, 1];
  private motionScale: ScaleRange = [0, 1];
  private presets = new Map<string, MotionReference>();
  private endPosition = 0;
  private plotHeight = 140;
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
    private panTime: (bounds: [number, number]) => void,
  ) {
    $("axis").onchange = () => {
      this.vertical = null;
      void this.refresh();
    };
    $("units").onchange = () => {
      this.vertical = null;
      this.paint();
    };
    $("curve").onchange = () => {
      const ref = this.presets.get(this.preset);
      if (ref) this.fillReference(ref);
      this.referenceControls();
      void this.refresh();
    };
    for (const id of [
      "bezier-x1",
      "bezier-y1",
      "bezier-x2",
      "bezier-y2",
      "spring-stiffness",
      "spring-damping",
      "spring-velocity",
    ]) {
      $<HTMLInputElement>(id).step = "any";
      $(id).oninput = () => {
        $<HTMLSelectElement>("curve").value = id.startsWith("spring-")
          ? "custom-spring"
          : "custom-bezier";
        this.referenceControls();
        void this.refresh();
      };
    }
    $("reference-save").onclick = () => void this.saveReference();
    $("reference-load").onclick = () =>
      $<HTMLInputElement>("reference-file").click();
    $("reference-file").onchange = () => void this.loadReference();
    $("duration").oninput = () => void this.refresh();
    $("graph-fit").onclick = () => {
      this.vertical = null;
      this.paint();
    };
    for (const [id, factor] of [
      ["graph-zoom-in", 0.5],
      ["graph-zoom-out", 2],
    ] as const)
      $(id).onclick = () => {
        this.vertical = zoomScale(this.visibleScale, factor);
        this.paint();
      };
    $("graph-fit-end").onclick = () => {
      const half = Math.max(
        this.progress ? 1 : 0.1,
        (this.motionScale[1] - this.motionScale[0]) * 0.05,
      );
      this.vertical = [this.endPosition - half, this.endPosition + half];
      this.paint();
    };
    const svg = $("graph");
    $("graph-pan").onchange = () => {
      svg.classList.toggle("pan-mode", this.panning);
      this.hovering = false;
    };
    svg.addEventListener(
      "click",
      (e) => {
        if (this.panning) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      },
      true,
    );
    let drag: {
      x: number;
      y: number;
      range: ScaleRange;
      height: number;
      time: [number, number];
      plot: boolean;
      width: number;
    } | null = null;
    svg.onpointerdown = (e) => {
      if (
        (!(e.target as Element).closest("[data-y-axis]") && !this.panning) ||
        document.body.hasAttribute("aria-busy")
      )
        return;
      const rect = svg.getBoundingClientRect();
      const axis = !!(e.target as Element).closest("[data-y-axis]");
      if (
        !axis &&
        (e.clientX < rect.left + LEFT ||
          e.clientX > rect.right - RIGHT ||
          e.clientY < rect.top + 24 ||
          e.clientY > rect.bottom - 56)
      )
        return;
      e.preventDefault();
      drag = {
        x: e.clientX,
        time: [...this.bounds()],
        plot: !axis,
        width: rect.width - LEFT - RIGHT,
        y: e.clientY,
        range: [...this.visibleScale],
        height: this.plotHeight,
      };
      svg.classList.add("panning");
      svg.setPointerCapture(e.pointerId);
    };
    svg.onpointermove = (e) => {
      if (!drag) return;
      this.vertical = panScale(drag.range, (e.clientY - drag.y) / drag.height);
      if (drag.plot) {
        const delta =
          (-(e.clientX - drag.x) / drag.width) * (drag.time[1] - drag.time[0]);
        this.panTime([drag.time[0] + delta, drag.time[1] + delta]);
      } else this.paint();
    };
    svg.onpointerup = svg.onpointercancel = () => {
      drag = null;
      svg.classList.remove("panning");
    };
    svg.addEventListener("keydown", (e) => {
      if (!(e.target as Element).closest("[data-y-axis]")) return;
      if (!["ArrowUp", "ArrowDown", "Home"].includes(e.key)) return;
      e.preventDefault();
      this.vertical =
        e.key === "Home"
          ? null
          : panScale(this.visibleScale, e.key === "ArrowUp" ? 0.1 : -0.1);
      this.paint();
      svg
        .querySelector<SVGElement>("[data-y-axis]")
        ?.focus({ preventScroll: true });
    });
    new ResizeObserver(() => this.paint()).observe($("graph").parentElement!);
  }
  get panning() {
    return $<HTMLInputElement>("graph-pan").checked;
  }
  exportOptions(view: VideoView, currentView: boolean) {
    const window = this.bounds();
    return {
      axis: this.axis,
      units: this.progress ? "progress" : "px",
      start: view.first,
      end: view.last,
      reference: this.preset === "none" ? undefined : this.curve(),
      duration: Number($<HTMLInputElement>("duration").value),
      window: currentView
        ? [window[0] - view.offset, window[1] - view.offset]
        : undefined,
      scale: currentView ? [...this.visibleScale] : undefined,
    };
  }
  get axis() {
    return $<HTMLSelectElement>("axis").value as Axis;
  }
  get preset() {
    return $<HTMLSelectElement>("curve").value;
  }
  get progress() {
    return $<HTMLSelectElement>("units").value === "progress";
  }
  async loadPresets() {
    const refs = await api<MotionReference[]>("/references");
    this.presets = new Map(refs.map((ref) => [ref.id!, ref]));
  }
  private fillReference(ref: MotionReference) {
    ref.curve.forEach((value, i) => {
      $<HTMLInputElement>(
        ["bezier-x1", "bezier-y1", "bezier-x2", "bezier-y2"][i],
      ).value = String(value);
    });
    for (const [field, value] of [
      ["stiffness", ref.stiffness ?? 380],
      ["damping", ref.damping ?? 0.8],
      ["velocity", ref.velocity ?? 0],
    ] as const)
      $<HTMLInputElement>("spring-" + field).value = String(value);
  }
  private curve(): MotionReference {
    const preset = this.presets.get(this.preset);
    if (preset) return preset;
    if (this.preset === "custom-spring")
      return {
        kind: "spring",
        curve: [0, 0, 0, 0],
        stiffness: Number($<HTMLInputElement>("spring-stiffness").value),
        damping: Number($<HTMLInputElement>("spring-damping").value),
        velocity: Number($<HTMLInputElement>("spring-velocity").value),
      };
    return {
      kind: "bezier",
      curve: ["bezier-x1", "bezier-y1", "bezier-x2", "bezier-y2"].map((id) =>
        Number($<HTMLInputElement>(id).value),
      ) as MotionReference["curve"],
    };
  }
  private referenceControls() {
    const ref = this.curve(),
      none = this.preset === "none";
    $("reference-controls").hidden = none;
    $("bezier-controls").hidden = none || ref.kind !== "bezier";
    $("spring-controls").hidden = none || ref.kind !== "spring";
    $("spring-note").hidden = none || ref.kind !== "spring";
    $("duration-controls").hidden = none || ref.kind === "spring";
    const link = $<HTMLAnchorElement>("reference-source"),
      source = this.presets.get(this.preset)?.source;
    link.hidden = !source;
    if (source) link.href = source;
    $("reference-status").textContent = "";
    syncMaterialControls();
  }
  private async saveReference() {
    try {
      const reference = await post<MotionReference>(
        "/references/validate",
        this.curve(),
      );
      const duration = Number($<HTMLInputElement>("duration").value);
      if (!Number.isFinite(duration) || duration < 1 || duration > 60000)
        throw Error("Reference duration must be 1–60000 ms.");
      const url = URL.createObjectURL(
        new Blob(
          [JSON.stringify({ schema: 1, reference, duration }, null, 2)],
          { type: "application/json" },
        ),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = "motion-reference.json";
      a.click();
      URL.revokeObjectURL(url);
      $("reference-status").textContent = "Reference saved.";
    } catch (e) {
      $("reference-status").textContent = String(e);
    }
  }
  private async loadReference() {
    const input = $<HTMLInputElement>("reference-file");
    try {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 65536) throw Error("Reference file exceeds 64 KB.");
      const data = JSON.parse(await file.text());
      if (
        data.schema !== 1 ||
        !Number.isFinite(data.duration) ||
        data.duration < 1 ||
        data.duration > 60000
      )
        throw Error("Invalid reference file.");
      const ref = await post<MotionReference>(
        "/references/validate",
        data.reference,
      );
      this.fillReference(ref);
      $<HTMLInputElement>("duration").value = String(data.duration);
      $<HTMLSelectElement>("curve").value =
        ref.kind === "emphasized" ? "emphasized" : "custom-" + ref.kind;
      this.referenceControls();
      await this.refresh();
      $("reference-status").textContent = "Reference loaded.";
    } catch (e) {
      $("reference-status").textContent = String(e);
    } finally {
      input.value = "";
    }
  }
  controls(busy: boolean) {
    for (const id of [
      "graph-fit",
      "graph-zoom-in",
      "graph-zoom-out",
      "graph-fit-end",
    ])
      $<HTMLButtonElement>(id).disabled =
        busy || !this.views().some((v) => v.project?.samples.length);
    for (const v of this.views())
      $<HTMLButtonElement>(`fit-${v.prefix}`).disabled =
        busy ||
        this.preset === "none" ||
        this.curve().kind === "spring" ||
        !v.project?.samples.length ||
        v.dirty;
    $<HTMLInputElement>("duration").disabled = busy || this.preset === "none";
  }
  setActive(v: VideoView) {
    this.active = v;
    this.paint();
  }
  reset() {
    this.vertical = null;
    this.cache.clear();
    this.hovering = false;
    $("sample-info").textContent = "";
    void this.refresh();
  }
  async fit(view: VideoView) {
    if (!view.project || this.curve().kind === "spring") return;
    const report = await post<Measurement>(
      `/projects/${view.project.id}/measure`,
      {
        axis: this.axis,
        start: view.first,
        end: view.last,
        reference: this.curve(),
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
    this.referenceControls();
    $("curve-legend").hidden = this.preset === "none";
    this.controls(document.body.getAttribute("aria-busy") === "true");
    if (this.preset !== "none")
      await Promise.all(
        this.views().map(async (view) => {
          const p = view.project;
          if (!p || view.dirty) return;
          let curve: MotionReference;
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
            reference: curve,
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
    const valid = p.samples.filter(
        (s) => s.valid && sampleValue(s, this.axis) !== null,
      ),
      origin =
        sampleValue(
          valid.findLast((s) => s.frame <= view.first),
          this.axis,
        ) ??
        sampleValue(valid[0], this.axis) ??
        0;
    const target = sampleValue(
      p.samples.find((s) => s.frame === view.last && s.valid),
      this.axis,
    );
    const distance =
      target === null || target === undefined ? 0 : target - origin;
    return {
      origin,
      distance,
      points: p.samples.map((s) => ({
        t: s.t + view.offset,
        v:
          s.valid && sampleValue(s, this.axis) !== null
            ? this.progress
              ? Math.abs(distance) > 1e-6
                ? ((sampleValue(s, this.axis)! - origin) / distance) * 100
                : null
              : sampleValue(s, this.axis)! - origin
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
      svg.clientHeight,
      this.axis,
      this.progress,
      this.vertical,
      this.active?.prefix,
      this.preset,
      this.curve(),
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
      right = RIGHT,
      height = svg.clientHeight,
      bottom = height - 56,
      plotHeight = (this.plotHeight = bottom - 24);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const values = data.flatMap((d) =>
      d.points
        .filter((s) => s.v !== null && s.t >= min && s.t <= max)
        .map((s) => s.v!),
    );
    for (const d of data) {
      const report = this.reports.get(d.view.prefix);
      if (!report || d.view.dirty) continue;
      for (const point of report.points) {
        const t = point.t + d.view.project!.times[d.view.first] + d.view.offset;
        if (t >= min && t <= max)
          values.push(
            this.progress
              ? (point.value / report.displacement) * 100
              : point.value,
          );
      }
    }
    const active = data.find((d) => d.view === this.active) || data[0];
    this.endPosition =
      this.progress && Math.abs(active.distance) > 1e-6 ? 100 : active.distance;
    this.motionScale = fitScale(values, this.progress ? 1 : 0.1);
    const [low, high] = (this.visibleScale = this.vertical || this.motionScale);
    $("graph-scale-info").textContent =
      `${low.toFixed(2)} to ${high.toFixed(2)} ${this.progress ? "%" : "px"}`;
    const X = (t: number) =>
        left + ((t - min) / (max - min)) * (width - left - right),
      Y = (v: number) => bottom - ((v - low) / (high - low)) * plotHeight;
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
      height: plotHeight,
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
        y2: bottom,
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
            y2: bottom,
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
              y1: bottom + 2,
              y2: bottom + 9,
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
          if (this.panning) return;
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
          if (this.panning) return;
          this.hovering = true;
          const sample = d.view.project!.samples.find(
            (row) => row.frame === s.frame,
          )!;
          $("sample-info").textContent =
            `${d.view.prefix.toUpperCase()}  Frame ${s.frame}  ${(s.t / 1000).toFixed(3)} s  ${s.v!.toFixed(3)} ${this.progress ? "%" : "px"}  ${d.view.project!.settings.method && d.view.project!.settings.method !== "feature" ? "Edge strength" : "Similarity"} ${sample.score.toFixed(3)}`;
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
      y2: bottom,
      class: "playhead",
    });
    this.paintPlayhead();

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
        result.textContent = `${view.prefix.toUpperCase()}: ${report.reference?.kind === "spring" ? "spring" : `reference ${report.duration.toFixed(1)} ms`}; RMSE ${(report.rmse * factor).toFixed(3)} ${unit}; maximum error ${(report.maxError * factor).toFixed(3)} ${unit}; ${report.samples} valid samples, ${report.weak} weak matches.`;
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
      else if (sample?.valid && sampleValue(sample, this.axis) !== null) {
        const first =
          p.samples.findLast(
            (s) =>
              s.valid &&
              s.frame <= v.first &&
              sampleValue(s, this.axis) !== null,
          ) ||
          p.samples.find((s) => s.valid && sampleValue(s, this.axis) !== null);
        const origin = sampleValue(first, this.axis) ?? 0,
          end = sampleValue(
            p.samples.find((s) => s.valid && s.frame === v.last),
            this.axis,
          ),
          distance = end === undefined || end === null ? 0 : end - origin;
        const value = this.progress
          ? ((sampleValue(sample, this.axis)! - origin) / (distance || 1)) * 100
          : sampleValue(sample, this.axis)! - origin;
        $("sample-info").textContent =
          `${v.prefix.toUpperCase()}  Frame ${v.index}  ${value.toFixed(3)} ${this.progress ? "%" : "px"}  ${sample.manual ? "Manual anchor" : `${p.settings.method && p.settings.method !== "feature" ? "Edge strength" : "Similarity"} ${sample.score.toFixed(3)}`}`;
      } else
        $("sample-info").textContent =
          `${v.prefix.toUpperCase()}  Frame ${v.index}  No valid measurement.`;
    }
  }
}
