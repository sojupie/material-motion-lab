import { readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
async function list(dir) {
  let result = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const p = `${dir}/${f.name}`;
    if (f.isDirectory()) result.push(...(await list(p)));
    else if (f.name !== "sw.js" && !/\.(?:br|gz)$/.test(f.name)) result.push(p);
  }
  return result;
}
const files = await list("dist"),
  hash = createHash("sha256");
for (const file of files) hash.update(await readFile(file));
const html = await readFile("dist/index.html", "utf8");
const versioned = [
  ...html.matchAll(/(?:src|href)="(\.\/[^"]+\?v=[^"]+)"/g),
].map((match) => match[1]);
const entryPaths = new Set(versioned.map((url) => url.split("?")[0]));
const urls = [
  ...new Set([
    ...files
      .filter(
        (file) =>
          !/^dist\/(?:ffmpeg|opencv|example|licenses)\//.test(file) &&
          !/\/(?:material\.css|token-source\.json)$/.test(file),
      )
      .map((file) => "./" + file.slice(5))
      .filter((url) => !entryPaths.has(url)),
    ...versioned,
  ]),
];
await writeFile(
  "dist/sw.js",
  `const PREFIX='motion:'+self.registration.scope+':',CACHE=PREFIX+'${hash.digest("hex").slice(0, 16)}',FILES=${JSON.stringify(urls)};
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).slice(0,-1).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||new URL(e.request.url).origin!==location.origin)return;
 const url=new URL(e.request.url);
 if(!url.pathname.startsWith(new URL(self.registration.scope).pathname))return;
 e.respondWith(caches.open(CACHE).then(async cache=>{
  if(e.request.mode==='navigate')return fetch(e.request).catch(()=>cache.match('./index.html'));
  const hit=await cache.match(e.request);if(hit)return hit;
  let response;
  try { response=await fetch(e.request); }
  catch(error) { const prior=await caches.match(e.request);if(prior)return prior;throw error; }
  if(!response.ok){const prior=await caches.match(e.request);if(prior)return prior;}
  if(response.ok&&response.status===200&&!e.request.headers.has('Range')){
   const write=cache.put(e.request,response.clone()).catch(()=>{});
   e.waitUntil(write);
  }
  return response;
 }));
});
`,
);
