import { $ } from "./api";
import { required } from "./errors";
import { ExportsController } from "./exports-controller";
import { MotionGraph } from "./graph";
import { WorkspaceLayout } from "./layout";
import { installMaterialControls, syncMaterialControls } from "./material";
import { installMobileTools } from "./mobile-tools";
import { OperationsController } from "./operations-controller";
import { viewControls } from "./project-view";
import { ProjectsController } from "./projects-controller";
import { Timeline } from "./timeline";
import { sourceFrame } from "./timing";
import { TransportController } from "./transport-controller";
import type { ViewActions } from "./video";
import { VideoView } from "./video";

export class WorkspaceController {
  readonly operations = new OperationsController(this);
  readonly transport = new TransportController(this);
  readonly projects = new ProjectsController(this);
  readonly exports = new ExportsController(this);
  readonly initialChartControls = Object.fromEntries(
    viewControls.map((id) => [id, $<HTMLInputElement>(id).value]),
  );
  readonly a: VideoView;
  readonly b: VideoView;
  selected: VideoView;
  readonly timeline: Timeline;
  readonly graph: MotionGraph;
  readonly layout: WorkspaceLayout;
  views = () => [this.a, this.b];
  constructor() {
    const actions: ViewActions = {
      export: this.exports.exportMedia,
      exportRange: (v) => {
        const range = this.transport.playbackRange();
        const { times } = v.project!;
        if (
          range[1] < required(times[0]) + v.offset ||
          range[0] > times.at(-1)! + v.offset
        ) {
          throw new Error("Playback interval does not overlap this video.");
        }
        return [
          sourceFrame(times, v.offset, range[0]),
          sourceFrame(times, v.offset, range[1]),
        ];
      },
      seek: (v, i) => {
        this.transport.seekFrame(v, i);
      },
      select: this.selectVideo,
      change: () => {
        this.transport.changed(true);
      },
      job: this.operations.job,
      message: this.operations.status,
    };
    this.a = new VideoView("a", actions);
    this.b = new VideoView("b", actions);
    this.selected = this.a;
    this.timeline = new Timeline(
      this.views,
      () => this.transport.time,
      () => this.selected,
      (t) => {
        this.transport.seek(t);
      },
      this.selectVideo,
      this.transport.changed,
      this.transport.playbackRange,
      this.transport.setPlaybackEdge,
    );
    this.graph = new MotionGraph(
      this.views,
      (t) => {
        this.transport.seek(t);
      },
      () => this.timeline.bounds(),
      () => this.transport.time,
      this.selectVideo,
      (bounds) => {
        this.timeline.window = bounds;
        this.transport.changed(false);
      },
    );
    this.layout = new WorkspaceLayout(() => {
      this.timeline.paint();
      this.graph.paint();
      if (this.selected.project) {
        this.inspector();
      }
    });
  }
  selectVideo = (v: VideoView) => {
    if (!v.project) {
      return;
    }
    this.selected = v;
    for (const view of this.views()) {
      view.el("pane").classList.toggle("active-viewer", v === view);
      view.el("remove").hidden = v !== view;
      view.el("select").setAttribute("aria-current", String(v === view));
      view.el("inspector").hidden = view !== v;
      if (view !== v) {
        view.stopDrawing();
      }
    }
    this.inspector();
    this.timeline.paint();
    this.graph.setActive(v);
    this.controls();
  };
  inspector = () => {
    if (!this.selected.project) {
      return;
    }
    $("inspector-title").textContent =
      `Video ${this.selected.prefix.toUpperCase()}`;
    $<HTMLInputElement>("clip-offset").value = this.selected.offset.toFixed(3);
    $("sync-info").textContent =
      this.selected.sync === null
        ? "No sync point marked."
        : `Sync point: frame ${this.selected.sync} at ${(required(this.selected.project.times[this.selected.sync]) / 1000).toFixed(3)} s source.`;
    $<HTMLButtonElement>("goto-sync").disabled =
      this.operations.busy || this.selected.sync === null;
    $<HTMLButtonElement>("mark-sync").disabled =
      this.operations.busy || this.selected.outside;
    $<HTMLButtonElement>("align-sync").disabled =
      this.operations.busy ||
      this.a.sync === null ||
      this.b.sync === null ||
      !this.b.project;
    $<HTMLButtonElement>("nudge-earlier").disabled =
      this.operations.busy || this.selected.offset <= 0;
    $<HTMLButtonElement>("nudge-later").disabled =
      this.operations.busy || this.selected.offset >= 86_400_000;
  };
  controls = () => {
    for (const control of document.querySelectorAll<
      HTMLInputElement | HTMLSelectElement
    >("input,select")) {
      control.disabled = this.operations.busy;
    }
    for (const control of document.querySelectorAll<HTMLButtonElement>(
      "[data-project-id],[data-delete-project],#empty-add,#empty-project-add,#open-recording,#open-example,#open-project-file,#project-menu-button,[data-project-action]",
    )) {
      control.disabled = this.operations.busy;
    }
    for (const view of this.views()) {
      view.controls(this.operations.busy);
      view.el<HTMLButtonElement>("remove").disabled =
        this.operations.busy || !view.project;
    }
    for (const id of [
      "tracking-start",
      "tracking-end",
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
    ]) {
      $<HTMLButtonElement>(id).disabled =
        this.operations.busy || !this.a.project;
    }
    $<HTMLButtonElement>("open-export").disabled =
      this.operations.busy ||
      !(
        this.selected.project !== null &&
        this.selected.project.samples.length > 0
      );
    $<HTMLButtonElement>("export-run").disabled = this.operations.busy;
    $("export-close").textContent = this.operations.busy ? "Close" : "Cancel";
    for (const id of ["maximize-viewer", "maximize-chart"]) {
      $<HTMLButtonElement>(id).disabled =
        this.operations.busy || !this.a.project;
    }
    $<HTMLButtonElement>("save-project").disabled =
      this.operations.busy || !this.projects.currentProject;
    $<HTMLButtonElement>("mobile-save").disabled =
      this.operations.busy || !this.projects.currentProject;
    for (const copy of document.querySelectorAll<HTMLButtonElement>(
      '[data-project-action="copy"],[data-project-action="close"]',
    )) {
      copy.disabled = this.operations.busy || !this.projects.currentProject;
    }
    $("legend").hidden = !this.a.project;
    $("chart-measurement-summary").hidden = !this.a.project;
    for (const id of ["playback-speed", "playback-loop"]) {
      $<HTMLInputElement>(id).disabled =
        this.operations.busy || !this.a.project;
    }
    ($("playback-range").parentElement as HTMLButtonElement).disabled =
      this.operations.busy || !this.a.project;
    if (!this.a.project) {
      $("playhead-time").textContent = "—";
    }
    this.transport.playbackControls();
    this.graph.controls(this.operations.busy);
    this.inspector();
    syncMaterialControls();
    this.timeline.paint();
  };
  renderContents = async () => {
    const empty = !this.a.project;
    $("reference-pane").hidden = !this.b.project;
    $("video-panes").classList.toggle("comparing", Boolean(this.b.project));
    $("empty-viewer").hidden = this.projects.currentProject !== null;
    $("empty-project").hidden = !this.projects.currentProject || !empty;
    $("viewer-tools").hidden = !this.projects.currentProject;
    for (const view of this.views()) {
      view.el("remove").hidden = !view.project;
    }
    $("video-panes").hidden = empty;
    document.title =
      this.projects.currentProject?.name ?? "Material Motion Lab";
    $("loaded-project-name").textContent =
      this.projects.currentProject?.name ?? "";
    this.selectVideo(this.a);
    this.transport.playbackControls();
    this.graph.reset();
    this.layout.projectLoaded();
    if (empty) {
      $("inspector-title").textContent = "Tools";
      for (const v of this.views()) {
        v.el("inspector").hidden = true;
      }
      $("playhead-time").textContent = "—";
      this.timeline.paint();
    } else {
      await this.transport.show(this.transport.time);
    }
  };
  async start() {
    this.operations.bind();
    this.transport.bind();
    this.projects.bind();
    this.exports.bind();
    installMaterialControls();
    installMobileTools(() => {
      this.transport.pause();
      this.exports.exportPreview();
      syncMaterialControls();
    });
    this.controls();
    await Promise.all([this.graph.loadPresets(), this.projects.refresh()]);
  }
}
