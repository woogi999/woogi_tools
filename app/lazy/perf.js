// Render settings shared by the 3D scenes, on every device (phones, laptops, desktops).
//
//   rendererOptions(max)     antialiasing only on low-density screens (high-density ones already
//                            look smooth), and the pixel ratio capped at `max`
//   createGovernor(renderer) lowers the resolution while frames run slow and raises it again once
//                            they're quick, so a weak laptop GPU or a huge monitor stays smooth
//
// Both scenes also skip frames while their canvas is off screen or the tab is hidden, and cull
// what the camera can't see (lazy/culling.js).

export function rendererOptions(max = 1.5) {
  const dpr = window.devicePixelRatio || 1;
  return { antialias: dpr < 2, pixelRatio: Math.min(dpr, max) };
}

const SLOW_MS = 24; // below ~42fps
const FAST_MS = 13; // comfortably above 60fps
const STEP = 0.15;
const SETTLE_MS = 1500;

export function createGovernor(renderer, { max, min = 0.75 } = {}) {
  let ratio = max;
  let average = 16;
  let changedAt = performance.now();
  renderer.setPixelRatio(ratio);
  return {
    get ratio() {
      return ratio;
    },
    // Once per rendered frame, with the time since the last one.
    frame(dtMs, now = performance.now()) {
      // A long gap (a hidden tab, a scroll away) says nothing about speed.
      if (dtMs > 250) return;
      average += (dtMs - average) * 0.05;
      if (now - changedAt < SETTLE_MS) return;
      let next = ratio;
      if (average > SLOW_MS && ratio > min) next = Math.max(min, ratio - STEP);
      else if (average < FAST_MS && ratio < max)
        next = Math.min(max, ratio + STEP);
      if (next === ratio) return;
      ratio = next;
      changedAt = now;
      // setPixelRatio resizes the drawing buffer to match the canvas's current size.
      renderer.setPixelRatio(ratio);
    },
  };
}

export const tabHidden = () =>
  typeof document !== 'undefined' && document.hidden;
