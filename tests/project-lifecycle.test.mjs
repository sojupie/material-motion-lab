import {test} from 'node:test';
import assert from 'node:assert/strict';
import {webModule} from './helpers/web-module.mjs';

function workspace() {
  const fields = new Map();
  const listeners = new Map();
  const buttons = ['new','open','close','copy','import','unknown'].map(projectAction=>({dataset:{projectAction}}));
  const $ = id => {
    if (!fields.has(id)) fields.set(id, {hidden:false,value:'',textContent:'',classList:{toggle(){}},dispatchEvent(){},addEventListener(){}});
    return fields.get(id);
  };
  const document = {title:'',querySelectorAll:selector=>selector==='[data-project-action]'?buttons:[],addEventListener:(event,fn)=>listeners.set(event,fn)};
  const video = prefix => ({prefix,project:null,offset:0,el:key=>$(`${prefix}-${key}`),clear(){this.project=null;this.offset=0;},async load(project){this.project=project;},workspace(){return {id:this.project.id,offset:0,first:0,last:0}}});
  const projects = new Map();
  const calls = [];
  let failSave = false, finishSave;
  let pauseSave = false;
  async function api(path,options={}) {
    calls.push([path, options.method??'GET']);
    if (options.method==='PUT') {
      if(failSave)throw Error('Storage unavailable');
      if(pauseSave)await new Promise(resolve=>{finishSave=resolve;});
      const project=JSON.parse(options.body);projects.set(project.id,project);return project;
    }
    if (path==='/workspaces') {
      if(options.method==='POST') {
        const project={id:`project-${projects.size+1}`,schema:1,...JSON.parse(options.body),tracks:[]};
        projects.set(project.id,project);return structuredClone(project);
      }
      return [...projects.values()];
    }
    const project=projects.get(path.split('/').at(-1));
    if(!project)throw Error('Not found');
    return structuredClone(project);
  }
  const boundary = {'api':{$,api},'material':{syncMaterialControls(){}},'local-client':{},'exports-controller':{ExportsController:class {}},'operations-controller':{OperationsController:class {}},'transport-controller':{TransportController:class {}},'projects-controller':{ProjectsController:class {}},'graph':{MotionGraph:class {}},'layout':{WorkspaceLayout:class {}},'timeline':{Timeline:class {}},'video':{VideoView:class {}},'mobile-tools':{}};
  const globals={document,window:{addEventListener(){}},localStorage:{getItem(){return null},setItem(){}},HTMLSelectElement:class {},HTMLInputElement:class {}};
  const {WorkspaceController}=webModule('workspace',boundary,globals);
  const editor=new WorkspaceController();
  editor.a=video('a');editor.b=video('b');editor.selected=editor.a;
  editor.transport={time:0,playback:{range:null,speed:1,loop:false},pause(){},playbackControls(){},show:async()=>{},seekFrame(){}};
  editor.graph={reset(){},savedScale(){return null}};
  editor.timeline={window:[1,2],paint(){}};
  editor.layout={projectLoaded(){}};
  editor.operations={busy:false,status:text=>{$('status').textContent=text},job:fn=>fn()};
  editor.selectVideo=()=>{};
  const {ProjectsController}=webModule('projects-controller',{'api':{$,api},'material':{syncMaterialControls(){}},'local-client':{}},globals);
  editor.projects=new ProjectsController(editor);
  editor.projects.refresh=async()=>{}; // List rendering is covered by browser checks.
  function setProject(project) {projects.set(project.id,structuredClone(project));editor.projects.currentProject=structuredClone(project);}
  return {editor,$,projects,calls,buttons,setProject,failSave:()=>{failSave=true},pauseSave:()=>{pauseSave=true},finishSave:()=>{pauseSave=false;finishSave()}};
}
test('library, empty project and media workspace have distinct presentations',async()=>{
 const {editor:e,$,setProject}=workspace();
 await e.renderContents();
 assert.equal($('empty-viewer').hidden,false);
 assert.equal($('empty-project').hidden,true);
 assert.equal($('viewer-tools').hidden,true);
 setProject({id:'old',schema:1,name:'My project',tracks:[]});
 await e.renderContents();
 assert.equal($('empty-viewer').hidden,true);
 assert.equal($('empty-project').hidden,false);
 assert.equal($('loaded-project-name').textContent,'My project');
 e.a.project={id:'video-1'};
 await e.renderContents();
 assert.equal($('empty-project').hidden,true);
 assert.equal($('video-panes').hidden,false);
 await e.projects.removeVideo(e.a);
 await e.projects.saveChain;
 assert.equal(e.projects.currentProject.id,'old');
 assert.equal($('empty-project').hidden,false);
 assert.equal($('empty-viewer').hidden,true);
});
test('new project activates a distinct empty workspace after removing its last video',async()=>{
 const {editor:e,$,projects,setProject}=workspace();
 setProject({id:'old',schema:1,name:'Untitled project',tracks:[]});
 e.a.project={id:'video-1'};
 await e.projects.removeVideo(e.a);
 await e.projects.saveChain;
 e.transport.time=99;e.transport.playback={range:[20,90],speed:2,loop:true};
 await e.projects.create();
 assert.notEqual(e.projects.currentProject.id,'old');
 assert.equal(e.projects.currentProject.name,'Untitled project 2');
 assert.equal($('loaded-project-name').textContent,'Untitled project 2');
 assert.equal($('empty-viewer').hidden,true);
 assert.equal($('empty-project').hidden,false);
 assert.equal(e.transport.time,0);
 assert.equal(e.timeline.window,null);
 assert.deepEqual(e.transport.playback,{range:null,speed:1,loop:false});
 assert.deepEqual(projects.get('old').tracks,[]);
 assert.match($('status').textContent,/Created Untitled project 2/);
});
test('failed persistence prevents creating or leaving the current project',async()=>{
 const h=workspace(),e=h.editor;
 h.setProject({id:'old',schema:1,name:'Old',tracks:[]});e.a.project={id:'video-1'};
 h.failSave();
 await assert.rejects(e.projects.create(),/Storage unavailable/);
 await assert.rejects(e.projects.closeProject(),/Storage unavailable/);
 assert.equal(e.projects.currentProject.id,'old');
 assert.equal(e.a.project.id,'video-1');
 assert.equal(h.calls.some(([,method])=>method==='POST'),false);
});
test('close waits for persistence, then returns to the library',async()=>{
 const h=workspace(),e=h.editor;
 h.setProject({id:'old',schema:1,name:'Old',tracks:[]});e.a.project={id:'video-1'};
 h.pauseSave();const closing=e.projects.closeProject();
 await new Promise(resolve=>setImmediate(resolve));
 assert.equal(e.projects.currentProject.id,'old');assert.equal(e.a.project.id,'video-1');
 h.finishSave();await closing;
 assert.equal(e.projects.currentProject,null);assert.equal(e.a.project,null);
 assert.equal(h.$('empty-viewer').hidden,false);
});
test('only the explicit new menu command creates a project',async()=>{
 const h=workspace();h.editor.projects.bind();
 let created=0;h.editor.projects.create=async()=>{created++};
 await h.buttons.find(b=>b.dataset.projectAction==='unknown').onclick();
 assert.equal(created,0);
 await h.buttons.find(b=>b.dataset.projectAction==='new').onclick();
 assert.equal(created,1);
});
