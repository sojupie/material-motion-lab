import test from 'node:test';
import assert from 'node:assert/strict';
import {layoutState,paneSizes} from '../web/layout-state.ts';
test('layout defaults reserve supporting panes for available width',()=>{
 assert.equal(layoutState(null,700).tools,false);
 assert.equal(layoutState(null,1200).tools,true);
 assert.equal(layoutState(null,1200).media,false);
 assert.equal(layoutState(null,1800).media,true);
});
test('saved layout preserves selection and clamps invalid dimensions',()=>{
 const s=layoutState({media:true,tools:false,mode:'reference',focus:'chart',mediaWidth:900,toolsWidth:-1,viewerRatio:NaN},1200);
 assert.equal(s.media,true);assert.equal(s.tools,false);assert.equal(s.mode,'reference');assert.equal(s.focus,'chart');
 assert.equal(s.mediaWidth,400);assert.equal(s.toolsWidth,328);assert.equal(s.viewerRatio,.46);
 assert.deepEqual(layoutState('corrupt',1200),layoutState(null,1200));
 assert.equal(layoutState({mode:'export',focus:'missing'},1200).mode,'tracking');
});
test('pane sizes divide available space and preserve usable minimums',()=>{
 for(const ratio of [.15,.46,.85]){
  const s=paneSizes(800,200,ratio);
  assert.equal(s.viewer+s.chart,590);assert.ok(s.viewer>=150);assert.ok(s.chart>=230);
 }
 const short=paneSizes(300,200,.46);assert.equal(short.viewer,150);assert.equal(short.chart,230);
});
