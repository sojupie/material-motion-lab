import "./style.css";
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
document.querySelector("#app")!.innerHTML = `
<header><h1>UI Motion</h1><div><button id="import" class="primary">Open video</button><input id="file" type="file" accept="video/*,.gif" hidden></div></header>
<div id="status" role="status" aria-live="polite">Open a video to begin.</div>
<div class="shell"><aside><h2>Recordings</h2><div id="projects"></div></aside><main>
<section id="empty"><h2>Measure motion from video</h2><p>Open a recording, draw around an object or edge, and track its movement.</p><p class="muted">Videos and measurements stay on this machine.</p></section>
<div id="workspace" hidden><h2 id="name" class="filename"></h2>
<div class="stage-grid"><section class="panel">
<div class="image-wrap"><canvas id="frame" aria-label="Video frame. Drag to select a tracking region."></canvas></div>
<div class="transport"><button id="prev" class="outline" aria-label="Previous frame">Previous</button><button id="play" class="primary">Play</button><button id="next" class="outline" aria-label="Next frame">Next</button><span id="time" class="time"></span></div>
<input id="scrub" type="range" min="0" value="0" step="1" aria-label="Video frame">
<div class="transport"><button id="zero" class="outline">Set time zero here</button><label class="zoom-label">Zoom <select id="zoom"><option value="fit">Fit</option><option value="1">100%</option><option value="2">200%</option><option value="4">400%</option></select></label><span id="quality" class="badge" hidden></span></div>

</section><section class="panel controls"><h3>Track position</h3><p id="selection" class="help">Draw a region on the frame.</p>
<div><label for="end">Last frame</label><input id="end" type="number" min="0" step="1"></div>
<div><label for="search">Search distance per frame (px)</label><input id="search" type="number" value="60" min="4" max="1000" step="1"></div>
<button id="track" class="primary" disabled>Track from this frame</button><button id="correct" class="outline" disabled>Correct position here</button>
<p class="help">Tracking follows the selected patch. It measures translation, not changes in shape or opacity. Weak matches leave gaps in the graph.</p>
<div class="actions"><button id="json" class="outline" disabled>Save JSON</button><button id="csv" class="outline" disabled>Save CSV</button><button id="export" class="outline" disabled>Export video</button></div>
</section>
<section class="panel graph-panel"><h2>Position over time</h2><div class="graph-controls">
<div><label for="axis">Position</label><select id="axis"><option value="x">Horizontal</option><option value="y">Vertical</option></select></div>
<div><label for="reference">Compare recording</label><select id="reference"><option value="">None</option></select></div>
<div id="ref-control" hidden><label for="refzero">Comparison zero frame</label><input id="refzero" type="number" min="0" step="1" value="0"></div>
</div><p id="graph-note" class="help">Track a region to plot its position.</p><div class="graph-wrap"><svg id="graph" viewBox="0 0 1000 270" role="img" aria-label="Tracked displacement against time"></svg></div>
<div class="legend"><span id="main-legend">Current recording</span><span id="ref-legend" class="ref" hidden>Comparison</span></div>
</section></div></div></main></div><footer>Coordinates use recording pixels. Times use the original video frame timestamps.</footer>`;
let project: Project | null = null,
  reference: Project | null = null,
  entries: Entry[] = [],
  index = 0,
  roi: Region | null = null;
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
  $<HTMLInputElement>("scrub").disabled = busy;
  for (const id of ["track", "correct"])
    $<HTMLButtonElement>(id).disabled =
      busy || !roi || !ready || (id === "correct" && !project?.samples.length);
  for (const id of ["json", "csv", "export"])
    $<HTMLButtonElement>(id).disabled = busy || !project?.samples.length;
}
async function refresh() {
  entries = await api<Entry[]>("/projects");
  $("projects").replaceChildren();
  for (const item of entries) {
    const b = document.createElement("button");
    b.textContent = item.name;
    b.setAttribute("aria-current", String(project?.id === item.id));
    b.onclick = () => job(() => open(item.id));
    $("projects").append(b);
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
  project = await api<Project>("/projects/" + id);
  reference = null;
  index = 0;
  roi = null;
  picture = null;
  cache.clear();
  $("empty").hidden = true;
  $("workspace").hidden = false;
  $("name").textContent = project.name;
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
  if (project.comparison) {
    reference = await api<Project>("/projects/" + project.comparison.id);
    $<HTMLSelectElement>("reference").value = reference.id;
    comparisonControls(project.comparison.zeroFrame);
  }
  await show(0);
  status(
    project.samples.length
      ? "Tracking loaded. Click the graph or step through the frames to inspect it."
      : `${project.times.length} frames. Draw a region to track.`,
  );
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
  canvas.style.width =
    value === "fit"
      ? `min(100%, ${(28 * project.width) / project.height}vh)`
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
$<HTMLInputElement>("scrub").oninput = (e) =>
  seek(Number((e.target as HTMLInputElement).value));
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
let domain = { min: 0, max: 1 };
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
  if (!vals.length) {
    $("graph-note").textContent = "Track a region to plot its position.";
    return;
  }
  const minT = Math.min(0, ...all.map((s) => s.t)),
    maxT = Math.max(minT + 1, ...all.map((s) => s.t));
  domain = { min: minT, max: maxT };
  let minY = Math.min(0, ...vals),
    maxY = Math.max(0, ...vals);
  const pad = Math.max(2, (maxY - minY) * 0.1);
  minY -= pad;
  maxY += pad;
  const X = (t: number) => 65 + ((t - minT) / (maxT - minT)) * 910,
    Y = (v: number) => 220 - ((v - minY) / (maxY - minY)) * 195;
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
  for (let i = 0; i <= 5; i++) {
    const t = minT + ((maxT - minT) * i) / 5,
      x = X(t);
    el("line", { x1: x, x2: x, y1: 20, y2: 220, class: "grid" });
    el(
      "text",
      { x, y: 243, "text-anchor": "middle", class: "tick" },
      String(Math.round(t)),
    );
  }
  for (let i = 0; i <= 4; i++) {
    const v = minY + ((maxY - minY) * i) / 4,
      y = Y(v);
    el("line", { x1: 65, x2: 975, y1: y, y2: y, class: "grid" });
    el(
      "text",
      { x: 55, y: y + 4, "text-anchor": "end", class: "tick" },
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
  el("line", { x1: X(time), x2: X(time), y1: 20, y2: 220, class: "playhead" });
  el(
    "text",
    { x: 520, y: 267, "text-anchor": "middle", class: "tick" },
    "Time from selected zero (ms)",
  );
  $("graph-note").textContent =
    `${axis === "x" ? "Horizontal" : "Vertical"} displacement (recording px). Zero: frame ${project.zeroFrame}. Click the graph to inspect a frame.`;
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
    x = ((e.clientX - rect.left) / rect.width) * 1000;
  const t =
    domain.min +
    ((x - 65) / 910) * (domain.max - domain.min) +
    project.times[project.zeroFrame];
  let best = 0;
  for (let i = 1; i < project.times.length; i++)
    if (Math.abs(project.times[i] - t) < Math.abs(project.times[best] - t))
      best = i;
  seek(best);
};
void refresh().catch((e) => status(e.message, true));
buttons();
