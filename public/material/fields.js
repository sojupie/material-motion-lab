(() => {
 const matches=(values,query)=>values.map((value,index)=>({value,index})).filter(({value})=>value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())).map(({index})=>index);
 function popupPosition(rect,viewport,height,gap,contentWidth=0) {
  const width=Math.min(Math.max(rect.width,contentWidth),Math.max(0,viewport.width-2*gap)),below=Math.max(0,viewport.height-rect.bottom-gap),above=Math.max(0,rect.top-gap),up=below<Math.min(height,above),available=up?above:below;
  return {left:Math.max(gap,Math.min(rect.left,viewport.width-gap-width)),top:up?Math.max(gap,rect.top-Math.min(height,available)):rect.bottom,width,height:available};
 }
 function typeahead(values,current,query) {
  const text=query.toLocaleLowerCase(),cycle=text.length>1&&Array.from(text).every(c=>c===text[0]),needle=cycle?text[0]:text;
  for(let step=0;step<values.length;step++){const index=cycle?(current+1+step)%values.length:step;if(values[index].toLocaleLowerCase().startsWith(needle))return index;}return -1;
 }
 if(typeof module!=='undefined')module.exports={matches,popupPosition,typeahead};
 if(typeof document==='undefined')return;
 let touchState;
 const states=new WeakMap(),rootFor=e=>e.closest?.('[data-field-example]'),stateFor=e=>states.get(rootFor(e));
 function active(state,index) {
  const options=state.options.filter(e=>!e.hidden);state.active=Math.max(-1,Math.min(index,options.length-1));
  for(const option of state.options){delete option.dataset.active;if(option.classList.contains('md-menu-item'))delete option.dataset.componentState;}
  const option=options[state.active];if(option){option.dataset.active='true';if(option.classList.contains('md-menu-item'))option.dataset.componentState='focused';state.input.setAttribute('aria-activedescendant',option.id);option.scrollIntoView({block:'nearest',inline:'nearest'});}else state.input.removeAttribute('aria-activedescendant');
 }
 function filter(state,query) {
  const visible=new Set(matches(state.options.map(e=>e.dataset.fieldOption),query));state.options.forEach((e,index)=>{e.hidden=!visible.has(index);e.setAttribute('aria-selected',String(e.dataset.fieldOption===state.input.value));});
  state.menu.querySelector('.md-field-empty').hidden=visible.size>0;
  const divider=state.menu.querySelector('.md-field-menu-divider');if(divider)divider.hidden=!state.options.slice(0,2).some(e=>!e.hidden)||!state.options.slice(2).some(e=>!e.hidden);active(state,-1);
 }
 function position(state) {
  const style=getComputedStyle(state.root),gap=Number.parseFloat(style.getPropertyValue('--md-sys-measurement-space100')),rect=state.root.getBoundingClientRect(),viewport={width:document.documentElement.clientWidth,height:window.innerHeight};
  // Chip labels can be shorter than their options. Text fields retain field width.
  let contentWidth=0;
  if(state.input.classList?.contains('md-filter-chip')){
   state.menu.style.setProperty('--_field-popup-width','max-content');
   contentWidth=state.menu.scrollWidth;
   state.menu.style.setProperty('--_field-popup-width',popupPosition(rect,viewport,0,gap,contentWidth).width+'px');
  }
  // Measure the CSS-capped surface before choosing which side of the field to use.
  state.menu.style.setProperty('--_field-popup-height',Math.max(0,viewport.height-2*gap)+'px');
  const height=Math.min(state.menu.scrollHeight,state.menu.offsetHeight||state.menu.scrollHeight);
  const p=popupPosition(rect,viewport,height,gap,contentWidth);state.menu.dataset.menuAbove=String(p.top<rect.top);state.menu.style.setProperty('--_menu-origin-x',Math.max(0,Math.min(100,(rect.left+rect.width/2-p.left)/p.width*100))+'%');for(const [key,value]of Object.entries(p))state.menu.style.setProperty('--_field-popup-'+key,value+'px');
 }
 function open(state,query='') {
  if(state.input.disabled)return;filter(state,query);if(!state.menu.matches(':popover-open'))state.menu.showPopover();position(state);state.input.setAttribute('aria-expanded','true');
 }
 function close(state) {if(state.menu.matches(':popover-open'))state.menu.hidePopover();state.input.setAttribute('aria-expanded','false');active(state,-1);}
 function choose(state,option) {
  if(!option)return;state.input.value=option.dataset.fieldOption;const display=state.root.querySelector('[data-field-display]');if(display)display.textContent=option.dataset.fieldOption;const value=state.root.querySelector('[data-field-value]');if(value)value.value=option.dataset.fieldValue??option.dataset.fieldOption;state.root.dataset.populated='true';for(const e of state.options)e.setAttribute('aria-selected',String(e===option));close(state);state.input.focus({preventScroll:true});
  state.committing=true;try{state.input.dispatchEvent(new Event('input',{bubbles:true}));state.input.dispatchEvent(new Event('change',{bubbles:true}));}finally{state.committing=false;}
 }
 function init(){for(const input of document.querySelectorAll('[data-field-combo]')){const root=rootFor(input);if(states.has(root))continue;const menu=root.querySelector('.md-field-menu'),state={root,input,menu,readOnly:input.readOnly||input.hasAttribute('data-field-select'),options:Array.from(menu.querySelectorAll('[data-field-option]')),active:-1,buffer:'',typedAt:0};states.set(root,state);input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');menu.addEventListener('beforetoggle',event=>{if(event.newState==='closed'){input.setAttribute('aria-expanded','false');active(state,-1);}});}}
 document.addEventListener('click',event=>{
  const state=stateFor(event.target);if(!state||state.input.disabled)return;
  const option=event.target.closest('[data-field-option]');if(option){if(event.detail>0&&state.touchCommitted===option){delete state.touchCommitted;return;}choose(state,option);return;}
  if(event.target.closest('[data-field-toggle]')||state.readOnly&&!event.target.closest('.md-field-menu')){
   event.preventDefault();
   // Native light-dismiss may already have closed the popup on pointerup.
   const shown=event.detail>0?(state.pointerOpen??state.menu.matches(':popover-open')):state.menu.matches(':popover-open');delete state.pointerOpen;
   state.input.focus({preventScroll:true});if(shown)close(state);else open(state);
  }
 });
 document.addEventListener('pointerdown',event=>{
  const state=stateFor(event.target);
  if(state){delete state.touchCommitted;const option=event.target.closest('[data-field-option]');state.touchOption=event.pointerType==='touch'&&option?{option,id:event.pointerId}:null;if(state.touchOption)touchState=state;}
  if(state&&(event.target.closest('[data-field-toggle]')||state.readOnly&&!event.target.closest('.md-field-menu'))){state.pointerOpen=state.menu.matches(':popover-open');event.preventDefault();}
  else if(event.target.closest?.('[data-field-option]'))event.preventDefault();
 });
 // Commit touch selection on release: Safari can blur the trigger before it
 // delivers a click on a non-focusable option. Keep focusout from hiding it first.
 document.addEventListener('pointerup',event=>{const state=touchState,touch=state?.touchOption;if(!touch||touch.id!==event.pointerId)return;touchState=null;state.touchOption=null;if(event.target.closest('[data-field-option]')===touch.option&&state.menu.matches(':popover-open')){event.preventDefault();state.touchCommitted=touch.option;choose(state,touch.option);}else close(state);});
 // Native touch scrolling cancels the pointer; cancel the pending tap, keeping the menu open.
 document.addEventListener('pointercancel',event=>{const state=touchState;if(state?.touchOption?.id===event.pointerId){touchState=null;state.touchOption=null;}});
 document.addEventListener('input',event=>{
  const root=rootFor(event.target);if(root)root.dataset.populated=String(event.target.value!=='');
  const state=stateFor(event.target);if(state&&event.target===state.input&&!state.readOnly&&!state.committing)open(state,state.input.value);
 });
 document.addEventListener('keydown',event=>{
  const state=stateFor(event.target);if(!state||state.input.disabled||event.target!==state.input)return;
  const shown=state.menu.matches(':popover-open');
  if(event.key==='Escape'&&shown){event.preventDefault();event.stopPropagation();close(state);return;}
  if(event.key==='Tab'){close(state);return;}
  if(['ArrowDown','ArrowUp'].includes(event.key)){
   event.preventDefault();if(event.altKey&&event.key==='ArrowUp'){close(state);return;}
   if(!shown){open(state,state.readOnly?'':state.input.value);const options=state.options.filter(e=>!e.hidden),selected=options.findIndex(e=>e.getAttribute('aria-selected')==='true');active(state,selected>=0?selected:event.key==='ArrowDown'?0:options.length-1);}
   else {const count=state.options.filter(e=>!e.hidden).length;if(count)active(state,state.active<0?(event.key==='ArrowDown'?0:count-1):(state.active+(event.key==='ArrowDown'?1:-1)+count)%count);}return;
  }
  if(state.readOnly&&['Home','End'].includes(event.key)){event.preventDefault();if(!shown)open(state);active(state,event.key==='Home'?0:state.options.filter(e=>!e.hidden).length-1);return;}
  if((event.key==='Enter'||state.readOnly&&event.key===' ')&&shown){const option=state.options.filter(e=>!e.hidden)[state.active];if(option){event.preventDefault();choose(state,option);}else {if(state.readOnly)event.preventDefault();close(state);}return;}
  if(state.readOnly&&['Enter',' '].includes(event.key)){event.preventDefault();open(state);active(state,0);return;}
  if(state.readOnly&&event.key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){event.preventDefault();const now=Date.now();state.buffer=(now-state.typedAt>500?'':state.buffer)+event.key;state.typedAt=now;if(!shown)open(state);active(state,typeahead(state.options.map(e=>e.dataset.fieldOption),state.active,state.buffer));}
 });
 document.addEventListener('focusout',event=>{const state=stateFor(event.target);if(state&&!state.touchOption&&!state.root.contains(event.relatedTarget))close(state);});
 window.addEventListener('resize',()=>{for(const menu of document.querySelectorAll('.md-field-menu:popover-open'))close(stateFor(menu));});
 document.addEventListener('scroll',event=>{if(event.target.closest?.('.md-field-menu'))return;for(const menu of document.querySelectorAll('.md-field-menu:popover-open'))close(stateFor(menu));},true);
 document.addEventListener('htmx:beforeCleanupElement',event=>{const node=event.detail?.elt;if(!node)return;for(const root of [...(node.matches?.('[data-field-example]')?[node]:[]),...node.querySelectorAll('[data-field-example]')]){const state=states.get(root);if(state){close(state);states.delete(root);}}});
 document.addEventListener('htmx:afterSwap',init);document.addEventListener('htmx:historyRestore',init);if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
