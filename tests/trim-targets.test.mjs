import test from "node:test";
import assert from "node:assert/strict";
import { nearestTrimHandle, TRIM_TARGET_SIZE } from "../web/trim-targets.ts";
test("grab areas surround each handle on every side", () => {
  const centers = [{ x: 100, y: 100 }];
  assert.equal(TRIM_TARGET_SIZE, 52);
  for (const [x, y] of [
    [75, 100],
    [125, 100],
    [100, 75],
    [100, 125],
    [100, 100],
  ])
    assert.equal(nearestTrimHandle(centers, x, y), 0);
  assert.equal(nearestTrimHandle(centers, 127, 100), -1);
});
test("nearby endpoints remain selectable even when grab areas overlap", () => {
  const centers = [
    { x: 100, y: 100 },
    { x: 108, y: 100 },
    { x: 100, y: 164 },
  ];
  assert.equal(nearestTrimHandle(centers, 101, 100), 0);
  assert.equal(nearestTrimHandle(centers, 107, 100), 1);
  assert.equal(nearestTrimHandle(centers, 100, 164), 2);
  assert.equal(nearestTrimHandle(centers, 100, 135), -1);
});

test("playback flags do not capture the ruler or tracks outside their own lane", () => {
  const flags = [{ x: 105, y: 28, width: 24, height: 24 }];
  assert.equal(nearestTrimHandle(flags, 105, 28), 0);
  assert.equal(nearestTrimHandle(flags, 125, 28), -1);
  assert.equal(nearestTrimHandle(flags, 105, 45), -1);
  assert.equal(nearestTrimHandle(flags, 105, 10), -1);
});
