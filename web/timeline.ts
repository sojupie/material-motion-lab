import { $ } from "./api";
import { required } from "./errors";
import { nearest } from "./timing";
import { nearestTrimHandle } from "./trim-targets";
import type { VideoView } from "./video";

import {
TRACK_LEFT,
TRACK_RIGHT,
SVG_NAMESPACE as ns,
renderTimeRuler,
} from "./timeline-renderer";

export { LEFT,RIGHT } from "./timeline-renderer";
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
    private readonly views: () => VideoView[],
    private readonly time: () => number,
    private readonly selected: () => VideoView,
    private readonly seek: (t: number) => void,
    private readonly select: (v: VideoView) => void,
    private readonly change: (save: boolean) => void,
    private readonly playback: () => [number, number],
    private readonly setPlayback: (
      edge: "start" | "end",
      t: number,
      save: boolean,
    ) => void,
  ) {
    const svg = $("timeline");
    svg.onpointerdown = (e) => {
      if (Object.hasOwn(document.body.dataset, "processing")) {
        return;
      }
      const handles = [
        ...svg.querySelectorAll<SVGElement>(".range-handle,.playback-handle"),
      ];
      const centers = handles.map((handle) => {
        const r = handle
          .querySelector(".trim-body,.playback-flag")!
          .getBoundingClientRect();
        return {
          x: r.x + r.width / 2,
          y: r.y + r.height / 2,
          width: 24,
          height: 24,
        };
      });
      const nearest = nearestTrimHandle(centers, e.clientX, e.clientY);
      const target = (e.target as Element).classList.contains("playhead-hit")
        ? (e.target as SVGElement)
        : nearest >= 0
          ? handles[nearest]
          : (e.target as Element).closest<SVGElement>("[data-kind]");
      const kind = target?.dataset.kind ?? "scrub";
      const view = this.views().find((v) => v.prefix === target?.dataset.view);
      if (view) {
        this.select(view);
      }
      if (kind === "clip") {
        this.window = this.bounds();
      }
      const offset = kind.startsWith("playback-")
        ? this.playback()[kind === "playback-start" ? 0 : 1]
        : view?.project && (kind === "start" || kind === "end")
          ? required(
              view.project.times[kind === "start" ? view.first : view.last],
            ) + view.offset
          : (view?.offset ?? 0);
      this.drag = { kind, view, x: e.clientX, offset };
      svg.setPointerCapture(e.pointerId);
      if (kind === "scrub") {
        this.seek(this.at(e.clientX));
      } else if (
        kind === "start" ||
        kind === "end" ||
        kind.startsWith("playback-")
      ) {
        this.seek(this.time());
      }
      if (kind === "mark") {
        this.seek(Number(target!.dataset.time));
        this.drag = null;
      }
      if (this.drag) {
        document.body.dataset.timelineDrag =
          kind === "clip" ? "move" : "resize";
      }
    };
    svg.onpointermove = (e) => {
      const d = this.drag;
      if (!d) {
        return;
      }
      if (d.kind === "scrub") {
        this.seek(this.at(e.clientX));
        return;
      }
      const time = d.offset + this.at(e.clientX) - this.at(d.x);
      if (d.kind === "playback-start" || d.kind === "playback-end") {
        this.setPlayback(
          d.kind === "playback-start" ? "start" : "end",
          time,
          false,
        );
        return;
      }
      const v = d.view;
      if (!v?.project) {
        return;
      }
      if (d.kind === "clip") {
        v.offset = time;
      } else {
        const frame = nearest(v.project.times, time - v.offset);
        v.setRange(
          d.kind === "start" ? Math.min(frame, v.last) : v.first,
          d.kind === "end" ? Math.max(frame, v.first) : v.last,
        );
      }
      this.change(false);
      if (d.kind === "clip") {
        this.seek(this.time());
      }
    };
    const finishDrag = () => {
      if (this.drag && this.drag.kind !== "scrub") {
        this.change(true);
      }
      this.drag = null;
      delete document.body.dataset.timelineDrag;
    };
    svg.onpointerup = finishDrag;
    svg.onpointercancel = finishDrag;
    svg.onlostpointercapture = finishDrag;
    svg.onkeydown = (e) => {
      const target = (e.target as Element).closest<SVGElement>("[data-kind]");
      if (
        !target ||
        !["ArrowLeft", "ArrowRight", "Enter", " "].includes(e.key)
      ) {
        return;
      }
      e.preventDefault();
      const v = this.views().find((v) => v.prefix === target.dataset.view);
      const { kind } = target.dataset;
      const dir = e.key === "ArrowLeft" ? -1 : 1;
      if (kind === "mark") {
        this.seek(Number(target.dataset.time));
        return;
      }
      if (kind === "playback-start" || kind === "playback-end") {
        const view = this.selected();
        const p = view.project;
        if (!p || !e.key.startsWith("Arrow")) {
          return;
        }
        const edge = kind === "playback-start" ? "start" : "end";
        const current = this.playback()[edge === "start" ? 0 : 1];
        const frame = Math.max(
          0,
          Math.min(
            p.times.length - 1,
            nearest(p.times, current - view.offset) + dir,
          ),
        );
        this.setPlayback(edge, required(p.times[frame]) + view.offset, true);
        return;
      }
      if (!v?.project) {
        return;
      }
      this.select(v);
      if (kind === "start") {
        v.setRange(Math.min(v.last, v.first + dir), v.last);
      } else if (kind === "end") {
        v.setRange(v.first, Math.max(v.first, v.last + dir));
      } else if (kind === "clip" && e.key.startsWith("Arrow")) {
        v.offset += dir * this.frameStep(v);
      }
      this.change(true);
    };
    for (const [id, factor] of [
      ["timeline-in", 0.5],
      ["timeline-out", 2],
    ] as const) {
      $(id).onclick = () => {
        this.zoom(factor);
      };
    }
    $("timeline-fit").onclick = () => {
      this.window = null;
      this.change(false);
    };
    $("timeline-range").onclick = () => {
      const v = this.selected();
      if (!v.project) {
        return;
      }
      const a = required(v.project.times[v.first]) + v.offset;
      const b = required(v.project.times[v.last]) + v.offset;
      const pad = Math.max(30, (b - a) * 0.05);
      this.window = [a - pad, b + pad];
      this.change(false);
    };
    $("timeline-pan").onscroll = () => {
      if (this.updating) {
        return;
      }
      const pan = $("timeline-pan");
      const full = this.full();
      const bounds = this.bounds();
      const span = bounds[1] - bounds[0];
      const space = Math.max(0, full[1] - full[0] - span);
      const range = pan.scrollWidth - pan.clientWidth;
      if (range <= 0) {
        return;
      }
      const start = full[0] + (pan.scrollLeft / range) * space;
      this.window = [start, start + span];
      this.change(false);
    };
    new ResizeObserver(() => {
      this.change(false);
    }).observe(svg.parentElement!);
  }
  frameStep(v: VideoView) {
    const t = v.project!.times;
    return (
      (v.index > 0
        ? required(t[v.index]) - required(t[v.index - 1])
        : (t[1] ?? required(t[0]) + 1000 / 60) - required(t[0])) || 1000 / 60
    );
  }
  full(): [number, number] {
    const vs = this.views().filter((v) => v.project);
    return vs.length > 0
      ? [
          Math.min(...vs.map((v) => v.offset)),
          Math.max(...vs.map((v) => v.offset + v.project!.times.at(-1)!)),
        ]
      : [0, 1];
  }
  bounds(): [number, number] {
    const [a, b] = this.window ?? this.full();
    return [a, Math.max(a + 1, b)];
  }
  private at(clientX: number) {
    const r = $("timeline").getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * this.width;
    const [min, max] = this.bounds();
    return (
      min +
      Math.max(
        0,
        Math.min(1, (x - TRACK_LEFT) / (this.width - TRACK_LEFT - TRACK_RIGHT)),
      ) *
        (max - min)
    );
  }
  zoom(factor: number) {
    const [a, b] = this.bounds();
    const span = Math.max(10, (b - a) * factor);
    const center = Math.max(a, Math.min(b, this.time()));
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
      [...svg.querySelectorAll<SVGElement>(":scope > *")].map((n) => [
        n.dataset.node,
        n,
      ]),
    );
    const used = new Set<Element>();
    let serial = 0;
    const views = this.views().filter((v) => v.project);
    if (views.length === 0) {
      delete document.body.dataset.timelineDrag;
      svg.replaceChildren();
      svg.style.height = "0px";
      $("timeline-pan").hidden = true;
      this.drag = null;
      return;
    }
    const width = Math.max(240, svg.parentElement!.clientWidth);
    this.width = width;
    const [min, max] = this.bounds();
    const height = 56 + views.length * 64;
    const X = (t: number) =>
      TRACK_LEFT +
      ((t - min) / (max - min)) * (width - TRACK_LEFT - TRACK_RIGHT);
    svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
    svg.style.height = `${height}px`;
    const el = (
      tag: string,
      attrs: Record<string, string | number>,
      text?: string,
    ) => {
      const key =
        attrs["data-kind"] === undefined
          ? `${tag}-${serial}`
          : `${attrs["data-kind"]}-${attrs["data-view"] ?? ""}-${attrs["data-time"] ?? ""}-${["mark", "scrub"].includes(String(attrs["data-kind"])) ? attrs.class : ""}`;
      serial++;
      let node = existing.get(key);
      if (!node || node.tagName !== tag) {
        node = document.createElementNS(ns, tag);
      }
      const attributes = [...node.attributes];
      for (const attr of attributes) {
        if (attr.name !== "data-node" && !(attr.name in attrs)) {
          node.removeAttribute(attr.name);
        }
      }
      node.dataset.node = key;
      for (const [k, v] of Object.entries(attrs)) {
        node.setAttribute(k, String(v));
      }
      node.textContent = text ?? "";
      used.add(node);
      svg.append(node);
      return node;
    };
    renderTimeRuler({
      el,
      width,
      height,
      bounds: [min, max],
      x: X,
      playback: this.playback(),
      full: this.full(),
      dragKind: this.drag?.kind,
    });
    const active = this.selected();
    if (active.project) {
      const { times } = active.project;
      // Draw individual frame ticks only when there is room to distinguish them.
      for (let i = 0; i < times.length; i++) {
        const x = X(required(times[i]) + active.offset);
        if (
          x < TRACK_LEFT ||
          x > width - TRACK_RIGHT ||
          (i && x - X(required(times[i - 1]) + active.offset) < 4)
        ) {
          continue;
        }
        el("line", {
          x1: x,
          x2: x,
          y1: 29,
          y2: 35,
          class: "frame-tick",
          "pointer-events": "none",
        });
      }
    }
    for (const [vindex, v] of views.entries()) {
      const p = v.project!;
      const y = 56 + vindex * 64;
      const selected = v === this.selected();
      const clipStart = Math.max(TRACK_LEFT, X(v.offset));
      const clipEnd = Math.min(
        width - TRACK_RIGHT,
        X(v.offset + p.times.at(-1)!),
      );
      el(
        "text",
        {
          x: 12,
          y: y + 23,
          "dominant-baseline": "middle",
          class: "track-label",
        },
        v.prefix.toUpperCase(),
      );
      if (clipEnd >= clipStart) {
        const clip = el("clipPath", {
          id: `timeline-clip-${v.prefix}`,
          clipPathUnits: "userSpaceOnUse",
        });
        const bounds = document.createElementNS(ns, "rect");
        for (const [key, value] of Object.entries({
          x: clipStart,
          y,
          width: Math.max(1, clipEnd - clipStart),
          height: 46,
          rx: 4,
        })) {
          bounds.setAttribute(key, String(value));
        }
        clip.append(bounds);
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
            y: y + 23,
            "dominant-baseline": "middle",
            class: "clip-name",
            "pointer-events": "none",
          },
          p.name.length > 30 ? `${p.name.slice(0, 28)}…` : p.name,
        );
      }
      const start = required(p.times[v.first]) + v.offset;
      const end = required(p.times[v.last]) + v.offset;
      const sx = Math.max(TRACK_LEFT, X(start));
      const ex = Math.min(width - TRACK_RIGHT, X(end));
      if (ex >= sx) {
        el("rect", {
          x: sx,
          y,
          width: Math.max(2, ex - sx),
          height: 46,
          class: "tracking-range",
          "clip-path": `url(#timeline-clip-${v.prefix})`,
          "pointer-events": "none",
        });
      }
      for (const [kind, t, frame] of [
        ["start", start, v.first],
        ["end", end, v.last],
      ] as const) {
        const x = X(t);
        if (x < TRACK_LEFT || x > width - TRACK_RIGHT) {
          continue;
        }
        const handle = el("g", {
          class: `range-handle ${v.prefix} ${this.drag?.view === v && this.drag.kind === kind ? "dragging" : ""}`,
          "data-kind": kind,
          "data-view": v.prefix,
          role: "slider",
          tabindex: 0,
          "aria-label": `${v.prefix.toUpperCase()} range ${kind}, frame ${frame}`,
          "aria-valuemin": 0,
          "aria-valuemax": p.times.length - 1,
          "aria-valuenow": frame,
        });
        const direction = kind === "start" ? 1 : -1;
        const hit = document.createElementNS(ns, "rect");
        for (const [key, value] of Object.entries({
          x: x + direction * 5 - 12,
          y: y + 7 - 12,
          width: 24,
          height: 24,
          class: "handle-hit",
        })) {
          hit.setAttribute(key, String(value));
        }
        const body = document.createElementNS(ns, "path");
        body.setAttribute(
          "d",
          `M${x},${y} h${direction * 10} v7 l${direction * -10},7 Z`,
        );
        body.setAttribute("class", "trim-body");
        body.setAttribute("clip-path", `url(#timeline-clip-${v.prefix})`);
        handle.append(hit, body);
        if (ex - sx >= 120) {
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
      }
      if (ex >= sx && ex - sx < 120) {
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
      }
      const mark = (t: number, cls: string, label: string) => {
        const x = X(t);
        if (x < TRACK_LEFT || x > width - TRACK_RIGHT) {
          return;
        }
        const node = el("path", {
          d: `M${x - 4},${y - 5} L${x},${y - 11} L${x + 4},${y - 5} L${x},${y + 1}Z`,
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
      for (const s of p.samples) {
        if (!s.valid) {
          const x = X(s.t + v.offset);
          if (x >= TRACK_LEFT && x <= width - TRACK_RIGHT) {
            el("line", {
              x1: x,
              x2: x,
              y1: y + 42,
              y2: y + 51,
              class: "weak-mark",
            });
          }
        }
      }
      for (const a of p.anchors.slice(1)) {
        mark(
          required(p.times[a.frame]) + v.offset,
          "correction-marker",
          `${v.prefix.toUpperCase()} correction at frame ${a.frame}`,
        );
      }
      if (v.sync !== null) {
        mark(
          required(p.times[v.sync]) + v.offset,
          "sync-marker",
          `${v.prefix.toUpperCase()} sync point at frame ${v.sync}`,
        );
      }
    }
    const x = X(this.time());
    if (x >= TRACK_LEFT && x <= width - TRACK_RIGHT) {
      el("line", { x1: x, x2: x, y1: 22, y2: height, class: "playhead" });
      // Above the tracks: the visible playhead remains a scrub target all the way down.
      el("rect", {
        x: x - 6,
        y: 36,
        width: 12,
        height: Math.max(0, height - 36),
        class: "playhead-hit",
        "data-kind": "scrub",
      });
      el("path", {
        d: `M${x - 5},22 L${x + 5},22 L${x},29Z`,
        class: "playhead-head",
        "pointer-events": "none",
      });
    }
    const children = [...svg.children];
    for (const node of children) {
      if (!used.has(node)) {
        node.remove();
      }
    }
    const full = this.full();
    const span = max - min;
    const space = Math.max(0, full[1] - full[0] - span);
    const pan = $("timeline-pan");
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
      requestAnimationFrame(() => {
        this.updating = false;
      });
    }
    if (focused?.kind !== undefined && focused.kind !== "") {
      svg
        .querySelector<SVGElement>(
          `[data-kind="${focused.kind}"]${focused.view !== undefined && focused.view !== "" ? `[data-view="${focused.view}"]` : ""}`,
        )
        ?.focus({ preventScroll: true });
    }
  }
}
