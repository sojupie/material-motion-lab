import "./style.css";
import { $, api } from "./api";
import { installMaterialControls, syncMaterialControls } from "./material";
import {
  sourceFrame,
  alignedOffset,
  snapTime,
  playbackPosition,
  workspaceFrame,
} from "./timing";
import { VideoView, type ViewActions } from "./video";
import { Timeline } from "./timeline";
import { WorkspaceLayout } from "./layout";
import { MotionGraph } from "./graph";
import type { Entry, Project, Workspace, Playback } from "./types";
let busy = false,
  time = 0,
  playing = false,
  playbackToken = 0,
  clock = 0,
  startTime = 0,
  endHold = 1000 / 60,
  entries: Entry[] = [],
  selected: VideoView;
let playback: Playback = { range: null, speed: 1, loop: false };
let saveChain: Promise<unknown> = Promise.resolve();
function status(text: string, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function playButton(active: boolean) {
  const button = $("play");
  button.setAttribute("aria-label", active ? "Pause" : "Play");
  button.title = active ? "Pause" : "Play";
  const label = button.querySelector("[data-transport-label]");
  if (label) label.textContent = active ? "Pause" : "Play";
  button
    .querySelector("svg path")!
    .setAttribute(
      "d",
      active
        ? "M280-200v-560h160v560H280Zm240 0v-560h160v560H520Z"
        : "M320-200v-560l440 280-440 280Z",
    );
}
function pause() {
  playing = false;
  playbackToken++;
  playButton(false);
}
async function job(fn: () => Promise<void>) {
  if (busy) return;
  pause();
  busy = true;
  document.body.setAttribute("aria-busy", "true");
  controls();
  try {
    await fn();
  } catch (e) {
    status(e instanceof Error ? e.message : String(e), true);
  } finally {
    busy = false;
    document.body.removeAttribute("aria-busy");
    controls();
  }
}
const actions: ViewActions = {
  export: exportMedia,
  exportRange: (v) => {
    const range = playbackRange();
    const times = v.project!.times;
    if (range[1] < times[0] + v.offset || range[0] > times.at(-1)! + v.offset)
      throw Error("Playback interval does not overlap this video.");
    return [
      sourceFrame(times, v.offset, range[0]),
      sourceFrame(times, v.offset, range[1]),
    ];
  },
  seek: (v, i) => seekFrame(v, i),
  select: selectVideo,
  change: () => changed(true),
  job,
  message: status,
};
const a = new VideoView("a", actions),
  b = new VideoView("b", actions);
selected = a;
const views = () => [a, b];
const timeline = new Timeline(
  views,
  () => time,
  () => selected,
  (t) => seek(t),
  selectVideo,
  changed,
  playbackRange,
  setPlaybackEdge,
);
const graph = new MotionGraph(
  views,
  (t) => seek(t),
  () => timeline.bounds(),
  () => time,
  selectVideo,
  (bounds) => {
    timeline.window = bounds;
    changed(false);
  },
);
const layout = new WorkspaceLayout(() => {
  timeline.paint();
  graph.paint();
  if (selected.project) inspector();
});
const exportDialog = $<HTMLDialogElement>("export-dialog");
let previewTimer: ReturnType<typeof setTimeout> | undefined,
  previewRequest: AbortController | undefined,
  previewURL: string | undefined;
async function renderExportPreview() {
  const v = exportVideo();
  if (
    !v.project ||
    !exportDialog.open ||
    $<HTMLSelectElement>("export-format").value !== "video"
  )
    return;
  previewRequest?.abort();
  const request = (previewRequest = new AbortController());
  try {
    const response = await fetch(
      `/api/projects/${v.project.id}/export/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(exportOptions(v)),
        signal: request.signal,
      },
    );
    if (!response.ok)
      throw Error((await response.json()).detail || "Preview failed");
    const url = URL.createObjectURL(await response.blob());
    if (request.signal.aborted || !exportDialog.open) {
      URL.revokeObjectURL(url);
      return;
    }
    if (previewURL) URL.revokeObjectURL(previewURL);
    previewURL = url;
    $("export-error").textContent = "";
    v.el<HTMLImageElement>("export-preview").src = url;
  } catch (e) {
    if (!request.signal.aborted)
      $("export-error").textContent =
        `Preview: ${e instanceof Error ? e.message : String(e)}`;
  }
}
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void renderExportPreview(), 150);
}
function exportVideo() {
  return $<HTMLSelectElement>("export-source").value === "b" ? b : a;
}
function exportPreview() {
  const v = exportVideo();
  if (!v.project) return;
  const format = $<HTMLSelectElement>("export-format").value;
  for (const view of views()) view.el("export-panel").hidden = view !== v;
  $("export-name").textContent =
    `Video ${v.prefix.toUpperCase()}: ${v.project.name}`;
  const first = Math.max(
      0,
      Math.min(
        v.project.times.length - 1,
        Number(v.input("export-first").value),
      ),
    ),
    last = Math.max(
      first,
      Math.min(
        v.project.times.length - 1,
        Number(v.input("export-last").value),
      ),
    );

  v.el("export-summary").textContent =
    `Frames ${first} to ${last}. ${(v.project.times[first] / 1000).toFixed(3)} s to ${(v.project.times[last] / 1000).toFixed(3)} s source time.`;
  v.el("export-preview").hidden = format !== "video";
  v.el("export-summary").hidden = format !== "video";
  v.el("export-panel").querySelector<HTMLElement>(".export-controls")!.hidden =
    format === "json" || format === "csv";
  for (const key of [
    "first",
    "last",
    "range-tracking",
    "range-playback",
    "range-full",
    "speed",
    "repeat",
    "tracking",
    "plot",
    "time",
    "comparison",
  ]) {
    const el = v.el("export-" + key);
    const root = el.closest<HTMLElement>(".field-row,.checkbox-label") || el;
    root.hidden = format === "chart";
  }
  $("export-error").textContent = "";
  schedulePreview();
}
$("open-export").onclick = () => {
  if (!selected.project) return;
  pause();
  $<HTMLSelectElement>("export-source").value = selected.prefix;
  syncMaterialControls();
  exportPreview();
  exportDialog.dataset.variant = innerWidth < 600 ? "full-screen" : "basic";
  exportDialog.showModal();
  layout.render();
  schedulePreview();
};
$("export-close").onclick = () => exportDialog.close();
exportDialog.addEventListener("close", () => {
  clearTimeout(previewTimer);
  previewRequest?.abort();
  layout.render();
});
exportDialog.addEventListener("input", () => schedulePreview());
for (const id of ["export-source", "export-format"])
  $(id).onchange = () => {
    if (exportVideo() === b && !b.project) {
      $<HTMLSelectElement>("export-source").value = "a";
      syncMaterialControls();
    }
    exportPreview();
  };
for (const v of views())
  for (const key of ["first", "last"])
    v.input("export-" + key).addEventListener("input", exportPreview);
for (const v of views())
  for (const key of ["tracking", "playback", "full"])
    v.el("export-range-" + key).addEventListener("click", exportPreview);
$("export-run").onclick = () =>
  void job(async () => {
    const v = exportVideo(),
      kind = $<HTMLSelectElement>("export-format").value;
    $("export-error").textContent = "";
    $("export-status").textContent = "Exporting…";
    try {
      if (kind === "json" || kind === "csv") await v.download(kind);
      else await exportMedia(v, kind);
      $("export-status").textContent = "Export ready.";
    } catch (e) {
      $("export-error").textContent =
        e instanceof Error ? e.message : String(e);
      $("export-status").textContent = "";
      throw e;
    }
  });
function exportOptions(v: VideoView) {
  const checked = (key: string) => v.input("export-" + key).checked;
  const chart = {
    ...graph.exportOptions(v, checked("view")),
    statistics: checked("statistics"),
    markers: checked("markers"),
    comparison: undefined as object | undefined,
  };
  if (!checked("reference")) chart.reference = undefined;
  if (checked("comparison")) {
    const other = views().find((other) => other !== v && other.project);
    if (!other) throw Error("Load a second video to include it in the export.");
    chart.comparison = {
      id: other.project!.id,
      first: other.first,
      last: other.last,
      offset: other.offset - v.offset,
    };
  }
  return {
    first: Number(v.input("export-first").value),
    last: Number(v.input("export-last").value),
    speed: Number(v.input("export-speed").value),
    repeat: Number(v.input("export-repeat").value),
    tracking: checked("tracking"),
    plot: checked("plot"),
    statistics: checked("statistics"),
    markers: checked("markers"),
    time: checked("time"),
    chart,
  };
}
async function exportMedia(v: VideoView, kind: string) {
  if (!v.project) return;
  const options = exportOptions(v);
  status(kind === "video" ? "Rendering selected frames…" : "Preparing chart…");
  const response = await fetch(`/api/projects/${v.project.id}/export/${kind}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  if (!response.ok)
    throw Error((await response.json()).detail || "Export failed");
  const url = URL.createObjectURL(await response.blob()),
    link = document.createElement("a");
  link.href = url;
  link.download = kind === "video" ? "annotated.mp4" : "motion-chart.svg";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  status("Export ready.");
}
function selectVideo(v: VideoView) {
  if (!v.project) return;
  selected = v;
  for (const view of views()) {
    view.el("pane").classList.toggle("active-viewer", v === view);
    view.el("select").setAttribute("aria-current", String(v === view));
    view.el("inspector").hidden = view !== v;
    if (view !== v) view.stopDrawing();
  }
  inspector();
  timeline.paint();
  graph.setActive(v);
}
function inspector() {
  if (!selected.project) return;
  $("inspector-title").textContent =
    layout.state.mode === "reference"
      ? "Chart"
      : `${layout.state.mode === "alignment" ? "Align" : "Track"} video ${selected.prefix.toUpperCase()}`;
  $<HTMLInputElement>("clip-offset").value = selected.offset.toFixed(3);
  $("sync-info").textContent =
    selected.sync === null
      ? "No sync point marked."
      : `Sync point: frame ${selected.sync} at ${(selected.project.times[selected.sync] / 1000).toFixed(3)} s source.`;
  $<HTMLButtonElement>("goto-sync").disabled = busy || selected.sync === null;
  $<HTMLButtonElement>("mark-sync").disabled = busy || selected.outside;
  $<HTMLButtonElement>("align-sync").disabled =
    busy || a.sync === null || b.sync === null || !b.project;
  $("open-alignment").toggleAttribute("disabled", !b.project);
  for (const id of ["nudge-earlier", "nudge-later"])
    $<HTMLButtonElement>(id).disabled = busy;
}
function controls() {
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("input,select"))
    control.disabled = busy;
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    "[data-project-id],#import,#empty-import,#home,#open-recording",
  ))
    control.disabled = busy;
  for (const view of views()) view.controls(busy);
  for (const id of [
    "previous-frame",
    "play",
    "next-frame",
    "timeline-out",
    "timeline-in",
    "timeline-fit",
    "timeline-range",
    "playback-start",
    "playback-end",
    "playback-reset",
  ])
    $<HTMLButtonElement>(id).disabled = busy || !a.project;
  $<HTMLButtonElement>("open-export").disabled =
    busy || !selected.project?.samples.length;
  $<HTMLButtonElement>("export-run").disabled = busy;
  $("export-close").textContent = busy ? "Close" : "Cancel";
  graph.controls(busy);
  inspector();
  syncMaterialControls();
  timeline.paint();
}
function playbackRange(): [number, number] {
  const full = timeline.full();
  if (!playback.range) return full;
  const start = Math.max(full[0], Math.min(full[1], playback.range[0]));
  return [start, Math.max(start, Math.min(full[1], playback.range[1]))];
}
function playbackControls() {
  const [first, last] = playbackRange();
  $("playback-range").textContent =
    `${(first / 1000).toFixed(3)} s to ${(last / 1000).toFixed(3)} s`;
  $<HTMLSelectElement>("playback-speed").value = String(playback.speed);
  $<HTMLInputElement>("playback-loop").checked = playback.loop;
}
function setPlaybackEdge(edge: "start" | "end", t: number, save: boolean) {
  pause();
  const p = selected.project;
  if (!p) return;
  const snapped = snapTime(p.times, selected.offset, t);
  const [first, last] = playbackRange();
  playback.range =
    edge === "start"
      ? [snapped, Math.max(snapped, last)]
      : [Math.min(first, snapped), snapped];
  changed(save);
}
$("playback-start").onclick = () => {
  setPlaybackEdge("start", time, true);
};
$("playback-end").onclick = () => {
  setPlaybackEdge("end", time, true);
};
$("playback-reset").onclick = () => {
  pause();
  playback.range = null;
  changed(true);
};
$("playback-speed").onchange = () => {
  const resume = playing;
  pause();
  playback.speed = Number($<HTMLSelectElement>("playback-speed").value);
  changed(true);
  if (resume) $("play").click();
};
$("playback-loop").onchange = () => {
  playback.loop = $<HTMLInputElement>("playback-loop").checked;
  changed(true);
};
function changed(save: boolean) {
  if (playback.range) playback.range = playbackRange();
  playbackControls();
  for (const v of views()) v.controls(busy);
  timeline.paint();
  if (save) void graph.refresh();
  else graph.paint();
  inspector();
  if (save) saveWorkspace();
}
function queueSave() {
  if (!a.project) return;
  const id = a.project.id,
    payload: Workspace = {
      schema: 1,
      playback: structuredClone(playback),
      tracks: views()
        .filter((v) => v.project)
        .map((v) => v.workspace()),
    };
  saveChain = saveChain
    .catch(() => {})
    .then(() =>
      api(`/projects/${id}/workspace`, {
        method: "PUT",
        keepalive: true,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    )
    .then(() => {
      if (a.project?.id === id)
        $("save-state").textContent = "Workspace saved.";
    })
    .catch((e) => {
      if (a.project?.id === id)
        $("save-state").textContent = "Workspace not saved.";
      status(e.message, true);
    });
}
function saveWorkspace() {
  if (!a.project) return;
  $("save-state").textContent = "Saving workspace…";
  queueSave();
}
async function refresh() {
  entries = await api<Entry[]>("/projects");
  for (const group of ["projects", "recent-projects"]) {
    $(group).replaceChildren();
    for (const entry of entries) {
      const item = $<HTMLTemplateElement>(
        "recording-item-template",
      ).content.firstElementChild!.cloneNode(true) as HTMLElement;
      const button = item.querySelector<HTMLButtonElement>("button")!;
      button.dataset.projectId = entry.id;
      button.disabled = busy;
      item.title = entry.name;
      item.querySelector(".md-list-label")!.textContent = entry.name;
      item.onclick = () => void job(() => open(entry.id));
      $(group).append(item);
    }
  }
  $("no-recordings").hidden = entries.length > 0;
  const select = $<HTMLSelectElement>("reference");
  select.replaceChildren(
    new Option("None", ""),
    ...entries
      .filter((e) => e.id !== a.project?.id)
      .map((e) => new Option(e.name, e.id)),
  );
  select.value = b.project?.id || "";
  syncMaterialControls();
}
async function open(id: string) {
  status("Opening video…");
  await saveChain;
  const p = await api<Project>("/projects/" + id);
  const workspace = await api<Workspace | null>(`/projects/${id}/workspace`);
  b.project = null;
  await a.load(p, workspace?.tracks[0]);
  const second = workspace?.tracks[1];
  if (second)
    await b.load(await api<Project>("/projects/" + second.id), second);
  else if (!workspace && p.comparison && p.comparison.id !== p.id) {
    const other = await api<Project>("/projects/" + p.comparison.id);
    await b.load(other, {
      id: other.id,
      offset: p.times[p.zeroFrame] - other.times[p.comparison.zeroFrame],
      sync: p.comparison.zeroFrame,
      first: other.settings.start ?? 0,
      last: other.settings.end ?? other.times.length - 1,
    });
    a.sync = p.zeroFrame;
  }
  $("empty").hidden = true;
  $("workspace").hidden = false;
  layout.projectLoaded();
  $<HTMLDialogElement>("open-dialog").close();
  $("workspace-name").textContent = p.name;
  $("reference-pane").hidden = !b.project;
  $("video-panes").classList.toggle("comparing", !!b.project);
  playback = workspace?.playback || { range: null, speed: 1, loop: false };
  playbackControls();
  timeline.window = null;
  time = a.offset;
  selectVideo(a);
  await refresh();
  graph.reset();
  await show(time);
  $("save-state").textContent = workspace ? "Workspace loaded." : "";
  status("");
}
async function show(t: number) {
  const loaded = views().filter((v) => v.project);
  t = workspaceFrame(
    loaded.map((v) => ({ times: v.project!.times, offset: v.offset })),
    loaded.indexOf(selected),
    t,
    playing ? playbackRange() : undefined,
  );
  time = t;
  const generation = ++showGeneration;
  await Promise.all(
    views()
      .filter((v) => v.project)
      .map(async (v) => {
        const p = v.project!,
          source = t - v.offset;
        v.outside = source < 0 || source > p.times.at(-1)!;
        await v.show(sourceFrame(p.times, v.offset, t));
      }),
  );
  if (generation !== showGeneration) return;
  $("playhead-time").textContent = `${(time / 1000).toFixed(3)} s`;
  inspector();
  timeline.paint();
  graph.paint();
}
let showGeneration = 0;
function seek(t: number) {
  if (busy) return;
  pause();
  const [min, max] = timeline.full();
  void show(Math.max(min, Math.min(max, t))).catch((e) =>
    status(e.message, true),
  );
}
function seekFrame(v: VideoView, i: number) {
  if (!v.project) return;
  selectVideo(v);
  const frame = Math.max(
    0,
    Math.min(v.project.times.length - 1, Math.round(i)),
  );
  seek(v.project.times[frame] + v.offset);
}
$("previous-frame").onclick = () => seekFrame(selected, selected.index - 1);
$("next-frame").onclick = () => seekFrame(selected, selected.index + 1);
$("play").onclick = () => {
  if (playing) {
    pause();
    return;
  }
  if (!a.project) return;
  const [min, max] = playbackRange();
  if (time < min || time >= max) time = min;
  playing = true;
  clock = performance.now();
  startTime = time;
  const lastView =
    views().find(
      (v) =>
        v.project &&
        max >= v.offset &&
        max <= v.offset + v.project.times.at(-1)!,
    ) || selected;
  const times = lastView.project!.times,
    frame = sourceFrame(times, lastView.offset, max);
  endHold =
    (times[frame + 1] ??
      times[frame] +
        (times[frame] - (times[frame - 1] ?? times[frame] - 1000 / 60))) -
    times[frame];
  playButton(true);
  const token = ++playbackToken;
  requestAnimationFrame((now) => void tick(now, token));
};
async function tick(now: number, token: number) {
  if (token !== playbackToken || !playing) return;
  const range = playbackRange();
  const next = playbackPosition(
    startTime,
    now - clock,
    playback.speed,
    range,
    playback.loop,
    endHold,
  );
  try {
    await show(next.time);
    if (token !== playbackToken) return;
    if (next.done) {
      pause();
      return;
    }
    requestAnimationFrame((now) => void tick(now, token));
  } catch (e) {
    pause();
    status(e instanceof Error ? e.message : String(e), true);
  }
}
$("mark-sync").onclick = () => {
  selected.sync = selected.index;
  changed(true);
};
$("goto-sync").onclick = () => {
  if (selected.sync !== null) seekFrame(selected, selected.sync);
};
$("align-sync").onclick = () => {
  if (a.sync === null || b.sync === null || !a.project || !b.project) return;
  pause();
  b.offset = alignedOffset(
    a.project.times[a.sync],
    a.offset,
    b.project.times[b.sync],
  );
  timeline.window = null;
  changed(true);
  void show(a.project.times[a.sync] + a.offset);
  status("Sync points aligned.");
};
$("clip-offset").onchange = () => {
  const n = Number($<HTMLInputElement>("clip-offset").value);
  if (!Number.isFinite(n) || Math.abs(n) > 86400000) {
    status("Clip offset must be within one day.", true);
    inspector();
    return;
  }
  pause();
  selected.offset = n;
  changed(true);
  void show(time);
};
for (const [id, dir] of [
  ["nudge-earlier", -1],
  ["nudge-later", 1],
] as const)
  $(id).onclick = () => {
    pause();
    selected.offset += dir * timeline.frameStep(selected);
    changed(true);
    void show(time);
  };
$("reference").onchange = () =>
  void job(async () => {
    const id = $<HTMLSelectElement>("reference").value;
    b.project = null;
    if (id) await b.load(await api<Project>("/projects/" + id));
    $("reference-pane").hidden = !b.project;
    $("video-panes").classList.toggle("comparing", !!b.project);
    timeline.window = null;
    if (playback.range) playback.range = playbackRange();
    playbackControls();
    if (!b.project) selectVideo(a);
    await show(time);
    saveWorkspace();
    graph.reset();
    controls();
  });
for (const v of views())
  $(`fit-${v.prefix}`).onclick = () => void job(() => graph.fit(v));
for (const id of ["import", "empty-import"])
  $(id).onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = () =>
  void job(async () => {
    const file = $<HTMLInputElement>("file").files?.[0];
    if (!file) return;
    status("Importing video and extracting frames…");
    const body = new FormData();
    body.append("file", file);
    const p = await api<Project>("/import", { method: "POST", body });
    await open(p.id);
    $<HTMLInputElement>("file").value = "";
  });
$("home").onclick = () => {
  if (busy) return;
  pause();
  $("workspace").hidden = true;
  $("empty").hidden = false;
  layout.home();
  $("empty-import").focus();
};
for (const [id, target] of [
  ["open-recording", "open-dialog"],
  ["open-export", "export-dialog"],
]) {
  $(id).setAttribute("aria-haspopup", "dialog");
  $(id).setAttribute("aria-controls", target);
}
$("open-recording").onclick = () =>
  $<HTMLDialogElement>("open-dialog").showModal();
$("close-open").onclick = () => $<HTMLDialogElement>("open-dialog").close();
// Modal settings must release the viewer while a region is being drawn.
let drawingFromSheet: VideoView | null = null;
for (const view of views()) {
  view.el("draw").addEventListener("click", () => {
    if (view.drawing && $("inspector").matches(":modal")) {
      drawingFromSheet = view;
      layout.closeTools();
      view.canvas.focus();
    }
  });
  view.canvas.addEventListener("pointerup", () => {
    if (drawingFromSheet === view && !view.drawing) {
      drawingFromSheet = null;
      layout.inspect("tracking");
      status("");
    }
  });
}
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && drawingFromSheet) {
    e.preventDefault();
    drawingFromSheet.stopDrawing();
    drawingFromSheet = null;
    layout.inspect("tracking");
    status("");
  }
});
void installMaterialControls()
  .then(() => graph.loadPresets())
  .then(refresh)
  .then(controls)
  .catch((e) => status(e.message, true));

document.addEventListener("keydown", (e) => {
  if (
    e.defaultPrevented ||
    busy ||
    !!document.querySelector("dialog:modal") ||
    !a.project ||
    (e.target as Element)?.closest(
      "input,select,textarea,button,summary,#timeline-pan",
    )
  )
    return;
  if (e.key === " ") {
    e.preventDefault();
    $("play").click();
  } else if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
    e.preventDefault();
    seekFrame(selected, selected.index + (e.key === "ArrowLeft" ? -1 : 1));
  }
});
