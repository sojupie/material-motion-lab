import { $ } from "./api";
import { required } from "./errors";
import { responseError } from "./json";
import { localFetch } from "./local-client";
import { syncMaterialControls } from "./material";
import type { VideoView } from "./video";
import type { WorkspaceController } from "./workspace";

export class ExportsController {
  constructor(private readonly editor: WorkspaceController) {}
  exportDialog = $<HTMLDialogElement>("export-dialog");
  previewTimer: ReturnType<typeof setTimeout> | undefined;
  previewRequest: AbortController | undefined;
  previewURL: string | undefined;
  private readonly dialogOpen = () => this.exportDialog.open;
  renderExportPreview = async () => {
    const v = this.exportVideo();
    if (
      !v.project ||
      !this.exportDialog.open ||
      $<HTMLSelectElement>("export-format").value !== "video"
    ) {
      return;
    }
    this.previewRequest?.abort();
    const request = new AbortController();
    this.previewRequest = request;
    $("preview-loading").hidden = false;
    v.el("export-preview").setAttribute("aria-busy", "true");
    try {
      const response = await localFetch(
        `/api/projects/${v.project.id}/export/preview`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(this.exportOptions(v)),
          signal: request.signal,
        },
      );
      if (!response.ok) {
        throw new Error(await responseError(response, "Preview failed"));
      }
      const url = URL.createObjectURL(await response.blob());
      if (request.signal.aborted || !this.dialogOpen()) {
        URL.revokeObjectURL(url);
        return;
      }
      if (this.previewURL !== undefined && this.previewURL !== "") {
        URL.revokeObjectURL(this.previewURL);
      }
      this.previewURL = url;
      $("export-error").textContent = "";
      v.el<HTMLImageElement>("export-preview").src = url;
    } catch (error) {
      if (!request.signal.aborted) {
        $("export-error").textContent =
          `Preview: ${error instanceof Error ? error.message : String(error)}`;
      }
    } finally {
      if (this.previewRequest === request) {
        $("preview-loading").hidden = true;
        v.el("export-preview").removeAttribute("aria-busy");
      }
    }
  };
  schedulePreview = () => {
    clearTimeout(this.previewTimer);
    this.previewTimer = setTimeout(() => void this.renderExportPreview(), 150);
  };
  exportVideo = () =>
    $<HTMLSelectElement>("export-source").value === "b"
      ? this.editor.b
      : this.editor.a;
  exportPreview = () => {
    const v = this.exportVideo();
    if (!v.project) {
      return;
    }
    const format = $<HTMLSelectElement>("export-format").value;
    for (const view of this.editor.views()) {
      view.el("export-panel").hidden = view !== v;
    }
    $("export-name").textContent =
      `Video ${v.prefix.toUpperCase()}: ${v.project.name}`;
    const first = Math.max(
      0,
      Math.min(
        v.project.times.length - 1,
        Number(v.input("export-first").value),
      ),
    );
    const last = Math.max(
      first,
      Math.min(
        v.project.times.length - 1,
        Number(v.input("export-last").value),
      ),
    );

    v.el("export-summary").textContent =
      `Frames ${first} to ${last}. ${(required(v.project.times[first]) / 1000).toFixed(3)} s to ${(required(v.project.times[last]) / 1000).toFixed(3)} s source time.`;
    v.el("export-preview").hidden = format !== "video";
    v.el("export-summary").hidden = format !== "video";
    v
      .el("export-panel")
      .querySelector<HTMLElement>(".export-controls")!.hidden =
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
      const el = v.el(`export-${key}`);
      const root = el.closest<HTMLElement>(".field-row,.checkbox-label") ?? el;
      root.hidden = format === "chart";
    }
    $("export-error").textContent = "";
    this.schedulePreview();
  };
  openExport = (format: string) => {
    if (!this.editor.selected.project) {
      return;
    }
    this.editor.transport.pause();
    $<HTMLSelectElement>("export-format").value = format;
    $<HTMLSelectElement>("export-source").value = this.editor.selected.prefix;
    syncMaterialControls();
    this.exportPreview();
    this.exportDialog.dataset.variant = "basic";
    this.exportDialog.showModal();
    this.editor.operations.paintProcessing();
    this.editor.layout.render();
    this.schedulePreview();
  };
  exportOptions = (v: VideoView) => {
    const checked = (key: string) => v.input(`export-${key}`).checked;
    const chart = {
      ...this.editor.graph.exportOptions(v, checked("view")),
      statistics: checked("statistics"),
      markers: checked("markers"),
      comparison: undefined as object | undefined,
    };
    if (!checked("reference")) {
      chart.reference = undefined;
    }
    if (checked("comparison")) {
      const other = this.editor
        .views()
        .find((other) => other !== v && other.project !== null);
      if (!other) {
        throw new Error("Load a second video to include it in the export.");
      }
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
  };
  exportMedia = async (v: VideoView, kind: string) => {
    if (!v.project) {
      return;
    }
    const options = this.exportOptions(v);
    this.editor.operations.status(
      kind === "video" ? "Rendering selected frames…" : "Preparing chart…",
    );
    const response = await localFetch(
      `/api/projects/${v.project.id}/export/${kind}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(options),
      },
    );
    if (!response.ok) {
      throw new Error(await responseError(response, "Export failed"));
    }
    const url = URL.createObjectURL(await response.blob());
    const link = document.createElement("a");
    link.href = url;
    link.download = kind === "video" ? "annotated.mp4" : "motion-chart.svg";
    link.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 30_000);
    this.editor.operations.status("Export ready.");
  };
  bind = () => {
    for (const item of document.querySelectorAll<HTMLButtonElement>(
      "[data-export-format]",
    )) {
      item.onclick = () => {
        const format = item.dataset.exportFormat!;
        if (format === "csv" || format === "json") {
          void this.editor.operations.job(() =>
            this.editor.selected.download(format),
          );
        } else {
          this.openExport(format);
        }
      };
    }
    $("export-close").onclick = () => {
      this.exportDialog.close();
    };
    this.exportDialog.addEventListener("close", () => {
      clearTimeout(this.previewTimer);
      this.previewRequest?.abort();
      $("preview-loading").hidden = true;
      this.editor.operations.paintProcessing();
      this.editor.layout.render();
    });
    this.exportDialog.addEventListener("input", () => {
      this.schedulePreview();
    });
    for (const id of ["export-source", "export-format"]) {
      $(id).onchange = () => {
        if (this.exportVideo() === this.editor.b && !this.editor.b.project) {
          $<HTMLSelectElement>("export-source").value = "a";
          syncMaterialControls();
        }
        this.exportPreview();
      };
    }
    for (const v of this.editor.views()) {
      for (const key of ["first", "last"]) {
        v.input(`export-${key}`).addEventListener("input", this.exportPreview);
      }
    }
    for (const v of this.editor.views()) {
      for (const key of ["tracking", "playback", "full"]) {
        v.el(`export-range-${key}`).addEventListener(
          "click",
          this.exportPreview,
        );
      }
    }
    $("export-run").onclick = () =>
      void this.editor.operations.job(async () => {
        const v = this.exportVideo();
        const kind = $<HTMLSelectElement>("export-format").value;
        $("export-error").textContent = "";
        $("export-status").textContent = "Exporting…";
        try {
          await (kind === "json" || kind === "csv"
            ? v.download(kind)
            : this.exportMedia(v, kind));
          $("export-status").textContent = "Export ready.";
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);
          const cancelled = message.startsWith("Processing cancelled.");
          $("export-error").textContent = cancelled ? "" : message;
          $("export-status").textContent = cancelled ? "Export cancelled." : "";
          throw error;
        }
      });
  };
}
