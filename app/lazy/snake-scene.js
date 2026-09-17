import {
  Group,
  Mesh,
  InstancedMesh,
  Object3D,
  SphereGeometry,
  BoxGeometry,
  CylinderGeometry,
  CircleGeometry,
  ShaderMaterial,
  MeshToonMaterial,
  MeshBasicMaterial,
  Color,
  Vector3,
  BackSide,
} from 'three';
import { buildAvatar, disposeAvatar, reachArms } from './avatar-model';
import { sfx } from '../utils/sound';
import { speedOf } from '../utils/snake';
import {
  createStage,
  createSea,
  buildIsland,
  makeObstacle,
  Particles,
  Tweens,
  nameTag,
  startEmote,
  playEmote,
  blobShadow,
  cellToWorld,
  easeOutBack,
  Shockwaves,
  dizzyStars,
  INK,
} from './island-world';

// Snake on a tropical island: every snake's body is an instanced string of
// toon spheres that glide from square to square, with the player's avatar
// riding on its head and reacting to apples, boosts and crashes.

import { SNAKE_COLORS } from '../utils/snake';

const SEGMENT_R = 0.4;
const BODY_Y = 0.36;
const RIDER_SCALE = 0.72;
// How far (in squares) the drawn snake trails the real one, to smooth out uneven ticks.
const GLIDE_BUFFER = 1;
const DIR_YAW = {
  up: Math.PI,
  down: 0,
  left: -Math.PI / 2,
  right: Math.PI / 2,
};

// The inverted-hull ink outline, for instanced meshes.
function instancedOutline(thickness) {
  return new ShaderMaterial({
    uniforms: {
      thickness: { value: thickness },
      color: { value: new Color(INK) },
    },
    vertexShader: `
      uniform float thickness;
      void main() {
        vec4 local = vec4(position, 1.0);
        vec3 n = normal;
        #ifdef USE_INSTANCING
          local = instanceMatrix * local;
          n = mat3(instanceMatrix) * n;
        #endif
        vec4 p = modelViewMatrix * local;
        p.xyz += normalize(normalMatrix * n) * thickness;
        gl_Position = projectionMatrix * p;
      }`,
    fragmentShader:
      'uniform vec3 color; void main() { gl_FragColor = vec4(color, 1.0); }',
    side: BackSide,
  });
}

const lighten = (hex, amount) =>
  `#${new Color(hex).lerp(new Color('#ffffff'), amount).getHexString()}`;
const angleLerp = (a, b, t) => {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
};

