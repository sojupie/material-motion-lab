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

test("workspace alignment and source-frame mapping preserve recorded timestamps", async () => {
  const { sourceFrame, alignedOffset, clampRange } =
    await import("../web/timing.ts");
  const a = [0, 16.667, 33.333, 50],
    b = [0, 40, 80, 120];
  const offset = alignedOffset(a[2], 100, b[1]);
  assert.equal(offset, 93.333);
  assert.equal(sourceFrame(a, 100, 133.333), 2);
  assert.equal(sourceFrame(b, offset, 133.333), 1);
  assert.equal(sourceFrame(b, -100, -60), 1);
  assert.deepEqual(clampRange(-4, 100, 30), [0, 29]);
  assert.deepEqual(clampRange(12, 2, 30), [12, 12]);
  assert.deepEqual(clampRange(1.2, 7.6, 30), [1, 8]);
});

test("scrubbing snaps to recorded frames with clip offsets and irregular intervals", async () => {
  const { snapTime } = await import("../web/timing.ts");
  const times = [0, 10, 70, 90];
  assert.equal(snapTime(times, 100, 165), 170);
  assert.equal(snapTime(times, -50, -32), -40);
  assert.equal(snapTime(times, 100, 1000), 190);
  assert.equal(snapTime(times, 100, 140), 110); // equidistant: earlier frame
});

test("playback respects range, speed, looping and the final frame's duration", async () => {
  const { playbackPosition: at } = await import("../web/timing.ts");
  assert.deepEqual(at(100, 50, 0.5, [100, 200], false, 20), {
    time: 125,
    done: false,
  });
  assert.deepEqual(at(150, 25, 2, [100, 200], false, 20), {
    time: 200,
    done: true,
  });
  assert.deepEqual(at(100, 110, 1, [100, 200], true, 20), {
    time: 200,
    done: false,
  });
  assert.deepEqual(at(100, 125, 1, [100, 200], true, 20), {
    time: 105,
    done: false,
  });
  assert.deepEqual(at(100, 245, 1, [100, 200], true, 20), {
    time: 105,
    done: false,
  });
  assert.deepEqual(at(100, 10, 1, [100, 100], true, 20), {
    time: 100,
    done: true,
  });
});

test("workspace frame grid handles mixed rates, clip gaps and range endpoints", async () => {
  const { workspaceFrame: snap } = await import("../web/timing.ts");
  const tracks = [
    { times: [0, 10, 70, 90], offset: 100 },
    { times: [0, 40, 80], offset: 300 },
  ];
  assert.equal(snap(tracks, 0, 165), 170);
  assert.equal(snap(tracks, 0, 335), 340); // outside selected clip
  assert.equal(snap(tracks, 0, 250), 300); // gap snaps to a real frame
  assert.equal(snap(tracks, 0, 185, [110, 175]), 170); // no frame outside range
  assert.equal(snap(tracks, 0, 340, [300, 380]), 340);
});
