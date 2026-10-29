import test from 'node:test';
import assert from 'node:assert/strict';
import {recentProjectIDs,rememberProject} from '../web/recent-projects.ts';
test('recent views recover from absent, corrupt and invalid browser storage',()=>{
 for(const raw of [null,'invalid','{}','null']) assert.deepEqual(recentProjectIDs(raw),[]);
 assert.deepEqual(recentProjectIDs('["b",2,"a","b"]'),['b','a']);
});
test('opening a project moves it to the front without duplicates and bounds history',()=>{
 assert.deepEqual(rememberProject(['a','b','c'],'b'),['b','a','c']);
 assert.equal(rememberProject(Array.from({length:12},(_,i)=>String(i)),'new').length,12);
});
