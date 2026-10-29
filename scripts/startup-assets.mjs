import { readFile, writeFile } from "node:fs/promises";
import { build } from "esbuild";
import postcss from "postcss";
import { pathToFileURL } from "node:url";

// Copy first-paint rules from the compiled stylesheet. Component geometry and
// token values retain their upstream definitions, including responsive contexts.
export function criticalStyles(css) {
  const root = postcss.parse(css);
  const initialFamily =
    /^md-(?:button(?:$|-)|icon-button|standard-icon-button|filled-icon-button|tonal-icon-button|outlined-icon-button|filled-tonal-icon-button|filled-button|outlined-button|text-button|tonal-button|filled-tonal-button|elevated-button|toolbar|nav-|navigation(?:$|-(?:drawer|header))|(?:outlined|filled|elevated)-card|card|list$|filter-chip|chip(?:$|-)|checkbox|typescale)/;
  root.walkRules((rule) => {
    if (rule.parent?.type === "atrule" && /keyframes$/.test(rule.parent.name))
      return;
    const selectors = rule.selectors.filter((selector) => {
      const name = selector.match(/\.(md-[\w-]+)/)?.[1];
      return !name || initialFamily.test(name);
    });
    if (!selectors.length) rule.remove();
    else rule.selectors = selectors;
  });
  const definitions = new Map();
  const needed = new Set();
  const references = (value) =>
    [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map((match) => match[1]);
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith("--")) {
      const values = definitions.get(declaration.prop) ?? [];
      values.push(declaration.value);
      definitions.set(declaration.prop, values);
    } else references(declaration.value).forEach((name) => needed.add(name));
  });
  // Resolve dependencies across every theme and state, rather than resolving a
  // token to one default value and losing the other captured contexts.
  for (const name of needed)
    for (const value of definitions.get(name) ?? [])
      references(value).forEach((dependency) => needed.add(dependency));
  root.walkDecls((declaration) => {
    if (declaration.prop.startsWith("--") && !needed.has(declaration.prop))
      declaration.remove();
    else
      declaration.value = declaration.value.replace(
        /url\((['"]?)(\.\.\/[^)'"\s]+)\1\)/g,
        (_, quote, url) => `url(${quote}./${url.slice(3)}${quote})`,
      );
  });
  root.walkRules((rule) => {
    if (!rule.nodes.length) rule.remove();
  });
  root.walkAtRules((rule) => {
    if (rule.nodes && !rule.nodes.length) rule.remove();
  });
  return root.toString();
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const { outputFiles } = await build({
    entryPoints: ["web/startup.ts"],
    bundle: true,
    format: "iife",
    target: "es2023",
    minify: true,
    write: false,
  });
  const startup = outputFiles[0].text;
  await writeFile("dist/assets/startup.js", startup);
  let html = await readFile("dist/index.html", "utf8");
  const styles = criticalStyles(await readFile("dist/assets/main.css", "utf8"));
  const cssURL = html.match(
    /<link id="workspace-styles"[^>]*href="([^"]+)"/,
  )[1];
  html = html.replace(
    '<link id="workspace-styles"',
    `<link rel="preload" as="style" href="${cssURL}"><style id="initial-styles">${styles}</style><link id="workspace-styles"`,
  );
  html = html.replace(
    '<link id="workspace-styles" rel="stylesheet"',
    '<link id="workspace-styles" media="print" onload="this.media=\'all\'" rel="stylesheet"',
  );
  html = html.replace(
    '<script src="./assets/startup.js"></script>',
    `<script>${startup.replaceAll("</script", "<\\/script")}</script>`,
  );
  await writeFile("dist/index.html", html);
  console.log(
    `Initial styles: ${Buffer.byteLength(styles)} bytes; early layout: ${Buffer.byteLength(startup)} bytes.`,
  );
}
