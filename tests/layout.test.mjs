import test from "node:test";
import assert from "node:assert/strict";
import { layoutState, paneSizes, toolsWidth, viewerRatio } from "../web/layout-state.ts";
test("startup exposes the viewer and preserves its split", () => {
  const s = layoutState({
    tools: true,
    focus: "chart",
    mode: "reference",
    viewerRatio: 0.65,
  });
  assert.equal(s.focus, "all");
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
  assert.equal(s.focus, "all");
  assert.equal(s.toolsWidth, 320);
  assert.equal(s.viewerRatio, 0.46);
  assert.deepEqual(layoutState("corrupt"), layoutState(null));
});
test("pane sizes divide available space and preserve usable minimums", () => {
  for (const ratio of [0.15, 0.46, 0.85]) {
    const s = paneSizes(1000, 200, ratio);
    assert.ok(s.viewer + s.chart >= 776);
    assert.ok(s.viewer >= 180);
    assert.ok(s.chart >= 340);
  }
  const short = paneSizes(300, 200, 0.46);
  assert.equal(short.viewer, 180);
  assert.equal(short.chart, 340);
});

test("empty library gets more space without changing the loaded viewer split", () => {
  const state = layoutState({viewerRatio:0.35});
  assert.equal(state.libraryRatio,0.75);
  assert.equal(state.viewerRatio,0.35);
  const library=paneSizes(1000,100,state.libraryRatio,true);
  assert.equal(library.viewer,657);
  assert.equal(library.chart,340);
  assert.ok(paneSizes(1000,100,0.85,true).viewer > paneSizes(1000,100,0.55,true).viewer);
  assert.equal(layoutState({...state,libraryRatio:0.6}).libraryRatio,0.6);
});

test("dividers move immediately from displayed dimensions, including at old limits", () => {
  const available = 500;
  assert.equal(paneSizes(724, 200, viewerRatio(260, 20, available)).viewer, 280);
  assert.equal(paneSizes(724, 200, viewerRatio(260, -20, available)).viewer, 240);
  assert.equal(toolsWidth(480, 1200), 480);
  assert.equal(toolsWidth(820, 1200), 820);
  assert.equal(toolsWidth(100, 1200), 320);
  const displayed = toolsWidth(900, 1000);
  assert.equal(displayed, 628);
  assert.equal(toolsWidth(displayed - 16, 1000), 612);
  assert.equal(paneSizes(1000, 200, 1).viewer, 776);
});
