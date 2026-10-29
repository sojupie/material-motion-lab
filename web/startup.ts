import "../../tokens/forge/site/site.js";
import { applyLayoutSize, restoredLayout } from "./initial-layout";

// Runs at the end of the parsed shell, before the deferred component scripts.
applyLayoutSize(restoredLayout());

// The initial shell has no active video; keep transport controls inert until
// The workspace has installed their handlers and restored its state.
for (const id of [
  "playback-speed",
  "playback-loop",
  "filter-playback-speed",
  "playback-interval",
  "maximize-chart",
]) {
  const control = document.querySelector<HTMLInputElement | HTMLButtonElement>(
    `#${id}`,
  );
  if (control) {control.disabled = true;}
}
