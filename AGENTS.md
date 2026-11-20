# Material Motion Lab

Use Token Catalog's tokens, layout rules (`../tokens/docs/reference/layout.md`),
and Forge components (`../tokens/docs/reference/components-api.md`). Fix shared
component defects in `../tokens` first with a regression test, then refresh this
app's imported assets (`npm run material`).

## Workspace invariants

- **Shared shell:** Uses `forge/site/` from `../tokens`; no separate app title
  bar or app navigation rail.
- **Responsive tools (1000 px):** At ≥ 1000 px, dock the permanent right tools
  panel (independent **Tracking**, **Alignment**, **Chart** accordions; no
  dismiss/modal state) under a floating **Project / Import / Export** toolbar.
  Below 1000 px, use the floating bottom toolbar + anchored menus—never a side
  sheet or full-screen menu.
- **Empty & export states:** Keep the workspace visible with no video (Import
  video, Open example, and recent projects directly in the viewer). Export
  settings stay in a dedicated dialog until opened.
- **Splitters & minimums:** Tools panel starts at 480 px (min 320 px, leaving
  ≥ 360 px workspace); loaded viewer ≥ 180 px, library ≥ 240 px, chart ≥ 260 px;
  timeline has no height splitter. Support keyboard resize/collapse/reset, clamp
  restored sizes, and never restore a maximized view on load.
- **Controls:** Transport (play/pause, prev/next) is a standard button group,
  not a radio group. Reserve persistent selected styling for true modes/toggles.
  Keep **Tracking marks** visible but disabled when empty.

## Safety & review

Preserve recordings and measurement data; use temporary project copies for
tracking and export tests. Leave visual changes on the local server for review
before pushing.
