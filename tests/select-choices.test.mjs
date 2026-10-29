import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';

test('connected choices follow restored select values and disabled state', () => {
  const select = { value: 'progress', disabled: false };
  const buttons = ['px', 'progress'].map(value => ({
    dataset: { selectChoice: 'units', choiceValue: value },
    attributes: {},
    setAttribute(key, value) { this.attributes[key] = value; },
  }));
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync('web/material.ts', 'utf8').replaceAll('import.meta.url',JSON.stringify('https://test.invalid/assets/main.js')), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code, {
    exports, CSS:{escape:id=>id},
    document: {
      querySelectorAll: () => buttons,
      querySelector: selector => { assert.equal(selector, '#units'); return select; },
    },
  });
  const state = () => buttons.map(b => [b.attributes['aria-pressed'], b.tabIndex, b.disabled]);
  exports.syncMaterialControls();
  assert.deepEqual(state(), [['false', -1, false], ['true', 0, false]]);
  select.value = 'px';
  select.disabled = true;
  exports.syncMaterialControls();
  assert.deepEqual(state(), [['true', 0, true], ['false', -1, true]]);
  select.disabled = false;
  exports.syncMaterialControls();
  assert.deepEqual(state(), [['true', 0, false], ['false', -1, false]]);
});
