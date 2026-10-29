import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webModule} from './helpers/web-module.mjs';

test('removing the last video clears the plot and its measurement readout',()=>{
 const fields=new Map();
 const $=id=>{if(!fields.has(id))fields.set(id,{hidden:false,textContent:'stale',replaceChildren(){this.textContent=''}});return fields.get(id)};
 const {MotionGraph}=webModule('graph',{'api':{$},'reference-controls':{},'material':{},'video':{}},{});
 const graph=Object.create(MotionGraph.prototype);
 Object.assign(graph,{views:()=>[{prefix:'a',project:null},{prefix:'b',project:null}]});
 Object.defineProperties(graph,{axis:{value:'width'},progress:{value:true}});
 graph.paint();
 for(const id of ['graph','sample-info','a-result','b-result'])assert.equal($(id).textContent,'');
 assert.equal($('a-result').hidden,true);
 assert.equal($('b-result').hidden,true);
});
