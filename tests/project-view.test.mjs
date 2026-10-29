import test from 'node:test';
import assert from 'node:assert/strict';
import {finiteRange} from '../web/project-view.ts';
test('project views accept finite ordered axis ranges only',()=>{
 assert.equal(finiteRange([-10,110]),true);
 for(const value of [null,[],[2,1],[1,1],[0,Infinity],[NaN,2],[0,1e100],['0',2]])assert.equal(finiteRange(value),false);
});
