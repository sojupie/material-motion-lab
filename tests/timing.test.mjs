import test from "node:test";
import assert from "node:assert/strict";
import { nearest, milliseconds } from "../web/timing.ts";

test("aligned playback uses timestamps across different frame rates", () => {
  const a = [0, 16.667, 33.333, 50, 66.667, 83.333, 100];
  const b = [0, 40, 80, 120, 160];
  const offset = a[4] - a[1];
  assert.equal(nearest(b, b[2] + offset), 3);
  assert.equal(nearest(a, a[1] + offset), 4);
  assert.equal(nearest(b, -20), 0);
  assert.equal(nearest(b, 1000), b.length - 1);
  // Variable frame intervals retain their recorded timing.
  assert.equal(nearest([0, 10, 70, 90], 65), 2);
});

test("CSS durations convert seconds and milliseconds to milliseconds", () => {
  assert.equal(milliseconds("0.3s"), 300);
  assert.equal(milliseconds("300ms"), 300);
  assert.equal(milliseconds(" .25s "), 250);
  assert.equal(milliseconds("0ms"), 0);
  for (const token of ["300", "NaNms", "-1s", "garbage"])
    assert.throws(() => milliseconds(token));
});