export function createSnakeScene(canvas) {
  const stage = createStage(canvas);
  const { scene, camera, kit, calm } = stage;
  const tweens = new Tweens();
  const particles = new Particles(700);
  scene.add(particles.points);
  const shockwaves = new Shockwaves(scene, tweens);
  const BASE_FOV = camera.fov;
  let fovKick = 0;

  const outlineMaterial = instancedOutline(0.03);
  const sphere = new SphereGeometry(1, 16, 12);
  const dummy = new Object3D();
  const tmp = new Vector3();
  const WHITE = new Color('#ffffff');

  let world = null; // { key, group, sea, size }
  const snakes = new Map(); // id -> visual
  const apples = new Map(); // "x,y" -> group
  let myId = null;
  // Whose snake the camera rides. Normally yours; a spectator (or someone
  // knocked out) follows whoever they chose instead.
  let watchId = null;
  let avatars = new Map();
  let stepMs = 60;
  let lastTick = -1;
  let shake = 0;
  const camTarget = new Vector3();
  const camPos = new Vector3(0, 30, 20);
  let overShown = false;

  // ─── The island ────────────────────────────────────────────────────

  function buildWorld(state) {
    const key = `${state.size}|${state.map}|${state.wrap}|${(state.land ?? []).join('')}|${(state.water ?? []).join('')}|${JSON.stringify(state.obstacles)}`;
    if (world?.key === key) return;
    if (world) {
      world.group.removeFromParent();
      world.sea.mesh.removeFromParent();
      world.sea.dispose();
    }
    const size = state.size;
    // Water squares are dug out of the terrain as ponds with the sea in them:
    // a drawn level says where they are itself, a built-in map lists them
    // among its obstacles.
    const water = state.water
      ? [...state.water]
      : Array(size * size).fill(false);
    for (const [x, y, kind] of state.obstacles)
      if (kind === 'water') water[y * size + x] = true;
    const group = buildIsland(kit, {
      width: size,
      depth: size,
      theme: state.map,
      walls: !state.wrap,
      seed: size * 7 + state.map.length,
      mask: state.mask,
      land: state.land ?? state.mask,
      water,
    });
    // The sea reads its shoreline from the island's own terrain.
    const sea = createSea(group.userData.terrain);
    for (const [x, y, kind] of state.obstacles) {
      const thing = makeObstacle(kit, kind, x * 31 + y);
      if (!thing) continue;
      const [wx, wz] = cellToWorld(size, size, x, y);
      thing.position.x = wx;
      thing.position.z = wz;
      group.add(thing);
    }
    scene.add(sea.mesh, group);
    world = { key, group, sea, size };
    camTarget.set(0, 0, 0);
    const d = distanceFor(size);
    camPos.set(0, d.y, d.z);
  }

  function distanceFor(size) {
    const portrait = Math.max(1, 1 / camera.aspect);
    const reach = (size * 0.86 + 4) * portrait ** 0.9;
    return { y: reach * 1.25, z: reach * 0.8 };
  }

  // ─── Snakes ─────────────────────────────────────────────────────────

  function makeSnake(snake) {
    const color = SNAKE_COLORS[snake.color % SNAKE_COLORS.length];
    const material = new MeshToonMaterial({
      color: '#ffffff',
      gradientMap: kit.gradient,
      transparent: true,
    });
    const group = new Group();
    const capacity = 64;
    const body = new InstancedMesh(sphere, material, capacity);
    const outline = new InstancedMesh(sphere, outlineMaterial, capacity);
    body.frustumCulled = false;
    outline.frustumCulled = false;
    body.setColorAt(0, new Color('#ffffff'));
    body.count = 0;
    outline.count = 0;
    group.add(outline, body);

    const head = new Group();
    const skull = new Mesh(
      kit.geometry('snake-head', () => new SphereGeometry(1, 20, 14)),
      kit.toon(color),
    );
    skull.scale.set(0.5, 0.42, 0.56);
    head.add(withInk(skull));
    const eyeWhite = kit.geometry(
      'snake-eye',
      () => new SphereGeometry(0.13, 10, 8),
    );
    const pupil = kit.geometry(
      'snake-pupil',
      () => new SphereGeometry(0.065, 8, 6),
    );
    for (const side of [-1, 1]) {
      const eye = new Mesh(eyeWhite, kit.toon('#ffffff'));
      eye.position.set(side * 0.22, 0.24, 0.3);
      head.add(withInk(eye));
      const dot = new Mesh(pupil, kit.toon(INK));
      dot.position.set(side * 0.23, 0.26, 0.41);
      head.add(dot);
    }
    const tongue = new Mesh(
      kit.geometry('snake-tongue', () => new BoxGeometry(0.06, 0.02, 0.3)),
      kit.toon('#e5484d'),
    );
    tongue.position.set(0, -0.05, 0.55);
    head.add(tongue);
    const shadow = blobShadow(kit, 0.55);
    group.add(shadow);
    group.add(head);

    // The rider, sat just behind the eyes.
    let rider = null;
    const avatarInput = avatars.get(snake.id);
    if (avatarInput) {
      const avatar = buildAvatar(avatarInput, kit);
      avatar.scale.setScalar(RIDER_SCALE);
      avatar.position.set(0, 0.28, -0.12);
      head.add(avatar);
      rider = { avatar, emote: null, flung: null };
    }
    const tag = nameTag(snake.id === myId ? 'You' : snake.name, color, {
      bot: snake.bot,
    });
    tag.sprite.position.y = 1.9;
    tag.sprite.scale.multiplyScalar(1.1);
    group.add(tag.sprite);
    scene.add(group);

    const positions = snake.body.map(([x, y]) =>
      cellToWorld(world.size, world.size, x, y),
    );
    return {
      id: snake.id,
      name: snake.name,
      color,
      stripe: lighten(color, 0.35),
      group,
      body,
      outline,
      material,
      head,
      tongue,
      shadow,
      rider,
      tag,
      to: positions,
      // Squares the body has passed through, head first, a few longer than the body.
      trail: positions.map((p) => [...p]),
      // How many squares behind the real snake the drawn one is (it glides to catch up).
      lag: 0,
      moveMs: stepMs * 3,
      yaw: DIR_YAW[snake.dir],
      dir: snake.dir,
      alive: true,
      score: snake.score,
      boosts: snake.boosts ?? 0,
      boosting: false,
      deadFade: 1,
      len: snake.body.length,
    };
  }

  function withInk(mesh) {
    const hull = new Mesh(mesh.geometry, kit.outlineThin);
    mesh.add(hull);
    return mesh;
  }

  function removeSnake(visual) {
    visual.group.removeFromParent();
    if (visual.scorch) {
      visual.scorch.removeFromParent();
      visual.scorch.material.dispose();
      visual.scorch.dispose();
    }
    if (visual.rider) {
      visual.rider.avatar.removeFromParent();
      visual.rider.stars?.removeFromParent();
      disposeAvatar(visual.rider.avatar);
    }
    visual.material.dispose();
    visual.tag.sprite.material.map.dispose();
    visual.tag.sprite.material.dispose();
    visual.body.dispose();
    visual.outline.dispose();
  }

  function growCapacity(visual, needed) {
    if (visual.body.instanceMatrix.count >= needed) return;
    const capacity = Math.max(needed, visual.body.instanceMatrix.count * 2);
    const body = new InstancedMesh(sphere, visual.material, capacity);
    const outline = new InstancedMesh(sphere, outlineMaterial, capacity);
    body.setColorAt(0, new Color('#ffffff'));
    body.frustumCulled = false;
    outline.frustumCulled = false;
    visual.group.remove(visual.body, visual.outline);
    visual.body.dispose();
    visual.outline.dispose();
    visual.group.add(outline, body);
    visual.body = body;
    visual.outline = outline;
  }

  // A new state for one snake: where each segment is headed, and where it's coming from.
  function syncSnake(visual, snake, now, state) {
    const size = world.size;
    const next = snake.body.map(([x, y]) => cellToWorld(size, size, x, y));
    const old = visual.to;
    const moved =
      next.length &&
      old.length &&
      (next[0][0] !== old[0][0] || next[0][1] !== old[0][1]);
    if (moved) {
      // The new head square goes on the front of the trail; every segment is now one square further along it.
      const jump =
        Math.abs(old[0][0] - next[0][0]) + Math.abs(old[0][1] - next[0][1]) >
        1.5;
      visual.trail = [[...next[0]], ...visual.trail].slice(0, next.length + 4);
      visual.lag = Math.min(visual.lag + 1, 3);
      if (jump) visual.lag = 0;
      visual.moveMs = stepMs / speedOf(state, snake);
    }
    next.forEach((p, i) => (visual.trail[i] = [...p]));
    visual.to = next;
    // A turn waiting for the next square: the head looks that way straight away.
    visual.queued = snake.alive ? (snake.queue?.[0] ?? null) : null;
    visual.dir = snake.dir;
    const boosting = snake.boost > 0 && snake.alive;
    if (visual.boosting && !boosting && snake.alive) {
      particles.emit(
        tmp.set(next[0][0], 0.5, next[0][1]),
        calm ? 3 : 10,
        ['#ffffff', visual.stripe],
        { speed: 1.4, up: 1.5, life: 0.5, size: 0.3 },
      );
    }
    visual.boosting = boosting;

    // Reactions.
    if (snake.score > visual.score) {
      if (visual.rider) startEmote(visual.rider, 'joy');
      const [hx, hz] = next[0];
      particles.emit(
        tmp.set(hx, 0.6, hz),
        calm ? 6 : 18,
        ['#ff5c5c', '#ffd84d', '#ffffff'],
        { speed: 2.2, up: 3, life: 0.7, size: 0.22 },
      );
    }
    if ((snake.boosts ?? 0) > visual.boosts) {
      if (visual.rider) startEmote(visual.rider, 'shocked');
      // The sacrificed tail pops in a puff of its own colour, and a ring bursts out from the head.
      const tail = old[old.length - 1] ?? next[next.length - 1];
      particles.emit(
        tmp.set(tail[0], 0.4, tail[1]),
        calm ? 6 : 22,
        [visual.color, visual.stripe, '#ffffff'],
        { speed: 3, up: 3, life: 0.7, size: 0.38 },
      );
      const [hx, hz] = next[0];
      shockwaves.add(hx, 0.06, hz, '#ffffff', { size: 3.2, duration: 480 });
      shockwaves.add(hx, 0.05, hz, visual.color, {
        size: 2.2,
        duration: 600,
        delay: 90,
      });
      particles.emit(
        tmp.set(hx, 0.5, hz),
        calm ? 6 : 20,
        ['#fff3b0', '#ffd84d', '#ffffff'],
        { speed: 4, up: 1.2, life: 0.45, size: 0.22, gravity: 1 },
      );
      if (snake.id === myId && !calm) {
        fovKick = 1;
        shake = Math.max(shake, 0.18);
      }
    }
    if (visual.alive && !snake.alive) crash(visual, snake);
    visual.score = snake.score;
    visual.boosts = snake.boosts ?? 0;
    visual.alive = snake.alive;
  }

  // A point `f` squares back along the trail from the head (fractions glide between squares).
  function trailAt(visual, f) {
    const trail = visual.trail;
    const i = Math.min(Math.floor(f), trail.length - 1);
    const a = trail[i];
    const b = trail[Math.min(i + 1, trail.length - 1)];
    const k = f - i;
    // Across a wrap-around edge the two squares are far apart: don't draw it sliding across the board.
    if (Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) > 1.5)
      return k < 0.5 ? a : b;
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
  }
  // A crashed snake is gone in a puff of smoke, leaving a dark snake-shaped scorch on the ground.
  const scorchGeometry = new CircleGeometry(1, 18);
  scorchGeometry.rotateX(-Math.PI / 2);

  function scorch(visual) {
    const spots = [];
    const count = visual.to.length;
    for (let i = 0; i < count; i++) {
      const [x, z] = trailAt(visual, i + visual.lag);
      const r =
        SEGMENT_R * Math.max(0.5, 1 - (i / Math.max(8, count)) * 0.55) * 1.15;
      spots.push([x, z, r]);
      if (i + 1 < count) {
        const [nx, nz] = trailAt(visual, i + 1 + visual.lag);
        if (Math.abs(nx - x) + Math.abs(nz - z) < 1.3)
          spots.push([(x + nx) / 2, (z + nz) / 2, r]);
      }
    }
    const material = new MeshBasicMaterial({
      color: '#2a2118',
      transparent: true,
      opacity: 0,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
    const marks = new InstancedMesh(scorchGeometry, material, spots.length);
    marks.renderOrder = 3;
    marks.frustumCulled = false;
    spots.forEach(([x, z, r], i) => {
      dummy.position.set(x, 0.05, z);
      dummy.rotation.set(0, Math.random() * Math.PI, 0);
      dummy.scale.set(
        r * (0.9 + Math.random() * 0.25),
        1,
        r * (0.9 + Math.random() * 0.25),
      );
      dummy.updateMatrix();
      marks.setMatrixAt(i, dummy.matrix);
      if (!calm && i % 2 === 0)
        particles.emit(
          tmp.set(x, 0.4, z),
          3,
          ['#6e6e6e', '#9e9e9e', '#4a4a4a'],
          { speed: 0.6, up: 1.8, life: 0.9, size: 0.45, gravity: -0.5 },
        );
    });
    scene.add(marks);
    visual.scorch = marks;
    visual.group.visible = false;
    tweens.add(calm ? 1 : 500, (t) => (material.opacity = 0.55 * t));
  }

  function crash(visual, snake) {
    const [hx, hz] = visual.to[0] ?? [0, 0];
    particles.emit(
      tmp.set(hx, 0.5, hz),
      calm ? 10 : 36,
      ['#ffffff', '#cfd8dc', visual.color, '#ffd84d'],
      { speed: 3.5, up: 4, life: 0.9, size: 0.35 },
    );
    shockwaves.add(hx, 0.05, hz, '#ffffff', { size: 2.4, duration: 450 });
    if (snake.id === myId && !calm) shake = 0.5;
    const rider = visual.rider;
    if (!rider) {
      scorch(visual);
      return;
    }
    // Thrown off: the rider leaves the snake for the world, keeping where it was,
    // then flies on in the direction the snake was heading and tumbles to the sand.
    const { avatar } = rider;
    // Place the head where it's drawn right now (the last frame may be a while ago), so the throw starts from the snake.
    const [dx, dz] = trailAt(visual, visual.lag);
    visual.head.position.set(dx, 0.4, dz);
    visual.yaw = headingOf(visual);
    visual.head.rotation.y = visual.yaw;
    visual.group.updateMatrixWorld(true);
    scene.attach(avatar);
    const yaw = visual.yaw;
    const side = Math.random() < 0.5 ? -1 : 1;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const power = calm ? 0.4 : 1;
    rider.fall = {
      vx: (fx * 2.4 + fz * side * 1.1) * power,
      vz: (fz * 2.4 - fx * side * 1.1) * power,
      vy: 5.5 * power,
      yaw,
      pitch: 0,
      roll: 0,
      flip: -8 * power,
      twist: side * 3 * power,
      bounces: 0,
      landed: false,
    };
    avatar.rotation.set(0, yaw, 0, 'YXZ');
    startEmote(rider, 'shocked');
    rider.stars = dizzyStars(kit);
    scene.add(rider.stars);
    scorch(visual);
  }

  const wrapAngle = (a) => Math.atan2(Math.sin(a), Math.cos(a));

  // One frame of a thrown rider: gravity, a bounce or two, then flat on its back, seeing stars.
  function updateFall(visual, now, dt) {
    const rider = visual.rider;
    const { avatar, fall } = rider;
    const limit = world.size / 2 + 2;
    if (!fall.landed) {
      fall.vy -= 18 * dt;
      avatar.position.x = Math.max(
        -limit,
        Math.min(limit, avatar.position.x + fall.vx * dt),
      );
      avatar.position.z = Math.max(
        -limit,
        Math.min(limit, avatar.position.z + fall.vz * dt),
      );
      avatar.position.y += fall.vy * dt;
      fall.pitch += fall.flip * dt;
      fall.roll += fall.twist * dt;
      // Arms and legs flail on the way.
      const flail = Math.sin(now / 55);
      reachArms(avatar, [
        [-0.45, 0.9 + flail * 0.15, 0.1],
        [0.45, 0.9 - flail * 0.15, 0.1],
      ]);
      avatar.userData.legs?.forEach((hip, i) =>
        hip.rotation.set(flail * 0.6 * (i ? 1 : -1), 0, (i ? 1 : -1) * 0.3),
      );
      const ground = fall.bounces ? 0.14 : 0.1;
      if (avatar.position.y <= ground && fall.vy < 0) {
        avatar.position.y = ground;
        fall.bounces++;
        particles.emit(
          tmp.set(avatar.position.x, 0.2, avatar.position.z),
          calm ? 5 : 18,
          ['#e9d5a0', '#ffffff', '#cdb784'],
          { speed: 2, up: 1.6, life: 0.6, size: 0.32 },
        );
        shockwaves.add(avatar.position.x, 0.04, avatar.position.z, '#fff7dd', {
          size: 1.4,
          duration: 380,
        });
        if (fall.bounces === 1 && visual.id === myId) sfx('snake.thud');
        if (fall.bounces >= 2 || calm) {
          fall.landed = true;
          fall.pitch = wrapAngle(fall.pitch);
          fall.roll = wrapAngle(fall.roll);
          startEmote(rider, 'stunned');
        } else {
          fall.vy = -fall.vy * 0.38;
          fall.vx *= 0.45;
          fall.vz *= 0.45;
          fall.flip *= 0.35;
          fall.twist *= 0.3;
        }
      }
    } else {
      // Settle onto its back (feet towards where it was going), limbs splayed.
      const k = Math.min(1, dt * 8);
      fall.pitch += (-Math.PI / 2 - fall.pitch) * k;
      fall.roll += (0 - fall.roll) * k;
      avatar.position.y += (0.14 - avatar.position.y) * k;
      reachArms(avatar, [
        [-0.55, 0.75, 0.05],
        [0.55, 0.75, 0.05],
      ]);
      avatar.userData.legs?.forEach((hip, i) =>
        hip.rotation.set(0, 0, (i ? 1 : -1) * 0.35),
      );
      if (!rider.emote) startEmote(rider, 'stunned');
      avatar.userData.head.getWorldPosition(tmp);
      rider.stars.position.set(tmp.x, tmp.y + 0.28, tmp.z);
      rider.stars.visible = true;
      rider.stars.userData.update(now);
    }
    avatar.rotation.set(fall.pitch, fall.yaw, fall.roll, 'YXZ');
    playEmote(rider, kit, now);
  }
  function drawSnake(visual, now, dt) {
    // Crashed: only the scorch mark and the thrown rider are left.
    if (visual.scorch) {
      if (visual.rider?.fall) updateFall(visual, now, dt);
      return;
    }
    const count = visual.to.length;
    growCapacity(visual, count * 2);
    const fadeTarget = visual.alive ? 1 : 0.35;
    visual.deadFade += (fadeTarget - visual.deadFade) * Math.min(1, dt * 4);
    visual.material.opacity = visual.deadFade;
    visual.material.depthWrite = visual.deadFade > 0.95;
    // Glide at the snake's own speed, exactly: one square per moveMs, so the
    // motion is linear rather than easing in and out between squares. The
    // drawn snake stays about a square behind the real one, which soaks up an
    // uneven timer; only a tiny nudge keeps that gap from drifting over time,
    // and a big gap (the tab was hidden) is simply snapped shut.
    if (visual.alive) {
      if (visual.lag >= GLIDE_BUFFER + 2) visual.lag = GLIDE_BUFFER + 1;
      const pace = Math.max(
        0.95,
        Math.min(1.05, 1 + (visual.lag - GLIDE_BUFFER) * 0.1),
      );
      visual.lag = Math.max(
        0,
        visual.lag - ((dt * 1000) / visual.moveMs) * pace,
      );
    } else visual.lag = Math.max(0, visual.lag - dt * 8);
    const points = visual.to.map((_, i) => trailAt(visual, i + visual.lag));
    const color = new Color();
    let n = 0;
    const wiggle = visual.alive ? 1 : 0;
    const place = (x, z, r, i, stripe) => {
      const y =
        BODY_Y * (r / SEGMENT_R) +
        Math.sin(now / 130 - i * 0.8) * 0.03 * wiggle;
      dummy.position.set(x, y, z);
      dummy.scale.set(r, r * 0.9, r);
      dummy.updateMatrix();
      visual.body.setMatrixAt(n, dummy.matrix);
      visual.outline.setMatrixAt(n, dummy.matrix);
      visual.body.setColorAt(
        n,
        color.set(stripe ? visual.stripe : visual.color),
      );
      // Boosting: a bright pulse runs down the body.
      if (visual.boosting)
        visual.body.setColorAt(
          n,
          color.lerp(
            WHITE,
            0.15 + 0.35 * Math.max(0, Math.sin(now / 45 - i * 0.9)),
          ),
        );
      n++;
    };
    for (let i = count - 1; i >= 1; i--) {
      const [x, z] = points[i];
      const r = SEGMENT_R * Math.max(0.5, 1 - (i / Math.max(8, count)) * 0.55);
      place(x, z, r, i, i % 3 === 0);
      // Boosting: sparks stream off the back half of the body.
      if (visual.boosting && !calm && i > count / 2 && Math.random() < 0.25) {
        particles.emit(
          tmp.set(x, BODY_Y + 0.1, z),
          1,
          ['#ffffff', '#fff3b0', visual.stripe],
          { speed: 0.4, up: 0.6, life: 0.4, size: 0.22, gravity: 0 },
        );
      }
      // Fill the gap to the segment in front, so the body reads as one tube.
      const [px, pz] = points[i - 1];
      if (Math.abs(px - x) + Math.abs(pz - z) < 1.3)
        place((x + px) / 2, (z + pz) / 2, r * 0.97, i - 0.5, false);
    }
    visual.body.count = n;
    visual.outline.count = n;
    visual.body.instanceMatrix.needsUpdate = true;
    visual.outline.instanceMatrix.needsUpdate = true;
    if (visual.body.instanceColor) visual.body.instanceColor.needsUpdate = true;

    // Head: turns smoothly to face where it's going.
    const [hx, hz] = points[0] ?? [0, 0];
    visual.head.position.set(hx, 0.4, hz);
    const target = headingOf(visual);
    const previousYaw = visual.yaw;
    if (visual.alive)
      visual.yaw = angleLerp(visual.yaw, target, Math.min(1, dt * 22));
    visual.head.rotation.y = visual.yaw;
    visual.tongue.scale.z = visual.alive && Math.sin(now / 90) > 0.6 ? 1 : 0.2;
    visual.shadow.position.set(hx, 0.06, hz);
    visual.tag.sprite.position.set(hx, 1.95, hz);
    visual.tag.draw(
      visual.alive ? String(visual.score) : `${visual.score} · out`,
    );

    const rider = visual.rider;
    if (!rider) return;
    const { avatar } = rider;
    if (rider.fall) {
      updateFall(visual, now, dt);
    } else {
      // Sat astride, holding on, leaning into turns and hunched forward while boosting.
      const turnRate = (visual.yaw - previousYaw) / Math.max(dt, 0.001);
      avatar.userData.legs?.forEach((hip, i) =>
        hip.rotation.set(-1.25, 0, (i === 0 ? -1 : 1) * 0.55),
      );
      reachArms(avatar, [
        [-0.2, 0.42, 0.34],
        [0.2, 0.42, 0.34],
      ]);
      avatar.rotation.set(
        visual.boosting ? 0.45 : 0.08,
        0,
        Math.max(-0.4, Math.min(0.4, -turnRate * 0.05)),
      );
      const hop = playEmote(rider, kit, now);
      avatar.position.x = 0;
      avatar.position.y = 0.28 + Math.abs(Math.sin(now / 110)) * 0.035 + hop;
      if (visual.boosting && !calm) {
        // A puff of dust kicked up behind the head.
        if (Math.random() < 0.7) {
          const tail = points[count - 1];
          particles.emit(
            tmp.set(tail[0], 0.3, tail[1]),
            1,
            ['#ffffff', '#fff3b0'],
            { speed: 0.6, up: 0.8, life: 0.5, size: 0.4, gravity: 0 },
          );
          particles.emit(tmp.set(hx, 0.15, hz), 1, ['#e9d5a0', '#ffffff'], {
            speed: 1.2,
            up: 1,
            life: 0.35,
            size: 0.26,
            gravity: 2,
          });
        }
      }
    }
  }

  const OPPOSITE_YAW = (a, b) =>
    Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) > 2.5;

  function headingOf(visual) {
    // Faces the direction the game says it's actually travelling, with an early turn
    // (yours, or one already queued) shown right away instead of waiting on the glide.
    const base = DIR_YAW[visual.dir] ?? visual.yaw;
    if (
      visual.queued &&
      visual.alive &&
      !OPPOSITE_YAW(DIR_YAW[visual.queued], base)
    )
      return DIR_YAW[visual.queued];
    return base;
  }

  // ─── Apples ─────────────────────────────────────────────────────────

  function makeApple() {
    const apple = new Group();
    const fruit = new Mesh(
      kit.geometry('apple', () => new SphereGeometry(0.3, 16, 12)),
      kit.toon('#ef4444'),
    );
    fruit.scale.set(1, 0.92, 1);
    fruit.add(new Mesh(fruit.geometry, kit.outlineThin));
    const shine = new Mesh(
      kit.geometry('apple-shine', () => new SphereGeometry(0.07, 8, 6)),
      kit.toon('#ffd0d0'),
    );
    shine.position.set(-0.12, 0.13, 0.2);
    const stem = new Mesh(
      kit.geometry(
        'apple-stem',
        () => new CylinderGeometry(0.025, 0.03, 0.18, 5),
      ),
      kit.toon('#6b4424'),
    );
    stem.position.y = 0.32;
    const leaf = new Mesh(
      kit.geometry('apple-leaf', () => new SphereGeometry(1, 8, 5)),
      kit.toon('#4cba57'),
    );
    leaf.scale.set(0.12, 0.03, 0.07);
    leaf.position.set(0.09, 0.36, 0);
    leaf.rotation.z = -0.5;
    const body = new Group();
    body.add(fruit, shine, stem, leaf);
    apple.add(body, blobShadow(kit, 0.3));
    apple.children[1].position.y = 0.06;
    apple.userData.body = body;
    apple.userData.born = performance.now();
    return apple;
  }

  function syncApples(state) {
    const seen = new Set();
    for (const [x, y] of state.apples) {
      const k = `${x},${y}`;
      seen.add(k);
      if (apples.has(k)) continue;
      const apple = makeApple();
      const [wx, wz] = cellToWorld(state.size, state.size, x, y);
      apple.position.set(wx, 0, wz);
      apple.userData.phase = Math.random() * 6;
      scene.add(apple);
      apples.set(k, apple);
    }
    for (const [k, apple] of apples) {
      if (seen.has(k)) continue;
      apple.removeFromParent();
      apples.delete(k);
    }
  }

  function drawApples(now) {
    for (const apple of apples.values()) {
      const grow = Math.min(1, (now - apple.userData.born) / 350);
      const body = apple.userData.body;
      body.scale.setScalar(calm ? 1 : easeOutBack(grow));
      body.position.y =
        0.38 + Math.sin(now / 300 + apple.userData.phase) * 0.07;
      body.rotation.y = now / 700 + apple.userData.phase;
    }
  }

  // ─── Game over ──────────────────────────────────────────────────────

  function celebrate(state) {
    const solo = state.snakes.length === 1;
    for (const snake of state.snakes) {
      const visual = snakes.get(snake.id);
      if (!visual?.rider) continue;
      const won = solo ? false : state.winner === snake.id;
      if (won) startEmote(visual.rider, 'cheer', 300);
      else if (!solo) startEmote(visual.rider, 'sad', 500);
    }
    const winner = snakes.get(state.winner);
    if (winner) {
      const [hx, hz] = winner.to[0] ?? [0, 0];
      for (let i = 0; i < (calm ? 1 : 4); i++) {
        tweens.add(1, () => {}, {
          delay: 300 + i * 350,
          done: () =>
            particles.emit(
              tmp.set(
                hx + (Math.random() - 0.5) * 2,
                2.5,
                hz + (Math.random() - 0.5) * 2,
              ),
              40,
              ['#ff6b81', '#ffd84d', '#7ed957', '#4d8ff0', '#ffffff'],
              { speed: 3, up: 5, life: 1.4, size: 0.28, gravity: 5 },
            ),
        });
      }
    }
  }

  // ─── Frame ──────────────────────────────────────────────────────────

  stage.onFrame((dt, now) => {
    tweens.tick(now);
    world?.sea.update(now / 1000, camera);
    drawApples(now);
    for (const visual of snakes.values()) drawSnake(visual, now, dt);
    particles.tick(dt, camera, stage.renderer);
    for (const child of world?.group.children ?? [])
      if (child.userData.water)
        child.position.y = 0.04 + Math.sin(now / 500 + child.position.x) * 0.01;

    if (world) {
      // Mostly the whole island, drifting a little towards your own snake.
      const mine = snakes.get(watchId ?? myId);
      const head = mine?.alive ? mine.head.position : null;
      // Closer in while you're riding (following you), the whole island otherwise.
      const pull = head ? 0.8 : 0;
      const zoom = head ? 0.62 : 1;
      const goalX = head ? head.x * pull : 0;
      const goalZ = head ? head.z * pull : 0;
      camTarget.x += (goalX - camTarget.x) * Math.min(1, dt * 2);
      camTarget.z += (goalZ - camTarget.z) * Math.min(1, dt * 2);
      const d = distanceFor(world.size);
      camPos.x += (camTarget.x - camPos.x) * Math.min(1, dt * 2);
      camPos.y += (d.y * zoom - camPos.y) * Math.min(1, dt * 2);
      camPos.z += (camTarget.z + d.z * zoom - camPos.z) * Math.min(1, dt * 2);
      camera.position.copy(camPos);
      if (shake > 0) {
        shake = Math.max(0, shake - dt);
        camera.position.x += (Math.random() - 0.5) * shake * 0.8;
        camera.position.y += (Math.random() - 0.5) * shake * 0.8;
      }
      camera.lookAt(camTarget.x, -0.5, camTarget.z + 0.6);
      // Boosting widens your view for a moment, for a rush of speed.
      const boostingMine = mine?.boosting ? 0.35 : 0;
      fovKick = Math.max(boostingMine, fovKick - dt * 1.6);
      const fov = BASE_FOV + fovKick * 9;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov += (fov - camera.fov) * Math.min(1, dt * 10);
        camera.updateProjectionMatrix();
      }
    }
  });

  return {
    // The latest snapshot of the game, the viewer's id, everyone's avatar (id -> avatar) and how long a half-step takes.
    setGame(state, options = {}) {
      if (!state) return;
      myId = options.myId ?? myId;
      // null is meaningful here: back to following yourself.
      if ('watchId' in options) watchId = options.watchId ?? null;
      avatars = options.avatars ?? avatars;
      stepMs = options.stepMs ?? stepMs;
      const now = performance.now();
      const fresh =
        state.tick < lastTick ||
        [...snakes.keys()].join() !== state.snakes.map((s) => s.id).join();
      lastTick = state.tick;
      buildWorld(state);
      if (fresh) {
        for (const visual of snakes.values()) removeSnake(visual);
        snakes.clear();
        for (const snake of state.snakes)
          snakes.set(snake.id, makeSnake(snake));
        overShown = false;
      }
      for (const snake of state.snakes)
        syncSnake(snakes.get(snake.id), snake, now, state);
      syncApples(state);
      if (state.status === 'over' && !overShown) {
        overShown = true;
        celebrate(state);
      }
      if (state.status !== 'over') overShown = false;
    },
    // Every other living snake's head on screen (-1..1 each way), for the off-screen arrows.
    markers() {
      const out = [];
      for (const v of snakes.values()) {
        if (v.id === myId || !v.alive) continue;
        const point = v.head.position.clone().setY(0.9).project(camera);
        out.push({
          id: v.id,
          name: v.name,
          color: v.color,
          x: point.x,
          y: point.y,
          behind: point.z > 1,
        });
      }
      return out;
    },
    // Your own turn, shown the moment you press it (before the game has taken the step).
    previewTurn(id, dir) {
      const visual = snakes.get(id);
      if (visual?.alive && DIR_YAW[dir] !== undefined) visual.queued = dir;
    },
    dispose() {
      for (const visual of snakes.values()) removeSnake(visual);
      snakes.clear();
      outlineMaterial.dispose();
      sphere.dispose();
      scorchGeometry.dispose();
      stage.dispose();
    },
  };
}
