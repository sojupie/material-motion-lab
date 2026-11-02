(() => {
  function revealSnap(offset,distance,rtl=false) {return (rtl?offset:-offset)>=distance/2;}
  function moveIndex(index,delta,length) {return Math.max(0,Math.min(length-1,index+delta));}
  if(typeof module!=='undefined')module.exports={revealSnap,moveIndex};
  if(typeof document==='undefined')return;
  const reduced=matchMedia('(prefers-reduced-motion: reduce)'),animations=new WeakMap();
  let gesture=null;
  const rows=list=>[...list.querySelectorAll(':scope > [data-list-row]')];
  const primary=row=>row.querySelector('.md-list-row > .md-list-item');
  const options=list=>[...list.querySelectorAll('[role="option"]')].filter(item=>!item.matches(':disabled,[aria-disabled="true"]')&&!item.closest('[inert]')&&item.getClientRects().length&&getComputedStyle(item).visibility==='visible');
  function optionFocus(list,item){for(const option of list.querySelectorAll('[role="option"]'))option.tabIndex=option===item?0:-1;}
  function selectOption(list,item){
    const selected=list.dataset.selectionMode==='single'||item.getAttribute('aria-selected')!=='true';
    if(list.dataset.selectionMode==='single')for(const option of list.querySelectorAll('[role="option"]'))option.setAttribute('aria-selected','false');
    item.setAttribute('aria-selected',String(selected));
    announce(list,item.dataset.listLabel+(selected?' selected.':' unselected.'));
  }
  const announce=(list,text)=>{const host=list.closest('[data-list-host],.md-list-demo'),status=host?.querySelector('[data-list-status]');if(status)status.textContent=text;list.dispatchEvent(new CustomEvent('md-list-change',{bubbles:true,detail:{text}}));};
  const timing=element=>MaterialMotion.timing(element,'default-spatial');
  const cancelFeedback=button=>button.dispatchEvent(new CustomEvent('material:cancel-feedback',{bubbles:true}));
  // Baseline list measurements top-align content at 88dp, including rows
  // made taller by media or wrapped text. Keep captured padding unchanged.
  // https://m3.material.io/components/lists/specs
  const observed=new WeakSet(),sizes=new ResizeObserver(entries=>{
    for(const entry of entries)entry.target.toggleAttribute('data-list-tall',entry.borderBoxSize?.[0]?.blockSize>=88||entry.target.getBoundingClientRect().height>=88);
  });
  function init(){for(const item of document.querySelectorAll('.md-list-item'))if(!observed.has(item)){observed.add(item);sizes.observe(item);}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
  reduced.addEventListener('change',()=>{if(reduced.matches)for(const panel of document.querySelectorAll('[data-list-animating]'))animations.get(panel)?.finish();});
  document.addEventListener('htmx:afterSwap',init);
  document.addEventListener('htmx:beforeCleanupElement',event=>{for(const item of event.detail.elt.querySelectorAll?.('.md-list-item')||[])sizes.unobserve(item);});
  document.addEventListener('change',event=>{
    const input=event.target;if(!input.matches('.md-list-selection-control > input'))return;
    const list=input.closest('.md-list');
    if(input.checked&&list.dataset.selectionMode==='single')for(const other of list.querySelectorAll('.md-list-selection-control > input'))if(other!==input)other.checked=false;
    for(const item of list.querySelectorAll('.md-list-item')){const control=item.querySelector('.md-list-selection-control > input');if(control){item.dataset.selected=String(control.checked);if(item.getAttribute('role')==='option')item.setAttribute('aria-selected',String(control.checked));}}
    announce(list,input.getAttribute('aria-label')+(input.checked?' selected.':' unselected.'));
  });
  function reveal(row,open) {
    const rtl=getComputedStyle(row).direction==='rtl',distance=row.querySelector('.md-list-reveal-action').getBoundingClientRect().width;
    row.dataset.revealed=String(open);
    const surface=row.querySelector('.md-list-row');surface.dataset.revealed=String(open);surface.style.setProperty('--_list-reveal-offset',(open?(rtl?distance:-distance):0)+'px');
    row.querySelector('[data-list-reveal-toggle]').setAttribute('aria-expanded',String(open));
  }
  async function expand(button) {
    const panel=document.getElementById(button.getAttribute('aria-controls')),open=button.getAttribute('aria-expanded')!=='true';
    const from=panel.hidden?0:panel.getBoundingClientRect().height;
    const row=button.closest('[data-list-row]');
    animations.get(panel)?.cancel();button.setAttribute('aria-expanded',String(open));row.dataset.listExpanded='true';panel.hidden=false;panel.inert=!open;
    panel.style.height='';const to=open?panel.scrollHeight:0;
    if(reduced.matches){panel.hidden=!open;panel.inert=!open;row.dataset.listExpanded=String(open);panel.removeAttribute('data-list-animating');return;}
    panel.setAttribute('data-list-animating','');
    const animation=panel.animate([{height:from+'px'},{height:to+'px'}],{...timing(panel),fill:'both'});animations.set(panel,animation);
    try{await animation.finished;if(animations.get(panel)!==animation)return;panel.hidden=!open;row.dataset.listExpanded=String(open);panel.style.height='';panel.removeAttribute('data-list-animating');animation.cancel();animations.delete(panel);}catch{}
  }
  function updateMoveActions(list) {
    const items=rows(list),row=items.find(item=>item.hasAttribute('data-list-action-target'));
    if(!row)return;
    const index=items.indexOf(row);
    for(const button of list.closest('[data-list-host],.md-list-demo').querySelectorAll('[data-list-move]'))button.disabled=primary(row).disabled||(button.dataset.listMove==='up'&&index===0)||(button.dataset.listMove==='down'&&index===items.length-1);
  }
  function move(row,index) {
    const list=row.parentElement,items=rows(list),from=new Map(items.map(item=>[item,item.getBoundingClientRect().top]));
    const old=items.indexOf(row);if(old===index)return;
    list.insertBefore(row,index<old?items[index]:items[index].nextSibling);
    for(const item of items){if(item===gesture?.row)continue;animations.get(item)?.cancel();const delta=from.get(item)-item.getBoundingClientRect().top;if(delta&&!reduced.matches){const a=item.animate([{transform:`translateY(${delta}px)`},{transform:'none'}],timing(list));animations.set(item,a);a.finished.catch(()=>{});}}
    if(gesture?.placeholder){gesture.placeholder.style.top=gesture.row.offsetTop+'px';gesture.placeholder.style.height=gesture.row.offsetHeight+'px';}
    updateMoveActions(list);
    announce(list,`${row.dataset.listLabel} moved to position ${index+1} of ${items.length}.`);
  }
  function pickUp(state) {
    state.original=rows(state.list);state.transform=state.row.style.transform;state.row.setAttribute('data-list-dragging','');state.list.setAttribute('data-reordering','');primary(state.row).setAttribute('data-dragged','true');
    state.row.querySelector('[data-list-grip]').setAttribute('aria-pressed','true');
    const placeholder=document.createElement('li');placeholder.className='md-list-drop-zone';placeholder.setAttribute('aria-hidden','true');placeholder.setAttribute('role','presentation');placeholder.style.top=state.row.offsetTop+'px';placeholder.style.height=state.row.offsetHeight+'px';state.list.append(placeholder);state.placeholder=placeholder;
    announce(state.list,state.row.dataset.listLabel+' picked up.');
  }
  function finish(cancel=false) {
    const state=gesture;if(!state)return;gesture=null;
    if(state.type==='reorder'&&state.moved){
      if(cancel&&state.list.isConnected)for(const row of state.original)state.list.append(row);
      state.row.style.transform=state.transform;state.row.removeAttribute('data-list-dragging');state.list.removeAttribute('data-reordering');primary(state.row).removeAttribute('data-dragged');state.row.querySelector('[data-list-grip]').setAttribute('aria-pressed','false');state.placeholder.remove();
      announce(state.list,state.row.dataset.listLabel+(cancel?' reorder cancelled.':' dropped.'));
    }else if(state.type==='reveal'&&state.moved){state.row.querySelector('.md-list-row').removeAttribute('data-swiping');reveal(state.row,cancel?state.open:revealSnap(state.offset,state.distance,state.rtl));}
    if(state.id!==undefined&&state.handle?.hasPointerCapture(state.id))state.handle.releasePointerCapture(state.id);
  }
  document.addEventListener('click',event=>{
    const row=event.target.closest?.('[data-list-row]')||(event.target.closest?.('[data-list-move]')&&event.target.closest('[data-list-host],.md-list-demo').querySelector('[data-list-action-target]'));if(!row)return;
    const native=row.querySelector('.md-list-selection-control > input');
    if(native&&!event.target.closest('.md-list-selection-control')&&!event.target.closest('button')){if(!native.disabled)native.click();return;}
    const list=row.closest('.md-list'),button=event.target.closest('button');if(!button||button.disabled)return;
    if(event.detail&&row.hasAttribute('data-list-suppress-click')){event.preventDefault();row.removeAttribute('data-list-suppress-click');return;}
    if(button.hasAttribute('data-list-reveal-toggle')){reveal(row,row.dataset.revealed!=='true');return;}
    if(button.hasAttribute('data-list-reveal-action')){reveal(row,false);primary(row).focus();announce(list,row.dataset.listLabel+' marked done.');return;}
    if(button.hasAttribute('data-list-grip')){
      for(const item of rows(list)){item.toggleAttribute('data-list-action-target',item===row);if(item===row)primary(item).setAttribute('data-dragged','true');else primary(item).removeAttribute('data-dragged');}
      const sheet=list.closest('[data-list-host],.md-list-demo').querySelector('[data-list-reorder-sheet]');sheet.setAttribute('aria-label','Reorder '+row.dataset.listLabel);
      if(!sheet.dataset.listTargetCleanup){sheet.dataset.listTargetCleanup='true';sheet.addEventListener('close',()=>{for(const item of rows(list)){item.removeAttribute('data-list-action-target');primary(item).removeAttribute('data-dragged');}});}
      updateMoveActions(list);sheet.querySelector('[data-list-move]:not(:disabled)')?.focus({preventScroll:true});return;
    }
    if(button.hasAttribute('data-list-move')){
      const items=rows(list);move(row,moveIndex(items.indexOf(row),button.dataset.listMove==='up'?-1:1,items.length));
      (button.disabled?button.closest('[data-list-reorder-sheet]').querySelector('[data-list-move]:not(:disabled)'):button).focus({preventScroll:true});return;
    }
    if(!button.matches('.md-list-item'))return;
    if(button.hasAttribute('aria-controls')){expand(button);return;}
    if(button.getAttribute('role')==='option'){selectOption(list,button);return;}
    if(list.dataset.selectionMode==='single')for(const item of rows(list))primary(item).setAttribute('aria-pressed',String(item===row));
    announce(list,button.dataset.listLabel+(button.getAttribute('aria-pressed')==='true'?' selected.':' activated.'));
  });
  document.addEventListener('focusin',event=>{const item=event.target.closest?.('[role="option"]');if(item)optionFocus(item.closest('.md-list'),item);});
  document.addEventListener('keydown',event=>{
    if(event.target.closest?.('[data-list-reorder-sheet]'))return;
    const list=event.target.closest?.('.md-list');if(!list)return;
    const option=event.target.closest?.('[role="option"]');
    if(option&&list.getAttribute('role')==='listbox'){
      const items=options(list),index=items.indexOf(option);if(index<0)return;
      if(event.key==='Enter'||event.key===' '){event.preventDefault();const input=option.querySelector('.md-list-selection-control > input');if(input){if(list.dataset.selectionMode!=='single'||!input.checked)input.click();}else option.click();return;}
      const next=globalThis.MaterialComponents.navigationIndex(index,items.length,event.key,['ArrowLeft','ArrowRight'].includes(event.key),getComputedStyle(list).direction==='rtl');
      if(next!==null){event.preventDefault();optionFocus(list,items[next]);items[next].focus({preventScroll:true});}return;
    }
    if(event.key==='Escape'&&gesture){event.preventDefault();finish(true);return;}
    const row=event.target.closest('[data-list-row]');
    if(list.dataset.control==='reveal'&&row&&event.key==='Escape'){event.preventDefault();reveal(row,false);return;}
    if(['reveal','reorder'].includes(list.dataset.control)&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      const actions=[...list.querySelectorAll('button:not(:disabled)')].filter(b=>b.getClientRects().length&&getComputedStyle(b).visibility!=='hidden'),index=actions.indexOf(event.target.closest('button'));
      if(index<0)return;event.preventDefault();const next=event.key==='Home'?0:event.key==='End'?actions.length-1:(index+(['ArrowUp','ArrowLeft'].includes(event.key)?-1:1)+actions.length)%actions.length;actions[next]?.focus();return;
    }
    if(event.target.matches('.md-list-item')&&['ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Home','End'].includes(event.key)){
      const buttons=[...list.querySelectorAll('.md-list-item:not(:disabled):not([aria-disabled="true"])')].filter(item=>item.getClientRects().length&&!item.closest('[inert]')&&getComputedStyle(item).visibility==='visible'),index=buttons.indexOf(event.target);if(index<0)return;
      const horizontal=['ArrowLeft','ArrowRight'].includes(event.key),next=globalThis.MaterialComponents.navigationIndex(index,buttons.length,event.key,horizontal,getComputedStyle(list).direction==='rtl');
      event.preventDefault();buttons[next]?.focus({preventScroll:true});
    }
  });
  document.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.isPrimary===false)return;
    const option=event.target.closest?.('[role="option"]');if(option&&option.getAttribute('aria-disabled')!=='true'){event.preventDefault();option.focus({preventScroll:true});}
    const row=event.target.closest?.('[data-list-row]'),button=event.target.closest?.('button');if(!row||!button||button.disabled)return;
    row.removeAttribute('data-list-suppress-click');const list=row.closest('.md-list');
    if(list.dataset.control==='reorder'&&button.matches('.md-list-item,[data-list-grip]')){gesture={type:'reorder',row,list,handle:button,id:event.pointerId,x:event.clientX,y:event.clientY,top:row.getBoundingClientRect().top,moved:false};return;}
    if(list.dataset.control==='reveal'&&button.matches('.md-list-item')){
      const distance=row.querySelector('.md-list-reveal-action').getBoundingClientRect().width,rtl=getComputedStyle(row).direction==='rtl',open=row.dataset.revealed==='true';
      gesture={type:'reveal',row,list,handle:button,id:event.pointerId,x:event.clientX,y:event.clientY,moved:false,distance,rtl,open,start:open?(rtl?distance:-distance):0};
    }
  });
  document.addEventListener('pointermove',event=>{
    const state=gesture;if(!state||state.id!==event.pointerId)return;
    const dx=event.clientX-state.x,dy=event.clientY-state.y,slop=parseFloat(getComputedStyle(state.list).getPropertyValue('--md-sys-measurement-space100'));
    if(!state.moved){
      if(state.type==='reveal'&&Math.abs(dy)>Math.abs(dx)+slop){gesture=null;return;}
      if(Math.abs(state.type==='reorder'?dy:dx)<slop)return;
      state.moved=true;cancelFeedback(state.handle);state.handle.setPointerCapture(event.pointerId);state.row.setAttribute('data-list-suppress-click','');
      if(state.type==='reorder')pickUp(state);else state.row.querySelector('.md-list-row').setAttribute('data-swiping','');
    }
    event.preventDefault();
    if(state.type==='reveal'){
      state.offset=Math.max(state.rtl?0:-state.distance,Math.min(state.rtl?state.distance:0,state.start+dx));state.row.querySelector('.md-list-row').style.setProperty('--_list-reveal-offset',state.offset+'px');return;
    }
    const items=rows(state.list),index=items.indexOf(state.row),origin=state.list.getBoundingClientRect().top;
    const next=items[index+1],previous=items[index-1];
    if(next&&event.clientY>origin+next.offsetTop+next.offsetHeight/2)move(state.row,index+1);
    else if(previous&&event.clientY<origin+previous.offsetTop+previous.offsetHeight/2)move(state.row,index-1);
    const natural=state.row.getBoundingClientRect().top-(state.offset||0);state.offset=state.top+dy-natural;state.row.style.transform=`translateY(${state.offset}px)`;
    state.handle.setPointerCapture(event.pointerId);
  });
  document.addEventListener('pointerup',event=>{if(gesture&&gesture.id===event.pointerId)finish();});
  document.addEventListener('pointercancel',event=>{if(gesture&&gesture.id===event.pointerId)finish(true);});
  document.addEventListener('htmx:beforeCleanupElement',event=>{if(gesture&&event.detail.elt.contains(gesture.list))finish(true);});
  window.addEventListener('blur',()=>finish(true));
  document.addEventListener('tokens:assets-ready',init);
})();
