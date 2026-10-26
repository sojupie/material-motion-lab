import "./style.css";
import { installMaterialControls, syncMaterialControls } from "./material";
type Region = [number, number, number, number];
type Sample = {
  frame: number;
  t: number;
  x: number | null;
  y: number | null;
  width: number;
  height: number;
  score: number;
  valid: boolean;
  manual: boolean;
};
type Anchor = { frame: number; region: Region };
type Project = {
  comparison?: { id: string; zeroFrame: number } | null;
  id: string;
  name: string;
  width: number;
  height: number;
  times: number[];
  zeroFrame: number;
  selection: Region | null;
  anchors: Anchor[];
  samples: Sample[];
  settings: {
    start?: number;
    end?: number;
    search?: number;
    threshold?: number;
  };
};
type Entry = { id: string; name: string };
const $ = <T extends HTMLElement = HTMLElement>(id: string) =>
  document.getElementById(id) as T;
let project: Project | null = null,
  reference: Project | null = null,
  entries: Entry[] = [],
  index = 0,
  roi: Region | null = null;
let settingFrame = false;
let playing = false,
  busy = false,
  startClock = 0,
  startTime = 0,
  paintVersion = 0;
let drag: { x: number; y: number } | null = null;
const canvas = $<HTMLCanvasElement>("frame"),
  ctx = canvas.getContext("2d")!;
