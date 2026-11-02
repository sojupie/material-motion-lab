// Dialog presentation only. Application code owns forms, validation and dirty state.
(() => {
 function scrollEdges(top,height,total){return {start:top>0,end:Math.ceil(top+height)<total}}
 if(typeof module!=='undefined')module.exports={scrollEdges};
 if(typeof document==='undefined')return;
 const selector='dialog[data-dialog-surface],dialog[data-dialog-preview]';
 const states=new WeakMap(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function stateFor(panel){let state=states.get(panel);if(!state){state={phase:panel.open?'open':'closed',revision:0,animation:null,opener:null};states.set(panel,state)}return state}
 function notify(panel,name,detail={},cancelable=false){return panel.dispatchEvent(new CustomEvent('md-dialog-'+name,{bubbles:true,cancelable,detail}))}
 function timing(panel){return MaterialMotion.timing(panel,'fast-effects')}
 function edges(panel){const body=panel.querySelector?.('[data-dialog-content]');if(!body)return;const e=scrollEdges(body.scrollTop,body.clientHeight,body.scrollHeight);panel.dataset.topScrolled=String(e.start);panel.dataset.bottomScrolled=String(e.end)}
 async function open(panel,opener){
  bind(panel);const state=stateFor(panel);if(state.phase==='open'||state.phase==='opening')return;
  if(!notify(panel,'beforeopen',{},true))return;
  const full=panel.dataset?.variant==='full-screen',style=getComputedStyle(panel),revision=++state.revision,from=state.phase==='closing'?{opacity:style.opacity,transform:style.transform}:full?{transform:'translateY(100%)'}:{opacity:0};
  state.animation?.cancel();state.phase='opening';state.opener=opener||document.activeElement;panel.inert=false;
  if(!panel.open)panel.showModal();state.opener?.setAttribute('aria-expanded','true');
  if(!reduced.matches){const animation=panel.animate([from,full?{transform:'none',opacity:1}:{opacity:1}],timing(panel));state.animation=animation;try{await animation.finished}catch{return}}
  if(state.revision!==revision)return;state.animation?.cancel();state.animation=null;state.phase='open';notify(panel,'opened');
 }
 async function close(panel,result='',reason='dismiss'){
  const state=stateFor(panel);if(!panel.open||state.phase==='closing')return;
  if(!notify(panel,'beforeclose',{result,reason},true)||panel.hasAttribute?.('data-dialog-inline'))return;
  const revision=++state.revision,style=getComputedStyle(panel),from={opacity:style.opacity,transform:style.transform};state.animation?.cancel();state.phase='closing';panel.inert=true;
  if(!reduced.matches){const animation=panel.animate([from,panel.dataset?.variant==='full-screen'?{transform:'translateY(100%)',opacity:1}:{opacity:0}],timing(panel));state.animation=animation;try{await animation.finished}catch{return}}
  if(state.revision!==revision)return;panel.close(result);
 }
 function rest(panel){const state=states.get(panel);if(!state)return;++state.revision;state.animation?.cancel();state.animation=null;state.phase='closed';panel.inert=false;state.opener?.setAttribute('aria-expanded','false');if(state.opener?.isConnected)state.opener.focus({preventScroll:true});notify(panel,'closed',{result:panel.returnValue})}
 function bind(panel){
  const state=stateFor(panel);if(state.bound)return;state.bound=true;
  panel.addEventListener('cancel',event=>{event.preventDefault();close(panel,'','escape')});
  panel.addEventListener('close',()=>rest(panel));
  const body=panel.querySelector?.('[data-dialog-content]');if(body){body.addEventListener('scroll',()=>edges(panel));if(typeof ResizeObserver!=='undefined'){const observer=new ResizeObserver(()=>edges(panel));observer.observe(body);state.observer=observer}edges(panel)}
 }
 function init(){for(const panel of document.querySelectorAll(selector))bind(panel)}
 document.addEventListener('click',event=>{
  const opener=event.target.closest?.('[data-dialog-open]');
  if(opener){const panel=document.getElementById(opener.dataset.dialogOpen||opener.getAttribute('aria-controls'));if(panel?.matches(selector))open(panel,opener)}
  const closer=event.target.closest?.('[data-dialog-close]');
  if(closer){const panel=document.getElementById(closer.dataset.dialogClose)||closer.closest('dialog[data-dialog-surface]');if(panel)close(panel,closer.dataset.dialogResult||'','action')}
 });
 let backdrop;
 const outside=(panel,event)=>{const r=panel.getBoundingClientRect();return event.target===panel&&(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)};
 document.addEventListener('pointerdown',event=>{const panel=event.target.closest?.(selector);backdrop=panel&&panel.open&&!panel.hasAttribute('data-dialog-inline')&&panel.dataset.variant!=='full-screen'&&outside(panel,event)?{panel,id:event.pointerId}:null});
 document.addEventListener('pointerup',event=>{const hit=backdrop;backdrop=null;if(hit?.id===event.pointerId&&outside(hit.panel,event))close(hit.panel,'','backdrop')});
 document.addEventListener('pointercancel',()=>{backdrop=null});
 document.addEventListener('htmx:beforeCleanupElement',event=>{const node=event.detail?.elt;if(typeof node?.querySelectorAll!=='function')return;for(const panel of [...(node.matches?.(selector)?[node]:[]),...node.querySelectorAll(selector)]){const state=states.get(panel);if(!state)continue;++state.revision;state.animation?.cancel();state.opener=null;state.observer?.disconnect();if(panel.open)panel.close();states.delete(panel)}});
 for(const name of ['DOMContentLoaded','htmx:afterSwap','htmx:historyRestore','tokens:assets-ready'])document.addEventListener(name,init);
 reduced.addEventListener?.('change',()=>{if(reduced.matches)for(const panel of document.querySelectorAll(selector))states.get(panel)?.animation?.finish()});
 init();
 globalThis.MaterialDialogs=Object.freeze({open,close});
})();
