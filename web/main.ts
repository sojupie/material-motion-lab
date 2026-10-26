import "./style.css";
import { nearest } from "./timing";
import { $, api, post } from "./api";
import { installMaterialControls, syncMaterialControls } from "./material";
import { VideoView, type ViewActions } from "./video";
import { MotionGraph } from "./graph";
import type { Entry, Project } from "./types";
let playbackToken = 0;
let busy = false,
  entries: Entry[] = [],
  playing: VideoView | "both" | null = null,
  clock = 0,
  startTime = 0;
function status(text: string, error = false) {
  $("status").textContent = text;
  $("status").classList.toggle("error", error);
}
function pause() {
  playbackToken++;
  playing = null;
  for (const view of [a, b]) view.el("play").textContent = "Play";
  $("play-both").textContent = "Play aligned";
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
  seek,
  play: togglePlay,
  change: () => {
    alignment();
    a.marks();
    b.marks();
    void graph.refresh();
  },
  job,
  message: status,
  align: async (view) => {
    if (!view.project) return;
    view.project = await post<Project>(`/projects/${view.project.id}/zero`, {
      frame: view.index,
    });
    view.zero = view.index;
    view.marks();
    await saveComparison();
    await view.show(view.index);
    alignment();
    await graph.refresh();
  },
};
const a = new VideoView("a", actions),
  b = new VideoView("b", actions);
const graph = new MotionGraph(
  () => [a, b],
  (time) => {
    pause();
    void showAligned(time).catch((e) => status(e.message, true));
  },
);
const linked = () => $<HTMLInputElement>("linked").checked && !!b.project;
function controls() {
  for (const id of ["import", "empty-import"])
    $<HTMLButtonElement>(id).disabled = busy;
  for (const view of [a, b]) view.controls(busy);
  for (const control of document.querySelectorAll<
    HTMLInputElement | HTMLSelectElement
  >("select,input[type=number],#linked"))
    control.disabled = busy;
  for (const item of document.querySelectorAll<HTMLButtonElement>(
    "[data-navigation-item]",
  ))
    item.disabled = busy;
  $<HTMLButtonElement>("align").disabled = busy || !a.project || !b.project;
  $<HTMLButtonElement>("play-both").disabled = busy || !a.project || !b.project;
  graph.controls(busy);
  syncMaterialControls();
}
function alignment() {
  $("reference-pane").hidden = !b.project;
  $("video-panes").classList.toggle("comparing", !!b.project);
  $("alignment").textContent =
    b.project && a.project
      ? `A: frame ${a.zero}    B: frame ${b.zero}. Scrub independently, then align the current frames.`
      : "";
  syncMaterialControls();
}
async function refresh() {
  entries = await api<Entry[]>("/projects");
  const focus = document.activeElement as HTMLElement | null,
    focusID = focus?.dataset.projectId,
    focusGroup = focus?.closest(".md-nav-items")?.id;
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
      item.onclick = () =>
        void job(async () => {
          await open(entry.id);
          if (group === "projects")
            for (const next of $(
              "projects",
            ).querySelectorAll<HTMLButtonElement>("[data-navigation-item]"))
              if (next.dataset.projectId === entry.id)
                next.focus({ preventScroll: true });
        });
      $(group).append(item);
      if (group === focusGroup && entry.id === focusID)
        item.focus({ preventScroll: true });
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
  const p = await api<Project>("/projects/" + id);
  b.project = null;
  $("empty").hidden = true;
  $("workspace").hidden = false;
  await a.load(p);
  let comparisonError = "";
  if (p.comparison) {
    try {
      const ref = await api<Project>("/projects/" + p.comparison.id);
      if (ref.id !== p.id) await b.load(ref, p.comparison.zeroFrame);
    } catch (e) {
      b.project = null;
      comparisonError = `Saved comparison could not be opened: ${e instanceof Error ? e.message : e}`;
    }
  }
  $<HTMLInputElement>("linked").checked = !!b.project;
  alignment();
  await refresh();
  graph.reset();
  status(comparisonError, !!comparisonError);
}
async function saveComparison() {
  if (!a.project) return;
  a.project = await post<Project>(`/projects/${a.project.id}/comparison`, {
    reference: b.project?.id ?? null,
    zero: b.zero,
  });
  alignment();
}
$("reference").onchange = () =>
  void job(async () => {
    const id = $<HTMLSelectElement>("reference").value;
    b.project = null;
    if (id) await b.load(await api<Project>("/projects/" + id));
    $<HTMLInputElement>("linked").checked = false;
    await saveComparison();
    graph.reset();
    controls();
    status("");
  });
