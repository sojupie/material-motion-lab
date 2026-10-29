import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { indexedDB, IDBKeyRange } from "fake-indexeddb";
const exports = {};
vm.runInNewContext(
  ts.transpileModule(fs.readFileSync("web/local-store.ts", "utf8"), {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText,
  { exports, indexedDB, IDBKeyRange, Error },
);
test("deleting a local project preserves shared recordings and removes unreferenced frames atomically", async () => {
  const { read, write, saveVideo, removeProject, all } = exports;
  await saveVideo(
    {
      id: "media",
      project: { id: "media" },
      source: new Blob(["video"]),
      extension: ".mp4",
    },
    [new Blob(["frame"])],
  );
  for (const id of ["a", "b"])
    await write("projects", id, {
      id,
      schema: 1,
      name: id,
      tracks: [{ id: "media" }],
    });
  await removeProject("a");
  assert.equal((await read("videos", "media")).id, "media");
  assert.equal((await read("frames", ["media", 0])).size, 5);
  assert.equal((await all("projects")).length, 1);
  await removeProject("b");
  await assert.rejects(read("videos", "media"));
  await assert.rejects(read("frames", ["media", 0]));
  assert.equal((await all("projects")).length, 0);
});

test("removing a track frees unshared media while retaining the workspace", async () => {
  const { read, write, saveVideo, updateProject } = exports;
  await saveVideo(
    {
      id: "removed",
      project: { id: "removed" },
      source: new Blob(["video"]),
      extension: ".mp4",
    },
    [new Blob(["frame"])],
  );
  await write("projects", "workspace", {
    id: "workspace",
    schema: 1,
    name: "Test",
    tracks: [{ id: "removed" }],
  });
  await updateProject({ id: "workspace", schema: 1, name: "Test", tracks: [] });
  assert.equal((await read("projects", "workspace")).tracks.length, 0);
  await assert.rejects(read("videos", "removed"));
  await assert.rejects(read("frames", ["removed", 0]));
});
