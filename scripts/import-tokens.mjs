import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import postcss from "postcss";
const source = process.argv[2];
if (!source)
  throw Error("Usage: node scripts/import-tokens.mjs /path/to/tokens");
const input = path.join(source, "published-review/assets/theme.css");
const fallback = path.join(
  source,
  "published-review/assets/dtcg/light-default/tokens.css",
);
const css =
    fs.readFileSync(fallback, "utf8") + "\n" + fs.readFileSync(input, "utf8"),
  tree = postcss.parse(css);
const names = new Set(
  [
    ...fs.readFileSync("web/style.css", "utf8").matchAll(/var\((--[\w-]+)/g),
  ].map((m) => m[1]),
);
let changed = true;
while (changed) {
  changed = false;
  tree.walkDecls((d) => {
    if (names.has(d.prop))
      for (const m of d.value.matchAll(/var\((--[\w-]+)/g))
        if (!names.has(m[1])) {
          names.add(m[1]);
          changed = true;
        }
  });
}
const available = new Set();
tree.walkDecls((d) => available.add(d.prop));
for (const name of names)
  if (!available.has(name)) throw Error("Missing token: " + name);
const output = postcss.root();
tree.walkRules((rule) => {
  const declarations = rule.nodes.filter(
    (n) => n.type === "decl" && names.has(n.prop),
  );
  if (declarations.length) {
    const r = postcss.rule({ selector: rule.selector });
    for (const d of declarations) r.append(d.clone());
    let node = r;
    for (let p = rule.parent; p && p.type !== "root"; p = p.parent) {
      const wrapper = postcss.atRule({ name: p.name, params: p.params });
      wrapper.append(node);
      node = wrapper;
    }
    output.append(node);
  }
});
fs.writeFileSync(
  "public/tokens.css",
  "/* Token Catalog generated values. Refresh with scripts/import-tokens.mjs. */\n" +
    output.toString(),
);
for (const file of ["roboto-latin.woff2", "OFL.txt"])
  fs.copyFileSync(
    path.join(source, "catalog/web/static/fonts", file),
    path.join("public", file),
  );
fs.writeFileSync(
  "public/token-source.json",
  JSON.stringify(
    {
      repository: "https://github.com/sojupie/tokens",
      files: [
        "published-review/assets/dtcg/light-default/tokens.css",
        "published-review/assets/theme.css",
      ],
      sha256: crypto.createHash("sha256").update(css).digest("hex"),
      variables: [...names].sort(),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `${names.size} token names; ${fs.statSync("public/tokens.css").size} bytes`,
);
