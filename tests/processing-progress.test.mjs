import test from 'node:test';
import assert from 'node:assert/strict';
import {progressPercent} from '../web/processing-progress.ts';

test('only measured work produces a percentage, bounded to the current stage',()=>{
  for(const p of [{label:'Loading'}, {label:'Loading',current:1}, {label:'Loading',current:1,total:0}, {label:'Loading',current:NaN,total:10}])assert.equal(progressPercent(p),null);
  assert.equal(progressPercent({label:'Tracking',current:25,total:100}),25);
  assert.equal(progressPercent({label:'Tracking',current:200,total:100}),100);
  assert.equal(progressPercent({label:'Tracking',current:-1,total:100}),0);
});

test('worker progress does not finish a request and cancellation discards late updates',async()=>{
  const fs=await import('node:fs');
  const vm=await import('node:vm');
  const ts=await import('typescript');
  let worker;
  class Worker {
    constructor(){worker=this;}
    postMessage(m){this.last=m;}
    terminate(){}
  }
  const exports={};
  const source=fs.readFileSync('web/local-client.ts','utf8').replaceAll('import.meta.url',JSON.stringify('http://localhost/assets/main.js'));
  vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
    exports,require:()=>({}),Worker,URL,FormData,Error,
  });
  const updates=[];
  const off=exports.onProcessingProgress((p,path)=>updates.push([p,path]));
  let completed=false;
  const request=exports.localRequest('/import').then(v=>{completed=true;return v;});
  const id=worker.last.id;
  await worker.onmessage({data:{id,progress:{label:'Decoding',current:5,total:10}}});
  assert.equal(completed,false);
  assert.equal(updates[0][1],'/import');
  await worker.onmessage({data:{id,result:'finished'}});
  assert.equal(await request,'finished');
  const next=exports.localRequest('/import');
  const stale=worker.last.id,oldWorker=worker;
  exports.cancelProcessing();
  await assert.rejects(next,/cancelled/);
  await oldWorker.onmessage({data:{id:stale,progress:{label:'late'}}});
  assert.equal(updates.length,1);
  off();
});
