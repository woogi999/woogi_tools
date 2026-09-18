// The 3D stage for the Pose Reference tool. The figure is Mannequiny, the
// open rigged mannequin GDQuest made for Godot (CC-BY 4.0), loaded as a GLB
// and posed by turning its bones. Loaded lazily like the games' scenes;
// utils/mannequin.js is the data it draws.
//
//   createPoseScene(canvas, { onSelect, onPose, onReady })
//     .setPose(pose)          the joint angles from utils/mannequin.js
//     .setSettings(settings)  shading, colours, lights, lens...
//     .select(jointId)        highlight a joint (null for none)
//     .setView(name)          'front' | 'quarter' | 'side' | 'back' | 'top' | 'low'
//     .snapshot({ width, height, transparent })  -> canvas
//     .dispose()

import {
  WebGLRenderer,
  Scene,
  PerspectiveCamera,
  HemisphereLight,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  MeshToonMaterial,
  MeshBasicMaterial,
  ShadowMaterial,
  SphereGeometry,
  PlaneGeometry,
  GridHelper,
  DataTexture,
  RGBAFormat,
  NearestFilter,
  SRGBColorSpace,
  PCFShadowMap,
  Raycaster,
  Vector2,
  Vector3,
  Quaternion,
  Color,
  MathUtils,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { rendererOptions, createGovernor, tabHidden } from './perf';
import {
  JOINTS,
  jointById,
  normalisePose,
  normaliseSettings,
} from '../utils/mannequin';

const MODEL_URL = '/models/mannequiny.glb';
const DEG = Math.PI / 180;
const X = new Vector3(1, 0, 0);
const Y = new Vector3(0, 1, 0);
const Z = new Vector3(0, 0, 1);

// Which bone of the model each joint turns.
const BONES = {
  hips: 'pelvis',
  spine: 'spine_01',
  chest: 'spine_02',
  neck: 'neck_01',
  head: 'head',
  armL: 'upperarm.l',
  elbowL: 'lowerarm.l',
  handL: 'hand.l',
  legL: 'thigh.l',
  kneeL: 'calf.l',
  footL: 'foot.l',
  armR: 'upperarm.r',
  elbowR: 'lowerarm.r',
  handR: 'hand.r',
  legR: 'thigh.r',
  kneeR: 'calf.r',
  footR: 'foot.r',
};

// Bones that aren't joints of their own belong to the nearest one that is,
// so grabbing a finger moves the hand and grabbing a shoulder the chest.
const OWNER = {
  root: 'hips',
  'body.001': 'hips',
  'clavicle.l': 'chest',
  'clavicle.r': 'chest',
  'ball.l': 'footL',
  'ball.r': 'footR',
};

// Where the camera looks and how far back it stands, per view.
const FRAMING = { target: [0, 0.9, 0], distance: 4.4 };

const VIEWS = {
  front: { azimuth: 0, elevation: 8 },
  quarter: { azimuth: 35, elevation: 10 },
  side: { azimuth: 90, elevation: 8 },
  back: { azimuth: 180, elevation: 8 },
  top: { azimuth: 20, elevation: 80 },
  low: { azimuth: 25, elevation: -18 },
};

// Which angles a drag on a body part moves: side to side, and up and down.
const dragAxes = (joint) => ({
  across: joint.axes.some((a) => a.key === 'z') ? 'z' : 'y',
  along: 'x',
});

// A three-step gradient for the toon look.
function toonGradient() {
  const data = new Uint8Array([
    90, 90, 90, 255, 170, 170, 170, 255, 255, 255, 255, 255,
  ]);
  const texture = new DataTexture(data, 3, 1, RGBAFormat);
  texture.minFilter = NearestFilter;
  texture.magFilter = NearestFilter;
  texture.needsUpdate = true;
  return texture;
}

// ─── Materials ─────────────────────────────────────────────────────────

class Kit {
  constructor() {
    this.gradient = toonGradient();
    this.clay = new MeshStandardMaterial({ roughness: 0.78, metalness: 0 });
    this.toon = new MeshToonMaterial({ gradientMap: this.gradient });
    this.wire = new MeshBasicMaterial({ wireframe: true });
    this.xray = new MeshBasicMaterial({
      transparent: true,
      opacity: 0.32,
      depthWrite: false,
    });
    this.dark = new MeshStandardMaterial({ color: '#26262b', roughness: 0.6 });
    this.darkToon = new MeshToonMaterial({
      color: '#26262b',
      gradientMap: this.gradient,
    });
    this.dot = new MeshBasicMaterial({
      color: '#4f8cff',
      depthTest: false,
      transparent: true,
      opacity: 0.85,
    });
    this.dotActive = new MeshBasicMaterial({
      color: '#ffb020',
      depthTest: false,
      transparent: true,
      opacity: 1,
    });
    this.shading = 'clay';
  }

  tint(colour) {
    const base = new Color(colour);
    this.clay.color.copy(base);
    this.toon.color.copy(base);
    this.wire.color.copy(base);
    this.xray.color.copy(base);
  }

  get body() {
    return this[this.shading] ?? this.clay;
  }

  // The model's dark joints.
  get feature() {
    if (this.shading === 'wire') return this.wire;
    if (this.shading === 'xray') return this.xray;
    return this.shading === 'toon' ? this.darkToon : this.dark;
  }

  dispose() {
    for (const value of Object.values(this)) value?.dispose?.();
  }
}

// ─── The scene ─────────────────────────────────────────────────────────

export function createPoseScene(canvas, { onSelect, onPose, onReady } = {}) {
  const phone = window.matchMedia?.('(pointer: coarse)').matches;
  const options = rendererOptions(phone ? 1.5 : 2);
  const renderer = new WebGLRenderer({
    canvas,
    antialias: options.antialias,
    alpha: true,
    powerPreference: 'low-power',
    preserveDrawingBuffer: false,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const governor = createGovernor(renderer, {
    max: options.pixelRatio,
    min: 1,
  });

  const kit = new Kit();
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 16 / 9, 0.05, 60);
  camera.position.set(1.8, 1.4, 4);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.1;
  controls.minDistance = 0.3;
  controls.maxDistance = 14;
  controls.maxPolarAngle = Math.PI * 0.95;
  controls.target.set(...FRAMING.target);

  const sky = new HemisphereLight('#ffffff', '#7a7570', 0.55);
  scene.add(sky);
  const key = new DirectionalLight('#ffffff', 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = key.shadow.camera.bottom = -1.6;
  key.shadow.camera.right = key.shadow.camera.top = 1.6;
  key.shadow.camera.near = 0.5;
  key.shadow.camera.far = 14;
  key.shadow.bias = -0.0006;
  key.shadow.normalBias = 0.015;
  scene.add(key);
  scene.add(key.target);
  const fill = new DirectionalLight('#dfe6ff', 0.5);
  scene.add(fill);

  const floor = new Mesh(
    new PlaneGeometry(30, 30),
    new ShadowMaterial({ opacity: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const grid = new GridHelper(8, 32, '#8a8a92', '#8a8a92');
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  grid.position.y = 0.001;
  scene.add(grid);

  // The figure, once loaded: { root, mesh, bones (joint id -> bone),
  // bind (bone -> { local, world }), jointOf (bone -> joint id), dots }.
  let model = null;
  let pose = normalisePose(null);
  let settings = normaliseSettings(null);
  let selected = null;
  let press = null;
  let disposed = false;
  const raycaster = new Raycaster();
  const pointer = new Vector2();
  const dotGeometry = new SphereGeometry(0.022, 12, 8);

  // ─── Loading and dressing the figure ────────────────────────────────

  new GLTFLoader().load(
    MODEL_URL,
    (gltf) => {
      if (disposed) return;
      // One mesh per material in the file, all on the same skeleton.
      const meshes = [];
      gltf.scene.traverse((object) => {
        if (object.isSkinnedMesh) meshes.push(object);
      });
      const mesh = meshes[0];
      if (!mesh) return;
      for (const part of meshes) {
        part.castShadow = true;
        part.receiveShadow = true;
        part.frustumCulled = false;
        part.userData.material = part.material.name;
      }
      // The file's tree is mid-animation; the bind pose is the T-pose, and
      // every joint angle is measured from it.
      mesh.skeleton.pose();
      gltf.scene.updateMatrixWorld(true);
      const bind = new Map();
      for (const bone of mesh.skeleton.bones) {
        const world = new Quaternion();
        bone.matrixWorld.decompose(new Vector3(), world, new Vector3());
        bind.set(bone, { local: bone.quaternion.clone(), world });
      }
      // The loader drops the dots from node names ("hand.l" is "handl").
      const plain = (name) => name.replace(/\./g, '');
      const byName = new Map(
        mesh.skeleton.bones.map((b) => [plain(b.name), b]),
      );
      const bones = new Map();
      for (const [joint, name] of Object.entries(BONES))
        if (byName.has(plain(name))) bones.set(joint, byName.get(plain(name)));
      const jointOfBone = (bone) =>
        [...bones].find(([, b]) => b === bone)?.[0] ?? null;
      // Every bone belongs to a joint: itself, an owner named above, or the
      // nearest ancestor that is one (fingers to the hand, and so on).
      const jointOf = new Map();
      for (const bone of mesh.skeleton.bones) {
        let joint =
          jointOfBone(bone) ??
          Object.entries(OWNER).find(([n]) => plain(n) === bone.name)?.[1] ??
          null;
        for (let up = bone.parent; !joint && up; up = up.parent)
          joint = jointOfBone(up);
        jointOf.set(bone, joint ?? 'hips');
      }
      const dots = [];
      for (const [joint, bone] of bones) {
        const dot = new Mesh(dotGeometry, kit.dot);
        dot.renderOrder = 10;
        dot.userData.dot = joint;
        bone.add(dot);
        dots.push(dot);
      }
      model = { root: gltf.scene, mesh, meshes, bones, bind, jointOf, dots };
      scene.add(gltf.scene);
      dress();
      applyPose();
      applyView();
      onReady?.();
    },
    undefined,
    () => onReady?.(new Error("Couldn't load the figure.")),
  );

  // The model's materials swap for the chosen surface: its dark joints stay
  // dark, everything else takes the figure colour.
  const dress = () => {
    if (!model) return;
    for (const part of model.meshes)
      part.material =
        part.userData.material === 'Negro' ? kit.feature : kit.body;
  };

  // ─── Posing ─────────────────────────────────────────────────────────

  const q = {
    a: new Quaternion(),
    b: new Quaternion(),
    c: new Quaternion(),
    inner: new Quaternion(),
  };
  const about = (axis, degrees, into) =>
    into.setFromAxisAngle(axis, degrees * DEG);

  // The rotation a joint's angles mean, in the frame the bones were bound in
  // (a T-pose facing +z). Angles are measured from a figure with its arms
  // down, which is what an arm's "hang" is: the T-pose turned down first.
  const semantic = (joint, angles, out) => {
    const sign = joint.sign ?? 1;
    const x = angles.x ?? 0;
    const y = (angles.y ?? 0) * sign;
    const z = (angles.z ?? 0) * sign;
    out.identity();
    if (joint.group === 'Body') {
      // Sideways lean first, then the bow, then the turn about the vertical.
      out.multiply(about(Y, y, q.a)).multiply(about(X, x, q.a));
      out.multiply(about(Z, z, q.a));
      return out;
    }
    const hang = joint.group === 'Arms' ? about(Z, -90 * sign, q.c) : null;
    if (joint.id.startsWith('arm')) {
      // Raise, then swing, then twist, then the hang itself.
      out.multiply(about(Z, z, q.a)).multiply(about(X, x, q.a));
      out.multiply(about(Y, y, q.a)).multiply(hang);
      return out;
    }
    // Everything below a shoulder or hip: twist along the limb, bend across
    // it, and spread sideways, in the frame of a hanging limb.
    const inner = q.inner.identity();
    if ('z' in angles) inner.multiply(about(Z, z, q.a));
    inner.multiply(about(X, x, q.a));
    if ('y' in angles) inner.multiply(about(Y, y, q.a));
    if (hang) {
      // Axes of the hanging arm, carried back to the T-pose.
      const unhang = q.b.copy(hang).invert();
      out.copy(unhang).multiply(inner).multiply(hang);
    } else out.copy(inner);
    return out;
  };

  const applyModelPose = () => {
    if (!model) return;
    const world = new Quaternion();
    const delta = new Quaternion();
    for (const joint of JOINTS) {
      const bone = model.bones.get(joint.id);
      if (!bone) continue;
      const { local, world: bindWorld } = model.bind.get(bone);
      semantic(joint, pose[joint.id], world);
      // A rotation about the bind frame's axes, expressed in the bone's own
      // frame so it rides along with whatever its parent is doing.
      delta.copy(bindWorld).invert().multiply(world).multiply(bindWorld);
      bone.quaternion.copy(local).multiply(delta);
    }
  };

  const applyPose = () => applyModelPose();

  // ─── What is shown ──────────────────────────────────────────────────

  const applyShading = () => {
    kit.shading = settings.shading;
    kit.tint(settings.colour);
    key.castShadow = settings.shadows;
    scene.background = new Color(settings.background);
    dress();
  };

  const dots = () => model?.dots ?? [];

  const refreshDots = () => {
    for (const dot of dots()) {
      const active = dot.userData.dot === selected;
      dot.material = active ? kit.dotActive : kit.dot;
      dot.scale.setScalar(active ? 1.6 : 1);
      dot.visible = settings.dots;
    }
  };

  const applyView = () => {
    grid.visible = settings.grid;
    floor.visible = settings.shadows && settings.shading !== 'wire';
    refreshDots();
  };

  const applyLight = () => {
    const a = settings.lightAngle * DEG;
    const e = settings.lightHeight * DEG;
    key.position.set(
      Math.sin(a) * Math.cos(e) * 6,
      Math.sin(e) * 6 + 0.5,
      Math.cos(a) * Math.cos(e) * 6,
    );
    key.target.position.set(0, 0.9, 0);
    key.intensity = (settings.lightPower / 100) * 2.4;
    fill.position.set(-Math.sin(a) * 4, 2, -Math.cos(a) * 4);
    fill.intensity = 0.25 + (settings.lightPower / 100) * 0.3;
    sky.intensity = 0.35 + (settings.lightPower / 100) * 0.3;
  };

  const applyCamera = () => {
    if (camera.fov !== settings.fov) {
      camera.fov = settings.fov;
      camera.updateProjectionMatrix();
    }
  };

  // The camera swings to a named view around whatever it is looking at.
  const frameView = (name, keepDistance = false) => {
    const view = VIEWS[name] ?? VIEWS.quarter;
    const target = new Vector3(...FRAMING.target);
    // Farther back for a wider lens, so the figure still fits.
    const distance = keepDistance
      ? camera.position.distanceTo(controls.target)
      : FRAMING.distance *
        (Math.tan((35 / 2) * DEG) / Math.tan((settings.fov / 2) * DEG));
    const a = view.azimuth * DEG;
    const e = view.elevation * DEG;
    controls.target.copy(target);
    camera.position.set(
      target.x + Math.sin(a) * Math.cos(e) * distance,
      target.y + Math.sin(e) * distance,
      target.z + Math.cos(a) * Math.cos(e) * distance,
    );
    controls.update();
  };

  // Which named view the camera is nearest, so a lens change can re-frame
  // without jumping somewhere else.
  const currentView = () => {
    const offset = new Vector3().subVectors(camera.position, controls.target);
    const elevation =
      Math.asin(MathUtils.clamp(offset.y / offset.length(), -1, 1)) / DEG;
    const azimuth = Math.atan2(offset.x, offset.z) / DEG;
    let best = 'quarter';
    let score = Infinity;
    for (const [name, view] of Object.entries(VIEWS)) {
      const d =
        Math.abs(view.elevation - elevation) +
        Math.abs(((view.azimuth - azimuth + 540) % 360) - 180);
      if (d < score) {
        score = d;
        best = name;
      }
    }
    return best;
  };

  // ─── Dragging limbs ─────────────────────────────────────────────────

  const pick = (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    raycaster.setFromCamera(pointer, camera);
    const dotHit = raycaster
      .intersectObjects(dots(), false)
      .find((h) => h.object.visible);
    if (dotHit) return dotHit.object.userData.dot;
    if (!model) return null;
    const hit = raycaster.intersectObjects(model.meshes, false)[0];
    if (!hit?.face) return null;
    // The joint whose bones carry most of the face that was hit.
    const geometry = hit.object.geometry;
    const skinIndex = geometry.getAttribute('skinIndex');
    const skinWeight = geometry.getAttribute('skinWeight');
    const weights = new Map();
    for (const v of [hit.face.a, hit.face.b, hit.face.c])
      for (let k = 0; k < 4; k++) {
        const bone = model.mesh.skeleton.bones[skinIndex.getComponent(v, k)];
        const joint = model.jointOf.get(bone);
        if (joint)
          weights.set(
            joint,
            (weights.get(joint) ?? 0) + skinWeight.getComponent(v, k),
          );
      }
    let best = null;
    let top = 0;
    for (const [joint, weight] of weights)
      if (weight > top) {
        top = weight;
        best = joint;
      }
    return best;
  };

  const select = (id) => {
    selected = id;
    refreshDots();
    onSelect?.(id);
  };

  const onDown = (event) => {
    if (event.button !== 0) return;
    const joint = pick(event);
    if (!joint) return;
    select(joint);
    controls.enabled = false;
    canvas.setPointerCapture?.(event.pointerId);
    press = {
      x: event.clientX,
      y: event.clientY,
      joint,
      start: { ...pose[joint] },
    };
  };

  const onMove = (event) => {
    if (!press) return;
    const rect = canvas.getBoundingClientRect();
    const dx = (event.clientX - press.x) / rect.width;
    const dy = (event.clientY - press.y) / rect.height;
    const joint = jointById(press.joint);
    const { across, along } = dragAxes(joint);
    // From behind, a sideways drag has to turn the other way to follow the pointer.
    const toCamera = new Vector3().subVectors(camera.position, controls.target);
    const facing = toCamera.z < 0 ? -1 : 1;
    // A limb follows the pointer outward; the torso and head lean the way it
    // goes. Up lifts everything except a knee, which bends further instead.
    const acrossSign = joint.sign ?? -1;
    const alongSign = joint.id.startsWith('knee') ? 1 : -1;
    const next = { ...press.start };
    if (across in next)
      next[across] = press.start[across] + dx * 220 * facing * acrossSign;
    if (along in next) next[along] = press.start[along] + dy * 220 * alongSign;
    pose = normalisePose({ ...pose, [press.joint]: next });
    applyPose();
    onPose?.(pose);
  };

  const onUp = () => {
    press = null;
    controls.enabled = true;
  };

  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointercancel', onUp);

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();
  let onScreen = true;
  const visibility = new IntersectionObserver(
    ([entry]) => (onScreen = entry.isIntersecting),
  );
  visibility.observe(canvas);

  let lastFrame = performance.now();
  renderer.setAnimationLoop((now) => {
    const gap = now - lastFrame;
    lastFrame = now;
    if (!onScreen || tabHidden()) return;
    governor.frame(gap, now);
    controls.update();
    renderer.render(scene, camera);
  });

  applyShading();
  applyLight();
  applyView();
  frameView('quarter');

  return {
    setPose(next) {
      pose = normalisePose(next);
      applyPose();
    },
    setSettings(next) {
      const previous = settings;
      settings = normaliseSettings(next);
      applyShading();
      applyLight();
      applyCamera();
      applyView();
      if (previous.fov !== settings.fov) frameView(currentView(), false);
    },
    select(id) {
      selected = id;
      refreshDots();
    },
    setView(name) {
      frameView(name);
    },
    // A still of the figure as it stands, at any size, with or without the background.
    snapshot({ width = 1600, height = 2000, transparent = false } = {}) {
      for (const dot of dots()) dot.visible = false;
      const background = scene.background;
      if (transparent) scene.background = null;
      const aspect = camera.aspect;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(1);
      renderer.setSize(width, height, false);
      renderer.render(scene, camera);
      const out = document.createElement('canvas');
      out.width = width;
      out.height = height;
      out.getContext('2d').drawImage(renderer.domElement, 0, 0, width, height);
      scene.background = background;
      camera.aspect = aspect;
      camera.updateProjectionMatrix();
      renderer.setPixelRatio(governor.ratio);
      resize();
      refreshDots();
      return out;
    },
    dispose() {
      disposed = true;
      renderer.setAnimationLoop(null);
      observer.disconnect();
      visibility.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      controls.dispose();
      if (model) {
        for (const part of model.meshes) part.geometry.dispose();
        model.root.removeFromParent();
      }
      dotGeometry.dispose();
      floor.geometry.dispose();
      floor.material.dispose();
      grid.geometry.dispose();
      grid.material.dispose();
      kit.dispose();
      renderer.dispose();
    },
  };
}
