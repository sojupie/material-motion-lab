export const LEFT = 64;
export const RIGHT = 48;
export const TRACK_LEFT = 32;
export const TRACK_RIGHT = 28;
export const SVG_NAMESPACE = "http://www.w3.org/2000/svg";
type SvgWriter = (
  tag: string,
  attrs: Record<string, string | number>,
  text?: string,
) => SVGElement;
export function renderTimeRuler({
  el,
  width,
  height,
  bounds: [min, max],
  x: X,
  playback,
  full,
  dragKind,
}: {
  el: SvgWriter;
  width: number;
  height: number;
  bounds: [number, number];
  x: (time: number) => number;
  playback: [number, number];
  full: [number, number];
  dragKind: string | undefined;
}) {
  const ns = SVG_NAMESPACE;
  el("rect", {
    x: TRACK_LEFT,
    y: 0,
    width: width - TRACK_LEFT - TRACK_RIGHT,
    height: 35,
    class: "time-ruler",
    "data-kind": "scrub",
  });
  const count = width < 500 ? 3 : 6;
  for (let i = 0; i <= count; i++) {
    const t = min + ((max - min) * i) / count;
    const x = X(t);
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
  const [playStart, playEnd] = playback;
  el("rect", {
    x: Math.max(TRACK_LEFT, X(playStart)),
    y: 21,
    width: Math.max(
      0,
      Math.min(width - TRACK_RIGHT, X(playEnd)) -
        Math.max(TRACK_LEFT, X(playStart)),
    ),
    height: 14,
    class: "playback-band",
    "pointer-events": "none",
  });
  for (const [edge, t] of [
    ["start", playStart],
    ["end", playEnd],
  ] as const) {
    const x = X(t);
    if (x < TRACK_LEFT || x > width - TRACK_RIGHT) {
      continue;
    }
    const handle = el("g", {
      class: `playback-handle ${dragKind === `playback-${edge}` ? "dragging" : ""}`,
      "data-kind": `playback-${edge}`,
      role: "slider",
      tabindex: 0,
      "aria-label": `Playback ${edge}`,
      "aria-valuemin": full[0],
      "aria-valuemax": full[1],
      "aria-valuenow": t,
      "aria-valuetext": `${(t / 1000).toFixed(3)} seconds`,
    });
    const shape = (tag: string, attrs: Record<string, string | number>) => {
      const node = document.createElementNS(ns, tag);
      for (const [key, value] of Object.entries(attrs)) {
        node.setAttribute(key, String(value));
      }
      handle.append(node);
    };
    const direction = edge === "start" ? 1 : -1;
    shape("rect", {
      x: x + (edge === "start" ? 5 : -5) - 12,
      y: 16,
      width: 24,
      height: 24,
      class: "handle-hit",
    });
    shape("path", {
      d: `M${x},21 h${direction * 10} v7 l${direction * -10},7 Z`,
      class: "playback-flag",
    });
  }
}
