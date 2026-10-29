(() => {
 function menuIndex(index,length,key,horizontal,rtl){
  if(key==='Home')return 0;if(key==='End')return length-1;
  const next=horizontal?(rtl?'ArrowLeft':'ArrowRight'):'ArrowDown',previous=horizontal?(rtl?'ArrowRight':'ArrowLeft'):'ArrowUp';
  return key===next?(index+1)%length:key===previous?(index-1+length)%length:null;
 }
 function submenuPosition(parent,child,viewport,gap,rtl=false){
  const right=parent.right,left=parent.left-child.width;
  const fits=x=>x>=gap&&x+child.width<=viewport-gap;
  const preferred=rtl?left:right,flipped=rtl?right:left;
  return fits(preferred)?{left:preferred,replace:false}:fits(flipped)?{left:flipped,replace:false}:{left:parent.left,replace:true};
 }
 if(typeof module!=='undefined')module.exports={menuIndex,submenuPosition};
 if(typeof document==='undefined')return;
 const pending=new WeakMap(),initialized=new WeakSet(),pointerOpen=new WeakMap(),enabledActions=new WeakSet();
 // The FAB controller schedules its item springs before this listener copies them.
 document.addEventListener('beforetoggle',event=>{
  const menu=event.target;
  if(!menu.matches?.('.md-menu[popover],.md-field-menu[popover],.md-fab-menu-panel[popover]')||menu.hasAttribute('data-menu-exit-copy'))return;
  if(event.newState==='open')MaterialMotion.clearExit(menu);
  else MaterialMotion.retainExit(menu,menu.matches('.md-fab-menu-panel'));
 },true);

 const items=menu=>[...menu.querySelectorAll('[role^="menuitem"]')].filter(x=>x.closest('[data-menu-panel]')===menu&&!x.closest('[hidden]')&&!x.disabled&&(!x.hasAttribute?.('data-menu-back')||menu.hasAttribute('data-menu-replace')));
 const panel=trigger=>document.getElementById(trigger.dataset.menuSubmenu||trigger.dataset.menuOpen);
 const triggerFor=menu=>menu.closest('[data-menu-example]')?.querySelector('['+(menu.hasAttribute('data-menu-main')?'data-menu-open':'data-menu-submenu')+'="'+menu.id+'"]');
 function activity(menu){const demo=menu.closest('[data-menu-example]');for(const p of demo.querySelectorAll('[data-menu-panel]'))if(p===menu||p.matches(':popover-open')||p.hasAttribute('data-menu-main'))p.dataset.menuActivity=p===menu?'active':'inactive';}
 function focus(menu,item){if(!item)return;for(const node of items(menu))node.tabIndex=node===item?0:-1;item.focus({preventScroll:true});activity(menu);}
 function position(menu){
  menu.removeAttribute('data-menu-scrollable');
  menu.toggleAttribute('data-menu-scrollable',menu.scrollHeight>menu.clientHeight);
  const trigger=triggerFor(menu);if(!trigger)return;const r=trigger.getBoundingClientRect(),b={width:menu.offsetWidth,height:menu.offsetHeight},rtl=getComputedStyle(trigger).direction==='rtl',viewport=document.documentElement.clientWidth,gap=Number.parseFloat(getComputedStyle(menu).getPropertyValue('--md-sys-measurement-space100'));
  let x,y;
  if(menu.hasAttribute('data-menu-main')){x=rtl?r.right-b.width:r.left;y=r.bottom+gap;if(y+b.height>innerHeight-gap)y=r.top-b.height-gap;}
  else{
   const parent=trigger.closest('[data-menu-panel]'),bounds=parent.getBoundingClientRect();
   menu.style.inlineSize='';
   const placement=submenuPosition(bounds,{width:menu.offsetWidth},viewport,gap,rtl);
   menu.toggleAttribute('data-menu-replace',placement.replace);
   parent.toggleAttribute('data-menu-covered',placement.replace);
   if(placement.replace)menu.style.inlineSize=bounds.width+'px';
   b.width=menu.offsetWidth;b.height=menu.offsetHeight;
   x=placement.left;y=placement.replace?bounds.top:r.top;
  }
  menu.dataset.menuAbove=String(y+b.height<=r.top);
  const left=Math.max(gap,Math.min(x,viewport-b.width-gap));menu.style.left=left+'px';menu.style.top=Math.max(gap,Math.min(y,innerHeight-b.height-gap))+'px';menu.style.setProperty('--_menu-origin-x',Math.max(0,Math.min(100,(r.left+r.width/2-left)/b.width*100))+'%');
 }
 function close(menu,restore){const parent=triggerFor(menu)?.closest('[data-menu-panel]');parent?.removeAttribute('data-menu-covered');if(menu.matches(':popover-open'))menu.hidePopover();const trigger=triggerFor(menu);if(!trigger)return;trigger.setAttribute('aria-expanded','false');if(restore){const parent=trigger.closest('[data-menu-panel]');if(parent)focus(parent,trigger);else trigger.focus({preventScroll:true});}}
 function open(trigger,keyboard,last=false){if(trigger.disabled||trigger.getAttribute?.('aria-disabled')==='true')return;const menu=panel(trigger);if(!menu.hasAttribute('popover'))return;clearTimeout(pending.get(trigger));menu.showPopover();position(menu);trigger.setAttribute('aria-expanded','true');if(keyboard){const list=items(menu);focus(menu,last?list.at(-1):list[0]);}}
 function sync(menu){const trigger=triggerFor(menu);if(!trigger)return;const visible=menu.matches(':popover-open');trigger.setAttribute('aria-expanded',String(visible));if(visible)position(menu);else{menu.removeAttribute('data-menu-activity');const parent=trigger.closest('[data-menu-panel]');if(parent){parent.removeAttribute('data-menu-covered');activity(parent);}}}
 function init(){for(const menu of document.querySelectorAll('[data-menu-example] [data-menu-panel]')){if(initialized.has(menu))continue;initialized.add(menu);const enabled=items(menu);for(const [index,item] of enabled.entries())item.tabIndex=index===0?0:-1;if(menu.hasAttribute('popover')){menu.addEventListener('toggle',()=>sync(menu));sync(menu);}}}
 // Preserve activation eligibility before an application handler disables its
 // command while starting asynchronous work.
 document.addEventListener('click',event=>{
  const item=event.target.closest?.('[data-menu-example] [data-menu-action]');
  if(item&&!item.disabled&&item.getAttribute?.('aria-disabled')!=='true')enabledActions.add(event);
 },true);
 document.addEventListener('click',event=>{
  const back=event.target.closest?.('[data-menu-back]');if(back){close(back.closest('[data-menu-panel]'),true);return;}
  const trigger=event.target.closest?.('[data-menu-submenu],[data-menu-open]');if(trigger){const menu=panel(trigger);if(menu.hasAttribute('popover')){const shown=event.detail>0?(pointerOpen.get(trigger)??menu.matches(':popover-open')):menu.matches(':popover-open');pointerOpen.delete(trigger);if(shown)close(menu,true);else open(trigger,true);}return;}
  const item=event.target.closest?.('[data-menu-example] [data-menu-action]');if(!item||!enabledActions.has(event))return;
  const demo=item.closest('[data-menu-example]'),label=item.getAttribute('aria-label')||item.querySelector('.md-menu-item-text > span')?.textContent||item.textContent.trim();
  let message=label+' activated';
  const role=item.getAttribute('role'),menu=item.closest('[data-menu-panel]');
  if(role==='menuitemcheckbox'||role==='menuitemradio'){
   const selected=role==='menuitemradio'||item.getAttribute('aria-checked')!=='true';
   const update=(node,on)=>{node.setAttribute('aria-checked',String(on));node.dataset.selected=String(on);const check=node.querySelector('[data-menu-checked-icon]'),icon=node.querySelector('[data-menu-unchecked-icon]');if(check)check.hidden=!on;if(icon)icon.hidden=on;};
   if(role==='menuitemradio'){for(const sibling of items(menu))if(sibling.getAttribute('role')===role)update(sibling,sibling===item);}
   else update(item,selected);
   message=label+(selected?' selected':' unselected');
  }
  demo.querySelector('[data-menu-output]').textContent=message;
  if(menu?.dataset.menuSelection==='multiple')return;
  const root=demo.querySelector('[data-menu-main]:popover-open'),submenu=item.closest('[data-menu-panel][popover]');if(root)close(root,true);else if(submenu)close(submenu,true);
 });
 document.addEventListener('keydown',event=>{
  const opener=event.target.closest?.('[data-menu-open]');if(opener&&['ArrowDown','ArrowUp'].includes(event.key)){event.preventDefault();open(opener,true,event.key==='ArrowUp');return;}
  const item=event.target.closest?.('[data-menu-example] [role^="menuitem"]');if(!item)return;const menu=item.closest('[data-menu-panel]'),rtl=getComputedStyle(menu).direction==='rtl',horizontal=menu.dataset.orientation==='horizontal',list=items(menu),index=list.indexOf(item),next=menuIndex(index,list.length,event.key,horizontal,rtl);
  if(next!==null){event.preventDefault();focus(menu,list[next]);return;}
  if(item.hasAttribute('data-menu-submenu')&&event.key===(rtl?'ArrowLeft':'ArrowRight')){event.preventDefault();open(item,true);return;}
  if(event.key==='Tab'){const root=menu.closest('[data-menu-example]').querySelector('[data-menu-main]:popover-open');if(root)close(root,true);else for(const p of menu.closest('[data-menu-example]').querySelectorAll(':popover-open'))close(p,false);return;}
  if(menu.hasAttribute('popover')&&(event.key==='Escape'||(!menu.hasAttribute('data-menu-main')&&event.key===(rtl?'ArrowRight':'ArrowLeft')))){event.preventDefault();close(menu,true);return;}
  if(event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&event.key!==' '){const match=[...list.slice(index+1),...list.slice(0,index+1)].find(x=>(x.getAttribute('aria-label')||x.textContent.trim()).toLocaleLowerCase().startsWith(event.key.toLocaleLowerCase()));if(match){event.preventDefault();focus(menu,match);}}
 });
 document.addEventListener('focusin',event=>{const menu=event.target.closest?.('[data-menu-example] [data-menu-panel]');if(menu){for(const item of items(menu))item.tabIndex=item===event.target?0:-1;activity(menu);}});
 document.addEventListener('pointerover',event=>{
  if(event.pointerType==='touch'||event.buttons)return;const item=event.target.closest?.('[data-menu-example] [role^="menuitem"]'),menu=item?.closest('[data-menu-panel]');if(!menu||item.contains(event.relatedTarget))return;activity(menu);
  // Replacing surfaces can appear beneath a stationary mouse. Require explicit
  // activation there so pointer hover cannot navigate another level by itself.
  if(menu.hasAttribute('data-menu-replace'))return;
  if(item.hasAttribute('data-menu-submenu')&&panel(item).hasAttribute('popover'))pending.set(item,setTimeout(()=>open(item,false),200));
  else for(const child of menu.querySelectorAll(':popover-open'))close(child,false);
 });
 document.addEventListener('pointerdown',event=>{const trigger=event.target.closest?.('[data-menu-submenu],[data-menu-open]');if(trigger){clearTimeout(pending.get(trigger));pointerOpen.set(trigger,panel(trigger).matches(':popover-open'));}});
 document.addEventListener('pointerout',event=>{const trigger=event.target.closest?.('[data-menu-submenu]');if(trigger&&!trigger.contains(event.relatedTarget))clearTimeout(pending.get(trigger));});
 const reposition=()=>{for(const menu of document.querySelectorAll('[data-menu-example] [data-menu-panel]:popover-open'))position(menu);};
 addEventListener('resize',reposition);document.addEventListener('scroll',reposition,true);
 document.addEventListener('htmx:beforeCleanupElement',event=>{const root=event.detail?.elt;if(!root)return;for(const trigger of root.querySelectorAll('[data-menu-submenu]'))clearTimeout(pending.get(trigger));for(const menu of root.querySelectorAll('[data-menu-panel]:popover-open'))menu.hidePopover();});
 document.addEventListener('htmx:afterSwap',init);document.addEventListener('htmx:historyRestore',init);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
