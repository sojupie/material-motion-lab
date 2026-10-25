(() => {
  function initializeCheckboxes(root = document) {
    for (const input of root.querySelectorAll('input[data-indeterminate="true"]')) {
      input.indeterminate = true;
      input.removeAttribute("data-indeterminate");
    }
  }
  initializeCheckboxes();
  document.addEventListener("htmx:afterSwap", () => initializeCheckboxes());

  const { springFrames, springState, springTrack } = MaterialMotion;
  // Neighbor compression adapted from AndroidX ButtonGroup.kt, Copyright 2024
  // The Android Open Source Project, Apache-2.0. See THIRD_PARTY_NOTICES.md.
  function groupWidths(widths,index,ratio,limits) {
    const result=[...widths];if(index<0||index>=widths.length||widths.length<2)return result;
    const neighbors=[index-1,index+1].filter(i=>i>=0&&i<widths.length);
    const growth=Math.max(0,Math.min(widths[index]*ratio/neighbors.length,...neighbors.map(i=>Math.min(limits[i],widths[i]))));
    for(const i of neighbors){result[i]-=growth;result[index]+=growth;}
    return result;
  }
  // FAB menu reveal behavior adapted from AndroidX FloatingActionButtonMenu.kt,
  // Copyright 2024 The Android Open Source Project, Apache-2.0.
  function fabMenuDelays(count,spring,opening) {
    // AndroidX reveals items as the animated integer item count crosses each step.
    return Array.from({length:count},(_,index)=>{
      const visible=opening?count-index:index+1;
      const sample=spring.samples.findIndex(p=>Math.round(Math.max(0,Math.min(1,p))*count)>=visible);
      return Math.max(0,sample)*spring.duration/(spring.samples.length-1);
    });
  }
  function corners(value, width, height) {
    const parts = value.replace(/calc\(\s*infinity\s*\*\s*1px\s*\)/g, "infinity").trim().split(/\s+/);
    const radius = parts.map((part) =>
      part.includes("infinity")
        ? Math.min(width, height) / 2
        : part.endsWith("%")
          ? (Math.min(width, height) * parseFloat(part)) / 100
          : Math.min(parseFloat(part), Math.min(width, height) / 2),
    );
    if (radius.some((n) => !Number.isFinite(n)))
      throw new Error("Invalid button shape");
    if (radius.length === 1) return Array(4).fill(radius[0]);
    if (radius.length === 2)
      return [radius[0], radius[1], radius[0], radius[1]];
    if (radius.length === 3) return [...radius, radius[1]];
    return radius;
  }
  // Geometry and lifecycle adapted from Material Web's Apache-2.0 ripple.
  // Copyright 2022 Google LLC, Apache-2.0. See THIRD_PARTY_NOTICES.md.
  function rippleGeometry(width, height, point, zoom = 1) {
    const max = Math.max(width, height);
    const size = Math.max(1, Math.floor((max * 0.2) / zoom));
    const scale =
      (Math.hypot(width, height) + 10 + Math.max(max * 0.35, 75)) / size / zoom;
    const x = point ? point.x / zoom : width / zoom / 2;
    const y = point ? point.y / zoom : height / zoom / 2;
    return {
      size,
      start: `translate(${x - size / 2}px, ${y - size / 2}px) scale(1)`,
      end: `translate(${(width / zoom - size) / 2}px, ${(height / zoom - size) / 2}px) scale(${scale})`,
    };
  }
  if (typeof module !== "undefined")
    module.exports = { springFrames, corners, rippleGeometry, groupWidths, fabMenuDelays };
  if (typeof document === "undefined") return;

  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  const forced = matchMedia("(forced-colors: active)");
  const active = new Map(),
    shapes = new Map(),
    ripples = new Set(),
    cancelled = new Map();
  const disabled = (button) =>
    button.matches(':disabled,[aria-disabled="true"],:has(> input:disabled)');
  const buttonFor = (target) =>
    target instanceof Element
      ? target.closest(
          ".md-button,.md-icon-button,.md-filter-chip,.md-assist-chip,.md-suggestion-chip,.md-input-chip,.md-interactive-card,.md-menu-item,.md-radio,.md-checkbox,.md-switch,.md-nav-item,.md-tab,.md-segmented-button,.md-slider-input,.md-list-item,.md-carousel-item,.md-search-trigger,.md-date-day,.md-date-year,.md-date-month-item,.md-date-menu-button,.md-time-value,.md-time-period",
        )
      : null;
  function currentCorners(button) {
    const style = getComputedStyle(button),
      rect = button.getBoundingClientRect();
    return ["TopLeft", "TopRight", "BottomRight", "BottomLeft"].map((c) =>
      radiusPixels(style[`border${c}Radius`],rect.width,rect.height),
    );
  }
  function radiusPixels(value,width,height) {
    if(!/^(?:calc|min|max|clamp)\(/.test(value))return corners(value,width,height)[0];
    // CSS transitions can interpolate percentages into calc()/min() expressions.
    // Measure their used length with the same circular-corner percentage basis.
    const basis=document.createElement('div'),probe=document.createElement('div');
    basis.style.cssText=`position:fixed;visibility:hidden;pointer-events:none;inset:0 auto auto 0;width:${Math.min(width,height)}px;height:0;border:0;padding:0;contain:layout style;`;
    probe.style.cssText='display:block;height:0;min-width:0;max-width:none;padding:0;border:0;';
    probe.style.width=value;basis.append(probe);document.body.append(basis);
    const result=probe.getBoundingClientRect().width;basis.remove();
    return Math.min(result,Math.min(width,height)/2);
  }
  function targetCorners(button, target) {
    // Let CSS resolve math and mixed percentage/length corners before animating.
    const radius=button.style.borderRadius,transition=button.style.transition;
    button.style.transition='none';
    button.style.borderRadius=getComputedStyle(button).getPropertyValue(target);
    const result=currentCorners(button);
    button.style.borderRadius=radius;button.style.transition=transition;
    return result;
  }
  const fabMenus=new Map();
  function animateFABMenu(panel,opening) {
    const items=[...panel.querySelectorAll('.md-fab-menu-item')],trigger=panel.closest('.md-fab-menu').querySelector('.md-fab-menu-opener'),old=fabMenus.get(panel);
    const interrupted=!!old;
    const from=items.map(item=>({width:item.getBoundingClientRect().width,opacity:parseFloat(getComputedStyle(item).opacity)}));
    for(const animation of old?.animations||[])animation.cancel();
    const widths=items.map(item=>item.getBoundingClientRect().width),style=getComputedStyle(panel);
    const motion=role=>springFrames(parseFloat(style.getPropertyValue(`--_fab-menu-${role}-damping`)),parseFloat(style.getPropertyValue(`--_fab-menu-${role}-stiffness`)));
    const spatial=motion('width'),effects=motion('alpha'),stagger=motion('stagger');
    const delays=fabMenuDelays(items.length,stagger,opening);
    const total=Math.max(...delays)+Math.max(spatial.duration,effects.duration);
    const state={animations:[],opening};fabMenus.set(panel,state);
    panel.style.setProperty('--_fab-menu-exit-duration',reduced.matches?'0ms':total+'ms');
    if(reduced.matches){panel.style.inlineSize='';fabMenus.delete(panel);return;}
    panel.style.inlineSize=Math.max(trigger.getBoundingClientRect().width,...widths)+'px';
    panel.setAttribute('data-menu-animating','');
    for(const [index,item]of items.entries()) {
      const start=interrupted?from[index]:opening?{width:0,opacity:0}:from[index];
      const target=opening?{width:widths[index],opacity:1}:{width:0,opacity:0};
      for(const [property,spring]of [['width',spatial],['opacity',effects]]) {
        const frames=spring.samples.map((p,i)=>({[property]:property==='width'?Math.max(0,start.width+(target.width-start.width)*p)+'px':Math.max(0,Math.min(1,start.opacity+(target.opacity-start.opacity)*p)),offset:i/(spring.samples.length-1)}));
        state.animations.push(item.animate(frames,{duration:spring.duration,delay:delays[index],easing:'linear',fill:'both'}));
      }
    }
    Promise.all(state.animations.map(animation=>animation.finished)).then(()=>{
      if(fabMenus.get(panel)!==state)return;
      // Closed animations retain their zero width until the native display transition ends.
      if(opening)for(const animation of state.animations)animation.cancel();
      if(opening)fabMenus.delete(panel);
      panel.removeAttribute('data-menu-animating');panel.style.inlineSize='';
    },()=>{});
  }
  document.addEventListener('beforetoggle',event=>{
    if(event.newState==='closed'&&event.target.matches?.('.md-fab-menu-panel[popover]'))animateFABMenu(event.target,false);
  },true);
  document.addEventListener('toggle',event=>{
    if(event.newState==='open'&&event.target.matches?.('.md-fab-menu-panel[popover]'))animateFABMenu(event.target,true);
  },true);
  const widthGroups=new Map();
  function widthGroup(button,pressed) {
    const group=button.closest('.md-button-group');if(group?.dataset?.control!=='standard')return;
    let state=widthGroups.get(group);
    if(!state){
      const items=[...group.querySelectorAll(':scope > .md-button')];
      state={items,base:items.map(item=>item.getBoundingClientRect().width),original:items.map(item=>item.style.width),limits:items.map(item=>{const s=getComputedStyle(item);return Math.min(parseFloat(s.paddingInlineStart),parseFloat(s.paddingInlineEnd));}),animations:[],revision:0};
      widthGroups.set(group,state);
    }
    const from=state.items.map(item=>item.getBoundingClientRect().width);
    const velocity=from.map((_,i)=>state.motion&&state.animations[i]?springState(state.motion.damping,state.motion.stiffness,Math.max(0,Number(state.animations[i].currentTime)||0)/1000,state.motion.from[i],state.motion.to[i],state.motion.velocity[i]).velocity:0);
    for(const animation of state.animations)animation.cancel();
    const revision=++state.revision,style=getComputedStyle(group);
    const held=state.items.findIndex(item=>item.hasAttribute('data-pressed'));
    const index=pressed?state.items.indexOf(button):held>=0?held:group.dataset.componentState==='pressed'?1:-1;
    const to=groupWidths(state.base,index,parseFloat(style.getPropertyValue('--_group-width-growth'))/100,state.limits);
    for(const [i,item]of state.items.entries())item.style.width=to[i]+'px';
    const finish=()=>{
      if(state.revision!==revision)return;
      state.animations=[];group.removeAttribute('data-width-animating');
      if(index<0){for(const [i,item]of state.items.entries())item.style.width=state.original[i];widthGroups.delete(group);}
    };
    if(reduced.matches||document.hidden){finish();return;}
    const damping=parseFloat(style.getPropertyValue('--_group-width-damping')),stiffness=parseFloat(style.getPropertyValue('--_group-width-stiffness'));
    const {samples,duration}=springTrack(damping,stiffness,from,to,velocity);state.motion={damping,stiffness,from,to,velocity};
    group.setAttribute('data-width-animating','');
    state.animations=state.items.map((item,i)=>item.animate(samples.map((widths,j)=>({width:Math.max(0,widths[i])+'px',offset:j/(samples.length-1)})),{duration,easing:'linear'}));
    Promise.all(state.animations.map(a=>a.finished)).then(finish,()=>{});
  }
  const widthGallery=new WeakSet();
  function initializeWidthGroups(){
    for(const group of document.querySelectorAll('.md-button-group[data-control="standard"][data-component-state="pressed"]'))if(!widthGallery.has(group)){
      widthGallery.add(group);const button=group.querySelectorAll(':scope > .md-button')[1];
      widthGroup(button,true);const state=widthGroups.get(group);for(const animation of state?.animations||[])animation.finish();
    }
  }
  document.addEventListener('htmx:afterSwap',()=>{if(!globalThis.TokenAssets)initializeWidthGroups();});
  document.addEventListener('tokens:assets-ready',initializeWidthGroups);
  function restoreShape(button) {
    if (!button.hasAttribute("data-pressed")) return;
    const start = currentCorners(button);
    button.removeAttribute("data-pressed");
    shapeTo(button, "--_button-rest-shape", start);
    widthGroup(button,false);
  }
  const shapeMotions = new WeakMap();
  function shapeTo(button, target, initial) {
    const old = shapes.get(button), prior = shapeMotions.get(button);
    const velocity = old && prior ? prior.from.map((n, i) => springState(prior.damping, prior.stiffness, Math.max(0, Number(old.currentTime) || 0) / 1000, n, prior.to[i], prior.velocity[i]).velocity) : [0, 0, 0, 0];
    const style = getComputedStyle(button);
    // Leave CSS transitions untouched when this component has no shape spring.
    if (!style.getPropertyValue("--_button-spring-damping").trim()) return;
    const start = initial || currentCorners(button);
    old?.cancel();
    const end = targetCorners(button, target);
    if (!button.isConnected) {
      shapes.delete(button);
      return;
    }
    if (
      reduced.matches ||
      !button.animate ||
      start.some((n) => !Number.isFinite(n))
    ) {
      shapes.delete(button);
      return;
    }
    const damping = parseFloat(style.getPropertyValue("--_button-spring-damping")), stiffness = parseFloat(style.getPropertyValue("--_button-spring-stiffness"));
    const { samples, duration } = springTrack(damping, stiffness, start, end, velocity);
    const frames = samples.map((corners, i) => ({ borderRadius: corners.map(n => `${Math.max(0, n)}px`).join(" "), offset: i / (samples.length - 1) }));
    const animation = button.animate(frames, { duration, easing: "linear" });
    shapes.set(button, animation);
    shapeMotions.set(button, { damping, stiffness, from: start, to: end, velocity });
    animation.finished.then(
      () => {
        if (shapes.get(button) === animation) shapes.delete(button);
      },
      () => {},
    );
  }
  function begin(button, point, id) {
    if (disabled(button) || forced.matches || active.has(button)) return null;
    button.removeAttribute("data-button-cancelled");
    cancelled.delete(button);
    const entry = [...ripples].find((r) => r.button === button) || {
      button,
      revision: 0,
    };
    clearTimeout(entry.touchTimer);
    clearTimeout(entry.releaseTimer);
    entry.revision++;
    entry.id = id;
    entry.point = point;
    entry.phase = "waiting-click";
    active.set(button, entry);
    const start = shapes.has(button)
      ? null
      : currentCorners(button);
    button.setAttribute("data-pressed", "");
    shapeTo(button, "--_button-pressed-shape", start);
    widthGroup(button,true);
    return entry;
  }
  function startInk(entry) {
    const { button } = entry;
    if (
      reduced.matches ||
      forced.matches ||
      !button.animate ||
      disabled(button)
    )
      return;
    let fromOpacity = "0";
    if (entry.layer) {
      fromOpacity = getComputedStyle(entry.layer).opacity;
      entry.growth?.cancel();
      entry.fade?.cancel();
    } else {
      entry.layer = document.createElement("span");
      entry.layer.className = "md-button-ripple";
      entry.layer.setAttribute("aria-hidden", "true");
      entry.ink = document.createElement("span");
      entry.layer.append(entry.ink);
      (button.querySelector(".md-slider-state-layer") || button.querySelector(".md-switch-handle") || button.querySelector(".md-nav-indicator") || button).append(entry.layer);
      ripples.add(entry);
    }
    const rect = entry.layer.getBoundingClientRect();
    const control = button.getBoundingClientRect();
    const point = entry.point && {
      x: entry.point.x + control.left - rect.left,
      y: entry.point.y + control.top - rect.top,
    };
    const geometry = rippleGeometry(
      rect.width,
      rect.height,
      point,
      button.currentCSSZoom || 1,
    );
    Object.assign(entry.ink.style, {
      width: `${geometry.size}px`,
      height: `${geometry.size}px`,
      left: "0",
      top: "0",
    });
    button.setAttribute("data-rippling", "");
    entry.started = performance.now();
    entry.growth = entry.ink.animate(
      [{ transform: geometry.start }, { transform: geometry.end }],
      {
        duration: 450,
        easing: "cubic-bezier(0.2, 0, 0, 1)",
        fill: "forwards",
      },
    );
    entry.fade = entry.layer.animate(
      [{ opacity: fromOpacity }, { opacity: 1 }],
      {
        duration: 105,
        easing: "linear",
        fill: "forwards",
      },
    );
    entry.growth.finished.catch(() => {});
    entry.fade.finished.catch(() => {});
  }
  function release(button, abort = false) {
    const entry = active.get(button);
    if (!entry) return;
    active.delete(button);
    clearTimeout(entry.touchTimer);
    restoreShape(button);
    if (abort) {
      button.setAttribute("data-button-cancelled", "");
      cancelled.set(button, entry.id);
    }
    if (!entry.layer) return;
    if (
      reduced.matches ||
      forced.matches ||
      !button.isConnected ||
      disabled(button)
    ) {
      finishRipple(entry);
      return;
    }
    const revision = ++entry.revision;
    const fadeOut = () => {
      if (
        entry.revision !== revision ||
        active.has(button) ||
        !ripples.has(entry)
      )
        return;
      const opacity = getComputedStyle(entry.layer).opacity;
      entry.fade?.cancel();
      const fade = (entry.fade = entry.layer.animate(
        [{ opacity }, { opacity: 0 }],
        {
          duration: 375,
          easing: "linear",
          fill: "forwards",
        },
      ));
      fade.finished.then(
        () => {
          if (entry.revision === revision && entry.fade === fade)
            finishRipple(entry);
        },
        () => {},
      );
    };
    const time = entry.growth.currentTime;
    const elapsed =
      typeof time === "number"
        ? time
        : time?.to
          ? time.to("ms").value
          : performance.now() - entry.started;
    const remaining = Math.max(0, 225 - elapsed);
    if (remaining) entry.releaseTimer = setTimeout(fadeOut, remaining);
    else fadeOut();
  }
  function finishRipple(entry) {
    clearTimeout(entry.releaseTimer);
    clearTimeout(entry.touchTimer);
    entry.revision++;
    entry.growth?.cancel();
    entry.fade?.cancel();
    entry.layer?.remove();
    ripples.delete(entry);
    entry.layer = null;
    entry.button.removeAttribute("data-rippling");
  }
  function clearCancelled(id) {
    for (const [button, pointer] of cancelled)
      if (id === undefined || id === pointer) {
        button.removeAttribute("data-button-cancelled");
        cancelled.delete(button);
      }
  }
  function cancelAll() {
    for (const button of active.keys()) release(button, true);
    for (const entry of ripples) finishRipple(entry);
    for (const animation of shapes.values()) animation.cancel();
    shapes.clear();
    for(const state of widthGroups.values())for(const animation of state.animations)animation.finish();
    for(const state of fabMenus.values())for(const animation of state.animations)animation.finish();
    clearCancelled();
  }
  document.addEventListener(
    "pointerdown",
    (event) => {
      const button = buttonFor(event.target);
      if (!button || event.button !== 0 || event.isPrimary === false) return;
      const touch = event.pointerType === "touch";
      if (touch) button.setAttribute("data-touch", "");
      else button.removeAttribute("data-touch");
      const rect = button.getBoundingClientRect();
      const entry = begin(
        button,
        { x: event.clientX - rect.left, y: event.clientY - rect.top },
        event.pointerId,
      );
      if (!entry) return;
      if (!touch) {
        startInk(entry);
        return;
      }
      entry.phase = "touch-delay";
      const revision = entry.revision;
      entry.touchTimer = setTimeout(() => {
        if (
          active.get(button) !== entry ||
          entry.revision !== revision ||
          entry.phase !== "touch-delay"
        )
          return;
        entry.phase = "holding";
        startInk(entry);
      }, 150);
    },
    true,
  );
  document.addEventListener(
    "pointerup",
    (event) => {
      if (event.isPrimary === false) return;
      for (const [button, entry] of active) {
        if (entry.id !== event.pointerId) continue;
        if (entry.phase === "touch-delay") {
          clearTimeout(entry.touchTimer);
          startInk(entry);
        }
        entry.phase = "waiting-click";
        restoreShape(button);
      }
      clearCancelled(event.pointerId);
    },
    true,
  );
  document.addEventListener(
    "pointercancel",
    (event) => {
      for (const [button, entry] of active)
        if (entry.id === event.pointerId) release(button, true);
      clearCancelled(event.pointerId);
    },
    true,
  );
  document.addEventListener(
    "pointerover",
    (event) => {
      if (event.pointerType !== "touch")
        buttonFor(event.target)?.removeAttribute("data-touch");
    },
    true,
  );
  document.addEventListener(
    "pointerout",
    (event) => {
      if (event.pointerType === "touch") return;
      const button = buttonFor(event.target);
      if (
        button &&
        active.has(button) &&
        !(
          event.relatedTarget instanceof Node &&
          button.contains(event.relatedTarget)
        )
      )
        release(button, true);
    },
    true,
  );
  document.addEventListener(
    "contextmenu",
    (event) => {
      const button = buttonFor(event.target);
      if (button) release(button, true);
    },
    true,
  );
  document.addEventListener(
    "keydown",
    (event) => {
      const button = buttonFor(event.target);
      if(event.key==='Enter'&&button?.matches('.md-radio,.md-checkbox,.md-switch'))return;
      if (
        !button ||
        event.repeat ||
        !(
          (button.matches(".md-slider-input") && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key)) || event.key === "Enter" ||
          (event.key === " " &&
            (button.tagName === "BUTTON" || button.matches(".md-filter-chip,.md-assist-chip,.md-suggestion-chip,.md-input-chip,.md-radio,.md-checkbox,.md-switch,.md-segmented-button,.md-slider-input")))
        )
      )
        return;
      const entry = begin(button, null, "keyboard");
      if (entry && button.matches(".md-slider-input")) startInk(entry);
    },
    true,
  );
  document.addEventListener(
    "keyup",
    (event) => {
      const button = buttonFor(event.target);
      if (["Enter", " "].includes(event.key) || button?.matches(".md-slider-input") && ["ArrowLeft","ArrowRight","ArrowUp","ArrowDown","PageUp","PageDown","Home","End"].includes(event.key)) {
        if (button && active.get(button)?.id === "keyboard") release(button);
        clearCancelled("keyboard");
      }
    },
    true,
  );
  document.addEventListener(
    "focusout",
    (event) => {
      const button = buttonFor(event.target);
      if (
        button &&
        !(
          event.relatedTarget instanceof Node &&
          button.contains(event.relatedTarget)
        )
      )
        release(button, true);
    },
    true,
  );
  document.addEventListener(
    "click",
    (event) => {
      // Focus handlers can change the control's class before its click arrives.
      const button = buttonFor(event.target) ||
        [...active.keys()].find(control => control.contains(event.target));
      if (!button) return;
      if(event.detail&&button.closest('[data-list-suppress-click]')?.hasAttribute('data-list-suppress-click')){release(button,true);event.preventDefault();return;}
      if (disabled(button)) {
        event.preventDefault();
        event.stopImmediatePropagation();
        return;
      }
      // A label's native input owns activation, including forwarded and keyboard clicks.
      if (button.tagName === "LABEL" && event.target.tagName !== "INPUT")
        return;
      let entry = active.get(button);
      if (!entry) entry = begin(button, null, "keyboard");
      if (entry && (!entry.layer || entry.id === "keyboard")) startInk(entry);
      if (entry) release(button);
      if (button.hasAttribute("data-button-toggle")) {
        button.setAttribute(
          "aria-pressed",
          String(button.getAttribute("aria-pressed") !== "true"),
        );
      }
    },
    true,
  );
  document.addEventListener("material:cancel-feedback",event=>{const button=buttonFor(event.target);if(button)release(button,true);});
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) cancelAll();
  });
  window.addEventListener("blur", cancelAll);
  reduced.addEventListener("change", cancelAll);
  forced.addEventListener("change", cancelAll);
  new MutationObserver((mutations = []) => {
    // Application click handlers can change selection after capture-phase release.
    // Retarget from the current animated corners before the next paint.
    for (const mutation of mutations) {
      if (!["aria-pressed","aria-expanded"].includes(mutation.attributeName)) continue;
      const button = buttonFor(mutation.target);
      if (button && button === mutation.target && button.isConnected &&
          !disabled(button) && !active.has(button) &&
          mutation.oldValue !== button.getAttribute(mutation.attributeName))
        shapeTo(button, "--_button-rest-shape");
    }
    for (const button of cancelled.keys())
      if (!button.isConnected) cancelled.delete(button);
    for (const [button] of active)
      if (!button.isConnected || disabled(button)) release(button, true);
    for (const entry of ripples)
      if (!entry.button.isConnected || disabled(entry.button))
        finishRipple(entry);
    for(const [panel,state]of fabMenus)if(!panel.isConnected){for(const animation of state.animations)animation.cancel();fabMenus.delete(panel);}
    for(const [group,state]of widthGroups)if(!group.isConnected){for(const animation of state.animations)animation.cancel();widthGroups.delete(group);}
    for (const [button, animation] of shapes)
      if (!button.isConnected || disabled(button)) {
        animation.cancel();
        shapes.delete(button);
      }
  }).observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeOldValue: true,
    attributeFilter: ["disabled", "aria-disabled", "aria-pressed", "aria-expanded"],
  });
  if(document.fonts)document.fonts.ready.then(initializeWidthGroups);else initializeWidthGroups();
  document.documentElement.setAttribute("data-feedback-ready", "");
})();
