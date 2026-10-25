/* Material spring sampling and popup exit retention. Shared by the compiler and browser. */
(() => {
  function springState(damping, stiffness, time, from = 0, to = 1, velocity = 0) {
    if (!(damping > 0) || !(stiffness > 0)) throw new Error('Invalid Material spring');
    const omega = Math.sqrt(stiffness), x = from - to;
    if (damping < 1) {
      const decay = damping * omega, frequency = omega * Math.sqrt(1 - damping * damping);
      const a = x, b = (velocity + decay * x) / frequency;
      const cosine = Math.cos(frequency * time), sine = Math.sin(frequency * time), envelope = Math.exp(-decay * time);
      const displacement = a * cosine + b * sine;
      return { value: to + envelope * displacement, velocity: envelope * ((b * frequency - decay * a) * cosine - (a * frequency + decay * b) * sine) };
    }
    if (damping === 1) {
      const b = velocity + omega * x, envelope = Math.exp(-omega * time);
      return { value: to + envelope * (x + b * time), velocity: envelope * (b - omega * (x + b * time)) };
    }
    const root = Math.sqrt(damping * damping - 1), a = -omega * (damping - root), b = -omega * (damping + root);
    const c = (velocity - b * x) / (a - b), d = x - c;
    return { value: to + c * Math.exp(a * time) + d * Math.exp(b * time), velocity: a * c * Math.exp(a * time) + b * d * Math.exp(b * time) };
  }
  function springFrames(damping, stiffness, velocity = 0) {
    const samples = [0];
    for (let i = 1; i <= 600; i++) {
      samples.push(springState(damping, stiffness, i / 60, 0, 1, velocity).value);
      if (i > 2 && Math.abs(1 - samples[i]) < .001 && Math.abs(samples[i] - samples[i - 1]) < .001) break;
    }
    samples[samples.length - 1] = 1;
    return { samples, duration: (samples.length - 1) * 1000 / 60 };
  }
  function springTrack(damping, stiffness, from, to, velocity = from.map(() => 0)) {
    const samples = [from.slice()], epsilon = from.map((n, i) => Math.max(1, Math.abs(to[i] - n)) * .001);
    for (let i = 1; i <= 600; i++) {
      const next = from.map((n, j) => springState(damping, stiffness, i / 60, n, to[j], velocity[j]).value);
      samples.push(next);
      if (i > 2 && next.every((n, j) => Math.abs(to[j] - n) < epsilon[j] && Math.abs(n - samples[i - 1][j]) < epsilon[j])) break;
    }
    samples[samples.length - 1] = to.slice();
    return { samples, duration: (samples.length - 1) * 1000 / 60 };
  }
  function cssTiming(damping, stiffness) {
    const { samples, duration } = springFrames(damping, stiffness);
    return { duration: `${duration.toFixed(3)}ms`, easing: `linear(${samples.map(n => Number(n.toFixed(6))).join(', ')})` };
  }
  function timing(element, role = 'fast-spatial') {
    const style = getComputedStyle(element);
    const duration = parseFloat(style.getPropertyValue(`--_motion-${role}-duration`));
    const easing = style.getPropertyValue(`--_motion-${role}-easing`).trim();
    if (!Number.isFinite(duration) || !easing) throw new Error(`Missing generated ${role} motion`);
    return { duration, easing };
  }
  // An exit copy needs its used geometry and paint, not hundreds of unrelated
  // computed CSS properties (each read can resolve layout in some browsers).
  const exitProperties=('position top right bottom left display box-sizing width height min-width max-width min-height max-height margin padding border border-radius background color box-shadow opacity overflow transform transform-origin translate rotate scale flex flex-direction flex-wrap align-items align-self align-content justify-content gap grid-template-columns grid-template-rows grid-auto-flow grid-column grid-row order font letter-spacing text-align white-space text-overflow word-break overflow-wrap visibility vertical-align fill fill-rule stroke stroke-width stroke-linecap stroke-linejoin clip-path appearance contain isolation z-index pointer-events direction writing-mode --_button-container --_button-background-state-color --_button-background-state-opacity --_button-state-color --_button-state-opacity --_button-ripple-color --_elevation-level --_shadow-color --_menu-container --_field-menu-label-color').split(' ');
  const exits = new Map();
  function clearExit(element) { exits.get(element)?.(); }
  function retainExit(element, mirror = false) {
    if (exits.has(element) || CSS.supports('overlay', 'auto') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const copy = element.cloneNode(true), originals = [element, ...(mirror ? element.querySelectorAll('*') : [])], copies = [copy, ...(mirror ? copy.querySelectorAll('*') : [])];
    const animations = []; let timer, cleaned = false;
    const cleanup = () => { if (cleaned) return; cleaned = true; clearTimeout(timer); for (const a of animations) a.cancel(); copy.remove(); if (exits.get(element) === cleanup) exits.delete(element); };
    exits.set(element, cleanup);
    try {
      copy.removeAttribute('id'); for (const child of copy.querySelectorAll('[id]')) child.removeAttribute('id');
      copy.removeAttribute('popover'); copy.setAttribute('data-menu-exit-copy', ''); copy.setAttribute('aria-hidden', 'true'); copy.inert = true;
      originals.forEach((node, i) => {
        const style = getComputedStyle(node);
        // Do not enumerate computed styles: the publication contributes thousands
        // of inherited tokens to every descendant's CSSStyleDeclaration.
        const declarations=exitProperties.map(property=>`${property}:${style.getPropertyValue(property)};`);
        copies[i].style.cssText=declarations.join('')+'transition:none!important;';
      });
      copy.style.setProperty('pointer-events', 'none', 'important'); copy.style.setProperty('z-index', '2147483647');
      (element.closest('dialog[open]') || document.body).append(copy);
      copy.scrollTop = element.scrollTop; copy.scrollLeft = element.scrollLeft;
      if (mirror) {
        originals.forEach((node, i) => { for (const original of node.getAnimations()) {
          if (original.effect?.target !== node) continue;
          const animation = copies[i].animate(original.effect.getKeyframes(), original.effect.getTiming());
          animation.currentTime = original.currentTime ?? 0; animations.push(animation);
        } });
      } else {
        const style = getComputedStyle(element);
        animations.push(copy.animate([{ opacity: style.opacity }, { opacity: 0 }], { ...timing(element, 'fast-effects'), fill: 'forwards' }));
        animations.push(copy.animate([{ scale: style.scale || '1' }, { scale: '.8' }], { ...timing(element), fill: 'forwards' }));
      }
      const duration = Math.max(0, ...animations.map(a => a.effect.getComputedTiming().endTime));
      timer = setTimeout(cleanup, duration + 50);
      Promise.all(animations.map(a => a.finished)).then(cleanup, cleanup);
    } catch { cleanup(); }
  }
  const api = { springState, springFrames, springTrack, cssTiming, timing, retainExit, clearExit };
  if (typeof module !== 'undefined') module.exports = api;
  globalThis.MaterialMotion = api;
  if (typeof document !== 'undefined' && typeof matchMedia !== 'undefined') matchMedia('(prefers-reduced-motion: reduce)').addEventListener?.('change', event => { if (event.matches) for (const cleanup of [...exits.values()]) cleanup(); });
})();
