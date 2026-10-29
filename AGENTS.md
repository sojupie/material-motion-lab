# UI Motion

Read [docs/design-guidelines.md](docs/design-guidelines.md) before designing or changing the UI. It defines workspace layout, control placement, disclosure, hierarchy, pane resizing and review expectations.

Design the task and its states before placing controls. Use the actual Token Catalog tokens and shared components. Keep app layout decisions distinct from upstream component requirements. Do not compensate for missing hierarchy by exposing every setting, shrinking text or overriding shared component geometry.

Preserve recordings and measurement data. Use temporary project copies for tracking and export tests. Leave visual changes on the local server for review before pushing.

Fix shared component defects in Token Catalog first, with a regression test, then refresh this app’s imported assets. App-specific adjustments must serve the workspace context; do not use them to conceal defects in shared sizing, motion or interaction behavior.
