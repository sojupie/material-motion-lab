import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import postcss from "postcss";

test("recent projects keep a full-width list item and an independent trailing action", () => {
  const page = fs.readFileSync("internal/web/page.templ", "utf8");
  assert.match(page, /data-control="actions"/);
  assert.match(page, /class="md-list-row"/);
  assert.match(page, /md-standard-icon-button md-list-action/);
  const css = postcss.parse(fs.readFileSync("public/material.css", "utf8"));
  let reserved = false, positioned = false;
  css.walkRules(rule => {
    if (/\[data-control=["']?actions["']?\]/.test(rule.selector)) rule.walkDecls("padding-inline-end", () => reserved = true);
    if (rule.selector.split(",").some(s => s.trim() === ".md-list-action")) rule.walkDecls("position", d => positioned ||= d.value === "absolute");
  });
  assert.ok(reserved && positioned, "shared list CSS must reserve and position the trailing action");
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules(rule => {
    if (rule.selector === ".video-library .recording-list") rule.walkDecls("flex", d => {
      assert.equal(d.value, "0 1 auto", "the rounded list must fit its rows instead of growing into empty space");
    });
  });
});

test("shared interaction code matches the recorded source bytes", () => {
  const source = JSON.parse(
    fs.readFileSync("public/token-source.json", "utf8"),
  );
  const files = {
    "buttons.js": "buttons.js",
    "fields.js": "fields.js",
    "motion.cjs": "motion.js",
    "utils.js": "utils.js",
    "button-groups.js": "button-groups.js",
    "menus.js": "menus.js",
    "snackbars.js": "snackbars.js",
    "toolbars.js": "toolbars.js",
    "navigation.js": "navigation.js",
    "progress.js": "progress.js",
    "loading.js": "loading.js",
    "loading-shapes.json": "loading-shapes.json",
  };
  for (const [original, local] of Object.entries(files)) {
    const record = source.files.find((f) => path.basename(f.file) === original);
    assert.ok(record, original);
    assert.equal(
      crypto
        .createHash("sha256")
        .update(fs.readFileSync("public/material/" + local))
        .digest("hex"),
      record.sha256,
      local,
    );
  }
});

test("every public token reference has an exported definition", () => {
  const material = fs.readFileSync("public/material.css", "utf8");
  const app = fs.readFileSync("web/style.css", "utf8") + fs.readFileSync("../tokens/forge/site/site.css", "utf8");
  const graph = fs.readFileSync("web/graph.ts", "utf8");
  const names = new Set();
  postcss.parse(material).walkDecls((d) => names.add(d.prop));
  for (const m of (material + "\n" + app).matchAll(/var\((--md-[\w-]+)/g))
    assert.ok(names.has(m[1]), m[1]);
  for (const m of graph.matchAll(/getPropertyValue\(\s*"(--md-[\w-]+)"/g))
    assert.ok(names.has(m[1]), m[1]);
});

test("app rules only position shared components", () => {
  const allowed = new Set([
    "--_loading-scale", // Documented loading-indicator multiplier.
    "cursor",
    "min-inline-size",
    "justify-content",
    "inline-size",
    "text-align",
    "white-space",
    "overflow-wrap",
    "margin-block-start",
    "flex-shrink",
    "max-width",
    "width",
    "flex",
    "flex-wrap",
  ]);
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules((rule) => {
    if (
      !/\.md-[\w-]+/.test(rule.selector) &&
      !/^button(?::disabled)?$/.test(rule.selector)
    )
      return;
    rule.walkDecls((d) =>
      assert.ok(
        allowed.has(d.prop),
        `${rule.selector}: ${d.prop} belongs in shared component styles`,
      ),
    );
  });
});

// Status uses the source snackbar's native popover placement, outside editor flow.
test("job status uses the shared snackbar surface", () => {
  const css = fs.readFileSync("public/material.css", "utf8");
  assert.ok(css.includes(".md-snackbar[popover]"));
  const page = fs.readFileSync("internal/web/page.templ", "utf8");
  assert.ok(page.includes('@ui.Snackbar("status", icon("close", 24))'));
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules((rule) => {
    assert.ok(
      !rule.selector.includes("#status"),
      "app recreates snackbar styling",
    );
  });
});

// Shared select popups contain sections too; inspector layout must not reach them.
test("inspector layout is scoped to its own sections", () => {
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules((rule) => {
    assert.ok(!/\.inspector\s+section\b/.test(rule.selector), rule.selector);
  });
});

// Keep renderer slots, state rules, keyframes and accessibility media rules intact.
test("import retains complete shared component modules", () => {
  const imported = fs.readFileSync("public/material.css", "utf8");
  const provenance = JSON.parse(
    fs.readFileSync("public/token-source.json", "utf8"),
  );
  const bundles = provenance.files.filter((entry) =>
    /bundles\/[^/]+\.css$/.test(entry.file),
  );
  assert.equal(bundles.length, 11);
  assert.ok(bundles.some(({file}) => file.endsWith("/card.css")));
  for (const { file } of [
    ...bundles,
    { file: "forge/components/static/buttons.css" },
  ]) {
    const upstream = fs.readFileSync("../tokens/" + file, "utf8");
    assert.ok(
      imported.includes(upstream.trim()),
      file + " was rewritten or filtered",
    );
  }
});

// Standard groups animate individual widths; app flex sizing would suppress that motion.
test("tracking command groups leave width allocation to the shared runtime", () => {
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules(rule => {
    if (!rule.selector.includes(".tracking-boundaries")) return;
    rule.walkDecls(d => assert.ok(
      !["flex", "flex-basis", "flex-grow", "flex-shrink", "width", "inline-size", "min-inline-size"].includes(d.prop),
      `${rule.selector}: ${d.prop} interferes with standard group width animation`,
    ));
  });
});
