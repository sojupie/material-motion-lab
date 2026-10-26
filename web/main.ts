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
function selectVideo(v: VideoView) {
  if (!v.project) return;
  selected = v;
  for (const view of views()) {
    view.el("pane").classList.toggle("active-viewer", v === view);
    view.el("select").setAttribute("aria-current", String(v === view));
    view.el("inspector").hidden = view !== v;
    if (view !== v) view.stopDrawing();
  }
  $("inspector-title").textContent = `Video ${v.prefix.toUpperCase()}`;
  inspector();
  timeline.paint();
  graph.setActive(v);
}
function inspector() {
  if (!selected.project) return;
  $<HTMLInputElement>("clip-offset").value = selected.offset.toFixed(3);
  $("sync-info").textContent =
    selected.sync === null
      ? "No sync point marked."
      : `Sync point: frame ${selected.sync} at ${(selected.project.times[selected.sync] / 1000).toFixed(3)} s source.`;
  $<HTMLButtonElement>("goto-sync").disabled = busy || selected.sync === null;
  $<HTMLButtonElement>("mark-sync").disabled = busy || selected.outside;
  $<HTMLButtonElement>("align-sync").disabled =
    busy || a.sync === null || b.sync === null || !b.project;
  for (const id of ["nudge-earlier", "nudge-later"])
    $<HTMLButtonElement>(id).disabled = busy;
}
function controls() {
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("input,select"))
    control.disabled = busy;
  for (const control of document.querySelectorAll<HTMLButtonElement>(
    "[data-navigation-item],#import,#empty-import",
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
$("playback-start").onclick = () => setPlaybackEdge("start", time, true);
$("playback-end").onclick = () => setPlaybackEdge("end", time, true);
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
  for (const group of ["projects", "mobile-projects"]) {
    $(group).replaceChildren();
    for (const entry of entries) {
      const item = $<HTMLTemplateElement>(
        "recording-item-template",
      ).content.firstElementChild!.cloneNode(true) as HTMLButtonElement;
      item.dataset.projectId = entry.id;
      item.title = entry.name;
      item.querySelector(".md-nav-label")!.textContent = entry.name;
      if (entry.id === a.project?.id) item.setAttribute("aria-current", "page");
      item.onclick = () => void job(() => open(entry.id));
      $(group).append(item);
    }
  }
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
void installMaterialControls()
  .then(refresh)
  .then(controls)
  .catch((e) => status(e.message, true));
matchMedia("(min-width:1600px)").addEventListener("change", (e) => {
  if (e.matches) {
    const drawer = $<HTMLDialogElement>("recording-drawer");
    if (drawer.open) drawer.close();
  }
});

document.addEventListener("keydown", (e) => {
  if (
    e.defaultPrevented ||
    busy ||
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
