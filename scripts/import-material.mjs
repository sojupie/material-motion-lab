// Refresh the shared Material styles and runtimes used by this tool.
// node scripts/import-material.mjs /path/to/tokens /path/to/theme.css
import { readFile, writeFile, mkdir, copyFile, mkdtemp, rm } from "node:fs/promises";
import postcss from "postcss";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
const [sourceArg, themeArg] = process.argv.slice(2);
// Resolve the very module that compiles the page; never import assets from a
// different checkout just because it was supplied on the command line.
const module = JSON.parse(execFileSync("go", ["list", "-m", "-json", "github.com/sojupie/tokens"], {encoding:"utf8"}));
const source = module.Dir;
if (sourceArg && path.resolve(sourceArg) !== path.resolve(source))
  throw Error("Asset source must match the Tokens module used to compile the page: " + source);
const publicationTokens = "published-review/assets/dtcg/light-default/tokens.css";
const theme = themeArg || path.join(source, "published-review/assets/theme.css");
// A source-only build starts from the Material light/default definitions shipped
// with this app. A local publication can refresh them.
const publication = await Promise.all([
  readFile(path.join(source, publicationTokens), "utf8"),
  readFile(theme, "utf8"),
]).catch(error => {
  if (themeArg || error.code !== "ENOENT") throw error;
  return null;
});
const themeCSS = postcss.parse(
  publication?.join("\n") ?? await readFile("public/material.css", "utf8"),
);
const checkoutRevision = () => {
  try {
    return execFileSync("git", ["-C", source, "rev-parse", "HEAD"], {
      encoding: "utf8", stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return module.Version;
  }
};
const temp = await mkdtemp(path.join(tmpdir(), "motion-components-"));
let componentManifest;
const componentAssets = new Map();
try {
  const manifestPath = path.join(temp, "components.json");
  execFileSync("go", [
    "run", "-tags", "staticweb", "./cmd/web-static",
    "--component-manifest", manifestPath, "--component-assets", temp,
  ], {stdio:"inherit"});
  componentManifest = JSON.parse(await readFile(manifestPath,"utf8"));
  for (const [file, expected] of Object.entries(componentManifest.files)) {
    const bytes = await readFile(path.join(temp, file));
    const actual = crypto.createHash("sha256").update(bytes).digest("hex");
    if (actual !== expected) throw Error("Forge asset changed during build: " + file);
    componentAssets.set(file, bytes);
  }
} finally { await rm(temp, {recursive:true, force:true}); }
const read = (p) => readFile(path.join(source, p), "utf8");
const buttons = postcss.parse(
  componentAssets.get("static/buttons.css").toString("utf8"),
);
const components = postcss.parse(
  componentAssets.get("static/components.css").toString("utf8"),
);
// Consume the Catalog's published component modules intact. Module ownership
// already includes each family's slots, states, media rules and keyframes.
const usedModules = new Set(componentManifest.modules);
const bundleFiles = componentManifest.modules.map(name => `static/bundles/${name}.css`);
const output = postcss.root();
for (const root of [
  buttons,
  ...bundleFiles.map(file => postcss.parse(componentAssets.get(file).toString("utf8"))),
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
    path.join(source, "catalog/web/assets/fonts", file),
    path.join("public", file),
  );
const localScript = script => script === "motion.cjs" ? "motion.js" : path.basename(script);
const copiedAssets = componentManifest.scripts.map(script => [`static/${script}`,localScript(script)]);
if (usedModules.has("loading")) copiedAssets.push(["static/loading-shapes.json","loading-shapes.json"]);
// Discard old imported scripts so removed dependencies do not ship indefinitely.
await rm("public/material", {recursive:true, force:true});
await mkdir("public/material", {recursive:true});
for (const [from,to] of copiedAssets)
  await writeFile(path.join("public/material",to),componentAssets.get(from));

console.log(
  `Material import: ${needed.size} tokens, ${output.nodes.length - 1} rules, ${Buffer.byteLength(output.toString())} bytes.`,
);

const files = [
  "forge/site/site.css", "forge/site/site.js",
];
const publicationFiles = publication ? [publicationTokens, path.relative(source, theme)] : [];
await writeFile(
  "public/token-source.json",
  JSON.stringify(
    {
      repository: "https://github.com/sojupie/tokens",
      revision: checkoutRevision(),
      componentManifest,
      outputs: Object.fromEntries(await Promise.all(["material.css",...copiedAssets.map(([,to])=>"material/"+to)].map(async file=>[file,crypto.createHash("sha256").update(await readFile(path.join("public",file))).digest("hex")]))),
      files: [
        ...Object.entries(componentManifest.files).map(([file, sha256]) => ({
          file: "forge/components/" + file,
          sha256,
        })),
        ...await Promise.all([...files, ...publicationFiles].map(async (file) => ({
          file,
          sha256: crypto
            .createHash("sha256")
            .update(await read(file))
            .digest("hex"),
        }))),
      ],
      tokenCount: needed.size,
    },
    null,
    2,
  ) + "\n",
);
