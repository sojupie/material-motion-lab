// Refresh the shared Material styles and runtimes used by this tool.
// node scripts/import-material.mjs /path/to/tokens /path/to/theme.css
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import postcss from "postcss";
import path from "node:path";
import crypto from "node:crypto";
const [source, themeArg] = process.argv.slice(2);
const theme =
  themeArg || path.join(source || "", "published-review/assets/theme.css");
if (!source || !theme)
  throw Error("Provide the source repository and its generated theme.css.");

const read = (p) => readFile(path.join(source, p), "utf8");
const buttons = postcss.parse(
  await read("forge/components/static/buttons.css"),
);
const components = postcss.parse(
  await read("forge/components/static/components.css"),
);
const themeCSS = postcss.parse(
  (await read("published-review/assets/dtcg/light-default/tokens.css")) +
    "\n" +
    (await readFile(theme, "utf8")),
);
const elevation = postcss.parse(
  await read("forge/components/static/elevation.css"),
);

const allowed = new Set([
  "md-button",
  "md-button-ripple",
  "md-filled-button",
  "md-tonal-button",
  "md-outlined-button",
  "md-filter-chip",
  "md-menu",
  "md-menu-item",
  "md-field-menu",
  "md-field-empty",
  "md-field-menu-divider",
  "md-card",
  "md-elevated-card",
  "md-outlined-card",
]);
for (const match of components
  .toString()
  .matchAll(/\.(md-(?:slider|field)[\w-]*)/g))
  allowed.add(match[1]);
for (const c of [
  "md-text-button",
  "md-outlined-text-field",
  "md-filled-text-field",
  "md-outlined-select",
  "md-filled-select",
  "md-outlined-autocomplete",
  "md-filled-autocomplete",
])
  allowed.add(c);
const output = postcss.root();
for (const root of [buttons, components, elevation])
  root.walkRules((rule) => {
    if (
      root === buttons &&
      rule.selector.startsWith(":root:not([data-feedback-ready])")
    ) {
      output.append(
        rule.clone({
          selector:
            ":root:not([data-feedback-ready]) :is(.md-button,.md-icon-button,.md-filter-chip)::before",
        }),
      );
      return;
    }
    const selectors = rule.selectors
      .map((s) =>
        s.replace(
          /:is\(\.md-filter-chip,\s*\.md-assist-chip,\s*\.md-suggestion-chip,\s*\.md-input-chip\)/g,
          ".md-filter-chip",
        ),
      )
      .filter((s) => {
        const classes = [...s.matchAll(/\.([\w-]+)/g)].map((m) => m[1]);
        if (!classes.length || !classes.every((c) => allowed.has(c)))
          return false;
        if (root === components && !classes.some((c) => allowed.has(c)))
          return false;
        if (
          /data-variant=[\"']?(?:vibrant|baseline)/.test(
            s.replace(/:not\(\[data-variant=(?:vibrant|baseline)\]\)/g, ""),
          )
        )
          return false;
        if (
          /data-size=["']?(?:xsmall|medium|large|xlarge)|data-width=["']?(?:narrow|wide)/.test(
            s,
          )
        )
          return false;
        return true;
      });
    if (!selectors.length) return;
    const clone = rule.clone({ selector: selectors.join(", ") });
    if (rule.parent.type === "atrule")
      output.append(rule.parent.clone({ nodes: [clone] }));
    else output.append(clone);
  });
const defs = new Map();
for (const root of [themeCSS, components])
  root.nodes
    .filter((n) => n.type === "rule" && n.selector === ":root")
    .forEach((r) => r.walkDecls((d) => defs.set(d.prop, d.value)));
const pageTokens = [
  "color-primary",
  "color-on-primary",
  "color-primary-container",
  "color-on-primary-container",
  "color-secondary-container",
  "color-on-secondary-container",
  "color-on-surface",
  "color-on-surface-variant",
  "color-surface",
  "color-surface-container",
  "color-surface-container-low",
  "color-surface-container-high",
  "color-outline",
  "color-outline-variant",
  "color-error",
  "shape-corner-extra-small",
  "shape-corner-medium",
  "shape-corner-large",
  "shape-corner-extra-large",
  "typescale-body-large",
  "typescale-body-medium",
  "typescale-body-small",
  "typescale-label-large",
  "typescale-title-large",
  "typescale-title-medium",
  "typescale-headline-small",
  "typescale-headline-medium",
  "typescale-display-small",
  "state-focus-indicator-thickness",
  "state-focus-indicator-outer-offset",
];
for (const t of pageTokens.filter((t) => t.startsWith("typescale-"))) {
  const key = "--md-sys-" + t;
  if (!defs.has(key))
    defs.set(
      key,
      `var(${key}-weight) var(${key}-size)/var(${key}-line-height) var(${key}-font)`,
    );
}
const needed = new Set(pageTokens.map((t) => "--md-sys-" + t));
const collect = (text) => {
  for (const m of text.matchAll(/var\((--[\w-]+)/g))
    if (defs.has(m[1])) needed.add(m[1]);
};
collect(output.toString());
collect(await readFile("web/style.css", "utf8"));
for (const key of needed) {
  if (!defs.has(key)) throw Error("Missing source token " + key);
  collect(defs.get(key));
}
const tokens = postcss.rule({ selector: ":root" });
for (const key of [...needed].sort())
  tokens.append({ prop: key, value: defs.get(key) });
output.prepend(tokens);
await writeFile(
  "public/material.css",
  "/* Material light/default token and component subset. Refresh with scripts/import-material.mjs. */\n" +
    output.toString() +
    "\n",
);
await mkdir("public/material", { recursive: true });
for (const file of ["roboto-latin.woff2", "OFL.txt"])
  await copyFile(
    path.join(source, "catalog/web/static/fonts", file),
    path.join("public", file),
  );
await copyFile(
  path.join(source, "forge/components/static/fields.js"),
  "public/material/fields.js",
);
await copyFile(
  path.join(source, "forge/components/static/motion.cjs"),
  "public/material/motion.js",
);
for (const [from, to] of [
  ["forge/components/static/buttons.js", "buttons.js"],
  ["forge/components/static/runtime/utils.js", "utils.js"],
  ["forge/components/static/runtime/sliders.js", "sliders.js"],
])
  await copyFile(path.join(source, from), path.join("public/material", to));

console.log(
  `Material subset: ${needed.size} tokens, ${output.nodes.length - 1} rules, ${Buffer.byteLength(output.toString())} bytes.`,
);

const files = [
  "published-review/assets/theme.css",
  "published-review/assets/dtcg/light-default/tokens.css",
  "forge/components/static/buttons.css",
  "forge/components/static/components.css",
  "forge/components/static/elevation.css",
  "forge/components/static/buttons.js",
  "forge/components/static/fields.js",
  "forge/components/static/motion.cjs",
  "forge/components/static/runtime/utils.js",
  "forge/components/static/runtime/sliders.js",
];
await writeFile(
  "public/token-source.json",
  JSON.stringify(
    {
      repository: "https://github.com/sojupie/tokens",
      files: await Promise.all(
        files.map(async (file) => ({
          file,
          sha256: crypto
            .createHash("sha256")
            .update(await read(file))
            .digest("hex"),
        })),
      ),
      tokenCount: needed.size,
    },
    null,
    2,
  ) + "\n",
);
