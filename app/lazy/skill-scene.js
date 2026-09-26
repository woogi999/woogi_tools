// Webskill Shenanigans' 3D view: a Roblox R6 character and a training dummy
// on a baseplate, playing a simulated skill (utils/skillbuilder/sim.js).
//
// Everything is drawn from the simulation at a time t, so the view can be
// scrubbed as well as played: positions come from the sampled motion, and
// each effect is a function of how far through its life it is. JJS's own
// animations and meshes aren't public, so animations are stand-in poses and
// effects are drawn by family (glow, ring, sparks, trail…); Billboard and
// Overlay effects show their real Roblox textures when the site's Worker can
// fetch them.

import {
  AdditiveBlending,
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  PlaneGeometry,
  RepeatWrapping,
  Scene,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  TextureLoader,
  TorusGeometry,
  Vector3,
  WebGLRenderer,
  BufferGeometry,
  Float32BufferAttribute,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { motionAt } from '../utils/skillbuilder/sim';
import { vec3, rgbOf } from '../utils/skillbuilder/schema';

const RAD = Math.PI / 180;
const clamp01 = (x) => Math.max(0, Math.min(1, x));

// Roblox's easing styles, In/Out/InOut.
const STYLES = {
  Linear: (x) => x,
  Quad: (x) => x * x,
  Cubic: (x) => x * x * x,
  Exponential: (x) => (x === 0 ? 0 : 2 ** (10 * x - 10)),
  Sine: (x) => 1 - Math.cos((x * Math.PI) / 2),
  Back: (x) => 2.70158 * x * x * x - 1.70158 * x * x,
};
function ease(style, direction, x) {
  const f = STYLES[style] ?? STYLES.Linear;
  if (direction === 'Out') return 1 - f(1 - x);
  if (direction === 'InOut') return x < 0.5 ? f(2 * x) / 2 : 1 - f(2 - 2 * x) / 2;
  return f(x);
}

const FAMILY = {
  sprite: ['Billboard'],
  screen: ['Overlay', 'Screen Color'],
  shake: ['Shake Light', 'Shake Medium', 'Shake Heavy'],
  fov: ['Field of View', 'Camera'],
  ring: ['Ring', 'Wind Expand', '360 Wind', 'Wind Streak', 'Whirl Slash', 'Cleave', 'Beams', 'Beam'],
  burst: ['Clash', 'Sparks', 'Energy Sparks', 'Star', 'Mass Hit', 'Weak Lightning', 'Flames', 'Black Flash'],
  trail: ['Melee Trail', 'Afterimage', 'Afterimage2'],
  none: ['Cancel', 'Visibility'],
};
const familyOf = (effect) =>
  Object.entries(FAMILY).find(([, list]) => list.includes(effect))?.[0] ?? 'glow';

// ─── The characters ─────────────────────────────────────────────────────

function faceTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#111';
  x.fillRect(20, 22, 6, 10);
  x.fillRect(38, 22, 6, 10);
  x.lineWidth = 4;
  x.strokeStyle = '#111';
  x.beginPath();
  x.arc(32, 34, 14, 0.2 * Math.PI, 0.8 * Math.PI);
  x.stroke();
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  return t;
}

// An R6 body in studs: 2-wide torso, 1-wide limbs, pivots at the joints.
function buildCharacter(colours, face) {
  const root = new Group();
  const mat = (c) => new MeshLambertMaterial({ color: c });
  const part = (w, h, d, c) => new Mesh(new BoxGeometry(w, h, d), mat(c));
  const torso = part(2, 2, 1, colours.torso);
  torso.position.y = 3;
  const head = new Group();
  head.position.y = 4;
  const headMesh = part(1.2, 1.2, 1.2, colours.skin);
  headMesh.position.y = 0.6;
  head.add(headMesh);
  const faceMesh = new Mesh(
    new PlaneGeometry(1.1, 1.1),
    new MeshBasicMaterial({ map: face, transparent: true }),
  );
  faceMesh.position.set(0, 0.6, 0.61);
  head.add(faceMesh);
  const limb = (x, y, c) => {
    const pivot = new Group();
    pivot.position.set(x, y, 0);
    const m = part(1, 2, 1, c);
    m.position.y = -1;
    pivot.add(m);
    return pivot;
  };
  // "Right" is the character's own right: -x when facing +z.
  const rightArm = limb(-1.5, 4, colours.skin);
  const leftArm = limb(1.5, 4, colours.skin);
  const rightLeg = limb(-0.5, 2, colours.legs);
  const leftLeg = limb(0.5, 2, colours.legs);
  const body = new Group();
  body.add(torso, head, rightArm, leftArm, rightLeg, leftLeg);
  root.add(body);
  const parts = {
    HumanoidRootPart: torso,
    Torso: torso,
    Head: headMesh,
    'Right Arm': rightArm.children[0],
    'Left Arm': leftArm.children[0],
    'Right Leg': rightLeg.children[0],
    'Left Leg': leftLeg.children[0],
  };
  return { root, body, head, rightArm, leftArm, rightLeg, leftLeg, parts, torso };
}

