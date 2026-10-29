import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import ts from 'typescript';

const nodeRequire = createRequire(import.meta.url);
// Load complete modules, with browser/worker boundaries supplied by each test.
export function webModule(name, overrides = {}, globals = {}) {
  const cache = new Map();
  function load(name) {
    if (Object.hasOwn(overrides, name)) return overrides[name];
    if (cache.has(name)) return cache.get(name);
    const exports = {};
    cache.set(name, exports);
    const filename = path.resolve('web', `${name}.ts`);
    const source = fs.readFileSync(filename, 'utf8').replaceAll('import.meta.url', JSON.stringify('https://test.invalid/assets/app.js'));
    const code = ts.transpileModule(source, {compilerOptions: {module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.compileFunction(code, ['exports','require',...Object.keys(globals)], {filename})(
      exports, dependency => dependency.startsWith('./') ? load(dependency.slice(2)) : nodeRequire(dependency),
      ...Object.values(globals),
    );
    return exports;
  }
  return load(name);
}
