import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import { avatarKey, drawPortrait } from '../utils/avatar';
import { poseKey } from '../utils/pose';

let model = null;
const loadModel = () => (model ??= import('../lazy/avatar-model'));

// The 3D portrait (rendered once per look and cached), sharp on high-DPI
// screens. It only repaints when the look itself changes: lobbies rebuild
// their seat lists on every little change, and clearing the canvas each time
// made portraits blink. Until three.js has loaded the canvas keeps whatever it
// showed before; the flat drawing is only a fallback for browsers without WebGL.
const paint = modifier((canvas, [avatar, size, pose]) => {
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  const pixels = Math.round(size * ratio);
  const key = `${avatarKey(avatar)}#${pose ? poseKey(pose) : ''}@${pixels}`;
  if (canvas.dataset.painted === key) return;
  canvas.dataset.wanted = key;
  const draw = ({ paintPortrait }) => {
    // A newer look arrived while this one was loading.
    if (canvas.dataset.wanted !== key) return;
    if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
    paintPortrait(canvas, avatar, pose ?? null);
    canvas.dataset.painted = key;
  };
  loadModel()
    .then(draw)
    .catch(() => {
      if (canvas.dataset.wanted !== key) return;
      if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
      drawPortrait(canvas.getContext('2d'), avatar, pixels);
      canvas.dataset.painted = key;
    });
});

const sizeStyle = (size) =>
  htmlSafe(`width: ${Number(size)}px; height: ${Number(size)}px`);

<template>
  <canvas
    class="avatar-portrait"
    style={{sizeStyle @size}}
    width="0"
    height="0"
    aria-hidden="true"
    {{paint @avatar @size @pose}}
  ></canvas>
</template>