// Stand-in poses for JJS's animations: the same animation always gets the
// same one, so a skill reads consistently from run to run.
const POSES = [
  (r, w) => (r.rightArm.rotation.x = -1.6 * w), // right jab
  (r, w) => (r.leftArm.rotation.x = -1.6 * w), // left jab
  (r, w) => {
    r.rightLeg.rotation.x = -1.4 * w;
    r.body.rotation.x = 0.15 * w;
  }, // kick
  (r, w) => {
    r.rightArm.rotation.x = -2.8 * w;
    r.body.position.y = 0.4 * w;
  }, // uppercut
  (r, w, p) => (r.body.rotation.y = p * Math.PI * 2 * (w > 0 ? 1 : 0)), // spin
  (r, w) => {
    r.rightArm.rotation.z = 2.6 * w;
    r.leftArm.rotation.z = -2.6 * w;
  }, // arms up
  (r, w) => {
    r.body.rotation.x = 0.5 * w;
    r.rightArm.rotation.x = -0.8 * w;
    r.leftArm.rotation.x = -0.8 * w;
  }, // lunge
  (r, w) => {
    r.rightArm.rotation.x = -2.4 * w;
    r.leftArm.rotation.x = -2.4 * w;
    r.body.rotation.x = -0.2 * w;
  }, // overhead slam
];
function poseIndex(anim) {
  const key = Array.isArray(anim) ? anim.join(',') : String(anim ?? '');
  let h = 0;
  for (const ch of key) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return Math.abs(h) % POSES.length;
}

function resetPose(r) {
  for (const limb of [r.rightArm, r.leftArm, r.rightLeg, r.leftLeg]) limb.rotation.set(0, 0, 0);
  r.body.rotation.set(0, 0, 0);
  r.body.position.set(0, 0, 0);
}

// ─── Helpers ────────────────────────────────────────────────────────────

function textSprite(text, colour = '#fff', size = 1.4) {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const x = c.getContext('2d');
  x.font = '800 64px system-ui, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.lineWidth = 10;
  x.strokeStyle = 'rgba(0,0,0,0.85)';
  x.strokeText(text, 128, 50);
  x.fillStyle = colour;
  x.fillText(text, 128, 50);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  const s = new Sprite(new SpriteMaterial({ map: t, transparent: true, depthTest: false }));
  s.scale.set(size * 2.6, size, 1);
  return s;
}

function burstGeometry() {
  const points = [];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2;
    const b = ((i * 7) % 14) / 14 - 0.5;
    const dir = new Vector3(Math.cos(a), b, Math.sin(a)).normalize();
    points.push(0, 0, 0, dir.x, dir.y, dir.z);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(points, 3));
  return g;
}

function baseplateTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = '#a3a3a3';
  x.fillRect(0, 0, 64, 64);
  x.strokeStyle = '#8f8f8f';
  x.lineWidth = 2;
  x.strokeRect(0, 0, 64, 64);
  const t = new CanvasTexture(c);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.repeat.set(128, 128);
  t.magFilter = NearestFilter;
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Mounts the view in `host`. `textureUrl(id)` resolves a Roblox image ID to a
 * URL (or null); `onSound(event)` hears each sound as playback passes it.
 */
