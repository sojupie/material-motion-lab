import { $, post } from "./api";
import { syncMaterialControls } from "./material";
import { clampRange } from "./timing";
import type { Project, Region, Method, WorkspaceTrack } from "./types";
export type ViewActions = {
  seek: (view: VideoView, index: number) => void;
  select: (view: VideoView) => void;
  change: () => void;
  job: (fn: () => Promise<void>) => Promise<void>;
  message: (text: string, error?: boolean) => void;
};
export class VideoView {
  project: Project | null = null;
  index = 0;
  offset = 0;
  sync: number | null = null;
  outside = false;
  roi: Region | null = null;
  drawing = false;
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private picture: HTMLImageElement | null = null;
  private cache = new Map<number, Promise<HTMLImageElement>>();
  private version = 0;
  private drag: { x: number; y: number } | null = null;
  constructor(
    readonly prefix: string,
    private actions: ViewActions,
  ) {
    this.canvas = this.el<HTMLCanvasElement>("frame");
    this.ctx = this.canvas.getContext("2d")!;
    this.el("select").onclick = () => actions.select(this);
    this.el("zoom").onchange = () => this.zoom();
    for (const key of ["start", "end"]) {
      this.input(key).onchange = () => {
        this.setRange(this.first, this.last);
        actions.change();
      };
      this.el(key + "-here").onclick = () => {
        this.setRange(
          key === "start" ? this.index : this.first,
          key === "end" ? this.index : this.last,
        );
        actions.change();
      };
      this.el("goto-" + key).onclick = () =>
        actions.seek(this, key === "start" ? this.first : this.last);
    }
    for (const key of ["method", "search", "threshold"])
      this.el(key).onchange = () => {
        this.methodHelp();
        this.controls(false);
        actions.change();
      };
    this.input("threshold").step = ".01";
    this.el("draw").onclick = () => {
      this.drawing = !this.drawing;
      this.canvas.classList.toggle("drawing", this.drawing);
      this.el("draw").setAttribute("aria-pressed", String(this.drawing));
      this.el("draw").textContent = this.drawing
        ? "Cancel region selection"
        : "Draw tracking region";
      if (this.drawing) this.actions.seek(this, this.index);
      if (this.drawing)
        this.el("pane").scrollIntoView({
          block: "nearest",
          behavior: "instant",
        });
      actions.message(
        this.drawing
          ? "Drag over the video to select a detail or straight edge."
          : "",
      );
    };
    this.el("track").onclick = () => actions.job(() => this.track(false));
    this.el("correct").onclick = () => actions.job(() => this.track(true));
    for (const kind of ["anchor", "weak"])
      for (const direction of [-1, 1])
        this.el(`${kind}-${direction < 0 ? "prev" : "next"}`).onclick = () =>
          this.jump(kind, direction);
    for (const [key, kind] of [
      ["json", "json"],
      ["csv", "csv"],
      ["export", "video"],
    ])
      this.el(key).onclick = () => actions.job(() => this.download(kind));
    this.canvas.onpointerdown = (e) => {
      if (!this.project || document.body.hasAttribute("aria-busy")) return;
      actions.select(this);
      if (!this.drawing) return;
      this.drag = this.point(e);
      this.roi = null;
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
      if (!this.drag) return;
      this.drag = null;
      if (this.roi && (this.roi[2] < 4 || this.roi[3] < 4)) this.roi = null;
      this.el("selection").textContent = this.roi
        ? `Selected at frame ${this.index}: x ${this.roi[0]}, y ${this.roi[1]}, ${this.roi[2]} × ${this.roi[3]} px`
        : "Select a region at least 4 × 4 px.";
      this.drawing = false;
      this.canvas.classList.remove("drawing");
      this.el("draw").setAttribute("aria-pressed", "false");
      this.el("draw").textContent = "Draw tracking region";
      this.controls(false);
      this.actions.change();
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
    return this.project ? this.project.times[this.index] + this.offset : 0;
  }
  get method() {
    return this.el<HTMLSelectElement>("method").value as Method;
  }
  get dirty() {
    const s = this.project?.settings;
    return (
      !!this.project?.samples.length &&
      (!!this.roi ||
        this.method !== (s?.method || "feature") ||
        Number(this.input("search").value) !== s?.search ||
        Number(this.input("threshold").value) !== s?.threshold)
    );
  }
  workspace(): WorkspaceTrack {
    return {
      id: this.project!.id,
      offset: this.offset,
      sync: this.sync,
      first: this.first,
      last: this.last,
    };
  }
  setRange(first: number, last: number) {
    if (!this.project) return;
    const range = clampRange(first, last, this.project.times.length);
    this.input("start").value = String(range[0]);
    this.input("end").value = String(range[1]);
    this.controls(false);
  }
  async load(p: Project, track?: WorkspaceTrack) {
    this.project = p;
    this.index = 0;
    this.roi = null;
    this.stopDrawing();
    this.picture = null;
    this.version++;
    this.cache.clear();
    this.offset = track?.offset ?? 0;
    this.sync = track?.sync ?? null;
    this.el("name").textContent = `${this.prefix.toUpperCase()}: ${p.name}`;
    this.el("meta").textContent =
      `${p.width} × ${p.height} px, ${p.times.length} frames`;
    for (const key of ["start", "end"])
      this.input(key).max = String(p.times.length - 1);
    this.setRange(
      track?.first ?? p.settings.start ?? 0,
      track?.last ?? p.settings.end ?? p.times.length - 1,
    );
    this.input("search").value = String(p.settings.search ?? 60);
    this.input("threshold").value = String(p.settings.threshold ?? 0.65);
    this.el<HTMLSelectElement>("method").value = p.settings.method || "feature";
    this.methodHelp();
    syncMaterialControls();
    await this.show(0);
    this.controls(false);
  }
  stopDrawing() {
    this.drawing = false;
    this.drag = null;
    this.canvas.classList.remove("drawing");
    this.el("draw").setAttribute("aria-pressed", "false");
    this.el("draw").textContent = "Draw tracking region";
  }
  methodHelp() {
    this.el("method-help").textContent =
      this.method === "feature"
        ? "Select a distinct detail at the range start. To correct a result, draw its position at the current frame."
        : "Draw a narrow strip across a straight edge. Keep corners and other boundaries outside it.";
  }
  controls(busy: boolean) {
    busy = busy || document.body.hasAttribute("aria-busy");
    const p = this.project;
    for (const key of ["draw", "start-here", "end-here"])
      this.el<HTMLButtonElement>(key).disabled = busy || !p || this.outside;
    for (const key of ["goto-start", "goto-end"])
      this.el<HTMLButtonElement>(key).disabled = busy || !p;
    this.el<HTMLButtonElement>("track").disabled =
      busy ||
      !p ||
      (!this.roi && !p.selection) ||
      (!!this.roi && this.index !== this.first) ||
      (!this.roi &&
        (this.first !== p.settings.start ||
          this.method !== (p.settings.method || "feature")));
    this.el<HTMLButtonElement>("correct").disabled =
      busy ||
      !this.roi ||
      !p?.samples.length ||
      this.method !== (p.settings.method || "feature") ||
      this.index < (p.settings.start ?? 0) ||
      this.index > (p.settings.end ?? 0);
    this.el("dirty").textContent = this.dirty
      ? "Tracking settings changed. Run tracking to update measurements."
      : p?.samples.length
        ? `Tracked frames ${p.settings.start}–${p.settings.end}.${this.first !== p.settings.start && !this.roi ? " Go to the range start and draw a region to retrack this range." : ""}`
        : "No measurements yet. Select a region at the range start, then track the range.";
    for (const key of ["json", "csv", "export"])
      this.el<HTMLButtonElement>(key).disabled = busy || !p?.samples.length;
    for (const kind of ["anchor", "weak"])
      for (const direction of [-1, 1])
        this.el<HTMLButtonElement>(
          `${kind}-${direction < 0 ? "prev" : "next"}`,
        ).disabled =
          busy ||
          !this.markFrames(kind).some((i) =>
            direction < 0 ? i < this.index : i > this.index,
          );
  }
  markFrames(kind: string) {
    return kind === "anchor"
      ? this.project?.anchors.slice(1).map((a) => a.frame) || []
      : this.project?.samples.filter((s) => !s.valid).map((s) => s.frame) || [];
  }
  jump(kind: string, direction: number) {
    const rows = this.markFrames(kind).filter((i) =>
      direction < 0 ? i < this.index : i > this.index,
    );
    if (rows.length)
      this.actions.seek(this, direction < 0 ? rows.at(-1)! : rows[0]);
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
      ? `Saved region at frame ${p.settings.start}: x ${p.selection[0]}, y ${p.selection[1]}, ${p.selection[2]} × ${p.selection[3]} px`
      : "No tracking region selected.";
    this.el("time").textContent =
      `Frame ${this.index} / ${p.times.length - 1}   ${(p.times[this.index] / 1000).toFixed(3)} s source${this.outside ? " (outside clip)" : ""}`;
    const sample = p.samples.find((s) => s.frame === this.index);
    this.el("quality").textContent = !sample
      ? ""
      : sample.manual
        ? "Manual anchor"
        : !sample.valid
          ? "Tracking lost"
          : p.settings.method?.startsWith("edge")
            ? `Edge strength: ${sample.score.toFixed(3)}× anchor`
            : `Similarity: ${sample.score.toFixed(3)}`;
    const token = ++this.version,
      picture = await this.getPicture(this.index);
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
    const wrap = this.canvas.parentElement!,
      bounds = getComputedStyle(wrap),
      value = this.el<HTMLSelectElement>("zoom").value,
      scale = Math.min(
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
  async track(correct: boolean) {
    const p = this.project;
    if (!p) return;
    let start = this.first,
      end = this.last,
      selection = this.roi || p.selection,
      anchors: typeof p.anchors = [];
    if (!selection) throw Error("Draw a tracking region at the range start.");
    if (this.roi && !correct && this.index !== start)
      throw Error("Go to the range start and draw the tracking region there.");
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
      correct
        ? "Recalculating tracking with the corrected position…"
        : "Tracking selected range…",
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
      workspace = this.workspace();
    await this.load(result, workspace);
    await this.show(index);
    const weak = result.samples.filter((s) => !s.valid).length;
    this.actions.message(
      `Tracked ${result.samples.length} frames; ${weak} weak ${weak === 1 ? "match" : "matches"}.`,
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
