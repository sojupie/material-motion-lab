import test from "node:test";
import assert from "node:assert/strict";
import { layoutState, paneSizes } from "../web/layout-state.ts";
test("startup always exposes the viewer and closes contextual tools", () => {
  const s = layoutState({
    tools: true,
    focus: "chart",
    mode: "reference",
    viewerRatio: 0.65,
  });
  assert.equal(s.tools, false);
  assert.equal(s.focus, "all");
  assert.equal(s.mode, "reference");
  assert.equal(s.viewerRatio, 0.65);
});
test("saved layout clamps invalid dimensions and accepts legacy values", () => {
  const s = layoutState({
    media: true,
    tools: false,
    mode: "reference",
    focus: "chart",
    toolsWidth: -1,
    viewerRatio: NaN,
  });
  assert.equal(s.mode, "reference");
  assert.equal(s.focus, "all");
  assert.equal(s.toolsWidth, 328);
  assert.equal(s.viewerRatio, 0.46);
  assert.deepEqual(layoutState("corrupt"), layoutState(null));
  assert.equal(layoutState({ mode: "export" }).mode, "tracking");
});
test("pane sizes divide available space and preserve usable minimums", () => {
  for (const ratio of [0.15, 0.46, 0.85]) {
    const s = paneSizes(800, 200, ratio);
    assert.equal(s.viewer + s.chart, 588);
    assert.ok(s.viewer >= 150);
    assert.ok(s.chart >= 230);
  }
  const short = paneSizes(300, 200, 0.46);
  assert.equal(short.viewer, 150);
  assert.equal(short.chart, 230);
});
