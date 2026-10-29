import { $, post } from "./api";
import { required } from "./errors";
import type { GraphPoint } from "./graph-renderer";
import { renderGraphPlot, renderGraphSummary } from "./graph-renderer";
import type { ScaleRange } from "./graph-scale";
import { fitScale, panScale, zoomScale } from "./graph-scale";
import { setButtonToggle, syncMaterialControls } from "./material";
import { ReferenceControls } from "./reference-controls";
import { LEFT, RIGHT } from "./timeline-renderer";
import type { Axis, Measurement, MotionReference, Project } from "./types";
import { sampleValue } from "./types";
import type { VideoView } from "./video";

export class MotionGraph {
  private renderKey = "";
  private vertical: ScaleRange | null = null;
  private visibleScale: ScaleRange = [0, 1];
  private motionScale: ScaleRange = [0, 1];
  private readonly reference = new ReferenceControls(() => this.refresh());
  loadPresets = async () => {
    await this.reference.loadPresets();
    await this.refresh();
  };
  private endPosition = 0;
  private plotHeight = 140;
  private hovering = false;
  private active: VideoView | null = null;
  private readonly reports = new Map<string, Measurement>();
  private readonly errors = new Map<string, string>();
  private revision = 0;
  private fitted?: { project: Project; key: string; duration: number };
  private readonly cache = new Map<
    string,
    { project: Project; key: string; report?: Measurement; error?: string }
  >();
  constructor(
    private readonly views: () => VideoView[],
    private readonly seek: (time: number) => void,
    private readonly bounds: () => [number, number],
    private readonly playhead: () => number,
    private readonly select: (view: VideoView) => void,
    private readonly panTime: (bounds: [number, number]) => void,
  ) {
    $("axis").onchange = () => {
      this.vertical = null;
      void this.refresh();
    };
    $("units").onchange = () => {
      this.vertical = null;
      this.paint();
    };
    $("graph-fit").onclick = () => {
      this.vertical = null;
      this.paint();
    };
    for (const [id, factor] of [
      ["graph-zoom-in", 0.5],
      ["graph-zoom-out", 2],
    ] as const) {
      $(id).onclick = () => {
        this.vertical = zoomScale(this.visibleScale, factor);
        this.paint();
      };
    }
    $("graph-fit-end").onclick = () => {
      const half = Math.max(
        this.progress ? 1 : 0.1,
        (this.motionScale[1] - this.motionScale[0]) * 0.05,
      );
      this.vertical = [this.endPosition - half, this.endPosition + half];
      this.paint();
    };
    const svg = $("graph");
    $("graph-pan").onclick = () => {
      setButtonToggle($("graph-pan"), !this.panning);
      svg.classList.toggle("pan-mode", this.panning);
      this.hovering = false;
      this.paintPlayhead();
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
        Object.hasOwn(document.body.dataset, "processing")
      ) {
        return;
      }
      const rect = svg.getBoundingClientRect();
      const axis = Boolean((e.target as Element).closest("[data-y-axis]"));
      if (
        !axis &&
        (e.clientX < rect.left + LEFT ||
          e.clientX > rect.right - RIGHT ||
          e.clientY < rect.top + 24 ||
          e.clientY > rect.bottom - 56)
      ) {
        return;
      }
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
      if (!drag) {
        return;
      }
      this.vertical = panScale(drag.range, (e.clientY - drag.y) / drag.height);
      if (drag.plot) {
        const delta =
          (-(e.clientX - drag.x) / drag.width) * (drag.time[1] - drag.time[0]);
        this.panTime([drag.time[0] + delta, drag.time[1] + delta]);
      } else {
        this.paint();
      }
    };
    const finishPan = () => {
      drag = null;
      svg.classList.remove("panning");
    };
    svg.onpointerup = finishPan;
    svg.onpointercancel = finishPan;
    svg.addEventListener("keydown", (e) => {
      if (!(e.target as Element).closest("[data-y-axis]")) {
        return;
      }
      if (!["ArrowUp", "ArrowDown", "Home"].includes(e.key)) {
        return;
      }
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
    new ResizeObserver(() => {
      this.paint();
    }).observe($("graph").parentElement!);
  }
  private sampleInfo(
    view: VideoView,
    frame: number,
    value: string,
    quality: string,
  ) {
    const output = $("sample-info");
    const fields = [
      ["Video", view.prefix.toUpperCase()],
      ["Frame", String(frame)],
      ["Displacement", value],
      ["Match", quality],
    ];
    output.replaceChildren(
      ...fields.map(([label, value]) => {
        const field = document.createElement("span");
        const caption = document.createElement("span");
        const result = document.createElement("span");
        field.className = "sample-field";
        caption.className = "sample-label";
        result.className = "sample-value";
        caption.textContent = label ?? "";
        result.textContent = value ?? "";
        field.append(caption, result);
        return field;
      }),
    );
  }
  get panning() {
    return $("graph-pan").getAttribute("aria-pressed") === "true";
  }
  exportOptions(view: VideoView, currentView: boolean) {
    const window = this.bounds();
    return {
      axis: this.axis,
      units: this.progress ? "progress" : "px",
      start: view.first,
      end: view.last,
      reference: this.preset === "none" ? undefined : this.reference.curve(),
      duration: Number($<HTMLInputElement>("duration").value),
      window: currentView
        ? [window[0] - view.offset, window[1] - view.offset]
        : undefined,
      scale: currentView ? [...this.visibleScale] : undefined,
    };
  }
  savedScale() {
    return this.vertical ? ([...this.vertical] as [number, number]) : null;
  }
  restoreScale(value: [number, number] | null) {
    this.vertical = value;
    this.paint();
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
  controls(busy: boolean) {
    for (const id of [
      "graph-pan",
      "graph-fit",
      "graph-zoom-in",
      "graph-zoom-out",
      "graph-fit-end",
    ]) {
      $<HTMLButtonElement>(id).disabled =
        busy || !this.views().some((v) => (v.project?.samples.length ?? 0) > 0);
    }
    const mode = $<HTMLSelectElement>("duration-mode");
    mode.disabled =
      busy ||
      this.preset === "none" ||
      this.reference.curve().kind === "spring";
    $<HTMLInputElement>("duration").disabled =
      busy || this.preset === "none" || mode.value !== "manual";
    syncMaterialControls();
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
  private async updateDuration(token: number): Promise<boolean> {
    const mode = $<HTMLSelectElement>("duration-mode").value;
    const status = $("duration-status");
    const duration = $<HTMLInputElement>("duration");
    if (this.preset === "none" || this.reference.curve().kind === "spring") {
      status.textContent = "";
      return true;
    }
    if (mode === "manual") {
      status.textContent = `Manual · ${Number(duration.value).toFixed(1)} ms`;
      return true;
    }
    const label = `Auto-fit ${mode.toUpperCase()}`;
    const view = this.views().find((v) => v.prefix === mode);
    if (
      !(
        view !== undefined &&
        view.project !== null &&
        view.project.samples.length > 0
      ) ||
      view.dirty
    ) {
      status.textContent = `${label} unavailable · ${view?.project ? "track the selected range" : `import video ${mode.toUpperCase()}`}.`;
      return false;
    }
    const payload = {
      axis: this.axis,
      start: view.first,
      end: view.last,
      reference: this.reference.curve(),
      duration: Number(duration.value),
      fit: true,
    };
    // The starting duration is not part of the fitted result's identity.
    const key = JSON.stringify({ ...payload, duration: undefined });
    try {
      if (
        !this.fitted ||
        this.fitted.project !== view.project ||
        this.fitted.key !== key
      ) {
        status.textContent = `${label} · Updating…`;
        const report = await post<Measurement>(
          `/projects/${view.project.id}/measure`,
          payload,
        );
        if (token !== this.revision) {
          return false;
        }
        this.fitted = { project: view.project, key, duration: report.duration };
      }
      duration.value = this.fitted.duration.toFixed(2);
      status.textContent = `${label} · ${this.fitted.duration.toFixed(1)} ms`;
      return true;
    } catch (error) {
      if (token === this.revision) {
        status.textContent = `${label} failed · ${error instanceof Error ? error.message : String(error)}`;
      }
      return false;
    }
  }
  async refresh() {
    const token = ++this.revision;
    const indicator = setTimeout(() => {
      if (token === this.revision) {
        $("chart-loading").hidden = false;
        $("graph").setAttribute("aria-busy", "true");
      }
    }, 200);
    try {
      this.reports.clear();
      this.errors.clear();
      $("curve-note").hidden = this.preset === "none";
      this.reference.update();
      $("curve-legend").hidden = this.preset === "none";
      this.controls(document.body.dataset.processing === "true");
      const durationReady = await this.updateDuration(token);
      if (token !== this.revision) {
        return;
      }
      if (this.preset !== "none" && durationReady) {
        await Promise.all(
          this.views().map(async (view) => {
            const p = view.project;
            if (!p || view.dirty) {
              return;
            }
            let curve: MotionReference;
            try {
              curve = this.reference.curve();
            } catch (error) {
              this.errors.set(view.prefix, String(error));
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
              } catch (error) {
                cached = {
                  project: p,
                  key,
                  error: error instanceof Error ? error.message : String(error),
                };
              }
              if (token !== this.revision) {
                return;
              }
              this.cache.set(view.prefix, cached);
            }
            if (cached.report) {
              this.reports.set(view.prefix, cached.report);
            }
            if (cached.error !== undefined && cached.error !== "") {
              this.errors.set(view.prefix, cached.error);
            }
          }),
        );
      }
      if (token === this.revision) {
        this.renderKey = "";
        this.paint();
      }
    } finally {
      clearTimeout(indicator);
      if (token === this.revision) {
        $("chart-loading").hidden = true;
        $("graph").removeAttribute("aria-busy");
      }
    }
  }
  private series(view: VideoView): {
    points: GraphPoint[];
    distance: number;
    origin: number;
  } {
    const p = view.project;
    if (!p) {
      return { points: [], distance: 0, origin: 0 };
    }
    const valid = p.samples.filter(
      (s) => s.valid && sampleValue(s, this.axis) !== null,
    );
    const origin =
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
    const distance = target === null ? 0 : target - origin;
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
    $("chart-measurement-summary").textContent =
      `${this.axis === "x" ? "Horizontal" : this.axis === "y" ? "Vertical" : this.axis === "width" ? "Width" : "Height"} in ${this.progress ? "percent" : "pixels"}`;
    const svg = $("graph");
    const views = this.views().filter((v) => v.project);
    if (views.length === 0) {
      svg.replaceChildren();
      $("sample-info").replaceChildren();
      for (const view of this.views()) {
        const result = $(`${view.prefix}-result`);
        result.hidden = true;
        result.textContent = "";
      }
      return;
    }
    const bounds = this.bounds();
    const renderWidth = Math.max(240, svg.parentElement!.clientWidth);
    const key = JSON.stringify([
      bounds,
      renderWidth,
      svg.clientHeight,
      this.axis,
      this.progress,
      this.vertical,
      this.active?.prefix,
      this.preset,
      this.reference.curve(),
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
    const width = Math.max(240, svg.parentElement!.clientWidth);
    const height = svg.clientHeight;
    const bottom = height - 56;
    this.plotHeight = bottom - 24;
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    const values = data.flatMap((d) =>
      d.points
        .filter((s) => s.v !== null && s.t >= min && s.t <= max)
        .map((s) => s.v!),
    );
    for (const d of data) {
      const report = this.reports.get(d.view.prefix);
      if (!report || d.view.dirty) {
        continue;
      }
      for (const point of report.points) {
        const t =
          point.t +
          required(d.view.project!.times[d.view.first]) +
          d.view.offset;
        if (t >= min && t <= max) {
          values.push(
            this.progress
              ? (point.value / report.displacement) * 100
              : point.value,
          );
        }
      }
    }
    const active = required(
      data.find((d) => d.view === this.active) ?? data[0],
    );
    this.endPosition =
      this.progress && Math.abs(active.distance) > 1e-6 ? 100 : active.distance;
    this.motionScale = fitScale(values, this.progress ? 1 : 0.1);
    this.visibleScale = this.vertical ?? this.motionScale;
    const [low, high] = this.visibleScale;
    $("graph-scale-info").textContent =
      `${low.toFixed(2)} to ${high.toFixed(2)} ${this.progress ? "%" : "px"}`;
    renderGraphPlot({
      svg,
      data,
      reports: this.reports,
      progress: this.progress,
      bounds: [min, max],
      scale: [low, high],
      width,
      height,
      isPanning: () => this.panning,
      onSelect: (view, time) => {
        this.active = view;
        this.select(view);
        if (time !== undefined) {
          this.seek(time);
        }
      },
      onHover: (view, point) => {
        this.hovering = true;
        const sample = required(
          view.project?.samples.find((row) => row.frame === point.frame),
        );
        this.sampleInfo(
          view,
          point.frame,
          required(point.v).toFixed(3) + (this.progress ? " %" : " px"),
          `${
            view.project?.settings.method &&
            view.project.settings.method !== "feature"
              ? "Edge strength"
              : "Similarity"
          } ${sample.score.toFixed(3)}`,
        );
      },
      onLeave: () => {
        this.hovering = false;
      },
      paintPlayhead: () => {
        this.paintPlayhead();
      },
    });
    renderGraphSummary({
      views: this.views(),
      progress: this.progress,
      distance: (view) => this.series(view).distance,
      reports: this.reports,
      errors: this.errors,
      preset: this.preset,
    });
  }
  private paintPlayhead() {
    const svg = $("graph");
    const line = svg.querySelector<SVGLineElement>("#graph-playhead");
    const [min, max] = this.bounds();
    const width = Math.max(240, svg.parentElement!.clientWidth);
    const t = this.playhead();
    if (line) {
      line.style.display = t < min || t > max ? "none" : "";
      const x = LEFT + ((t - min) / (max - min)) * (width - LEFT - RIGHT);
      line.setAttribute("x1", String(x));
      line.setAttribute("x2", String(x));
    }
    for (const dot of svg.querySelectorAll(".current-sample")) {
      dot.classList.remove("current-sample");
    }
    for (const v of this.views()) {
      if (v.project && !v.outside) {
        svg
          .querySelector(`[data-view="${v.prefix}"][data-frame="${v.index}"]`)
          ?.classList.add("current-sample");
      }
    }
    if (!this.hovering && this.active?.project) {
      const v = this.active;
      const p = v.project!;
      const sample = p.samples.find((s) => s.frame === v.index);
      if (v.outside) {
        this.sampleInfo(v, v.index, "Unavailable", "Outside clip");
      } else if (
        sample?.valid === true &&
        sampleValue(sample, this.axis) !== null
      ) {
        const first =
          p.samples.findLast(
            (s) =>
              s.valid &&
              s.frame <= v.first &&
              sampleValue(s, this.axis) !== null,
          ) ??
          p.samples.find((s) => s.valid && sampleValue(s, this.axis) !== null);
        const origin = sampleValue(first, this.axis) ?? 0;
        const end = sampleValue(
          p.samples.find((s) => s.valid && s.frame === v.last),
          this.axis,
        );
        const distance = end === null ? 0 : end - origin;
        const value = this.progress
          ? ((sampleValue(sample, this.axis)! - origin) / (distance || 1)) * 100
          : sampleValue(sample, this.axis)! - origin;
        this.sampleInfo(
          v,
          v.index,
          value.toFixed(3) + (this.progress ? " %" : " px"),
          sample.manual
            ? "Manual anchor"
            : `${p.settings.method && p.settings.method !== "feature" ? "Edge strength" : "Similarity"} ${sample.score.toFixed(3)}`,
        );
      } else {
        this.sampleInfo(v, v.index, "Unavailable", "No valid measurement");
      }
    }
  }
}
