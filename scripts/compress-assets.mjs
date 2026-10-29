import { readdir, readFile, writeFile } from "node:fs/promises";
import { gzipSync, brotliCompressSync, constants } from "node:zlib";
async function compress(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const file = `${dir}/${entry.name}`;
    if (entry.isDirectory()) await compress(file);
    else if (/\.(?:html|css|js|json|svg|wasm)$/.test(file)) {
      const bytes = await readFile(file);
      if (bytes.length < 1024) continue;
      await writeFile(`${file}.gz`, gzipSync(bytes));
      await writeFile(
        `${file}.br`,
        brotliCompressSync(bytes, {
          params: { [constants.BROTLI_PARAM_QUALITY]: 5 },
        }),
      );
    }
  }
}
await compress("dist");
