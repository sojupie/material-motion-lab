import { $ } from "./api";
import { cancelProcessing,onProcessingProgress } from "./local-client";
import { showSnackbar } from "./material";
import type { ProcessingProgress } from "./processing-progress";
import { progressPercent } from "./processing-progress";
import type { WorkspaceController } from "./workspace";

export class OperationsController {
  constructor(private readonly editor: WorkspaceController) {}
  busy = false;
  processing: ProcessingProgress = { label: "Working…" };
  processingVisible = false;
  status = (text: string, error = false, opener?: HTMLElement) => {
    if (this.busy && !error && text.endsWith("…")) {
      this.processing = { label: text };
      this.paintProcessing();
      return;
    }
    const bar = $("status");
    bar.querySelector(".md-feedback-text")!.textContent = text;
    bar.setAttribute("role", error ? "alert" : "status");
    bar.setAttribute("aria-live", error ? "assertive" : "polite");
    if (text) {
      showSnackbar(bar, opener);
    } else if (bar.matches(":popover-open")) {
      bar.hidePopover();
    }
  };
  paintProcessing = () => {
    const percent = progressPercent(this.processing);
    for (const panel of document.querySelectorAll<HTMLElement>(
      "[data-processing-status]",
    )) {
      const exporting = $<HTMLDialogElement>("export-dialog").open;
      panel.hidden =
        !this.processingVisible ||
        (panel.id === "export-processing-status") !== exporting ||
        (document.querySelector("dialog:modal") !== null && !exporting);
      const label = panel.querySelector<HTMLElement>(
        "[data-processing-label]",
      )!;
      if (label.textContent !== this.processing.label) {
        label.textContent = this.processing.label;
      }
      panel.querySelector<HTMLElement>(
        "[data-processing-percent]",
      )!.textContent = percent === null ? "" : `${percent}%`;
      const bar = panel.querySelector<HTMLElement>("[data-processing-bar]")!;
      bar.dataset.control = percent === null ? "indeterminate" : "determinate";
      bar.setAttribute("aria-label", this.processing.label);
      if (percent === null) {
        bar.removeAttribute("aria-valuenow");
        bar.removeAttribute("aria-valuemin");
        bar.removeAttribute("aria-valuemax");
      } else {
        bar.setAttribute("aria-valuemin", "0");
        bar.setAttribute("aria-valuemax", "100");
        bar.setAttribute("aria-valuenow", String(percent));
      }
    }
  };
  job = async (fn: () => Promise<void>) => {
    if (this.busy) {
      return;
    }
    this.editor.transport.pause();
    this.busy = true;
    if ($("status").matches(":popover-open")) {
      $("status").hidePopover();
    }
    document.body.dataset.processing = "true";
    $("video-panes").setAttribute("aria-busy", "true");
    this.editor.controls();
    this.processing = { label: "Working…" };
    const indicatorTimer = setTimeout(() => {
      this.processingVisible = true;
      this.paintProcessing();
    }, 200);
    try {
      await fn();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.status(message, !message.startsWith("Processing cancelled."));
    } finally {
      this.busy = false;
      clearTimeout(indicatorTimer);
      this.processingVisible = false;
      this.paintProcessing();
      delete document.body.dataset.processing;
      $("video-panes").removeAttribute("aria-busy");
      this.editor.controls();
    }
  };
  bind = () => {
    onProcessingProgress((progress, path) => {
      if (
        this.busy &&
        !/\/measure(?:\?|$)|\/export\/preview(?:\?|$)|\/references/.test(path)
      ) {
        this.processing = progress;
        this.paintProcessing();
      }
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>(
      "[data-cancel-processing]",
    )) {
      button.onclick = () => {
        cancelProcessing();
      };
    }
  };
}
