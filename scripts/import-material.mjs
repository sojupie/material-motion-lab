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
// Consume the Catalog's published component modules intact. Module ownership
// already includes each family's slots, states, media rules and keyframes.
const usedModules = new Set([
  "common",
  "checkbox",
  "messages",
  "toolbar",
  "button-group",
  "list",
  "card",
  "dialog",
  "navigation",
  "progress",
  "loading",
]);
const moduleManifest = "forge/components/static/bundles/modules.json";
const moduleOrder = JSON.parse(await read(moduleManifest));
for (const name of usedModules)
  if (!moduleOrder.includes(name))
    throw Error("Missing component module " + name);
const bundleFiles = moduleOrder
  .filter((name) => usedModules.has(name))
  .map((name) => `forge/components/static/bundles/${name}.css`);
const output = postcss.root();
for (const root of [
  buttons,
  ...(await Promise.all(
    bundleFiles.map(async (file) => postcss.parse(await read(file))),
  )),
])
  for (const node of root.nodes) output.append(node.clone());
const defs = new Map();
for (const root of [themeCSS, components])
  root.nodes
    .filter((n) => n.type === "rule" && n.selector === ":root")
    .forEach((r) => r.walkDecls((d) => defs.set(d.prop, d.value)));
const pageTokens = [
  "motion-easing-standard",
  "motion-duration-medium2",
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
collect(await read("forge/site/site.css"));
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
  "/* Material light/default tokens and intact Catalog component modules. Refresh with scripts/import-material.mjs. */\n" +
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
  ["forge/components/static/menus.js", "menus.js"],
  ["forge/components/static/progress.js", "progress.js"],
  ["forge/components/static/loading.js", "loading.js"],
  ["forge/components/static/loading-shapes.json", "loading-shapes.json"],
  ["forge/components/static/runtime/utils.js", "utils.js"],
  ["forge/components/static/runtime/button-groups.js", "button-groups.js"],
  ["forge/components/static/runtime/snackbars.js", "snackbars.js"],
  ["forge/components/static/runtime/toolbars.js", "toolbars.js"],
  ["forge/components/static/runtime/navigation.js", "navigation.js"],
])
  await copyFile(path.join(source, from), path.join("public/material", to));

console.log(
  `Material import: ${needed.size} tokens, ${output.nodes.length - 1} rules, ${Buffer.byteLength(output.toString())} bytes.`,
);

const files = [
  "forge/components/static/progress.js",
  "forge/components/static/loading.js",
  "forge/components/static/loading-shapes.json",
  "published-review/assets/theme.css",
  "published-review/assets/dtcg/light-default/tokens.css",
  "forge/components/static/buttons.css",
  "forge/components/static/components.css",
  "forge/site/site.css",
  "forge/site/site.js",
  moduleManifest,
  ...bundleFiles,
  "forge/components/static/buttons.js",
  "forge/components/static/menus.js",
  "forge/components/static/fields.js",
  "forge/components/static/motion.cjs",
  "forge/components/static/runtime/utils.js",
  "forge/components/static/runtime/button-groups.js",
  "forge/components/static/runtime/snackbars.js",
  "forge/components/static/runtime/toolbars.js",
  "forge/components/static/runtime/navigation.js",
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