export function mountSkillScene(host, { textureUrl = async () => null } = {}) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = 'ws-canvas';
  host.append(renderer.domElement);
  const screen = document.createElement('div');
  screen.className = 'ws-screen';
  const overlayImg = document.createElement('img');
  overlayImg.className = 'ws-screen-img';
  overlayImg.alt = '';
  screen.append(overlayImg);
  host.append(screen);

  const scene = new Scene();
  scene.background = new Color('#b9d3ea');
  const camera = new PerspectiveCamera(70, 1, 0.1, 2000);
  camera.position.set(-9, 8, -9);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 3, 2.5);
  controls.enableDamping = false;
  controls.update();
  scene.add(new HemisphereLight('#ffffff', '#8a8a8a', 1.6));
  scene.add(new AmbientLight('#ffffff', 0.5));
  const sun = new DirectionalLight('#ffffff', 1.4);
  sun.position.set(-20, 40, -10);
  scene.add(sun);
  const plate = new Mesh(
    new PlaneGeometry(512, 512),
    new MeshLambertMaterial({ map: baseplateTexture() }),
  );
  plate.rotation.x = -Math.PI / 2;
  scene.add(plate);

  const face = faceTexture();
  const user = buildCharacter({ skin: '#f5cd30', torso: '#0d69ac', legs: '#a4bd47' }, face);
  const target = buildCharacter({ skin: '#b3b3b3', torso: '#8c8c8c', legs: '#6e6e6e' }, face);
  scene.add(user.root, target.root);
  const people = { user, target };

  const fx = new Group();
  scene.add(fx);
  const live = new Map();
  const textures = new Map();
  const burst = burstGeometry();
  const unitSphere = new SphereGeometry(0.5, 20, 14);
  const unitRing = new TorusGeometry(0.5, 0.06, 8, 40);
  const unitBox = new BoxGeometry(1, 1, 1);

  let run = null;
  let time = 0;
  let follow = true;
  let baseFov = 70;
  let lastFocus = new Vector3(0, 3, 2.5);

  function texture(id) {
    if (!id) return null;
    if (textures.has(id)) return textures.get(id);
    const entry = { map: null };
    textures.set(id, entry);
    textureUrl(id)
      .then((url) => {
        if (!url) return;
        new TextureLoader().setCrossOrigin('anonymous').load(url, (map) => {
          map.colorSpace = SRGBColorSpace;
          entry.map = map;
          entry.url = url;
          render();
        });
      })
      .catch(() => {});
    return entry;
  }

  function resize() {
    const { clientWidth: w, clientHeight: h } = host;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    render();
  }
  const watcher = new ResizeObserver(resize);
  watcher.observe(host);

  // Where a body part is in the world, now.
  function partPosition(who, name) {
    const mesh = people[who].parts[name] ?? people[who].parts.HumanoidRootPart;
    mesh.updateWorldMatrix(true, false);
    return new Vector3().setFromMatrixPosition(mesh.matrixWorld);
  }
  function localToWorld(who, [x, y, z]) {
    const yaw = people[who].root.rotation.y;
    const fx2 = Math.sin(yaw);
    const fz = Math.cos(yaw);
    return new Vector3(-fz * x + fx2 * z, y, fx2 * x + fz * z);
  }

  function shotAt(shot, t) {
    const k = Math.max(0, Math.min(t, shot.t1) - shot.t0) * shot.speed;
    return new Vector3(...shot.origin.map((c, i) => c + shot.dir[i] * k));
  }

  function place(t) {
    if (!run) return;
    for (const who of ['user', 'target']) {
      const r = people[who];
      const [x, y, z] = motionAt(run.motion[who], t);
      r.root.position.set(x, y, z);
      r.root.rotation.y = run.yaw[who];
      resetPose(r);
      // Walking legs while moving along the ground.
      const [px, , pz] = motionAt(run.motion[who], t - 1 / 30);
      const speed = Math.hypot(x - px, z - pz) * 30;
      if (speed > 2 && y < 0.2) {
        const swing = Math.sin(t * 14) * 0.7;
        r.rightLeg.rotation.x = swing;
        r.leftLeg.rotation.x = -swing;
      }
    }
    for (const e of run.events) {
      if (t < e.t || t >= e.end) continue;
      const r = people[e.who];
      const p = clamp01((t - e.t) / Math.max(0.01, e.end - e.t));
      if (e.kind === 'ANIM') POSES[poseIndex(e.node.ANIM_USE)](r, Math.sin(p * Math.PI), p);
      if (e.kind === 'STATE' && e.node.STATE === 'Stun' && e.who === 'target') r.body.rotation.x = -0.25;
      if (e.kind === 'VELO' && e.ragdoll > 0 && t < e.t + e.ragdoll) {
        r.body.rotation.x = -1.2 * Math.sin(clamp01((t - e.t) / e.ragdoll) * Math.PI);
      }
    }
    // Grabs hold the one grabbed to the grabber's part.
    for (const g of run.grabs) {
      if (t < g.t0 || t >= g.t1) continue;
      const at = partPosition(g.by, g.node['BODY PART'] ?? 'HumanoidRootPart');
      const off = localToWorld(g.by, vec3(g.node.POSITION));
      const held = people[g.who].root;
      held.position.copy(at.add(off)).add(new Vector3(0, -3, 0));
      held.rotation.y = people[g.by].root.rotation.y + vec3(g.node.ROTATION)[1] * RAD;
    }
  }

  function ensure(e) {
    if (live.has(e.id)) return live.get(e.id);
    let obj = null;
    const n = e.node ?? {};
    if (e.kind === 'VISUAL' || e.kind === 'PARTICLE') {
      const family = e.kind === 'PARTICLE' ? 'burst' : familyOf(n.EFFECT);
      if (family === 'sprite') {
        const tex = texture(n.TEXTURE);
        obj = new Sprite(new SpriteMaterial({ map: tex?.map ?? null, transparent: true, depthWrite: false }));
        obj.userData.tex = tex;
      } else if (family === 'ring') {
        obj = new Mesh(unitRing, new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending, side: DoubleSide }));
        obj.rotation.x = Math.PI / 2;
      } else if (family === 'burst') {
        obj = new LineSegments(burst, new LineBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }));
      } else if (family === 'trail') {
        obj = new Mesh(unitBox, new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: AdditiveBlending }));
      } else if (family === 'glow') {
        // A Mesh effect with a texture is usually a textured ball (a beach
        // ball, a sun): wrap the texture round it rather than glowing.
        const tex = n.EFFECT === 'Mesh' && n.TEXTURE ? texture(n.TEXTURE) : null;
        obj = new Mesh(
          unitSphere,
          new MeshBasicMaterial({ transparent: true, depthWrite: false, blending: tex ? 1 : AdditiveBlending }),
        );
        obj.userData.tex = tex;
      }
      if (obj) obj.userData.family = family;
    } else if (e.kind === 'HITBOX') {
      const size = vec3(n.SIZE, [5, 5, 5]);
      obj = new Group();
      const fill = new Mesh(unitBox, new MeshBasicMaterial({ color: '#ff3b3b', transparent: true, opacity: 0.18, depthWrite: false }));
      const edges = new LineSegments(new EdgesGeometry(unitBox), new LineBasicMaterial({ color: '#ff3b3b' }));
      obj.add(fill, edges);
      obj.scale.set(...size);
      obj.userData.family = 'hitbox';
    } else if (e.kind === 'PROJECTILE') {
      obj = new Mesh(unitSphere, new MeshBasicMaterial({ color: '#b28cff', transparent: true, opacity: 0.55, depthWrite: false }));
      obj.userData.family = 'shot';
    } else if (e.kind === 'HIT') {
      obj = textSprite(e.damage ? `-${e.damage}` : 'HIT', '#ff5a5a');
      obj.userData.family = 'popup';
    } else if (e.kind === 'SFX') {
      obj = textSprite('♪', '#b8f36a', 0.9);
      obj.userData.family = 'popup';
    } else if (e.kind === 'COUNTER') {
      obj = new Mesh(unitSphere, new MeshBasicMaterial({ color: '#7fb2ff', transparent: true, opacity: 0.25, depthWrite: false }));
      obj.userData.family = 'shield';
    } else if (e.kind === 'TELEPORT') {
      obj = new Mesh(unitRing, new MeshBasicMaterial({ color: '#5fe0c0', transparent: true, depthWrite: false, side: DoubleSide }));
      obj.rotation.x = Math.PI / 2;
      obj.userData.family = 'blink';
    }
    if (obj) fx.add(obj);
    live.set(e.id, obj);
    return obj;
  }

  function drop(id) {
    const obj = live.get(id);
    if (obj) {
      fx.remove(obj);
      obj.traverse?.((o) => {
        if (o.material && o.material.map && o instanceof Sprite && o.userData.family === 'popup') o.material.map.dispose();
        o.material?.dispose?.();
      });
    }
    live.delete(id);
  }

  function effects(t) {
    let shake = 0;
    let fovKick = 0;
    let tint = null;
    let overlay = null;
    const cancelled = new Map();
    for (const e of run.events)
      if (e.kind === 'VISUAL' && e.node.EFFECT === 'Cancel' && e.node['VISUAL TAG'] && e.t <= t)
        cancelled.set(e.node['VISUAL TAG'], Math.max(cancelled.get(e.node['VISUAL TAG']) ?? 0, e.t));
    const active = new Set();
    for (const e of run.events) {
      const n = e.node ?? {};
      const dead = n['VISUAL TAG'] && cancelled.has(n['VISUAL TAG']) && cancelled.get(n['VISUAL TAG']) >= e.t && n.EFFECT !== 'Cancel';
      if (t < e.t || t >= e.end || dead) continue;
      const p = clamp01((t - e.t) / Math.max(0.01, e.end - e.t));
      if (e.kind === 'VISUAL') {
        const family = familyOf(n.EFFECT);
        const k = ease(n['EASING STYLE'], n['EASING DIRECTION'], p);
        const opacityFrom = 1 - clamp01(Number(n.OPACITY ?? 0));
        const opacityTo = 1 - clamp01(Number(n['ALT OPACITY'] ?? 1));
        const alpha = opacityFrom + (opacityTo - opacityFrom) * k;
        const c0 = rgbOf(n.COLOR);
        const c1 = rgbOf(n['ALT COLOR'] ?? n.COLOR);
        const colour = new Color(...c0.map((c, i) => (c + (c1[i] - c) * k) / 255));
        if (family === 'shake') {
          shake = Math.max(shake, ({ 'Shake Light': 0.12, 'Shake Medium': 0.25, 'Shake Heavy': 0.5 }[n.EFFECT] ?? 0.2) * (1 - p));
          continue;
        }
        if (family === 'fov') {
          fovKick = Math.max(fovKick, 12 * Math.sin(p * Math.PI));
          continue;
        }
        if (family === 'screen') {
          if (n.EFFECT === 'Overlay' && n.TEXTURE) overlay = { tex: texture(n.TEXTURE), alpha, colour };
          else tint = { colour, alpha: Math.min(0.6, Math.abs(Number(n.SIZE ?? 1)) * 0.15 + 0.1) * (1 - p) };
          continue;
        }
        if (family === 'none') continue;
      }
      const obj = ensure(e);
      if (!obj) continue;
      active.add(e.id);
      const fam = obj.userData.family;
      if (e.kind === 'VISUAL' || e.kind === 'PARTICLE') {
        const k = ease(n['EASING STYLE'], n['EASING DIRECTION'], p);
        const s0 = Number(n.SIZE ?? 1);
        const s1 = Number(n['ALT SIZE'] ?? s0);
        const size = Math.max(0.05, Math.abs(s0 + (s1 - s0) * k));
        const pos0 = vec3(n.POSITION);
        const pos1 = vec3(n['ALT POSITION'] ?? n.POSITION);
        const offset = pos0.map((v, i) => v + (pos1[i] - v) * k);
        const shot = n['PROJECTILE TAG'] && run.shots.findLast?.((s) => s.tag === n['PROJECTILE TAG'] && s.t0 <= e.t);
        const anchor = shot ? shotAt(shot, t) : partPosition(e.who, n['BODY PART'] ?? 'HumanoidRootPart');
        obj.position.copy(anchor.add(localToWorld(e.who, offset)));
        const opacityFrom = 1 - clamp01(Number(n.OPACITY ?? 0));
        const opacityTo = 1 - clamp01(Number(n['ALT OPACITY'] ?? 1));
        const alpha = clamp01(opacityFrom + (opacityTo - opacityFrom) * k);
        const c0 = rgbOf(n.COLOR);
        const c1 = rgbOf(n['ALT COLOR'] ?? n.COLOR);
        obj.material.color?.setRGB(...c0.map((c, i) => (c + (c1[i] - c) * k) / 255));
        obj.material.opacity = e.kind === 'PARTICLE' ? 1 - p : alpha;
        if (fam === 'sprite') {
          const tex = obj.userData.tex;
          if (tex?.map && obj.material.map !== tex.map) {
            obj.material.map = tex.map;
            obj.material.needsUpdate = true;
          }
          if (!tex?.map) obj.material.color.set('#ffffff');
          obj.scale.set(size * 2, size * 2, 1);
        } else if (fam === 'ring') obj.scale.setScalar(size * 4 * (0.4 + p));
        else if (fam === 'burst') obj.scale.setScalar(size * 2.5 * (0.3 + p));
        else if (fam === 'trail') {
          obj.scale.set(1.1, 2.1, 1.1);
          obj.material.opacity = 0.35 * (1 - p);
        } else {
          // Mesh sizes are the mesh's own scale: kept modest so a big one
          // doesn't swallow the view.
          const mesh = n.EFFECT === 'Mesh';
          obj.scale.setScalar(mesh ? Math.min(size, 14) : size * 2);
          const tex = obj.userData.tex;
          if (tex?.map && obj.material.map !== tex.map) {
            obj.material.map = tex.map;
            obj.material.needsUpdate = true;
          }
          if (!tex?.map) obj.material.opacity *= mesh ? 0.35 : 0.6;
        }
      } else if (fam === 'hitbox') {
        const off = localToWorld(e.who, vec3(n.POSITION));
        obj.position.copy(people[e.who].root.position).add(off).add(new Vector3(0, 2.5, 0));
        obj.rotation.y = people[e.who].root.rotation.y;
        obj.children[0].material.opacity = 0.22 * (1 - p);
        obj.children[1].material.opacity = 1 - p;
        obj.children[1].material.transparent = true;
      } else if (fam === 'shot') {
        const shot = run.shots[e.shot];
        if (shot) {
          obj.position.copy(shotAt(shot, t));
          obj.scale.setScalar(Math.max(0.6, Math.max(...shot.size) / 3));
          obj.material.opacity = shot.speed ? 0.6 : 0.2;
        }
      } else if (fam === 'popup') {
        const base = people[e.who].root.position;
        obj.position.set(base.x, base.y + 6.5 + p * 1.5, base.z);
        obj.material.opacity = 1 - p * p;
      } else if (fam === 'shield') {
        obj.position.copy(people[e.who].root.position).add(new Vector3(0, 3, 0));
        obj.scale.setScalar(7);
      } else if (fam === 'blink') {
        obj.position.copy(people[e.who].root.position).add(new Vector3(0, 0.2, 0));
        obj.scale.setScalar(4 * (0.3 + p));
        obj.material.opacity = 1 - p;
      }
    }
    for (const id of [...live.keys()]) if (!active.has(id)) drop(id);

    screen.style.background = tint ? `rgba(${Math.round(tint.colour.r * 255)},${Math.round(tint.colour.g * 255)},${Math.round(tint.colour.b * 255)},${tint.alpha})` : 'transparent';
    if (overlay?.tex?.url) {
      overlayImg.src = overlay.tex.url;
      overlayImg.style.opacity = String(clamp01(overlay.alpha));
      overlayImg.hidden = false;
    } else overlayImg.hidden = true;
    return { shake, fovKick };
  }

  function render() {
    renderer.render(scene, camera);
  }

  function show(t) {
    time = t;
    if (!run) return render();
    place(t);
    const { shake, fovKick } = effects(t);
    if (follow) {
      const a = people.user.root.position;
      const b = people.target.root.position;
      const focus = new Vector3((a.x + b.x) / 2, Math.max(a.y, b.y) / 2 + 3, (a.z + b.z) / 2);
      const delta = focus.clone().sub(lastFocus);
      camera.position.add(delta);
      controls.target.copy(focus);
      lastFocus = focus;
    }
    controls.update();
    camera.fov = baseFov + fovKick;
    camera.updateProjectionMatrix();
    const saved = camera.position.clone();
    if (shake) camera.position.add(new Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake));
    render();
    camera.position.copy(saved);
  }

  controls.addEventListener('change', () => {
    lastFocus = controls.target.clone();
    render();
  });

  return {
    setRun(next) {
      for (const id of [...live.keys()]) drop(id);
      run = next;
      lastFocus = controls.target.clone();
      show(0);
    },
    show,
    get time() {
      return time;
    },
    setFollow(on) {
      follow = on;
    },
    resetCamera() {
      camera.position.set(-9, 8, -9);
      controls.target.set(0, 3, 2.5);
      lastFocus = controls.target.clone();
      controls.update();
      show(time);
    },
    resize,
    dispose() {
      watcher.disconnect();
      controls.dispose();
      for (const id of [...live.keys()]) drop(id);
      scene.traverse((o) => {
        o.geometry?.dispose?.();
        o.material?.map?.dispose?.();
        o.material?.dispose?.();
      });
      for (const t of textures.values()) t.map?.dispose?.();
      renderer.dispose();
      renderer.domElement.remove();
      screen.remove();
    },
  };
}
