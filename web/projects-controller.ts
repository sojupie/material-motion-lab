import { $, api } from "./api";
import { errorMessage, required } from "./errors";
import { responseError } from "./json";
import { localFetch } from "./local-client";
import { all } from "./local-store";
import { syncMaterialControls } from "./material";
import { finiteRange, viewControls } from "./project-view";
import { recentProjectIDs, rememberProject } from "./recent-projects";
import type { Project, Workspace } from "./types";
import type { VideoView } from "./video";
import type { WorkspaceController } from "./workspace";

export class ProjectsController {
  constructor(private readonly editor: WorkspaceController) {}
  currentProject: Workspace | null = null;
  pendingSaves = 0;
  localSaveFailed = false;
  saveChain: Promise<unknown> = Promise.resolve();
  recentKey = "motion-recent-projects";
  workspaceSnapshot = (): Workspace => ({
    schema: 1,
    id: this.currentProject?.id ?? "",
    name: this.currentProject?.name ?? "Untitled project",
    playback: structuredClone(this.editor.transport.playback),
    view: {
      controls: Object.fromEntries(
        viewControls.map((id) => [id, $<HTMLInputElement>(id).value]),
      ),
      time: this.editor.transport.time,
      window: this.editor.timeline.window,
      vertical: this.editor.graph.savedScale(),
      selected: this.editor.selected.prefix,
    },
    tracks: this.editor
      .views()
      .filter((v) => v.project)
      .map((v) => v.workspace()),
  });
  queueSave = () => {
    if (!this.currentProject) {
      return;
    }
    const { id } = this.currentProject;
    const payload = this.workspaceSnapshot();
    this.pendingSaves++;
    const previous = this.saveChain;
    this.saveChain = (async () => {
      try {
        await previous;
      } catch {}
      try {
        await api(`/workspaces/${id}`, {
          method: "PUT",
          keepalive: true,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
        this.localSaveFailed = false;
        if (this.currentProject?.id === id) {
          $("save-state").textContent = "Project saved in this browser.";
        }
      } catch (error: unknown) {
        this.localSaveFailed = true;
        if (this.currentProject?.id === id) {
          $("save-state").textContent =
            "Project could not be saved in this browser.";
        }
        this.editor.operations.status(errorMessage(error), true);
      } finally {
        this.pendingSaves--;
      }
    })();
  };
  saveWorkspace = () => {
    if (!this.currentProject) {
      return;
    }
    $("save-state").textContent = "Saving project…";
    this.queueSave();
  };
  recentIDs = (): string[] => {
    try {
      return recentProjectIDs(localStorage.getItem(this.recentKey));
    } catch {
      return [];
    }
  };
  markViewed = (id: string) => {
    try {
      localStorage.setItem(
        this.recentKey,
        JSON.stringify(rememberProject(this.recentIDs(), id)),
      );
    } catch {}
  };
  refresh = async () => {
    const projects = await all<Workspace>("projects");
    const order = this.recentIDs();
    projects.sort((a, b) => {
      const ai = order.indexOf(a.id);
      const bi = order.indexOf(b.id);
      return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
    });
    $("recent-empty").hidden = projects.length > 0;
    $("recent-projects").replaceChildren();
    for (const entry of projects) {
      const item = $<HTMLTemplateElement>(
        "recording-item-template",
      ).content.firstElementChild!.cloneNode(true) as HTMLElement;
      const button = item.querySelector<HTMLButtonElement>("button")!;
      button.dataset.projectId = entry.id;
      button.disabled = this.editor.operations.busy;
      item.querySelector(".md-list-label")!.textContent = entry.name;
      button.onclick = () =>
        void this.editor.operations.job(async () => {
          await this.persistProject();
          await this.open(entry.id);
        });
      const remove = item.querySelector<HTMLButtonElement>(
        "[data-delete-project]",
      )!;
      remove.disabled = this.editor.operations.busy;
      remove.setAttribute("aria-label", `Delete project ${entry.name}`);
      remove.onclick = () =>
        void this.editor.operations.job(async () => {
          if (
            !confirm(
              `Delete “${entry.name}” from this browser? Downloaded project files are kept.`,
            )
          ) {
            return;
          }
          await api(`/workspaces/${entry.id}`, { method: "DELETE" });
          if (this.currentProject?.id === entry.id) {
            this.currentProject = null;
            this.editor.a.clear();
            this.editor.b.clear();
            await this.editor.renderContents();
          }
          await this.refresh();
          this.editor.operations.status("Local project deleted.");
        });
      $("recent-projects").append(item);
    }
    syncMaterialControls();
  };
  open = async (id: string) => {
    this.editor.operations.status("Opening project…");
    await this.saveChain;
    const workspace = await api<Workspace>(`/workspaces/${id}`);
    const media = await Promise.all(
      workspace.tracks.map((track) => api<Project>(`/projects/${track.id}`)),
    );
    this.editor.a.clear();
    this.editor.b.clear();
    this.currentProject = workspace;
    if (media[0]) {
      await this.editor.a.load(media[0], workspace.tracks[0]);
    }
    if (media[1]) {
      await this.editor.b.load(media[1], workspace.tracks[1]);
    }
    const p = media[0];
    for (const id of viewControls) {
      $<HTMLInputElement>(id).value = required(
        this.editor.initialChartControls[id],
      );
    }
    $("curve").dispatchEvent(new Event("change"));
    syncMaterialControls();
    this.editor.transport.playback = workspace.playback ?? {
      range: null,
      speed: 1,
      loop: false,
    };
    this.editor.transport.playbackControls();
    this.editor.timeline.window = null;
    this.editor.transport.time = this.editor.a.project
      ? this.editor.a.offset
      : 0;
    this.editor.selectVideo(this.editor.a);
    this.editor.graph.reset();
    if (p?.example === "carousel-width") {
      $<HTMLSelectElement>("axis").value = "width";
      $<HTMLSelectElement>("units").value = "progress";
      $<HTMLSelectElement>("curve").value = "md3";
      $<HTMLInputElement>("duration").value = String(
        required(p.times[this.editor.a.last]) -
          required(p.times[this.editor.a.first]),
      );
      $("curve").dispatchEvent(new Event("change"));
      this.editor.timeline.window = [
        required(p.times[this.editor.a.first]) - 50,
        required(p.times[this.editor.a.last]) + 50,
      ];
      this.editor.transport.time = required(p.times[this.editor.a.first]);
      syncMaterialControls();
      await this.editor.graph.refresh();
    }
    await this.editor.renderContents();
    const savedView = workspace.view;
    if (
      savedView &&
      typeof savedView === "object" &&
      Boolean(savedView.controls) &&
      typeof savedView.controls === "object"
    ) {
      for (const id of viewControls) {
        const value = savedView.controls[id];
        const control = $<HTMLInputElement | HTMLSelectElement>(id);
        if (typeof value !== "string" || value.length > 128) {
          continue;
        }
        if (
          control instanceof HTMLSelectElement &&
          ![...control.options].some((option) => option.value === value)
        ) {
          continue;
        }
        if (
          control instanceof HTMLInputElement &&
          (!Number.isFinite(Number(value)) ||
            (control.min && Number(value) < Number(control.min)) ||
            (control.max && Number(value) > Number(control.max)))
        ) {
          continue;
        }
        control.value = value;
        if (id === "curve") {
          control.dispatchEvent(new Event("change"));
        }
      }
      if (finiteRange(savedView.window)) {
        this.editor.timeline.window = savedView.window;
      }
      if (
        typeof savedView.time === "number" &&
        Number.isFinite(savedView.time)
      ) {
        this.editor.transport.time = savedView.time;
      }
      if (savedView.selected === "b" && this.editor.b.project) {
        this.editor.selectVideo(this.editor.b);
      }
      syncMaterialControls();
      await this.editor.graph.refresh();
      this.editor.graph.restoreScale(
        finiteRange(savedView.vertical) ? savedView.vertical : null,
      );
    }
    if (this.editor.a.project) {
      await this.editor.transport.show(this.editor.transport.time);
    }
    this.markViewed(id);
    await this.refresh();
    $("save-state").textContent = "Project loaded.";
    this.editor.operations.status("");
  };
  removeVideo = async (view: VideoView) => {
    await this.saveChain;
    if (view === this.editor.a && this.editor.b.project) {
      await this.editor.a.load(
        this.editor.b.project,
        this.editor.b.workspace(),
      );
      this.editor.b.clear();
    } else {
      view.clear();
    }
    this.editor.transport.playback.range = null;
    this.editor.timeline.window = null;
    this.editor.transport.time = this.editor.a.project
      ? this.editor.a.offset
      : 0;
    await this.editor.renderContents();
    this.saveWorkspace();
    this.editor.operations.status("Video removed from project.");
  };
  closeProject = async () => {
    await this.persistProject();
    this.currentProject = null;
    this.editor.a.clear();
    this.editor.b.clear();
    this.editor.transport.playback = { range: null, speed: 1, loop: false };
    this.editor.timeline.window = null;
    this.editor.transport.time = 0;
    await this.editor.renderContents();
    await this.refresh();
    $("save-state").textContent = "";
    this.editor.operations.status("");
  };
  persistProject = async () => {
    if (!this.currentProject) {
      return;
    }
    await this.saveChain;
    await api(`/workspaces/${this.currentProject.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(this.workspaceSnapshot()),
    });
    this.localSaveFailed = false;
  };
  saveProjectFile = async () => {
    if (!this.currentProject) {
      return;
    }
    await this.persistProject();
    const response = await localFetch(
      `/api/workspaces/${this.currentProject.id}/project-file`,
    );
    if (!response.ok) {
      throw new Error(
        await responseError(response, "Could not save project file."),
      );
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = `${this.currentProject.name}.motion`;
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
    this.editor.operations.status(
      "Project file saved with videos, measurements and workspace settings.",
    );
  };
  create = async () => {
    await this.persistProject();
    const existing = await api<Workspace[]>("/workspaces");
    const names = new Set(existing.map((project) => project.name));
    let number = 1;
    let name = "Untitled project";
    while (names.has(name)) {
      number++;
      name = `Untitled project ${number}`;
    }
    const project = await api<Workspace>("/workspaces", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name }),
    });
    await this.open(project.id);
    this.editor.operations.status(`Created ${name}.`);
  };
  bind = () => {
    for (const view of this.editor.views()) {
      view.el("remove").onclick = () =>
        void this.editor.operations.job(() => this.removeVideo(view));
    }
    $("tracking-start").onclick = () => {
      this.editor.transport.seekFrame(
        this.editor.selected,
        this.editor.selected.first,
      );
    };
    $("tracking-end").onclick = () => {
      this.editor.transport.seekFrame(
        this.editor.selected,
        this.editor.selected.last,
      );
    };
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-dialog-choice]",
    )) {
      button.onclick = () => {
        button
          .closest<HTMLDialogElement>("dialog")!
          .close(button.dataset.dialogChoice);
      };
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-project-action]",
    )) {
      button.onclick = () => {
        if (button.dataset.projectAction === "open") {
          $<HTMLInputElement>("project-file").click();
        } else if (button.dataset.projectAction === "close") {
          void this.editor.operations.job(this.closeProject);
        } else if (button.dataset.projectAction === "copy") {
          void this.editor.operations.job(async () => {
            if (!this.currentProject) {
              return;
            }
            await this.persistProject();
            const copy = await api<Workspace>(
              `/workspaces/${this.currentProject.id}/copy`,
              { method: "POST" },
            );
            await this.open(copy.id);
          });
        } else if (button.dataset.projectAction === "import") {
          $<HTMLInputElement>("file").click();
        } else if (button.dataset.projectAction === "new") {
          void this.editor.operations.job(this.create);
        }
      };
    }
    $<HTMLInputElement>("project-file").onchange = () =>
      void this.editor.operations.job(async () => {
        const input = $<HTMLInputElement>("project-file");
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        try {
          await this.persistProject();
          this.editor.operations.status("Opening project file…");
          const body = new FormData();
          body.append("file", file);
          const project = await api<Workspace>("/import-project", {
            method: "POST",
            body,
          });
          await this.open(project.id);
        } finally {
          input.value = "";
        }
      });
    $("save-project").onclick = () =>
      void this.editor.operations.job(this.saveProjectFile);
    $("mobile-save").onclick = () =>
      void this.editor.operations.job(this.saveProjectFile);
    $("open-example").onclick = () =>
      void this.editor.operations.job(async () => {
        await this.persistProject();
        this.editor.operations.status("Preparing example project…");
        const example = await api<Workspace>("/examples/carousel", {
          method: "POST",
        });
        await this.open(example.id);
        this.editor.operations.status(
          "Example ready. Play the interval or inspect a point on the chart.",
        );
      });
    for (const id of ["open-recording", "empty-add", "empty-project-add"]) {
      $(id).onclick = () => {
        $<HTMLInputElement>("file").click();
      };
    }
    $<HTMLInputElement>("file").onchange = () =>
      void this.editor.operations.job(async () => {
        const input = $<HTMLInputElement>("file");
        const file = input.files?.[0];
        if (!file) {
          return;
        }
        try {
          let target = this.editor.a.project ? this.editor.b : this.editor.a;
          if (this.editor.a.project && this.editor.b.project) {
            const dialog = $<HTMLDialogElement>("replace-video-dialog");
            dialog.returnValue = "cancel";
            $("replace-a").textContent =
              `Replace A: ${this.editor.a.project.name}`;
            $("replace-b").textContent =
              `Replace B: ${this.editor.b.project.name}`;
            const choice = new Promise<string>((resolve) => {
              dialog.addEventListener(
                "close",
                () => {
                  resolve(dialog.returnValue);
                },
                { once: true },
              );
            });
            dialog.showModal();
            const result = await choice;
            if (result === "cancel") {
              return;
            }
            target = result === "a" ? this.editor.a : this.editor.b;
          }
          this.editor.operations.status(
            "Importing video and extracting frames…",
          );
          const body = new FormData();
          body.append("file", file);
          const video = await api<Project>("/import", { method: "POST", body });
          this.currentProject ??= await api<Workspace>("/workspaces", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: file.name.replace(/\.[^/.]+$/, "").slice(0, 200),
            }),
          });
          if (this.currentProject.name === "Untitled project") {
            this.currentProject.name =
              file.name.replace(/\.[^/.]+$/, "").slice(0, 200) ||
              "Untitled project";
          }
          await target.load(video);
          this.editor.transport.playback.range = null;
          this.editor.timeline.window = null;
          this.editor.transport.time = this.editor.a.offset;
          await this.editor.renderContents();
          this.editor.selectVideo(target);
          this.saveWorkspace();
          this.markViewed(this.currentProject.id);
          await this.refresh();
          this.editor.operations.status(
            `Imported as video ${target.prefix.toUpperCase()}.`,
          );
        } finally {
          input.value = "";
        }
      });
    window.addEventListener("beforeunload", (event) => {
      if (
        this.editor.operations.busy ||
        this.pendingSaves > 0 ||
        this.localSaveFailed
      ) {
        event.preventDefault();
      }
    });
    document.addEventListener("change", (event) => {
      if (
        !this.editor.operations.busy &&
        viewControls.includes(
          (event.target instanceof HTMLElement
            ? event.target.id
            : "") as (typeof viewControls)[number],
        )
      ) {
        this.saveWorkspace();
      }
    });
  };
}
