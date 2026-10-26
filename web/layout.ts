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
    this.state = layoutState(saved, innerWidth);
    $("toggle-media").onclick = () => {
      this.state.media = !this.state.media;
      if (innerWidth < 1100 && this.state.media) this.state.tools = false;
      this.render(true);
    };
    $("close-media").onclick = () => {
      this.state.media = false;
      this.render(true);
      $("toggle-media").focus();
    };
    $("toggle-inspector").onclick = () => {
      this.state.tools = !this.state.tools;
      if (innerWidth < 1100 && this.state.tools) this.state.media = false;
      this.render(true);
    };
    $("close-inspector").onclick = () => {
      this.state.tools = false;
      this.render(true);
      $("toggle-inspector").focus();
    };
    for (const mode of ["tracking", "alignment", "reference"] as const) {
      $("inspect-" + mode).onclick = () => this.inspect(mode);
      $("open-" + mode).onclick = () => this.inspect(mode);
    }
    for (const id of ["maximize-viewer", "focus-viewer"])
      $(id).onclick = () => this.focus("viewer");
    for (const id of ["maximize-chart", "focus-chart"])
      $(id).onclick = () => this.focus("chart");
    $("restore-layout").onclick = () => {
      this.state.focus = "all";
      this.render(true);
    };
    $("reset-layout").onclick = () => {
      this.state = layoutState(null, innerWidth);
      this.render(true);
    };
    for (const id of ["media-panel", "inspector"]) {
      const panel = $<HTMLDialogElement>(id);
      panel.addEventListener("cancel", (e) => {
        e.preventDefault();
        if (id === "media-panel") this.state.media = false;
        else this.state.tools = false;
        this.render(true);
      });
      panel.addEventListener("click", (e) => {
        if (e.target !== panel || !panel.matches(":modal")) return;
        const r = panel.getBoundingClientRect();
        if (
          e.clientX >= r.left &&
          e.clientX <= r.right &&
          e.clientY >= r.top &&
          e.clientY <= r.bottom
        )
          return;
        if (id === "media-panel") this.state.media = false;
        else this.state.tools = false;
        this.render(true);
      });
    }
    for (const id of [
      "media-splitter",
      "inspector-splitter",
      "viewer-splitter",
    ])
      this.splitter(id);
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
    this.render();
  }
  closeMedia() {
    if (innerWidth < 1100) {
      this.state.media = false;
      this.render(true);
    }
  }
  inspect(mode: InspectorMode) {
    this.state.mode = mode;
    this.state.tools = true;
    if (innerWidth < 1100) this.state.media = false;
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
      const compact = innerWidth < 1100,
        shell = document.querySelector<HTMLElement>(".shell")!;
      const exporting = !!document.querySelector("#export-dialog:modal");
      this.panel(
        "media-panel",
        this.state.media &&
          (!compact || !this.loaded || !this.state.tools) &&
          !(compact && exporting),
        compact,
      );
      this.panel(
        "inspector",
        this.loaded && this.state.tools && !(compact && exporting),
        compact,
      );
      const bin = !compact && this.state.media,
        tools = !compact && this.loaded && this.state.tools;
      // Keep the working area usable when a wide saved layout is restored in a smaller window.
      const media = Math.min(
        this.state.mediaWidth,
        Math.max(200, innerWidth - 700),
      );
      const inspector = Math.min(
        this.state.toolsWidth,
        Math.max(328, innerWidth - (bin ? media + 10 : 0) - 520),
      );
      shell.style.setProperty("--media-width", `${bin ? media : 0}px`);
      shell.style.setProperty("--tools-width", `${tools ? inspector : 0}px`);
      shell.style.setProperty("--media-divider", bin ? "10px" : "0px");
      shell.style.setProperty("--tools-divider", tools ? "10px" : "0px");
      $("media-splitter").hidden = !bin;
      $("inspector-splitter").hidden = !tools;
      shell.dataset.focus = this.state.focus;
      for (const mode of ["tracking", "alignment", "reference"]) {
        $(mode + "-settings").hidden = mode !== this.state.mode;
        $("inspect-" + mode).setAttribute(
          "aria-pressed",
          String(mode === this.state.mode),
        );
      }
      for (const [id, open] of [
        ["toggle-media", this.state.media],
        ["toggle-inspector", this.state.tools],
      ] as const)
        $(id).setAttribute("aria-pressed", String(open));
      for (const area of ["viewer", "chart"])
        $("maximize-" + area).setAttribute(
          "aria-pressed",
          String(this.state.focus === area),
        );
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
      $("media-splitter").setAttribute(
        "aria-valuenow",
        String(Math.round((media / innerWidth) * 100)),
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
                Math.max(1, main.clientHeight - timeline.offsetHeight - 10),
          ),
        );
      } else {
        const key = id === "media-splitter" ? "mediaWidth" : "toolsWidth";
        this.state[key] = Math.max(
          key === "mediaWidth" ? 200 : 328,
          Math.min(
            key === "mediaWidth" ? 400 : 480,
            (drag?.width ?? this.state[key]) +
              delta * (key === "mediaWidth" ? 1 : -1),
          ),
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
        width:
          id === "media-splitter"
            ? this.state.mediaWidth
            : this.state.toolsWidth,
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
        }
        else if (id === "media-splitter") {
          this.state.media = false;
          this.render(true);
          $("toggle-media").focus();
        } else {
          this.state.tools = false;
          this.render(true);
          $("toggle-inspector").focus();
        }
      } else if (e.key === "Home") {
        e.preventDefault();
        if (horizontal) this.state.viewerRatio = 0.46;
        else if (id === "media-splitter") this.state.mediaWidth = 240;
        else this.state.toolsWidth = 360;
        this.render(true);
      }
    };
  }
}
