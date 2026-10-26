import test from "node:test";
import assert from "node:assert/strict";
import { fitScale, zoomScale, panScale } from "../web/graph-scale.ts";
test("fit includes all finite samples and reference values with room around flat traces", () => {
  assert.deepEqual(fitScale([0, 100, 120, NaN], 1), [-12, 132]);
  assert.deepEqual(fitScale([100, 100], 1), [99, 101]);
  assert.deepEqual(fitScale([], 0.1), [-0.1, 0.1]);
});
test("vertical zoom keeps the center and pan keeps the span", () => {
  assert.deepEqual(zoomScale([0, 100], 0.5), [25, 75]);
  assert.deepEqual(zoomScale([25, 75], 2), [0, 100]);
  assert.deepEqual(panScale([25, 75], 0.2), [35, 85]);
  assert.deepEqual(panScale([-10, 10], -0.5), [-20, 0]);
});
