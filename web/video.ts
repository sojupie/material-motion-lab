import { $, post } from "./api";
import { syncMaterialControls } from "./material";
import type { Project, Region, Method } from "./types";
export type ViewActions = {
  seek: (view: VideoView, index: number) => void;
  play: (view: VideoView) => void;
  change: () => void;
  job: (fn: () => Promise<void>) => Promise<void>;
  message: (text: string, error?: boolean) => void;
  align: (view: VideoView) => Promise<void>;
};
export class VideoView {
  project: Project | null = null;
  index = 0;
  zero = 0;
  roi: Region | null = null;
  outside = false;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private picture: HTMLImageElement | null = null;
  private cache = new Map<number, Promise<HTMLImageElement>>();
  private version = 0;
  private sliderUpdate = false;
  private drag: { x: number; y: number } | null = null;
  constructor(
    readonly prefix: string,
    private actions: ViewActions,
  ) {
    this.canvas = this.el<HTMLCanvasElement>("frame");
    this.ctx = this.canvas.getContext("2d")!;
    this.el("prev").onclick = () => actions.seek(this, this.index - 1);
    this.el("next").onclick = () => actions.seek(this, this.index + 1);
    this.el("play").onclick = () => actions.play(this);
    this.el<HTMLInputElement>("scrub").oninput = (e) => {
      if (!this.sliderUpdate)
        actions.seek(this, Number((e.target as HTMLInputElement).value));
    };
    this.el("zoom").onchange = () => this.zoom();
    this.el("zero").onclick = () => actions.job(() => actions.align(this));
    for (const key of ["start", "end"]) {
      this.el(key + "-here").onclick = () => {
        this.input(key).value = String(this.index);
        actions.change();
        this.controls(false);
      };
      this.input(key).onchange = () => {
        const n = Number(this.input(key).value);
        if (
          this.project &&
          Number.isInteger(n) &&
          n >= 0 &&
          n < this.project.times.length
        ) {
          actions.seek(this, n);
        }
        actions.change();
        this.controls(false);
      };
    }
    this.input("threshold").step = ".01";
    this.el("method").onchange = () => {
      this.methodHelp();
      this.controls(false);
    };
    this.el("track").onclick = () => actions.job(() => this.track(false));
    this.el("correct").onclick = () => actions.job(() => this.track(true));
    this.el<HTMLSelectElement>("marks").onchange = () => {
      const value = this.el<HTMLSelectElement>("marks").value;
      if (value !== "") actions.seek(this, Number(value));
    };
    this.el("weak-prev").onclick = () => this.jumpWeak(-1);
    this.el("weak-next").onclick = () => this.jumpWeak(1);
    for (const [key, kind] of [
      ["json", "json"],
      ["csv", "csv"],
      ["export", "video"],
    ])
      this.el(key).onclick = () => actions.job(() => this.download(kind));
    this.canvas.onpointerdown = (e) => {
      if (!this.project || document.body.getAttribute("aria-busy") === "true")
        return;
      this.actions.seek(this, this.index);
      this.drag = this.point(e);
      this.canvas.setPointerCapture(e.pointerId);
    };
    this.canvas.onpointermove = (e) => {
      if (!this.drag) return;
      const p = this.point(e);
      this.roi = [
        Math.round(Math.min(p.x, this.drag.x)),
        Math.round(Math.min(p.y, this.drag.y)),
        Math.round(Math.abs(p.x - this.drag.x)),
        Math.round(Math.abs(p.y - this.drag.y)),
      ];
      this.overlay();
    };
    this.canvas.onpointerup = () => {
      this.drag = null;
      if (this.roi)
        this.el<HTMLDetailsElement>("pane").querySelector<HTMLDetailsElement>(
          ".tracking-controls",
        )!.open = true;
      if (this.roi && (this.roi[2] < 4 || this.roi[3] < 4)) this.roi = null;
      this.el("selection").textContent = this.roi
        ? `Frame ${this.index}: x ${this.roi[0]}, y ${this.roi[1]}, ${this.roi[2]} × ${this.roi[3]} px`
        : "Select a region at least 4 × 4 px.";
      this.controls(false);
    };
    this.canvas.onpointercancel = () => {
      this.drag = null;
      this.roi = null;
      this.overlay();
      this.controls(false);
    };
    this.canvas.onkeydown = (e) => {
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        e.preventDefault();
        actions.seek(this, this.index + (e.key === "ArrowLeft" ? -1 : 1));
      }
    };
    new ResizeObserver(() => this.zoom()).observe(this.canvas.parentElement!);
  }
  el<T extends HTMLElement = HTMLElement>(key: string) {
    return $<T>(`${this.prefix}-${key}`);
  }
  input(key: string) {
    return this.el<HTMLInputElement>(key);
  }
  get first() {
    return Number(this.input("start").value);
  }
  get last() {
    return Number(this.input("end").value);
  }
  get time() {
    return this.project
      ? this.project.times[this.index] - this.project.times[this.zero]
      : 0;
  }
  get method() {
    return this.el<HTMLSelectElement>("method").value as Method;
  }
  async load(project: Project, zero = project.zeroFrame) {
    this.project = project;
    this.zero = zero;
    this.index = 0;
    this.roi = null;
    this.picture = null;
    this.version++;
    this.cache.clear();
    this.el("name").textContent =
      `${this.prefix.toUpperCase()}: ${project.name}`;
    this.el("meta").textContent =
      `${project.width} × ${project.height} px, ${project.times.length} frames`;
    this.input("scrub").max = String(project.times.length - 1);
    for (const key of ["start", "end"])
      this.input(key).max = String(project.times.length - 1);
    this.input("start").value = String(project.settings.start ?? 0);
    this.input("end").value = String(
      project.settings.end ?? project.times.length - 1,
    );
    this.input("search").value = String(project.settings.search ?? 60);
    this.input("threshold").value = String(project.settings.threshold ?? 0.65);
    this.el<HTMLSelectElement>("method").value =
      project.settings.method || "feature";
    this.methodHelp();
    this.marks();
    syncMaterialControls();
    await this.show(zero);
    this.controls(false);
  }
  methodHelp() {
    this.el("method-help").textContent =
      this.method === "feature"
        ? "Select a distinct detail on the first frame."
        : "Select a narrow strip across a straight edge. Keep corners and other boundaries outside the strip.";
  }
  controls(busy: boolean) {
    busy = busy || document.body.getAttribute("aria-busy") === "true";
    const p = this.project,
      ready = !!p;
    for (const key of [
      "prev",
      "next",
      "play",
      "zero",
      "start-here",
      "end-here",
    ])
      this.el<HTMLButtonElement>(key).disabled = busy || !ready;
    this.input("scrub").disabled = busy || !ready;
    const validInterval =
      ready &&
      Number.isInteger(this.first) &&
      Number.isInteger(this.last) &&
      this.first >= 0 &&
      this.first <= this.last &&
      this.last < p!.times.length;
    this.el<HTMLButtonElement>("track").disabled =
      busy ||
      !validInterval ||
      (!this.roi && !p?.selection) ||
      (!this.roi && this.method !== (p?.settings.method || "feature")) ||
      (!!this.roi && this.index !== this.first) ||
      (!this.roi && this.first !== p?.settings.start);
    this.el<HTMLButtonElement>("correct").disabled =
      busy ||
      !this.roi ||
      !p?.samples.length ||
      this.method !== (p?.settings.method || "feature") ||
      this.index < (p.settings.start ?? 0) ||
      this.index > (p.settings.end ?? 0);
    for (const key of ["json", "csv", "export"])
      this.el<HTMLButtonElement>(key).disabled = busy || !p?.samples.length;
    for (const direction of [-1, 1]) {
      const button = this.el<HTMLButtonElement>(
        direction < 0 ? "weak-prev" : "weak-next",
      );
      button.hidden = !p?.samples.some((s) => !s.valid);
      button.disabled =
        busy ||
        !p?.samples.some(
          (s) =>
            !s.valid &&
            (direction < 0 ? s.frame < this.index : s.frame > this.index),
        );
    }
  }
  private getPicture(i: number) {
    let pending = this.cache.get(i);
    if (!pending) {
      const id = this.project!.id;
      pending = new Promise<HTMLImageElement>((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => {
          this.cache.delete(i);
          reject(Error("Frame failed to load"));
        };
        image.src = `/api/projects/${id}/frames/${i}`;
      });
      this.cache.set(i, pending);
      if (this.cache.size > 90)
        this.cache.delete(this.cache.keys().next().value!);
    }
    return pending;
  }
  async show(i: number) {
    const p = this.project;
    if (!p) return;
    this.index = Math.max(0, Math.min(p.times.length - 1, Math.round(i)));
    this.roi = null;
    this.el("selection").textContent = p.selection
      ? `Saved first-frame region: x ${p.selection[0]}, y ${p.selection[1]}, ${p.selection[2]} × ${p.selection[3]} px`
      : "Draw a region on the first frame.";
    this.input("scrub").value = String(this.index);
    this.sliderUpdate = true;
    this.input("scrub").dispatchEvent(new Event("input", { bubbles: true }));
    this.sliderUpdate = false;
    this.el("time").textContent =
      `Frame ${this.index} / ${p.times.length - 1}   ${(p.times[this.index] / 1000).toFixed(3)} s   ${this.time >= 0 ? "+" : ""}${this.time.toFixed(1)} ms from alignment${this.outside ? " (outside recording)" : ""}`;
    const sample = p.samples.find((s) => s.frame === this.index);
    let quality = "";
    if (sample) {
      quality = sample.manual
        ? "Manual anchor"
        : !sample.valid
          ? "Tracking lost"
          : p.settings.method?.startsWith("edge")
            ? `Edge strength: ${sample.score.toFixed(3)}× anchor`
            : `Similarity: ${sample.score.toFixed(3)}`;
      if (p.settings.precision !== "subpixel")
        quality += "; legacy whole-pixel positions";
    }
    this.el("quality").textContent = quality;
    const token = ++this.version;
    const picture = await this.getPicture(this.index);
    if (token !== this.version) return;
    this.picture = picture;
    this.canvas.width = p.width;
    this.canvas.height = p.height;
    this.zoom();
    this.overlay();
    this.controls(false);
    for (
      let n = this.index + 1;
      n <= Math.min(this.index + 3, p.times.length - 1);
      n++
    )
      void this.getPicture(n).catch(() => {});
  }
  zoom() {
    const p = this.project;
    if (!p) return;
    const wrap = this.canvas.parentElement!;
    const value = this.el<HTMLSelectElement>("zoom").value;
    const bounds = getComputedStyle(wrap);
    const scale = Math.min(
      parseFloat(bounds.width) / p.width,
      parseFloat(bounds.height) / p.height,
    );
    wrap.style.overflow = value === "fit" ? "hidden" : "auto";
    this.canvas.style.width = `${value === "fit" ? Math.max(1, scale * p.width) : p.width * Number(value)}px`;
  }
  overlay() {
    const p = this.project;
    if (!p || !this.picture) return;
    const ctx = this.ctx;
    ctx.drawImage(this.picture, 0, 0, p.width, p.height);
    const sample = p.samples.find((s) => s.frame === this.index);
    ctx.lineWidth = Math.max(1, p.width / 500);
    if (sample?.valid && sample.x !== null && sample.y !== null) {
      ctx.strokeStyle = "#39d877";
      if (p.settings.method === "edge-x") {
        ctx.beginPath();
        ctx.moveTo(sample.x, sample.y);
        ctx.lineTo(sample.x, sample.y + sample.height);
        ctx.stroke();
      } else if (p.settings.method === "edge-y") {
        ctx.beginPath();
        ctx.moveTo(sample.x, sample.y);
        ctx.lineTo(sample.x + sample.width, sample.y);
        ctx.stroke();
      } else ctx.strokeRect(sample.x, sample.y, sample.width, sample.height);
    }
    if (this.roi) {
      ctx.strokeStyle = "#ffd54f";
      ctx.strokeRect(...this.roi);
    }
  }
  private point(e: PointerEvent) {
    const r = this.canvas.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(
          this.canvas.width,
          ((e.clientX - r.left) / r.width) * this.canvas.width,
        ),
      ),
      y: Math.max(
        0,
        Math.min(
          this.canvas.height,
          ((e.clientY - r.top) / r.height) * this.canvas.height,
        ),
      ),
    };
  }
  marks() {
    const p = this.project;
    if (!p) return;
    const values = new Map<number, string>();
    values.set(this.zero, "Alignment");
    values.set(this.first, "First frame");
    values.set(this.last, "Last frame");
    for (const anchor of p.anchors)
      values.set(
        anchor.frame,
        `${values.get(anchor.frame) ? values.get(anchor.frame) + "; " : ""}Manual anchor`,
      );
    this.el("marks").replaceChildren(
      new Option("Choose a mark", ""),
      ...Array.from(values)
        .sort((a, b) => a[0] - b[0])
        .map(
          ([frame, label]) =>
            new Option(`${label}: frame ${frame}`, String(frame)),
        ),
    );
  }
  jumpWeak(direction: number) {
    const rows = this.project?.samples.filter(
      (s) =>
        !s.valid &&
        (direction < 0 ? s.frame < this.index : s.frame > this.index),
    );
    if (!rows?.length) return;
    this.actions.seek(
      this,
      direction < 0 ? rows[rows.length - 1].frame : rows[0].frame,
    );
  }
  async track(correct: boolean) {
    const p = this.project;
    if (!p) return;
    let start = this.first,
      end = this.last,
      selection = this.roi || p.selection,
      anchors: typeof p.anchors = [];
    if (!selection) throw Error("Select a tracking region on the first frame.");
    if (this.roi && !correct && this.index !== start)
      throw Error("Select the region on the first frame.");
    if (correct) {
      start = p.settings.start!;
      end = p.settings.end!;
      anchors = [
        ...p.anchors.filter((a) => a.frame !== this.index),
        { frame: this.index, region: selection },
      ];
      selection = start === this.index ? selection : p.selection!;
    }
    this.actions.message(
      correct ? "Applying correction…" : "Tracking interval…",
    );
    const result = await post<Project>(`/projects/${p.id}/track`, {
      region: selection,
      start,
      end,
      anchors,
      search: Number(this.input("search").value),
      threshold: Number(this.input("threshold").value),
      method: correct ? p.settings.method || "feature" : this.method,
    });
    const index = this.index,
      zero = this.zero;
    await this.load(result, zero);
    await this.show(index);
    const weak = result.samples.filter((s) => !s.valid).length;
    this.actions.message(
      `Tracked ${result.samples.length} frames; ${weak} weak matches.`,
    );
    this.actions.change();
  }
  async download(kind: string) {
    if (!this.project) return;
    this.actions.message(
      kind === "video"
        ? "Rendering annotated video…"
        : "Preparing measurements…",
    );
    const response = await fetch(
      `/api/projects/${this.project.id}/download/${kind}?axis=${$<HTMLSelectElement>("axis").value}`,
    );
    if (!response.ok) {
      let error = await response.json();
      throw Error(error.detail || "Export failed");
    }
    const blob = await response.blob(),
      url = URL.createObjectURL(blob),
      link = document.createElement("a");
    link.href = url;
    link.download =
      kind === "video"
        ? "annotated.mp4"
        : kind === "csv"
          ? "measurements.csv"
          : "project.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    this.actions.message("Export ready.");
  }
}
