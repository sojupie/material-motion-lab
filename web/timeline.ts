import { $ } from "./api";
import { nearest } from "./timing";
import type { VideoView } from "./video";
export const LEFT = 64,
  RIGHT = 16;
const ns = "http://www.w3.org/2000/svg";
export class Timeline {
  window: [number, number] | null = null;
  private width = 900;
  private updating = false;
  private drag: {
    kind: string;
    view?: VideoView;
    x: number;
    offset: number;
  } | null = null;
  constructor(
    private views: () => VideoView[],
    private time: () => number,
    private selected: () => VideoView,
    private seek: (t: number) => void,
    private select: (v: VideoView) => void,
    private change: (save: boolean) => void,
  ) {
    const svg = $("timeline");
    svg.onpointerdown = (e) => {
      if (document.body.hasAttribute("aria-busy")) return;
      const target = (e.target as Element).closest<SVGElement>("[data-kind]"),
        kind = target?.dataset.kind || "scrub",
        view = this.views().find((v) => v.prefix === target?.dataset.view);
      if (view) this.select(view);
      if (kind === "clip") this.window = this.bounds();
      this.drag = { kind, view, x: e.clientX, offset: view?.offset || 0 };
      svg.setPointerCapture(e.pointerId);
      if (kind === "scrub") this.seek(this.at(e.clientX));
      else if (kind === "start" || kind === "end") this.seek(this.time());
      if (kind === "mark") {
        this.seek(Number(target!.dataset.time));
        this.drag = null;
      }
    };
    svg.onpointermove = (e) => {
      const d = this.drag;
      if (!d) return;
      if (d.kind === "scrub") {
        this.seek(this.at(e.clientX));
        return;
      }
      const v = d.view;
      if (!v?.project) return;
      if (d.kind === "clip")
        v.offset = Math.max(
          -86400000,
          Math.min(86400000, d.offset + this.at(e.clientX) - this.at(d.x)),
        );
      else {
        const frame = nearest(v.project.times, this.at(e.clientX) - v.offset);
        v.setRange(
          d.kind === "start" ? Math.min(frame, v.last) : v.first,
          d.kind === "end" ? Math.max(frame, v.first) : v.last,
        );
      }
      this.change(false);
      if (d.kind === "clip") this.seek(this.time());
    };
    svg.onpointerup = () => {
      if (this.drag && this.drag.kind !== "scrub") this.change(true);
      this.drag = null;
    };
    svg.onpointercancel = () => {
      if (this.drag) this.change(true);
      this.drag = null;
    };
    svg.onkeydown = (e) => {
      const target = (e.target as Element).closest<SVGElement>("[data-kind]");
      if (!target || !["ArrowLeft", "ArrowRight", "Enter", " "].includes(e.key))
        return;
      e.preventDefault();
      const v = this.views().find((v) => v.prefix === target.dataset.view),
        kind = target.dataset.kind,
        dir = e.key === "ArrowLeft" ? -1 : 1;
      if (kind === "mark") {
        this.seek(Number(target.dataset.time));
        return;
      }
      if (!v?.project) return;
      this.select(v);
      if (kind === "start") v.setRange(Math.min(v.last, v.first + dir), v.last);
      else if (kind === "end")
        v.setRange(v.first, Math.max(v.first, v.last + dir));
      else if (kind === "clip" && e.key.startsWith("Arrow"))
        v.offset += dir * this.frameStep(v);
      this.change(true);
    };
    for (const [id, factor] of [
      ["timeline-in", 0.5],
      ["timeline-out", 2],
    ] as const)
      $(id).onclick = () => this.zoom(factor);
    $("timeline-fit").onclick = () => {
      this.window = null;
      this.change(false);
    };
    $("timeline-range").onclick = () => {
      const v = this.selected();
      if (!v.project) return;
      const a = v.project.times[v.first] + v.offset,
        b = v.project.times[v.last] + v.offset,
        pad = Math.max(30, (b - a) * 0.05);
      this.window = [a - pad, b + pad];
      this.change(false);
    };
    $("timeline-pan").onscroll = () => {
      if (this.updating) return;
      const pan = $("timeline-pan"),
        full = this.full(),
        bounds = this.bounds(),
        span = bounds[1] - bounds[0],
        space = Math.max(0, full[1] - full[0] - span),
        range = pan.scrollWidth - pan.clientWidth;
      if (range <= 0) return;
      const start = full[0] + (pan.scrollLeft / range) * space;
      this.window = [start, start + span];
      this.change(false);
    };
    new ResizeObserver(() => this.change(false)).observe(svg.parentElement!);
  }
  frameStep(v: VideoView) {
    const t = v.project!.times;
    return (
      (v.index > 0
        ? t[v.index] - t[v.index - 1]
        : (t[1] ?? t[0] + 1000 / 60) - t[0]) || 1000 / 60
    );
  }
  full(): [number, number] {
    const vs = this.views().filter((v) => v.project);
    return vs.length
      ? [
          Math.min(...vs.map((v) => v.offset)),
          Math.max(...vs.map((v) => v.offset + v.project!.times.at(-1)!)),
        ]
      : [0, 1];
  }
  bounds(): [number, number] {
    const [a, b] = this.window || this.full();
    return [a, Math.max(a + 1, b)];
  }
  private at(clientX: number) {
    const r = $("timeline").getBoundingClientRect(),
      x = ((clientX - r.left) / r.width) * this.width,
      [min, max] = this.bounds();
    return (
      min +
      Math.max(0, Math.min(1, (x - LEFT) / (this.width - LEFT - RIGHT))) *
        (max - min)
    );
  }
  zoom(factor: number) {
    const [a, b] = this.bounds(),
      span = Math.max(10, (b - a) * factor),
      center = Math.max(a, Math.min(b, this.time()));
    this.window = [center - span / 2, center + span / 2];
    this.change(false);
  }
  paint() {
    const svg = $("timeline");
    const focused =
      document.activeElement instanceof SVGElement &&
      svg.contains(document.activeElement)
        ? {
            kind: document.activeElement.dataset.kind,
            view: document.activeElement.dataset.view,
          }
        : null;
    const existing = new Map(
      Array.from(svg.children).map((n) => [n.getAttribute("data-node"), n]),
    );
    const used = new Set<Element>();
    let serial = 0;
    const views = this.views().filter((v) => v.project);
    if (!views.length) return;
    const width = (this.width = Math.max(240, svg.parentElement!.clientWidth)),
      [min, max] = this.bounds(),
      height = 40 + views.length * 64,
      X = (t: number) =>
        LEFT + ((t - min) / (max - min)) * (width - LEFT - RIGHT);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.height = `${height}px`;
    const el = (
      tag: string,
      attrs: Record<string, string | number>,
      text?: string,
    ) => {
      const key = attrs["data-kind"]
        ? `${attrs["data-kind"]}-${attrs["data-view"] || ""}-${attrs["data-time"] || ""}-${attrs["data-kind"] === "mark" ? attrs.class : ""}`
        : `${tag}-${serial}`;
      serial++;
      let node = existing.get(key);
      if (!node || node.tagName !== tag)
        node = document.createElementNS(ns, tag);
      for (const attr of Array.from(node.attributes))
        if (attr.name !== "data-node" && !(attr.name in attrs))
          node.removeAttribute(attr.name);
      node.setAttribute("data-node", key);
      for (const [k, v] of Object.entries(attrs))
        node.setAttribute(k, String(v));
      node.textContent = text || "";
      used.add(node);
      svg.append(node);
      return node;
    };
    el("rect", {
      x: LEFT,
      y: 0,
      width: width - LEFT - RIGHT,
      height: 35,
      class: "time-ruler",
      "data-kind": "scrub",
    });
    const count = width < 500 ? 3 : 6;
    for (let i = 0; i <= count; i++) {
      const t = min + ((max - min) * i) / count,
        x = X(t);
      el("line", { x1: x, x2: x, y1: 25, y2: height, class: "grid" });
      el(
        "text",
        {
          x,
          y: 17,
          "text-anchor": i === count ? "end" : i === 0 ? "start" : "middle",
          class: "tick",
        },
        `${(t / 1000).toFixed(max - min < 1000 ? 3 : 2)} s`,
      );
    }
    for (const [vindex, v] of views.entries()) {
      const p = v.project!,
        y = 40 + vindex * 64,
        selected = v === this.selected(),
        clipStart = Math.max(LEFT, X(v.offset)),
        clipEnd = Math.min(width - RIGHT, X(v.offset + p.times.at(-1)!));
      el(
        "text",
        { x: 12, y: y + 32, class: "track-label" },
        v.prefix.toUpperCase(),
      );
      if (clipEnd >= clipStart) {
        el("rect", {
          x: clipStart,
          y,
          width: Math.max(1, clipEnd - clipStart),
          height: 46,
          rx: 4,
          class: `video-clip ${selected ? "selected" : ""}`,
          "data-kind": "clip",
          "data-view": v.prefix,
          role: "button",
          tabindex: 0,
          "aria-label": `Select or move video ${v.prefix.toUpperCase()}`,
        });
        el(
          "text",
          {
            x: clipStart + 8,
            y: y + 15,
            class: "clip-name",
            "pointer-events": "none",
          },
          p.name.length > 30 ? p.name.slice(0, 28) + "…" : p.name,
        );
      }
      const start = p.times[v.first] + v.offset,
        end = p.times[v.last] + v.offset,
        sx = Math.max(LEFT, X(start)),
        ex = Math.min(width - RIGHT, X(end));
      if (ex >= sx)
        el("rect", {
          x: sx,
          y: y + 24,
          width: Math.max(2, ex - sx),
          height: 20,
          class: "tracking-range",
          "pointer-events": "none",
        });
      for (const [kind, t, frame] of [
        ["start", start, v.first],
        ["end", end, v.last],
      ] as const) {
        const x = X(t);
        if (x < LEFT || x > width - RIGHT) continue;
        el("rect", {
          x: x - 5,
          y: y + 23,
          width: 10,
          height: 24,
          rx: 2,
          class: `range-handle ${v.prefix}`,
          "data-kind": kind,
          "data-view": v.prefix,
          role: "slider",
          tabindex: 0,
          "aria-label": `${v.prefix.toUpperCase()} range ${kind}, frame ${frame}`,
          "aria-valuemin": 0,
          "aria-valuemax": p.times.length - 1,
          "aria-valuenow": frame,
        });
        if (ex - sx >= 120)
          el(
            "text",
            {
              x: x + (kind === "start" ? 8 : -8),
              y: y + 61,
              "text-anchor": kind === "start" ? "start" : "end",
              class: "range-label",
            },
            `${kind === "start" ? "In" : "Out"} ${frame}`,
          );
      }
      if (ex >= sx && ex - sx < 120)
        el(
          "text",
          {
            x: (sx + ex) / 2,
            y: y + 61,
            "text-anchor": "middle",
            class: "range-label",
          },
          `${v.first} to ${v.last}`,
        );
      const mark = (t: number, cls: string, label: string) => {
        const x = X(t);
        if (x < LEFT || x > width - RIGHT) return;
        const node = el("path", {
          d: `M${x - 4},${y + 29} L${x},${y + 23} L${x + 4},${y + 29} L${x},${y + 35}Z`,
          class: cls,
          "data-kind": "mark",
          "data-view": v.prefix,
          "data-time": t,
          tabindex: 0,
          role: "button",
          "aria-label": label,
        });
        const title = document.createElementNS(ns, "title");
        title.textContent = label;
        node.append(title);
      };
      for (const s of p.samples)
        if (!s.valid) {
          const x = X(s.t + v.offset);
          if (x >= LEFT && x <= width - RIGHT)
            el("line", {
              x1: x,
              x2: x,
              y1: y + 42,
              y2: y + 51,
              class: "weak-mark",
            });
        }
      for (const a of p.anchors.slice(1))
        mark(
          p.times[a.frame] + v.offset,
          "correction-marker",
          `${v.prefix.toUpperCase()} correction at frame ${a.frame}`,
        );
      if (v.sync !== null)
        mark(
          p.times[v.sync] + v.offset,
          "sync-marker",
          `${v.prefix.toUpperCase()} sync point at frame ${v.sync}`,
        );
    }
    const x = X(this.time());
    if (x >= LEFT && x <= width - RIGHT) {
      el("line", { x1: x, x2: x, y1: 22, y2: height, class: "playhead" });
      el("path", {
        d: `M${x - 5},22 L${x + 5},22 L${x},29Z`,
        class: "playhead-head",
        "pointer-events": "none",
      });
    }
    for (const node of Array.from(svg.children))
      if (!used.has(node)) node.remove();
    const full = this.full(),
      span = max - min,
      space = Math.max(0, full[1] - full[0] - span),
      pan = $("timeline-pan");
    pan.hidden = space < 1;
    pan.firstElementChild!.setAttribute(
      "style",
      `width:${Math.max(100, ((full[1] - full[0]) / span) * 100)}%;height:1px`,
    );
    const scroll =
      space > 0
        ? Math.max(0, Math.min(1, (min - full[0]) / space)) *
          (pan.scrollWidth - pan.clientWidth)
        : 0;
    if (Math.abs(pan.scrollLeft - scroll) > 1) {
      this.updating = true;
      pan.scrollLeft = scroll;
      requestAnimationFrame(() => (this.updating = false));
    }
    if (focused?.kind)
      svg
        .querySelector<SVGElement>(
          `[data-kind="${focused.kind}"][data-view="${focused.view}"]`,
        )
        ?.focus({ preventScroll: true });
  }
}
