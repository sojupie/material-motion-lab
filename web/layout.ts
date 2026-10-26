import { $ } from "./api";
import {
  layoutState,
  paneSizes,
  type InspectorMode,
  type LayoutState,
} from "./layout-state";
const storageKey = "ui-motion-layout";
export class WorkspaceLayout {
  state: LayoutState;
  private loaded = false;
  private rendering = false;
  constructor(private changed: () => void) {
    let saved: unknown;
    try {
      saved = JSON.parse(localStorage.getItem(storageKey) || "null");
    } catch {}
    this.state = layoutState(saved);
    $("close-inspector").onclick = () => this.closeTools();
    for (const mode of ["tracking", "alignment", "reference"] as const) {
      $("inspect-" + mode).onclick = () => this.inspect(mode);
      $("open-" + mode).onclick = () => this.inspect(mode);
    }
    for (const id of ["maximize-viewer"])
      $(id).onclick = () => this.focus("viewer");
    for (const id of ["maximize-chart"])
      $(id).onclick = () => this.focus("chart");
    $("restore-layout").onclick = () => {
      this.state.focus = "all";
      this.render(true);
    };
    const panel = $<HTMLDialogElement>("inspector");
    panel.addEventListener("cancel", (e) => {
      e.preventDefault();
      this.closeTools();
    });
    panel.addEventListener("click", (e) => {
      if (e.target !== panel || !panel.matches(":modal")) return;
      const r = panel.getBoundingClientRect();
      if (
        e.clientX < r.left ||
        e.clientX > r.right ||
        e.clientY < r.top ||
        e.clientY > r.bottom
      )
        this.closeTools();
    });
    for (const mode of ["tracking", "alignment", "reference"] as const) {
      $("inspect-" + mode).addEventListener("focus", () => this.inspect(mode));
    }
    this.splitter("viewer-splitter");
    this.splitter("inspector-splitter");
    new ResizeObserver(() => this.render()).observe(
      document.querySelector(".editing-main")!,
    );
    new ResizeObserver(() => this.render()).observe(
      document.querySelector(".timeline-panel")!,
    );
    addEventListener("resize", () => this.render());
    this.render();
  }
  projectLoaded() {
    this.loaded = true;
    this.state.focus = "all";
    this.state.tools = false;
    this.render();
  }
  home() {
    this.loaded = false;
    this.state.focus = "all";
    this.state.tools = false;
    this.render();
  }
  closeTools() {
    this.state.tools = false;
    this.render(true);
    $("open-" + this.state.mode).focus();
  }
  inspect(mode: InspectorMode) {
    this.state.mode = mode;
    this.state.tools = true;
    this.render(true);
  }
  private focus(area: "viewer" | "chart") {
    this.state.focus = this.state.focus === area ? "all" : area;
    this.render(true);
  }
  private save() {
    try {
      localStorage.setItem(storageKey, JSON.stringify(this.state));
    } catch {}
  }
  private panel(id: string, visible: boolean, modal: boolean) {
    const panel = $<HTMLDialogElement>(id);
    if (panel.open && (!visible || panel.matches(":modal") !== modal))
      panel.close();
    panel.dataset.control = modal ? "modal" : "docked";
    if (visible && !panel.open) {
      if (modal) panel.showModal();
      else panel.show();
    }
  }
  render(save = false) {
    if (this.rendering) return;
    this.rendering = true;
    try {
      const compact = innerWidth < 1280,
        shell = document.querySelector<HTMLElement>(".shell")!;
      const exporting = !!document.querySelector("#export-dialog:modal");
      this.panel(
        "inspector",
        this.loaded && this.state.tools && !(compact && exporting),
        compact,
      );
      const tools = !compact && this.loaded && this.state.tools;
      const inspector = Math.min(
        this.state.toolsWidth,
        Math.max(328, innerWidth - 920),
      );
      shell.style.setProperty("--tools-width", `${tools ? inspector : 0}px`);
      shell.style.setProperty("--tools-divider", tools ? "12px" : "0px");
      $("inspector-splitter").hidden = !tools;
      $("app-navigation").hidden = !this.loaded;
      shell.dataset.editor = String(this.loaded);
      $("restore-layout").hidden = this.state.focus === "all";
      shell.dataset.focus = this.state.focus;
      for (const mode of ["tracking", "alignment", "reference"]) {
        $(mode + "-settings").hidden = mode !== this.state.mode;
        $("inspect-" + mode).tabIndex = mode === this.state.mode ? 0 : -1;
        $("inspect-" + mode).setAttribute(
          "aria-selected",
          String(mode === this.state.mode),
        );
      }
      for (const area of ["viewer", "chart"]) {
        const button = $("maximize-" + area);
        const name =
          this.state.focus === area ? "Restore workspace" : `Expand ${area}`;
        button.setAttribute("aria-label", name);
        button.title = name;
      }
      const main = document.querySelector<HTMLElement>(".editing-main")!,
        timeline = document.querySelector<HTMLElement>(".timeline-panel")!;
      const size = paneSizes(
        main.clientHeight,
        timeline.offsetHeight,
        this.state.viewerRatio,
      );
      main.style.setProperty("--viewer-height", `${size.viewer}px`);
      $("viewer-splitter").setAttribute(
        "aria-valuenow",
        String(Math.round(this.state.viewerRatio * 100)),
      );
      $("inspector-splitter").setAttribute(
        "aria-valuenow",
        String(Math.round((inspector / innerWidth) * 100)),
      );
      if (save) this.save();
    } finally {
      this.rendering = false;
    }
    this.changed();
  }
  private splitter(id: string) {
    const el = $(id),
      horizontal = id === "viewer-splitter";
    let drag: { x: number; y: number; width: number; ratio: number } | null =
      null;
    const update = (delta: number) => {
      if (horizontal) {
        const main = document.querySelector<HTMLElement>(".editing-main")!,
          timeline = document.querySelector<HTMLElement>(".timeline-panel")!;
        this.state.viewerRatio = Math.max(
          0.15,
          Math.min(
            0.85,
            (drag?.ratio ?? this.state.viewerRatio) +
              delta /
                Math.max(1, main.clientHeight - timeline.offsetHeight - 12),
          ),
        );
      } else {
        const key = "toolsWidth";
        this.state[key] = Math.max(
          328,
          Math.min(480, (drag?.width ?? this.state[key]) + delta * -1),
        );
      }
      this.render();
    };
    el.onpointerdown = (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      el.focus();
      drag = {
        x: e.clientX,
        y: e.clientY,
        width: this.state.toolsWidth,
        ratio: this.state.viewerRatio,
      };
      el.setPointerCapture(e.pointerId);
      el.classList.add("dragging");
    };
    el.onpointermove = (e) => {
      if (drag) update(horizontal ? e.clientY - drag.y : e.clientX - drag.x);
    };
    const finish = () => {
      drag = null;
      el.classList.remove("dragging");
      this.save();
    };
    el.onpointerup = finish;
    el.onpointercancel = finish;
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
        } else this.closeTools();
      } else if (e.key === "Home") {
        e.preventDefault();
        if (horizontal) this.state.viewerRatio = 0.46;
        else this.state.toolsWidth = 360;
        this.render(true);
      }
    };
  }
}