let picture: HTMLImageElement | null = null;
const cache = new Map<string, Promise<HTMLImageElement>>();
function status(message: string, error = false) {
  $("status").textContent = message;
  $("status").classList.toggle("error", error);
}
async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch("/api" + url, options);
  if (!response.ok) {
    let text = `Request failed (${response.status})`;
    try {
      text = (await response.json()).detail || text;
    } catch {}
    throw Error(typeof text === "string" ? text : JSON.stringify(text));
  }
  return response.json();
}
async function job(fn: () => Promise<void>) {
  if (busy) return;
  pause();
  busy = true;
  document.body.setAttribute("aria-busy", "true");
  buttons();
  try {
    await fn();
  } catch (e) {
    status(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    document.body.removeAttribute("aria-busy");
    buttons();
  }
}
function post<T>(path: string, data: unknown) {
  return api<T>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}
function buttons() {
  const ready = !!project;
  for (const id of ["prev", "next", "play", "zero"])
    $<HTMLButtonElement>(id).disabled = busy || !ready;
  $<HTMLButtonElement>("import").disabled = busy;
  $<HTMLButtonElement>("empty-import").disabled = busy;
  $("export-note").hidden = !!project?.samples.length;
  $<HTMLInputElement>("scrub").disabled = busy;
  for (const id of ["track", "correct"])
    $<HTMLButtonElement>(id).disabled =
      busy || !roi || !ready || (id === "correct" && !project?.samples.length);
  for (const id of ["json", "csv", "export"])
    $<HTMLButtonElement>(id).disabled = busy || !project?.samples.length;
  for (const control of document.querySelectorAll<
    HTMLSelectElement | HTMLInputElement
  >("select,input[type=number]"))
    control.disabled = busy;
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    "[data-navigation-item]",
  ))
    button.disabled = busy;
  syncMaterialControls();
}
async function refresh() {
  entries = await api<Entry[]>("/projects");
  const focused = document.activeElement as HTMLElement | null;
  const focusId = focused?.dataset.projectId;
  const focusGroup = focused?.closest(".md-nav-items")?.id;
  for (const group of ["projects", "mobile-projects"]) {
    $(group).replaceChildren();
    for (const item of entries) {
      const template = $<HTMLTemplateElement>("recording-item-template");
      const button = template.content.firstElementChild!.cloneNode(
        true,
      ) as HTMLButtonElement;
      button.dataset.projectId = item.id;
      button.title = item.name;
      button.querySelector(".md-nav-label")!.textContent = item.name;
      if (project?.id === item.id) button.setAttribute("aria-current", "page");
      button.onclick = async () => {
        const restoreFocus =
          group === "projects" && document.activeElement === button;
        await job(() => open(item.id));
        for (const navItem of document.querySelectorAll<HTMLButtonElement>(
          "[data-navigation-item]",
        )) {
          if (navItem.dataset.projectId === project?.id)
            navItem.setAttribute("aria-current", "page");
          else navItem.removeAttribute("aria-current");
        }
        if (restoreFocus)
          for (const next of $("projects").querySelectorAll<HTMLButtonElement>(
            "[data-navigation-item]",
          ))
            if (next.dataset.projectId === item.id)
              next.focus({ preventScroll: true });
      };
      $(group).append(button);
      if (group === focusGroup && item.id === focusId)
        button.focus({ preventScroll: true });
    }
  }
  const selected = $<HTMLSelectElement>("reference").value;
  $("reference").replaceChildren(
    new Option("None", ""),
    ...entries
      .filter((e) => e.id !== project?.id)
      .map((e) => new Option(e.name, e.id)),
  );
  $<HTMLSelectElement>("reference").value = selected;
}
async function open(id: string) {
  status("Opening recording…");
  project = await api<Project>("/projects/" + id);
  reference = null;
  index = 0;
  roi = null;
  picture = null;
  cache.clear();
  $("empty").hidden = true;
  $("workspace").hidden = false;
  $("name").textContent = project.name;
  $("name").hidden = false;
  $("recording-meta").hidden = false;
  $("recording-meta").textContent =
    `${project.width} × ${project.height} px, ${project.times.length} frames`;
  $<HTMLInputElement>("scrub").max = String(project.times.length - 1);
  $<HTMLInputElement>("end").value = String(
    project.settings.end ?? project.times.length - 1,
  );
  $<HTMLInputElement>("end").max = String(project.times.length - 1);
  $<HTMLInputElement>("search").value = String(project.settings.search ?? 60);
  $("selection").textContent = "Draw a region on the frame.";
  $("ref-control").hidden = true;
  $("ref-legend").hidden = true;
  await refresh();
  syncMaterialControls();
  if (project.comparison) {
    reference = await api<Project>("/projects/" + project.comparison.id);
    $<HTMLSelectElement>("reference").value = reference.id;
    comparisonControls(project.comparison.zeroFrame);
  }
  await show(0);
  status("");
  buttons();
}
function getPicture(i: number) {
  const key = project!.id + ":" + i;
  let result = cache.get(key);
  if (!result) {
    const id = project!.id;
    result = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => {
        cache.delete(key);
        reject(Error("Frame failed to load"));
      };
      img.src = `/api/projects/${id}/frames/${i}`;
    });
    cache.set(key, result);
    if (cache.size > 90) cache.delete(cache.keys().next().value!);
  }
  return result;
}
function overlay() {
  if (!project || !picture) return;
  ctx.drawImage(picture, 0, 0, canvas.width, canvas.height);
  const sample = project.samples.find((s) => s.frame === index);
  const boxes: { r: Region; color: string }[] = [];
  if (sample?.valid)
    boxes.push({
      r: [sample.x!, sample.y!, sample.width, sample.height],
      color: "#39d877",
    });
  if (roi) boxes.push({ r: roi, color: "#ffd54f" });
  for (const { r, color } of boxes) {
    ctx.lineWidth = Math.max(2, project.width / 500);
    ctx.strokeStyle = "#171717";
    ctx.strokeRect(r[0] - 1, r[1] - 1, r[2] + 2, r[3] + 2);
    ctx.strokeStyle = color;
    ctx.strokeRect(...r);
  }
}
async function show(i: number) {
  if (!project) return;
  index = Math.max(0, Math.min(project.times.length - 1, i));
  $<HTMLInputElement>("scrub").value = String(index);
  settingFrame = true;
  $("scrub").dispatchEvent(new Event("input", { bubbles: true }));
  settingFrame = false;
  $("time").textContent =
    `Frame ${index} / ${project.times.length - 1}   ${(project.times[index] / 1000).toFixed(3)} s   ${(project.times[index] - project.times[project.zeroFrame]).toFixed(1)} ms`;
  const sample = project.samples.find((s) => s.frame === index);
  $("quality").hidden = !sample;
  $("quality").textContent = sample
    ? sample.valid
      ? `Match ${Math.round(sample.score * 100)}%${sample.manual ? " (marked)" : ""}`
      : "Tracking lost"
    : "";
  const version = ++paintVersion;
  const img = await getPicture(index);
  if (version !== paintVersion) return;
  picture = img;
  canvas.width = project.width;
  canvas.height = project.height;
  zoom();
  overlay();
  graph();
  for (
    let n = index + 1;
    n <= Math.min(index + 5, project.times.length - 1);
    n++
  )
    void getPicture(n).catch(() => {});
}
function zoom() {
  if (!project) return;
  const value = $<HTMLSelectElement>("zoom").value;
  const wrap = canvas.parentElement!;
  const scale = Math.min(
    wrap.clientWidth / project.width,
    wrap.clientHeight / project.height,
  );
  canvas.style.width =
    value === "fit"
      ? `${Math.max(1, scale * project.width)}px`
      : `${project.width * Number(value)}px`;
}
$("zoom").onchange = zoom;
function pause() {
  playing = false;
  $("play").textContent = "Play";
}
function animate(now: number) {
  if (!playing || !project) return;
  const elapsed = startTime + now - startClock;
  let next = index;
  while (next + 1 < project.times.length && project.times[next + 1] <= elapsed)
    next++;
  if (next !== index)
    void show(next).catch((e) => {
      pause();
      status(e.message, true);
    });
  if (next === project.times.length - 1) {
    pause();
    return;
  }
  requestAnimationFrame(animate);
}
$("play").onclick = () => {
  if (playing) {
    pause();
    return;
  }
  if (!project) return;
  if (index === project.times.length - 1) index = 0;
  playing = true;
  startClock = performance.now();
  startTime = project.times[index];
  $("play").textContent = "Pause";
  requestAnimationFrame(animate);
};
function seek(i: number) {
  pause();
  roi = null;
  buttons();
  void show(i).catch((e) => status(e.message, true));
}
$("prev").onclick = () => seek(index - 1);
$("next").onclick = () => seek(index + 1);
$<HTMLInputElement>("scrub").oninput = (e) => {
  if (!settingFrame) seek(Number((e.target as HTMLInputElement).value));
};
document.addEventListener("keydown", (e) => {
  if (
    (e.target as HTMLElement).matches("input,select,button") ||
    !project ||
    busy
  )
    return;
  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    seek(index + (e.key === "ArrowLeft" ? -1 : 1));
  }
});
function point(e: PointerEvent) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: Math.max(
      0,
      Math.min(
        canvas.width,
        ((e.clientX - rect.left) / rect.width) * canvas.width,
      ),
    ),
    y: Math.max(
      0,
      Math.min(
        canvas.height,
        ((e.clientY - rect.top) / rect.height) * canvas.height,
      ),
    ),
  };
}
canvas.onpointerdown = (e) => {
  if (!project || busy) return;
  pause();
  drag = point(e);
  canvas.setPointerCapture(e.pointerId);
};
canvas.onpointermove = (e) => {
  if (!drag) return;
  const p = point(e);
  roi = [
    Math.round(Math.min(drag.x, p.x)),
    Math.round(Math.min(drag.y, p.y)),
    Math.round(Math.abs(p.x - drag.x)),
    Math.round(Math.abs(p.y - drag.y)),
  ];
  overlay();
};
canvas.onpointerup = () => {
  drag = null;
  if (roi && (roi[2] < 4 || roi[3] < 4)) roi = null;
  $("selection").textContent = roi
    ? `Frame ${index}: x ${roi[0]}, y ${roi[1]}, ${roi[2]} × ${roi[3]} px`
    : "Select a region at least 4 × 4 px.";
  buttons();
};
canvas.onpointercancel = () => {
  drag = null;
  roi = null;
  overlay();
  buttons();
};
async function runTrack(correct: boolean) {
  if (!project || !roi) return;
  const selected = roi;
  let anchors: Anchor[] = [],
    start = index,
    end = Number($<HTMLInputElement>("end").value),
    selection = selected;
  if (correct) {
    start = project.settings.start!;
    end = project.settings.end!;
    if (index < start || index > end)
      throw Error("Choose a frame inside the tracked interval.");
    anchors = project.anchors.filter((a) => a.frame !== index);
    anchors.push({ frame: index, region: selected });
    selection = index === start ? selected : project.selection!;
  }
  status(
    correct
      ? "Applying correction and tracking again…"
      : "Tracking selected region…",
  );
  project = await post<Project>(`/projects/${project.id}/track`, {
    region: selection,
    start,
    end,
    anchors,
    search: Number($<HTMLInputElement>("search").value),
  });
  roi = null;
  await show(index);
  const lost = project.samples.filter((s) => !s.valid).length;
  status(
    `Tracked ${project.samples.length} frames. ${lost ? `${lost} weak matches. Mark a corrected region on those frames.` : "No weak matches."}`,
  );
}
$("track").onclick = () => job(() => runTrack(false));
$("correct").onclick = () => job(() => runTrack(true));
$("zero").onclick = () =>
  job(async () => {
    if (!project) return;
    project = await post<Project>(`/projects/${project.id}/zero`, {
      frame: index,
    });
    await show(index);
    status(`Time zero set to frame ${index}.`);
  });
