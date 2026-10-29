import { $ } from "./api";
import { setIcon } from "./icons";
import {
  applyLayoutSize,
  layoutHeight,
  layoutRatioKey,
  layoutStorageKey,
  restoredLayout,
} from "./initial-layout";
import type { LayoutState } from "./layout-state";
import { toolsWidth, viewerRatio } from "./layout-state";
import { setButtonToggle } from "./material";

export class WorkspaceLayout {
  state: LayoutState;
  private rendering = false;
  constructor(private readonly changed: () => void) {
    this.state = restoredLayout();
    for (const id of ["maximize-viewer"]) {
      $(id).onclick = () => {
        this.focus("viewer");
      };
    }
    for (const id of ["maximize-chart"]) {
      $(id).onclick = () => {
        this.focus("chart");
      };
    }
    this.splitter("viewer-splitter");
    this.splitter("inspector-splitter");
    new ResizeObserver(() => {
      this.render();
    }).observe(document.querySelector(".editing-main")!);
    new ResizeObserver(() => {
      this.render();
    }).observe(document.querySelector(".timeline-panel")!);
    addEventListener("resize", () => {
      this.render();
    });
    this.render();
  }
  projectLoaded() {
    this.state.focus = "all";
    this.render();
  }
  private focus(area: "viewer" | "chart") {
    this.state.focus = this.state.focus === area ? "all" : area;
    this.render(true);
  }
  private save() {
    try {
      localStorage.setItem(layoutStorageKey, JSON.stringify(this.state));
    } catch {}
  }
  render(save = false) {
    if (this.rendering) {
      return;
    }
    this.rendering = true;
    try {
      const inspector = applyLayoutSize(this.state);
      const shell = document.querySelector<HTMLElement>(".shell")!;
      shell.dataset.focus = this.state.focus;
      for (const area of ["viewer", "chart"]) {
        const button = $(`maximize-${area}`);
        const name =
          this.state.focus === area ? "Restore layout" : `Expand ${area}`;
        button.setAttribute("aria-label", name);
        button.title = name;
        setButtonToggle(button, this.state.focus === area);
        const label = button.querySelector("span")!;
        if (label.textContent !== name) {
          label.textContent = name;
        }
        setIcon(
          button.querySelector("svg")!,
          this.state.focus === area ? "collapse_content" : "expand_content",
        );
      }
      $("viewer-splitter").tabIndex = this.state.focus === "all" ? 0 : -1;
      $("viewer-splitter").setAttribute(
        "aria-hidden",
        String(this.state.focus !== "all"),
      );
      $("viewer-splitter").setAttribute(
        "aria-valuenow",
        String(Math.round(this.state[layoutRatioKey()] * 100)),
      );
      $("inspector-splitter").setAttribute(
        "aria-valuenow",
        String(Math.round((inspector / innerWidth) * 100)),
      );
      if (save) {
        this.save();
      }
    } finally {
      this.rendering = false;
    }
    this.changed();
  }
  private splitter(id: string) {
    const el = $(id);
    const horizontal = id === "viewer-splitter";
    let drag: {
      x: number;
      y: number;
      width: number;
      viewer: number;
      available: number;
    } | null = null;
    const update = (delta: number) => {
      if (horizontal) {
        const main = document.querySelector<HTMLElement>(".editing-main")!;
        const timeline =
          document.querySelector<HTMLElement>(".timeline-panel")!;
        this.state[layoutRatioKey()] = viewerRatio(
          drag?.viewer ?? $("viewer-area").getBoundingClientRect().height,
          delta,
          drag?.available ??
            Math.max(0, layoutHeight(main) - timeline.offsetHeight - 24),
        );
      } else {
        const shell = document.querySelector<HTMLElement>(".shell")!;
        this.state.toolsWidth = toolsWidth(
          (drag?.width ??
            document
              .querySelector<HTMLElement>(".tools-column")!
              .getBoundingClientRect().width) - delta,
          shell.clientWidth - 24,
        );
      }
      this.render();
    };
    el.onpointerdown = (e) => {
      if (e.button !== 0) {
        return;
      }
      e.preventDefault();
      el.focus({ preventScroll: true });
      const main = document.querySelector<HTMLElement>(".editing-main")!;
      drag = {
        x: e.clientX,
        y: e.clientY,
        width: document
          .querySelector<HTMLElement>(".tools-column")!
          .getBoundingClientRect().width,
        viewer: $("viewer-area").getBoundingClientRect().height,
        available: Math.max(
          0,
          layoutHeight(main) -
            document.querySelector<HTMLElement>(".timeline-panel")!
              .offsetHeight -
            24,
        ),
      };
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
      document.body.dataset.paneResize = horizontal ? "row" : "column";
    };
    el.onpointermove = (e) => {
      if (drag) {
        update(horizontal ? e.clientY - drag.y : e.clientX - drag.x);
      }
    };
    const finish = () => {
      drag = null;
      el.classList.remove("dragging");
      delete document.body.dataset.paneResize;
      this.save();
    };
    el.onpointerup = finish;
    el.onpointercancel = finish;
    el.onlostpointercapture = finish;
    el.onkeydown = (e) => {
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        update(
          (e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 1) *
            (e.shiftKey ? 40 : 16),
        );
        this.save();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (horizontal) {
          this.focus("viewer");
          $("maximize-viewer").focus();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        if (horizontal) {
          this.state[layoutRatioKey()] =
            layoutRatioKey() === "libraryRatio" ? 0.75 : 0.46;
        } else {
          this.state.toolsWidth = 480;
        }
        this.render(true);
      }
    };
  }
}
