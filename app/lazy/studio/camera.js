// Viewport navigation, modelled on Roblox Studio:
//
//   right mouse held       look around (the camera turns in place)
//   W A S D, Q E           fly (any time the viewport has focus); Shift is faster
//   mouse wheel            zoom towards whatever is under the cursor
//   middle mouse           orbit around the point in front of you
//   Shift + middle         pan;  Ctrl + middle: dolly
//   Alt + left             orbit (for trackpads)
//   F                      frame the selection
//
// Movement eases in and out (velocity chases the keys rather than jumping)
// and zoom and focus glide, so it feels smooth without feeling floaty.

import { Vector3, Euler, MathUtils } from 'three';

const UP = new Vector3(0, 1, 0);

export class FlyCamera {
  constructor(camera, dom, { onChange, pickDistance, isTyping } = {}) {
    this.camera = camera;
    this.dom = dom;
    this.onChange = onChange ?? (() => {});
    this.pickDistance = pickDistance ?? (() => null);
    this.isTyping = isTyping ?? (() => false);
    this.yaw = 0;
    this.pitch = 0;
    this.focus = 6; // distance to the orbit point
    this.keys = new Set();
    this.velocity = new Vector3();
    this.drag = null;
    this.glide = null;
    this.speed = 1;
    this.enabled = true;
    this.hover = false;
    this.lookSensitivity = 0.0035;
    this.syncFromCamera();
    this.bind();
  }

  syncFromCamera() {
    const e = new Euler().setFromQuaternion(this.camera.quaternion, 'YXZ');
    this.yaw = e.y;
    this.pitch = e.x;
  }

  applyRotation() {
    this.pitch = MathUtils.clamp(
      this.pitch,
      -Math.PI / 2 + 0.001,
      Math.PI / 2 - 0.001,
    );
    this.camera.quaternion.setFromEuler(
      new Euler(this.pitch, this.yaw, 0, 'YXZ'),
    );
  }

  get forward() {
    return new Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
  }

  get pivot() {
    return this.camera.position
      .clone()
      .add(this.forward.multiplyScalar(this.focus));
  }

  // Puts the camera at `position` looking at `target`.
  lookAt(position, target) {
    this.camera.position.copy(position);
    const dir = target.clone().sub(position);
    this.focus = Math.max(0.05, dir.length());
    dir.normalize();
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(MathUtils.clamp(dir.y, -1, 1));
    this.applyRotation();
    this.onChange();
  }

  // Glides to frame a sphere (centre, radius), keeping the current direction.
  frame(center, radius) {
    const fov = MathUtils.degToRad(this.camera.fov);
    const distance = Math.max(0.2, (radius * 1.25) / Math.sin(fov / 2));
    const to = center.clone().sub(this.forward.multiplyScalar(distance));
    this.glide = {
      from: this.camera.position.clone(),
      to,
      t: 0,
      focus: distance,
      focusFrom: this.focus,
    };
    this.onChange();
  }

  setView(dir, center = this.pivot) {
    const d = dir.clone().normalize();
    const pos = center.clone().add(d.multiplyScalar(this.focus));
    this.lookAt(pos, center);
  }

  bind() {
    const dom = this.dom;
    this.handlers = {
      down: (e) => this.pointerDown(e),
      move: (e) => this.pointerMove(e),
      up: (e) => this.pointerUp(e),
      wheel: (e) => this.wheel(e),
      key: (e) => {
        this._shift = e.shiftKey;
        this.keyDown(e);
      },
      keyUp: (e) => {
        this._shift = e.shiftKey;
        this.keys.delete(e.code);
      },
      blur: () => this.keys.clear(),
      context: (e) => e.preventDefault(),
      enter: () => (this.hover = true),
      leave: () => (this.hover = false),
    };
    dom.addEventListener('pointerdown', this.handlers.down);
    dom.addEventListener('wheel', this.handlers.wheel, { passive: false });
    dom.addEventListener('contextmenu', this.handlers.context);
    dom.addEventListener('pointerenter', this.handlers.enter);
    dom.addEventListener('pointerleave', this.handlers.leave);
    window.addEventListener('pointermove', this.handlers.move);
    window.addEventListener('pointerup', this.handlers.up);
    window.addEventListener('keydown', this.handlers.key);
    window.addEventListener('keyup', this.handlers.keyUp);
    window.addEventListener('blur', this.handlers.blur);
  }

  dispose() {
    const dom = this.dom;
    dom.removeEventListener('pointerdown', this.handlers.down);
    dom.removeEventListener('wheel', this.handlers.wheel);
    dom.removeEventListener('contextmenu', this.handlers.context);
    dom.removeEventListener('pointerenter', this.handlers.enter);
    dom.removeEventListener('pointerleave', this.handlers.leave);
    window.removeEventListener('pointermove', this.handlers.move);
    window.removeEventListener('pointerup', this.handlers.up);
    window.removeEventListener('keydown', this.handlers.key);
    window.removeEventListener('keyup', this.handlers.keyUp);
    window.removeEventListener('blur', this.handlers.blur);
  }