$("import").onclick = () => $<HTMLInputElement>("file").click();
$("empty-import").onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = () =>
  job(async () => {
    const file = $<HTMLInputElement>("file").files?.[0];
    if (!file) return;
    status("Importing video and extracting frames…");
    const form = new FormData();
    form.append("file", file);
    const result = await api<Project>("/import", {
      method: "POST",
      body: form,
    });
    await open(result.id);
    $<HTMLInputElement>("file").value = "";
  });
for (const [id, kind] of [
  ["json", "json"],
  ["csv", "csv"],
  ["export", "video"],
])
  $(id).onclick = () =>
    job(async () => {
      if (!project) return;
      status(
        kind === "video"
          ? "Rendering annotated video…"
          : "Preparing measurements…",
      );
      const response = await fetch(
        `/api/projects/${project.id}/download/${kind}?axis=${$<HTMLSelectElement>("axis").value}`,
      );
      if (!response.ok) {
        const e = await response.json();
        throw Error(e.detail || "Export failed");
      }
      const blob = await response.blob(),
        url = URL.createObjectURL(blob),
        a = document.createElement("a");
      a.href = url;
      a.download =
        kind === "video"
          ? "annotated.mp4"
          : kind === "csv"
            ? "measurements.csv"
            : "project.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 30000);
      status("Export ready.");
    });
