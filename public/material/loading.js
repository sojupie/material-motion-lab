(() => {
  // Shape sequence and motion adapted from AndroidX Material 3 (Apache-2.0).
  const clamp = value => Math.max(0,Math.min(1,value));
  function loadingFrame(time, value) {
    time=Math.max(0,time);
    if(value!==undefined)return {index:0,progress:clamp(value),rotation:-clamp(value)*180};
    const iteration=Math.floor(time/650), seconds=(time%650)/1000;
    const omega=Math.sqrt(200), decay=.6*omega, frequency=omega*Math.sqrt(1-.6*.6);
    const progress=1-Math.exp(-decay*seconds)*(Math.cos(frequency*seconds)+decay/frequency*Math.sin(frequency*seconds));
    return {index:iteration%7,progress,rotation:progress*90+(iteration+1)*90+time/4666*360};
  }
  function loadingPath(pair, progress, scale) {
    const curves=pair[0].map((start,i)=>start.map((v,j)=>v+(pair[1][i][j]-v)*progress));
    let minX=Infinity,minY=Infinity,maxX=-Infinity,maxY=-Infinity;
    for(const curve of curves)for(let i=0;i<8;i+=2){minX=Math.min(minX,curve[i]);maxX=Math.max(maxX,curve[i]);minY=Math.min(minY,curve[i+1]);maxY=Math.max(maxY,curve[i+1]);}
    const cx=(minX+maxX)/2,cy=(minY+maxY)/2;
    const point=(curve,i)=>`${((curve[i]-cx)*scale+.5).toFixed(6)},${((curve[i+1]-cy)*scale+.5).toFixed(6)}`;
    return `M${point(curves[0],0)}`+curves.map(c=>`C${point(c,2)} ${point(c,4)} ${point(c,6)}`).join('')+'Z';
  }
  if(typeof module!=='undefined')module.exports={loadingFrame,loadingPath};
  if(typeof document==='undefined')return;
  const script=document.currentScript,source=new URL('loading-shapes.json',script.src);
  if(script.dataset.shapesVersion)source.searchParams.set('v',script.dataset.shapesVersion);
  const entries=new Map(),reduced=matchMedia('(prefers-reduced-motion: reduce)');
  let geometry,pending,frame=0;
  function paint(element,entry,time) {
    const determinate=element.dataset.control==='determinate';
    const value=determinate?Number(element.getAttribute('aria-valuenow'))/100:undefined;
    const sample=loadingFrame(reduced.matches?0:time,value),sequence=geometry[determinate?'determinate':'indeterminate'];
    element.querySelector('path').setAttribute('d',loadingPath(sequence.morphs[sample.index],sample.progress,sequence.scale));
    element.querySelector('g').setAttribute('transform',`rotate(${sample.rotation} .5 .5)`);
  }
  function moving(element,entry){return entry.visible&&element.isConnected&&element.dataset.control==='indeterminate';}
  function schedule(){if(!frame&&!reduced.matches&&!document.hidden&&[...entries].some(([e,v])=>moving(e,v)))frame=requestAnimationFrame(tick);}
  function tick(time){
    frame=0;
    for(const [element,entry]of entries){
      if(!element.isConnected){visibility.unobserve(element);entries.delete(element);continue;}
      if(moving(element,entry))paint(element,entry,time-entry.started);
    }
    schedule();
  }
  const visibility=new IntersectionObserver(records=>{for(const {target,isIntersecting}of records){const entry=entries.get(target);if(entry)entry.visible=isIntersecting;}schedule();});
  async function initialize(){
    const elements=[...document.querySelectorAll('.md-loading')].filter(e=>!entries.has(e)&&!e.closest('[inert]'));
    if(!elements.length)return;
    try{
      pending ||= fetch(source).then(response=>{if(!response.ok)throw new Error(`Loading geometry: ${response.status}`);return response.json();});
      geometry=await pending;
      for(const element of elements){
        if(!element.isConnected||entries.has(element))continue;
        const entry={visible:false,started:performance.now()};entries.set(element,entry);paint(element,entry,0);visibility.observe(element);
      }
    }catch(error){console.error(error);pending=undefined;}
  }
  document.addEventListener('input',event=>{
    if(!event.target.matches('.md-progress-control .md-slider-input input'))return;
    const demo=event.target.closest('.md-progress-demo'),element=demo.querySelector('.md-loading');if(!element)return;
    element.setAttribute('aria-valuenow',event.target.value);demo.querySelector('output').textContent=event.target.value+'%';
    if(entries.has(element))paint(element,entries.get(element),0);
  });
  document.addEventListener('htmx:afterSwap',initialize);
  document.addEventListener('tokens:assets-ready',initialize);
  document.addEventListener('htmx:beforeCleanupElement',event=>{
    for(const [element]of entries)if(element===event.detail.elt||event.detail.elt.contains(element)){visibility.unobserve(element);entries.delete(element);}
  });
  reduced.addEventListener('change',()=>{for(const [element,entry]of entries)paint(element,entry,0);schedule();});
  document.addEventListener('visibilitychange',schedule);
  initialize();
})();
