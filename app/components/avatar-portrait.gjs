import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { drawPortrait } from '../utils/avatar';

// Redraws whenever the avatar changes; sized in CSS pixels, sharp on high-DPI
// screens. The flat drawing shows straight away, then the 3D render (cached
// per look) replaces it once three.js has loaded.
const paint = modifier((canvas, [avatar, size]) => {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  drawPortrait(canvas.getContext('2d'), avatar, size * ratio);
  let current = true;
  import('../lazy/avatar-model')
    .then(({ paintPortrait }) => current && paintPortrait(canvas, avatar))
    .catch(() => {
      // no WebGL: keep the flat drawing
    });
  return () => (current = false);
});

const sizeStyle = (size) => htmlSafe(`width: ${Number(size)}px; height: ${Number(size)}px`);

<template>
  <canvas class="avatar-portrait" style={{sizeStyle @size}} aria-hidden="true" {{paint @avatar @size}}></canvas>
</template>
