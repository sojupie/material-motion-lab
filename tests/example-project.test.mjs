import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import {webModule} from './helpers/web-module.mjs';

test('Open example restores removed media without duplicating the project, then preserves edits', async () => {
  const projects = new Map([['example-carousel', {id:'example-carousel', tracks:[]}]]);
  const videos = new Map();
  const template = JSON.parse(fs.readFileSync('internal/analysis/example/project.json','utf8'));
  let imports=0;
  const store = {
    all: async () => [...projects.values()],
    read: async (kind,id) => {
      const value=(kind==='videos'?videos:projects).get(id);
      if(value===undefined)throw Error('This local project is no longer available.');
      return value;
    },
    updateProject: async p => projects.set(p.id,p),
  };
  const exports={};
  const source=fs.readFileSync('web/local-projects.ts','utf8').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/worker.js'));
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText, {
    exports, URL, Error,
    require: name => name==='./local-store'?store:name==='./local-media'?{
      importVideo: async (_,name,id,p) => {imports++;const video={id,project:{...p,id,name}};videos.set(id,video);return video;},
    }:name==='./local-analysis'?{region(){}}:name==='./errors'?webModule('errors'):name==='./json'?webModule('json'):{},
    fetch: async url => ({ok:true,json:async()=>structuredClone(template),blob:async()=>new Blob(['example'])}),
  });
  const opened=await exports.exampleProject();
  assert.equal(opened.tracks[0].id,'example-video');
  assert.equal(projects.size,1);
  assert.equal(imports,1);
  opened.name='My edited example';
  assert.equal(await exports.exampleProject(),opened);
  assert.equal(imports,1);
  videos.clear();
  assert.equal((await exports.exampleProject()).tracks[0].id,'example-video');
  assert.equal(imports,2);
  assert.equal(projects.size,1);
});
