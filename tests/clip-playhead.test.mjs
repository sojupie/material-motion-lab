import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webModule} from './helpers/web-module.mjs';

function workspace() {
  const fields = new Map();
  const $ = id => {
    if (!fields.has(id)) fields.set(id, {
      dataset:{}, parentElement:{}, querySelectorAll:()=>[],
      querySelector:()=>null, setAttribute(){}, setPointerCapture(){},
      getBoundingClientRect:()=>({left:0,width:900}),
    });
    return fields.get(id);
  };
  const document = {body:{dataset:{}}};
  const frames = [];
  const view = {
    prefix:'a',offset:0,index:5,project:{times:Array.from({length:31},(_,i)=>i*40)},
    show:async frame=>{frames.push(frame);},controls(){},
  };
  const editor = {
    views:()=>[view],selected:view,a:view,
    operations:{busy:false,status(message){assert.fail(message);}},
    graph:{paint(){},refresh(){}},inspector(){},projects:{saveWorkspace(){}},
  };
  const {TransportController} = webModule('transport-controller',{'api':{$},'icons':{setIcon(){}}});
  const transport = new TransportController(editor);
  const {Timeline} = webModule('timeline',{'api':{$}}, {
    document,ResizeObserver:class {observe(){}},
  });
  const timeline = new Timeline(
    editor.views,()=>transport.time,()=>view,transport,
    ()=>{},transport.changed,transport.playbackRange,transport.setPlaybackEdge,
  );
  timeline.paint=()=>{};
  editor.timeline=timeline;
  const target={dataset:{kind:'clip',view:'a'},classList:{contains:()=>false}};
  target.closest=()=>target;
  return {transport,view,frames,svg:$('timeline'),target};
}

test('slow clip dragging and keyboard moves refresh frames without moving the workspace playhead',async()=>{
  const {transport,view,frames,svg,target}=workspace();
  await transport.show(200);
  svg.onpointerdown({target,clientX:200,clientY:60,pointerId:1});
  for(let x=201;x<=450;x++) {
    svg.onpointermove({clientX:x});
    assert.equal(transport.time,200);
  }
  svg.onpointerup();
  await Promise.resolve();
  assert.ok(view.offset>200,'clip moves past the playhead');
  assert.equal(view.outside,true);
  assert.equal(frames.at(-1),0);
  svg.onkeydown({target,key:'ArrowLeft',preventDefault(){}});
  assert.equal(transport.time,200);
  assert.equal(frames.length,252,'every move refreshes the video');
});

test('ordinary seeking still snaps to recorded frames',async()=>{
  const {transport,view}=workspace();
  view.offset=13;
  transport.seek(200);
  await Promise.resolve();
  assert.equal(transport.time,213);
});
