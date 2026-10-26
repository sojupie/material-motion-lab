import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import postcss from "postcss";

test("shared interaction code matches the recorded source bytes", () => {
  const source = JSON.parse(
    fs.readFileSync("public/token-source.json", "utf8"),
  );
  const files = {
    "buttons.js": "buttons.js",
    "fields.js": "fields.js",
    "motion.cjs": "motion.js",
    "utils.js": "utils.js",
    "sliders.js": "sliders.js",
    "navigation.js": "navigation.js",
    "button-groups.js": "button-groups.js",
    "menus.js": "menus.js",
    "tabs.js": "tabs.js",
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
  const app = fs.readFileSync("web/style.css", "utf8");
  const graph = fs.readFileSync("web/graph.ts", "utf8");
  const names = new Set();
  postcss.parse(material).walkDecls((d) => names.add(d.prop));
  for (const m of (material + "\n" + app).matchAll(/var\((--md-[\w-]+)/g))
    assert.ok(names.has(m[1]), m[1]);
  for (const m of graph.matchAll(/getPropertyValue\(\s*"(--md-[\w-]+)"/g))
    assert.ok(names.has(m[1]), m[1]);
});

test("app button rules only position shared components", () => {
  const allowed = new Set([
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
  ]);
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules((rule) => {
    if (
      !rule.selector.includes(".md-button") &&
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

// Status must not insert a row above the editor when a job starts.
test("job status occupies a fixed surface", () => {
  let position;
  postcss.parse(fs.readFileSync("web/style.css", "utf8")).walkRules((rule) => {
    if (rule.selector === "#status")
      rule.walkDecls("position", (d) => (position = d.value));
  });
  assert.equal(position, "fixed");
});
