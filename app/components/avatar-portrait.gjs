import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { drawPortrait } from '../utils/avatar';

// Redraws whenever the avatar changes; sized in CSS pixels, sharp on high-DPI screens.
const paint = modifier((canvas, [avatar, size]) => {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(size * ratio);
  canvas.height = Math.round(size * ratio);
  drawPortrait(canvas.getContext('2d'), avatar, size * ratio);
});

const sizeStyle = (size) => htmlSafe(`width: ${Number(size)}px; height: ${Number(size)}px`);

<template>
  <canvas class="avatar-portrait" style={{sizeStyle @size}} aria-hidden="true" {{paint @avatar @size}}></canvas>
</template>
