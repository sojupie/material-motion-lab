import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { criticalStyles } from "../scripts/startup-assets.mjs";

test("first-paint styles retain token dependencies and themes without copying unused tokens", () => {
  const css = criticalStyles(
    ":root{--used:var(--color);--color:red;--unused:10px}@media(prefers-color-scheme:dark){:root{--color:blue}}.md-button{color:var(--used)}.md-menu{width:var(--unused)}.md-navigation[data-navigation-modal]:not([open]){display:none}.md-outlined-card{border:1px solid var(--color)}.md-list{margin:0}@font-face{font-family:Roboto;src:url(../roboto.woff2)}",
  );
  assert.match(css, /--color:red/);
  assert.match(css, /--color:blue/);
  assert.match(css, /--used:var\(--color\)/);
  assert.doesNotMatch(css, /--unused|\.md-menu/);
  assert.match(css, /md-outlined-card/);
  assert.match(css, /md-list\{margin:0\}/);
  assert.match(css, /md-navigation\[data-navigation-modal\]/);
  assert.match(css, /url\(.\/roboto.woff2\)/);
});
test("initial shell discovers ordered deferred controls before the application entry", () => {
  const page = fs.readFileSync("internal/web/page.templ", "utf8");
  const scripts = [
    ...page.matchAll(/<script src="\/material\/([^"\s]+)" defer/g),
  ].map((m) => m[1]);
  assert.equal(scripts[0], "utils.js");
  assert.equal(scripts[1], "motion.js");
  for (const name of [
    "buttons.js",
    "fields.js",
    "menus.js",
    "loading.js",
    "navigation.js",
  ])
    assert.ok(scripts.includes(name));
  assert.ok(
    page.indexOf("/material/motion.js") < page.indexOf("/assets/main.js"),
  );
  assert.doesNotMatch(
    fs.readFileSync("web/material.ts", "utf8"),
    /createElement\("script"\)/,
  );
});
test("offline shell excludes engines and example media, then caches successful on-demand responses", async () => {
  const code = fs.readFileSync("dist/sw.js", "utf8");
  const files = JSON.parse(code.match(/FILES=(\[[^\n]+\]);/)[1]);
  assert.ok(files.includes("./index.html"));
  assert.ok(files.some((f) => f.includes("main.css")));
  assert.ok(files.every((f) => !/^\.\/(ffmpeg|opencv|example)\//.test(f)));
  assert.ok(files.every((f) => !f.endsWith(".br") && !f.endsWith(".gz")));
  const events = {},
    saved = [],
    waits = [];
  const response = {
    ok: true,
    status: 200,
    clone() {
      return this;
    },
  };
  vm.runInNewContext(code, {
    URL,
    location: { origin: "https://test.invalid" },
    self: {
      registration: { scope: "https://test.invalid/tools/motion/" },
      addEventListener: (name, fn) => {
        events[name] = fn;
      },
    },
    caches: {
      open: async () => ({
        match: async () => undefined,
        put: async (request) => {
          saved.push(request.url);
        },
      }),
    },
    fetch: async () => response,
  });
  let result;
  events.fetch({
    request: {
      url: "https://test.invalid/tools/motion/ffmpeg/ffmpeg-core.wasm",
      method: "GET",
      headers: new Headers(),
    },
    respondWith(promise) {
      result = promise;
    },
    waitUntil(promise) {
      waits.push(promise);
    },
  });
  assert.equal(await result, response);
  await Promise.all(waits);
  assert.deepEqual(saved, [
    "https://test.invalid/tools/motion/ffmpeg/ffmpeg-core.wasm",
  ]);
});
