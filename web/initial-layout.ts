import type { LayoutState } from "./layout-state";
import { layoutState, paneSizes, toolsWidth } from "./layout-state";

export const layoutStorageKey = "ui-motion-layout";
export function restoredLayout(): LayoutState {
  try {
    return layoutState(
      JSON.parse(localStorage.getItem(layoutStorageKey) ?? "null") as unknown,
    );
  } catch {
    return layoutState(null);
  }
}
export function layoutRatioKey(): "libraryRatio" | "viewerRatio" {
  return document.querySelector<HTMLElement>("#empty-viewer")!.hidden === false
    ? "libraryRatio"
    : "viewerRatio";
}
export function layoutHeight(main: HTMLElement): number {
  if (layoutRatioKey() !== "libraryRatio" || innerWidth <= 700)
    {return main.clientHeight;}
  return Math.max(
    parseFloat(getComputedStyle(main).minBlockSize) || 0,
    innerHeight - main.getBoundingClientRect().top - scrollY - 12,
  );
}
export function applyLayoutSize(state: LayoutState) {
  const docked = innerWidth >= 1000;
  const shell = document.querySelector<HTMLElement>(".shell")!;
  const inspector = toolsWidth(state.toolsWidth, shell.clientWidth - 24);
  shell.style.setProperty("--tools-width", `${docked ? inspector : 0}px`);
  shell.style.setProperty("--tools-divider", docked ? "12px" : "0px");
  document.querySelector<HTMLElement>("#inspector-splitter")!.hidden = !docked;
  const main = document.querySelector<HTMLElement>(".editing-main")!;
  const timeline = document.querySelector<HTMLElement>(".timeline-panel")!;
  main.style.setProperty("--library-height", `${layoutHeight(main)}px`);
  const size = paneSizes(
    layoutHeight(main),
    timeline.offsetHeight,
    state[layoutRatioKey()],
    layoutRatioKey() === "libraryRatio",
  );
  main.style.setProperty("--viewer-height", `${size.viewer}px`);
  return inspector;
}
