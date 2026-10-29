import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
import ts from "typescript";
const modules = {};
function load(name) {
  if (modules[name]) return modules[name];
  const exports = {};
  modules[name] = exports;
  const code = ts.transpileModule(fs.readFileSync(`web/${name}.ts`, "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  vm.runInNewContext(code, {
    exports,
    require: (n) =>
      n.startsWith("./") ? load(n.replace("./", "")) : { default: require(n) },
  });
  return exports;
}
const { referenceAt, measure, track, validateReference } =
  load("local-analysis");
test("browser reference fitting recovers known easing duration and spring response", () => {
  const ref = { kind: "bezier", curve: [0.2, 0, 0, 1] },
    times = Array.from({ length: 21 }, (_, i) => i * 15),
    p = {
      times,
      samples: times.map((t, frame) => ({
        frame,
        t,
        x: 100 * referenceAt(ref, t, 300),
        y: 0,
        valid: true,
      })),
    };
  const m = measure(p, {
    axis: "x",
    start: 0,
    end: 20,
    reference: ref,
    duration: 500,
    fit: true,
  });
  assert.ok(Math.abs(m.duration - 300) < 0.001);
  assert.ok(m.rmse < 0.001);
  assert.equal(
    referenceAt({ kind: "spring", stiffness: 100, damping: 1 }, 100, 300),
    1 - 2 / Math.E,
  );
  assert.throws(() =>
    validateReference({ kind: "bezier", curve: [-1, 0, 0, 1] }),
  );
});
test("browser edge and span tracking retains subpixel positions and rejects invalid regions", async () => {
  const width = 100,
    height = 20,
    times = [0, 16, 32],
    p = {
      id: "test",
      width,
      height,
      times,
      anchors: [],
      samples: [],
      settings: {},
    };
  const frame = async (i) => {
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++)
        data[y * width + x] = x >= 20 + i && x < 60 + i ? 220 : 20;
    return { data, width, height };
  };
  const progress=[];
  const result = await track(
    p,
    {
      region: [20, 2, 40, 16],
      start: 0,
      end: 2,
      search: 8,
      threshold: 0.6,
      method: "width",
    },
    frame,
    undefined,
    (label,current,total)=>progress.push({label,current,total}),
  );
  assert.equal(result.samples.length, 3);
  assert.equal(progress.at(-1).current,3);
  assert.equal(progress.at(-1).total,3);
  assert.ok(
    result.samples.every(
      (s) => s.valid && Math.abs(s.measuredWidth - 40) < 0.01,
    ),
  );
  assert.ok(Math.abs(result.samples[2].x - result.samples[0].x - 2) < 0.01);
  await assert.rejects(
    track(
      p,
      {
        region: [-1, 0, 5, 5],
        start: 0,
        end: 2,
        search: 8,
        threshold: 0.6,
        method: "edge-x",
      },
      frame,
    ),
  );
});
test("browser boundary contains no transport upload or server frame fetch", () => {
  const api = fs.readFileSync("web/api.ts", "utf8");
  assert.ok(!api.includes("fetch("));
  assert.ok(api.includes("localRequest"));
  for (const file of ["web/main.ts", "web/video.ts"])
    assert.ok(!/\bawait fetch\(/.test(fs.readFileSync(file, "utf8")), file);
  assert.ok(
    fs
      .readFileSync("internal/web/static.go", "utf8")
      .includes("http.StatusMethodNotAllowed"),
  );
});

test("browser patch matching uses OpenCV normalized correlation and follows translation", async () => {
  const width = 40,
    height = 32,
    p = {
      id: "patch",
      width,
      height,
      times: [0, 16, 32],
      anchors: [],
      samples: [],
      settings: {},
    };
  const frame = async (i) => {
    const data = new Uint8Array(width * height);
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        const xx = x - i,
          yy = y - i;
        data[y * width + x] =
          xx >= 5 && xx < 15 && yy >= 5 && yy < 15
            ? ((xx * 73 + yy * 29 + xx * yy * 7) % 230) + 20
            : 0;
      }
    return { data, width, height };
  };
  const cv = require("@techstark/opencv-js");
  if (!cv.Mat)
    await new Promise((resolve) => (cv.onRuntimeInitialized = resolve));
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync("public/opencv/worker.js", "utf8"), {
    module,
  });
  const result = await track(
    p,
    {
      region: [5, 5, 10, 10],
      start: 0,
      end: 2,
      search: 4,
      threshold: 0.65,
      method: "feature",
    },
    frame,
    (g, t, r) => Promise.resolve(module.exports.matchPatch(cv, g, t, r)),
  );
  assert.ok(result.samples.every((s) => s.valid));
  assert.ok(Math.abs(result.samples[2].x - 7) < 0.1);
  assert.ok(Math.abs(result.samples[2].y - 7) < 0.1);
});