$("align").onclick = () =>
  void job(async () => {
    if (!a.project || !b.project) return;
    a.project = await post<Project>(`/projects/${a.project.id}/zero`, {
      frame: a.index,
    });
    a.zero = a.index;
    b.zero = b.index;
    await saveComparison();
    a.marks();
    b.marks();
    $<HTMLInputElement>("linked").checked = true;
    await showAligned(0);
    await graph.refresh();
    status("Current frames aligned.");
  });
$("linked").onchange = () => {
  pause();
  if (linked()) void showAligned(a.time).catch((e) => status(e.message, true));
};
async function showAligned(time: number) {
  await Promise.all(
    [a, b]
      .filter((v) => v.project)
      .map(async (view) => {
        const p = view.project!,
          absolute = time + p.times[view.zero];
        view.outside = absolute < 0 || absolute > p.times.at(-1)!;
        await view.show(nearest(p.times, absolute));
      }),
  );
  graph.paint();
}
function seek(view: VideoView, index: number) {
  if (busy) return;
  pause();
  if (!view.project) return;
  const i = Math.max(0, Math.min(view.project.times.length - 1, index));
  if (linked())
    void showAligned(
      view.project.times[i] - view.project.times[view.zero],
    ).catch((e) => status(e.message, true));
  else {
    view.outside = false;
    void view
      .show(i)
      .then(() => graph.paint())
      .catch((e) => status(e.message, true));
  }
}
function togglePlay(view: VideoView) {
  if (playing) {
    pause();
    return;
  }
  if (!view.project) return;
  playing = linked() ? "both" : view;
  const p = view.project;
  if (view.index >= view.last) view.index = view.first;
  clock = performance.now();
  startTime =
    playing === "both"
      ? p.times[view.index] - p.times[view.zero]
      : p.times[view.index];
  view.el("play").textContent = "Pause";
  if (playing === "both") {
    $("play-both").textContent = "Pause aligned";
    b.el("play").textContent = "Pause";
    a.el("play").textContent = "Pause";
  }
  const token = playbackToken;
  requestAnimationFrame((now) => tick(now, token));
}
$("play-both").onclick = () => {
  if (playing) {
    pause();
    return;
  }
  $<HTMLInputElement>("linked").checked = true;
  togglePlay(a);
};
async function tick(now: number, token: number) {
  if (token !== playbackToken) return;
  const target = playing;
  if (!target) return;
  try {
    const elapsed = startTime + now - clock;
    if (target === "both") {
      const end = Math.max(
        ...[a, b]
          .filter((v) => v.project)
          .map((v) => v.project!.times[v.last] - v.project!.times[v.zero]),
      );
      await showAligned(Math.min(end, elapsed));
      if (elapsed >= end) {
        pause();
        return;
      }
    } else {
      const p = target.project!;
      const end = p.times[target.last];
      await target.show(nearest(p.times, Math.min(end, elapsed)));
      graph.paint();
      if (elapsed >= end) {
        pause();
        return;
      }
    }
    if (playing === target && token === playbackToken)
      requestAnimationFrame((now) => tick(now, token));
  } catch (e) {
    pause();
    status(e instanceof Error ? e.message : String(e), true);
  }
}
for (const view of [a, b])
  $(`fit-${view.prefix}`).onclick = () => void job(() => graph.fit(view));
for (const id of ["import", "empty-import"])
  $(id).onclick = () => $<HTMLInputElement>("file").click();
$<HTMLInputElement>("file").onchange = () =>
  void job(async () => {
    const file = $<HTMLInputElement>("file").files?.[0];
    if (!file) return;
    status("Importing video and extracting frames…");
    const form = new FormData();
    form.append("file", file);
    const project = await api<Project>("/import", {
      method: "POST",
      body: form,
    });
    await open(project.id);
    $<HTMLInputElement>("file").value = "";
  });
void installMaterialControls()
  .then(refresh)
  .then(controls)
  .catch((e) => status(e.message, true));
matchMedia("(min-width:1280px)").addEventListener("change", (e) => {
  if (e.matches) {
    const drawer = $<HTMLDialogElement>("recording-drawer");
    if (drawer.open) drawer.close();
  }
});
