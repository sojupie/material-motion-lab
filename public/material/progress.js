(() => {
  const clamp = (n, low=0, high=1) => Math.max(low, Math.min(high, n));
  function progressNumber(value, fallback=0) {
    if(value.includes('infinity'))return Infinity;
    const number=Number.parseFloat(value);
    return Number.isFinite(number)?number:fallback;
  }
  function bezier(t, x1, y1, x2, y2) {
    const sample=(s,a,b)=>3*(1-s)*(1-s)*s*a+3*(1-s)*s*s*b+s*s*s;
    let low=0, high=1;
    for(let i=0;i<16;i++) { const mid=(low+high)/2; if(sample(mid,x1,x2)<t)low=mid;else high=mid; }
    return sample((low+high)/2,y1,y2);
  }
  // AndroidX Material 3 timing. Source tokens specify geometry and color, not motion.
  function progressSegments(time, circular) {
    if(circular) {
      const phase=(time%6000)/6000;
      const progress=phase<.5 ? .1+.77*phase*2 : .87-.77*bezier((phase-.5)*2,.2,0,0,1);
      // Keyframe easing applies after its timestamp in AndroidX: the sweep
      // grows linearly, then contracts with Standard easing. Four linear
      // 90-degree turns over 300 ms accompany the global rotation.
      const turn=(time%6000)/1500, index=Math.floor(turn);
      const rotation=(time/6000*3 + (index+clamp((turn-index)*1500/300))/4)%1;
      return [[rotation,rotation+progress]];
    }
    const t=time%1750;
    const position=(delay,duration)=>bezier(clamp((t-delay)/duration),.3,0,.8,.15);
    return [[position(250,1000),position(0,1000)],[position(900,850),position(650,850)]];
  }
  function complement(segments, gap, circular=false) {
    const spans=[];
    for(const [a,b] of segments) {
      if(b-a<=0)continue;
      for(const shift of circular?[-1,0,1]:[0]) {
        const start=clamp(a+shift-gap),end=clamp(b+shift+gap);
        if(end>start)spans.push([start,end]);
      }
    }
    spans.sort((a,b)=>a[0]-b[0]);
    const result=[];let end=0;
    for(const [a,b] of spans) { if(a>end)result.push([end,a]);end=Math.max(end,b); }
    if(end<1)result.push([end,1]);
    return result;
  }
  function progressPath(start,end,geometry,phase=0,active=true) {
    const {width,height,thickness,circular,amplitude,wavelength}=geometry;
    if(end<=start)return '';
    // The flat track follows the outer circle, not the wave's mean radius.
    const radius=(Math.min(width,height)-thickness)/2-(active?amplitude:0);
    const length=circular?2*Math.PI*radius:width-thickness;
    const waves=circular?Math.max(1,Math.round(Math.PI*(Math.min(width,height)-thickness)/wavelength)):length/wavelength;
    const steps=Math.max(2,Math.ceil((end-start)*length/2));let path='';
    for(let i=0;i<=steps;i++) {
      const p=start+(end-start)*i/steps;
      // Circular wave motion is relative to the rotating arc. One wavelength
      // advances each second; the waveform must not slide backwards in page space.
      const wave=active?amplitude*Math.sin(2*Math.PI*(circular?(p-start)*waves+phase:p*waves-phase)):0;
      const angle=2*Math.PI*p-Math.PI/2;
      const x=circular?width/2+(radius+wave)*Math.cos(angle):thickness/2+p*length;
      const y=circular?height/2+(radius+wave)*Math.sin(angle):height/2+wave;
      path+=`${i?'L':'M'}${x.toFixed(3)},${y.toFixed(3)} `;
    }
    return path;
  }
  if(typeof module!=='undefined')module.exports={progressSegments,complement,progressPath,progressNumber};
  if(typeof document==='undefined')return;
  const entries=new Map(), reduce=matchMedia('(prefers-reduced-motion: reduce)');
  let frame=0;
  function measure(element,entry) {
    const style=getComputedStyle(element),number=(key,fallback=0)=>progressNumber(style.getPropertyValue('--_progress-'+key),fallback);
    const box={width:element.clientWidth,height:element.clientHeight},wave=element.dataset.shape==='wave';
    entry.geometry={width:box.width,height:box.height,circular:element.dataset.variant.endsWith('circular'),thickness:number('thickness'),amplitude:wave?number('amplitude'):0,wavelength:number('wavelength',40)};
    entry.gap=number('gap');entry.trackThickness=number('track-thickness',entry.geometry.thickness);
    entry.round=number('shape')>0;entry.trackRound=number('track-shape')>0;
    entry.stop=number('stop-size');entry.stopShape=number('stop-shape');entry.trailing=number('stop-trailing');
    const svg=element.querySelector('svg');svg.setAttribute('viewBox',`0 0 ${box.width} ${box.height}`);
    paint(element,entry,performance.now()-entry.started);
  }
  function paint(element,entry,time) {
    const g=entry.geometry;if(!g.width||!g.height)return;
    const indeterminate=element.dataset.control==='indeterminate';
    const value=clamp(Number(element.getAttribute('aria-valuenow'))/100);
    const segments=indeterminate?progressSegments(reduce.matches||element.closest('[inert]')?650:time,g.circular):[[0,value]];
    const radius=(Math.min(g.width,g.height)-g.thickness)/2;
    const length=g.circular?2*Math.PI*radius:g.width-g.thickness;
    const cap=Math.max(entry.round?g.thickness/2:0,entry.trackRound?entry.trackThickness/2:0);
    const sweep=segments.reduce((total,[a,b])=>total+b-a,0)*length;
    // As progress starts, grow the spacing with the arc (AndroidX drawing cache).
    const gap=(Math.min(sweep,entry.gap)+2*Math.min(sweep,cap))/length;
    const track=element.querySelector('.md-progress-track');
    // A legacy circular spinner has no track token.
    track.setAttribute('d',element.dataset.variant==='legacy-circular'?'':complement(segments,gap,g.circular).map(([a,b])=>progressPath(a,b,g,0,false)).join(' '));
    track.style.strokeWidth=String(entry.trackThickness);track.style.strokeLinecap=entry.trackRound?'round':'butt';
    element.querySelectorAll('.md-progress-active').forEach((path,index)=>{
      const span=segments[index];
      path.setAttribute('d',span?progressPath(span[0],span[1],g,reduce.matches||element.closest('[inert]')?0:time/1000):'');
      path.style.strokeWidth=String(g.thickness);path.style.strokeLinecap=entry.round?'round':'butt';
      path.style.stroke=element.dataset.shape==='four-color'?`var(--_progress-color-${['one','two','three','four'][Math.floor(time/1750)%4]})`:'';
    });
    const stop=element.querySelector('.md-progress-stop');
    stop.style.display=!g.circular&&!indeterminate&&entry.stop&&value<1?'':'none';
    stop.setAttribute('x',String(g.width-entry.trailing-entry.stop));stop.setAttribute('y',String((g.height-entry.stop)/2));stop.setAttribute('width',String(entry.stop));stop.setAttribute('height',String(entry.stop));stop.setAttribute('rx',String(Math.min(entry.stopShape,entry.stop/2)));
  }
  function moving(element,entry) { return entry.visible&&element.isConnected&&!element.closest('[inert]')&&(element.dataset.control==='indeterminate'||element.dataset.shape==='wave'); }
  function schedule() {
    if(frame||reduce.matches||document.hidden||![...entries].some(([e,v])=>moving(e,v)))return;
    frame=requestAnimationFrame(tick);
  }
  function tick(time) {
    frame=0;
    for(const [element,entry]of entries) {
      if(!element.isConnected){resize.unobserve(element);visibility.unobserve(element);entry.changes.disconnect();entries.delete(element);continue;}
      if(moving(element,entry))paint(element,entry,time-entry.started);
    }
    schedule();
  }
  const resize=new ResizeObserver(records=>{for(const {target}of records)if(entries.has(target))measure(target,entries.get(target));});
  const visibility=new IntersectionObserver(records=>{for(const {target,isIntersecting}of records){const entry=entries.get(target);if(entry)entry.visible=isIntersecting;}schedule();});
  function initialize() {
    for(const element of document.querySelectorAll('.md-progress')) {
      if(entries.has(element))continue;
      const entry={visible:false,started:performance.now()};
      entry.changes=new MutationObserver(()=>{measure(element,entry);schedule();});
      entry.changes.observe(element,{attributes:true,attributeFilter:['aria-valuenow','data-control','data-variant','data-shape']});
      entries.set(element,entry);measure(element,entry);resize.observe(element);visibility.observe(element);
    }
  }
  document.addEventListener('input',event=>{
    if(!event.target.matches('.md-progress-control .md-slider-input input'))return;
    const demo=event.target.closest('.md-progress-demo'),element=demo.querySelector('.md-progress');
    if(!element)return;
    element.setAttribute('aria-valuenow',event.target.value);demo.querySelector('output').textContent=event.target.value+'%';paint(element,entries.get(element),performance.now()-entries.get(element).started);
  });
  document.addEventListener('htmx:afterSwap',initialize);
  document.addEventListener('htmx:beforeCleanupElement',event=>{
    for(const [element,entry]of entries)if(element===event.detail.elt||event.detail.elt.contains(element)){resize.unobserve(element);visibility.unobserve(element);entry.changes.disconnect();entries.delete(element);}
  });
  document.addEventListener('visibilitychange',schedule);
  reduce.addEventListener('change',()=>{for(const [element,entry]of entries)paint(element,entry,0);schedule();});
  initialize();
  document.addEventListener('tokens:assets-ready',()=>{initialize();schedule();});
})();