let domain = { min: 0, max: 1, width: 1000, left: 52, right: 16 };
function series(p: Project, axis: "x" | "y", zero: number) {
  const valid = p.samples.filter((s) => s.valid);
  const origin = valid.findLast((s) => s.frame <= zero) ?? valid[0];
  return p.samples.map((s) => ({
    frame: s.frame,
    t: s.t - p.times[zero],
    v: s.valid && origin ? s[axis]! - origin[axis]! : null,
  }));
}
function graph() {
  if (!project) return;
  const svg = $("graph"),
    axis = $<HTMLSelectElement>("axis").value as "x" | "y",
    main = series(project, axis, project.zeroFrame),
    ref = reference
      ? series(reference, axis, Number($<HTMLInputElement>("refzero").value))
      : [];
  const all = [...main, ...ref],
    vals = all.filter((s) => s.v !== null).map((s) => s.v!);
  svg.replaceChildren();
  svg.toggleAttribute("hidden", !vals.length);
  $("main-legend").parentElement!.hidden = !vals.length;
  if (!vals.length) {
    $("graph-note").textContent = "Track a region to plot its position.";
    return;
  }
  const minT = Math.min(0, ...all.map((s) => s.t)),
    maxT = Math.max(minT + 1, ...all.map((s) => s.t));
  const width = Math.max(240, svg.parentElement!.clientWidth),
    left = 52,
    right = 16;
  svg.setAttribute("viewBox", `0 0 ${width} 200`);
  domain = { min: minT, max: maxT, width, left, right };
  let minY = Math.min(0, ...vals),
    maxY = Math.max(0, ...vals);
  const pad = Math.max(2, (maxY - minY) * 0.1);
  minY -= pad;
  maxY += pad;
  const X = (t: number) =>
      left + ((t - minT) / (maxT - minT)) * (width - left - right),
    Y = (v: number) => 150 - ((v - minY) / (maxY - minY)) * 130;
  const ns = "http://www.w3.org/2000/svg";
  function el(
    tag: string,
    attrs: Record<string, string | number>,
    text?: string,
  ) {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
    if (text) e.textContent = text;
    svg.append(e);
    return e;
  }
  el("text", { x: left, y: 13, class: "tick" }, "Displacement (recording px)");
  const ticks = width < 480 ? 3 : 5;
  for (let i = 0; i <= ticks; i++) {
    const t = minT + ((maxT - minT) * i) / ticks,
      x = X(t);
    el("line", { x1: x, x2: x, y1: 20, y2: 150, class: "grid" });
    el(
      "text",
      {
        x,
        y: 174,
        "text-anchor": i === ticks ? "end" : i === 0 ? "start" : "middle",
        class: "tick",
      },
      String(Math.round(t)),
    );
  }
  for (let i = 0; i <= 4; i++) {
    const v = minY + ((maxY - minY) * i) / 4,
      y = Y(v);
    el("line", { x1: left, x2: width - right, y1: y, y2: y, class: "grid" });
    el(
      "text",
      { x: left - 8, y: y + 4, "text-anchor": "end", class: "tick" },
      v.toFixed(1),
    );
  }
  function path(data: ReturnType<typeof series>, name: string) {
    let d = "",
      pen = false;
    for (const s of data) {
      if (s.v === null) {
        pen = false;
        continue;
      }
      d += (pen ? "L" : "M") + `${X(s.t)},${Y(s.v)}`;
      pen = true;
    }
    el("path", { d, class: name });
    for (const s of data)
      if (s.v !== null)
        el("circle", {
          cx: X(s.t),
          cy: Y(s.v),
          r: 2,
          fill:
            name === "trace"
              ? "var(--md-sys-color-primary)"
              : "var(--md-sys-color-tertiary)",
        });
  }
  path(main, "trace");
  if (reference) path(ref, "reference");
  const time = project.times[index] - project.times[project.zeroFrame];
  el("line", { x1: X(time), x2: X(time), y1: 20, y2: 150, class: "playhead" });
  el(
    "text",
    { x: width / 2, y: 194, "text-anchor": "middle", class: "tick" },
    "Time from selected zero (ms)",
  );
  $("graph-note").textContent =
    `Time zero: frame ${project.zeroFrame}. Click the graph to inspect a frame.`;
}
$("axis").onchange = graph;
function comparisonControls(zero: number) {
  $("ref-control").hidden = !reference;
  $("ref-legend").hidden = !reference;
  if (reference) {
    $<HTMLInputElement>("refzero").value = String(zero);
    $<HTMLInputElement>("refzero").max = String(reference.times.length - 1);
    $("ref-legend").textContent = reference.name;
  }
}
async function saveComparison() {
  if (!project) return;
  project = await post<Project>(`/projects/${project.id}/comparison`, {
    reference: reference?.id ?? null,
    zero: Number($<HTMLInputElement>("refzero").value) || 0,
  });
}
$("reference").onchange = () =>
  job(async () => {
    const id = $<HTMLSelectElement>("reference").value;
    reference = id ? await api<Project>("/projects/" + id) : null;
    $("ref-control").hidden = !reference;
    $("ref-legend").hidden = !reference;
    if (reference) {
      $<HTMLInputElement>("refzero").value = String(reference.zeroFrame);
      $<HTMLInputElement>("refzero").max = String(reference.times.length - 1);
      $("ref-legend").textContent = reference.name;
      status(
        reference.samples.length
          ? "Comparison loaded. Adjust its zero frame to align the events."
          : "This recording has no tracking measurements yet.",
      );
    }
    await saveComparison();
    graph();
  });
