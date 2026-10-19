<script module>
  import { modifier } from '../core/modifier.js';
  import { avatarKey, drawPortrait } from '../utils/avatar.js';
  import { poseKey } from '../utils/pose.js';

  let model = null;
  const loadModel = () => (model ??= import('../lazy/avatar-model.js'));

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
    `width: ${Number(size)}px; height: ${Number(size)}px`;
</script>

<script>
  let args = $props();
</script>

<canvas
  class="avatar-portrait"
  style={sizeStyle(args.size)}
  width="0"
  height="0"
  aria-hidden="true"
  {@attach paint([args.avatar, args.size, args.pose])}
></canvas>