  // Returns true when the camera took the press (so tools ignore it).
  pointerDown(e) {
    if (!this.enabled) return false;
    let mode = null;
    if (e.button === 2) mode = 'look';
    else if (e.button === 1)
      mode = e.shiftKey ? 'pan' : e.ctrlKey ? 'dolly' : 'orbit';
    else if (e.button === 0 && e.altKey) mode = e.shiftKey ? 'pan' : 'orbit';
    if (!mode) return false;
    e.preventDefault();
    this.dom.focus?.({ preventScroll: true });
    this.glide = null;
    this.drag = {
      mode,
      x: e.clientX,
      y: e.clientY,
      pivot: this.pivot,
      moved: 0,
    };
    capture(this.dom, e.pointerId);
    this.dom.style.cursor = mode === 'look' ? 'none' : 'grabbing';
    return true;
  }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    if (d.mode === 'look') {
      this.yaw -= dx * this.lookSensitivity;
      this.pitch -= dy * this.lookSensitivity;
      this.applyRotation();
    } else if (d.mode === 'orbit') {
      this.yaw -= dx * this.lookSensitivity * 1.4;
      this.pitch -= dy * this.lookSensitivity * 1.4;
      this.applyRotation();
      this.camera.position
        .copy(d.pivot)
        .sub(this.forward.multiplyScalar(this.focus));
    } else if (d.mode === 'pan') {
      const h = this.dom.clientHeight || 1;
      const worldPerPx =
        (2 * this.focus * Math.tan(MathUtils.degToRad(this.camera.fov) / 2)) /
        h;
      const right = new Vector3(1, 0, 0).applyQuaternion(
        this.camera.quaternion,
      );
      const up = new Vector3(0, 1, 0).applyQuaternion(this.camera.quaternion);
      this.camera.position
        .addScaledVector(right, -dx * worldPerPx)
        .addScaledVector(up, dy * worldPerPx);
      d.pivot = this.pivot;
    } else if (d.mode === 'dolly') {
      const step = dy * this.focus * 0.01;
      this.camera.position.addScaledVector(this.forward, -step);
      this.focus = Math.max(0.05, this.focus + step);
    }
    this.onChange();
  }

  pointerUp() {
    if (!this.drag) return;
    this.drag = null;
    this.dom.style.cursor = '';
  }

  // Zooms towards the point under the cursor (or along the view if there's nothing there).
  wheel(e) {
    if (!this.enabled) return;
    e.preventDefault();
    const rect = this.dom.getBoundingClientRect();
    const ndc = [
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    ];
    const hit = this.pickDistance(ndc);
    const dir = new Vector3(ndc[0], ndc[1], 0.5)
      .unproject(this.camera)
      .sub(this.camera.position)
      .normalize();
    const dist = hit ?? this.focus;
    const amount =
      (Math.sign(e.deltaY) * Math.min(Math.abs(e.deltaY), 120)) / 120;
    const step = dist * 0.18 * -amount;
    this.camera.position.addScaledVector(dir, step);
    this.focus = Math.max(0.05, hit ? hit - step : this.focus - step);
    this.glide = null;
    this.onChange();
  }

  keyDown(e) {
    if (!this.enabled || this.isTyping() || e.ctrlKey || e.metaKey || e.altKey)
      return;
    if (!this.hover && !this.drag && document.activeElement !== this.dom)
      return;
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyQ', 'KeyE'].includes(e.code)) {
      this.keys.add(e.code);
      this.glide = null;
      e.preventDefault();
      this.onChange();
    }
  }

  get moving() {
    return (
      this.keys.size > 0 || this.velocity.lengthSq() > 1e-8 || !!this.glide
    );
  }

  // Called every frame with the elapsed seconds; returns whether anything moved.
  update(dt) {
    if (!this.enabled) return false;
    let changed = false;
    if (this.glide) {
      const g = this.glide;
      g.t = Math.min(1, g.t + dt * 3.2);
      const k = 1 - (1 - g.t) ** 3;
      this.camera.position.lerpVectors(g.from, g.to, k);
      this.focus = g.focusFrom + (g.focus - g.focusFrom) * k;
      if (g.t >= 1) this.glide = null;
      changed = true;
    }
    const want = new Vector3();
    if (this.keys.size) {
      const fwd = this.forward;
      const right = new Vector3().crossVectors(fwd, UP).normalize();
      if (this.keys.has('KeyW')) want.add(fwd);
      if (this.keys.has('KeyS')) want.sub(fwd);
      if (this.keys.has('KeyD')) want.add(right);
      if (this.keys.has('KeyA')) want.sub(right);
      if (this.keys.has('KeyE')) want.add(UP);
      if (this.keys.has('KeyQ')) want.sub(UP);
      if (want.lengthSq()) want.normalize();
      // Speed follows how far away things are, so moving round a tiny part
      // and across a big scene both feel right.
      const base = MathUtils.clamp(this.focus, 0.5, 200) * 1.4 * this.speed;
      want.multiplyScalar(base * (this.shift ? 3.5 : 1));
    }
    // Ease the velocity towards what the keys ask for.
    const k = 1 - Math.exp(-dt * (want.lengthSq() ? 10 : 14));
    this.velocity.lerp(want, k);
    if (this.velocity.lengthSq() > 1e-8) {
      this.camera.position.addScaledVector(this.velocity, dt);
      changed = true;
    } else this.velocity.set(0, 0, 0);
    if (changed) this.onChange();
    return changed;
  }

  get shift() {
    return this._shift ?? false;
  }
}

// Pointer capture keeps a drag going outside the element; a pointer the
// browser doesn't know (a synthetic event) can't be captured, which is fine.
function capture(el, id) {
  try {
    el.setPointerCapture?.(id);
    return true;
  } catch {
    return false; // not a live pointer
  }
}