$("refzero").onchange = () =>
  job(async () => {
    if (!reference) return;
    const input = $<HTMLInputElement>("refzero");
    input.value = String(
      Math.max(
        0,
        Math.min(
          reference.times.length - 1,
          Math.round(Number(input.value) || 0),
        ),
      ),
    );
    await saveComparison();
    graph();
  });
$("graph").onclick = (e) => {
  if (!project || !project.samples.length) return;
  const rect = $("graph").getBoundingClientRect(),
    x = ((e.clientX - rect.left) / rect.width) * domain.width;
  const t =
    domain.min +
    ((x - domain.left) / (domain.width - domain.left - domain.right)) *
      (domain.max - domain.min) +
    project.times[project.zeroFrame];
  let best = 0;
  for (let i = 1; i < project.times.length; i++)
    if (Math.abs(project.times[i] - t) < Math.abs(project.times[best] - t))
      best = i;
  seek(best);
};
void installMaterialControls()
  .then(() => refresh())
  .then(() => buttons())
  .catch((e) => status(e.message, true));

matchMedia("(min-width: 1280px)").addEventListener("change", (event) => {
  if (event.matches) {
    const drawer = $<HTMLDialogElement>("recording-drawer");
    if (drawer.open) drawer.close();
  }
});

new ResizeObserver(() => {
  zoom();
  graph();
}).observe(canvas.parentElement!);
new ResizeObserver(() => graph()).observe($("graph").parentElement!);
