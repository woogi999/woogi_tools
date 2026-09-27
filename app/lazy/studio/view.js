// 3D Studio's viewport. It draws the document, and turns pointer input into
// picks, gizmo drags and brush strokes that it hands back to the page; it
// never changes the document itself.
//
//   const view = mountView(container, { evaluator, textures, onPick, onBox,
//                                        onTransform, onBrush, onHover });
//   view.sync(state);   // after every change: document, selection, mode…
//   view.dispose();
//
// Syncing is incremental: objects are matched by id, geometry is rebuilt
// only when an object's evaluation key changes, materials only when their
// data (or texture set) changes, and transforms are just copied.

import {
  ACESFilmicToneMapping,
  AmbientLight,
  Bone,
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  DoubleSide,
  EdgesGeometry,
  Float32BufferAttribute,
  PlaneGeometry,
  ShaderMaterial,
  Group,
  HemisphereLight,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Raycaster,
  RingGeometry,
  Scene,
  Skeleton,
  SkinnedMesh,
  SpotLight,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { TransformControls } from 'three/examples/jsm/controls/TransformControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { FlyCamera } from './camera';
import {
  geometryFromMesh,
  addSkin,
  setVertexColors,
  makeMaterial,
  applyMaterial,
  outlineMaterial,
  cutterMaterial,
  boneGeometry,
  controlGeometry,
  lightGizmo,
  cameraGizmo,
  pickBody,
} from './scene-build';
import { worldMatrix, trsOf } from './doc';
import { edgeMap, triangulateFace, faceCenter, vertexNormals } from './mesh';
import {
  solvePose,
  boneLength,
  poseFromWorld,
  remapSkin,
  weightColor,
  restMatrix,
  sortBones,
} from './rig';
import { mergePose } from './anim';

const RAD = Math.PI / 180;
const ORANGE = new Color('#ff9a3c');
const matKey = (m) => m.elements.map((x) => Math.round(x * 1e4)).join(',');

const isTyping = () => {
  const el = document.activeElement;
  return (
    el?.isContentEditable ||
    ['INPUT', 'TEXTAREA', 'SELECT'].includes(el?.tagName)
  );
};

export function mountView(container, hooks) {
  return new StudioView(container, hooks);
}

class StudioView {
  constructor(container, hooks) {
    this.container = container;
    this.hooks = hooks;
    this.evaluator = hooks.evaluator;
    this.textures = hooks.textures;
    this.nodes = new Map();
    this.state = null;
    this.needsRender = true;
    this.pointer = new Vector2();
    this.pointerPx = [0, 0];

    const renderer = new WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: true,
      alpha: false,
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = PCFShadowMap;
    renderer.domElement.className = 'st-canvas';
    renderer.domElement.tabIndex = 0;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;
    this.canvas = renderer.domElement;
    // A handle for tests and the console to inspect what's drawn.
    this.canvas.studioView = this;

    renderer.setClearColor(0x2a2d34, 1);
    const scene = new Scene();
    this.scene = scene;
    const pmrem = new PMREMGenerator(renderer);
    this.envMap = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    scene.environment = this.envMap;
    scene.environmentIntensity = 0.55;

    this.camera = new PerspectiveCamera(50, 1, 0.02, 2000);
    this.camera.position.set(4.5, 3.4, 5.5);
    this.root = new Group();
    this.overlay = new Group();
    scene.add(this.root, this.overlay);

    // A hemisphere light is always there so nothing is ever pitch black;
    // the scene's own lights do the real work.
    this.hemi = new HemisphereLight(0xdfe6ff, 0x3a3530, 0.5);
    this.headlight = new DirectionalLight(0xffffff, 1.6);
    this.headlight.position.set(3, 5, 4);
    scene.add(this.hemi, this.headlight, this.headlight.target);

    // The ground grid: a shader rather than lines, so it stays crisp at any
    // angle and fades out towards the horizon instead of aliasing into a band.
    this.grid = new Mesh(
      new PlaneGeometry(2000, 2000).rotateX(-Math.PI / 2),
      new ShaderMaterial({
        transparent: true,
        depthWrite: false,
        side: DoubleSide,
        uniforms: { uCam: { value: new Vector3() }, uFade: { value: 60 } },
        vertexShader: `
          varying vec3 vWorld;
          void main() {
            vec4 w = modelMatrix * vec4(position, 1.0);
            vWorld = w.xyz;
            gl_Position = projectionMatrix * viewMatrix * w;
          }`,
        fragmentShader: `
          varying vec3 vWorld;
          uniform vec3 uCam;
          uniform float uFade;
          float grid(vec2 p, float size) {
            vec2 c = p / size;
            vec2 g = abs(fract(c - 0.5) - 0.5) / fwidth(c);
            return 1.0 - min(min(g.x, g.y), 1.0);
          }
          void main() {
            float d = length(vWorld.xz - uCam.xz);
            float fade = 1.0 - smoothstep(uFade * 0.25, uFade, d);
            float a = max(grid(vWorld.xz, 1.0) * 0.28, grid(vWorld.xz, 10.0) * 0.5);
            vec3 col = vec3(0.56, 0.6, 0.68);
            float ax = 1.0 - min(abs(vWorld.z) / fwidth(vWorld.z), 1.0);
            float az = 1.0 - min(abs(vWorld.x) / fwidth(vWorld.x), 1.0);
            col = mix(col, vec3(0.92, 0.32, 0.38), ax);
            col = mix(col, vec3(0.3, 0.52, 0.96), az * (1.0 - ax));
            a = max(a, max(ax, az) * 0.85);
            a *= fade;
            if (a < 0.01) discard;
            gl_FragColor = vec4(col, a);
          }`,
      }),
    );
    this.grid.renderOrder = -1;
    scene.add(this.grid);

    this.fly = new FlyCamera(this.camera, this.canvas, {
      onChange: () => {
        this.needsRender = true;
        hooks.onCamera?.();
      },
      pickDistance: (ndc) => this.pickDepth(ndc),
      isTyping,
    });
    this.fly.lookAt(new Vector3(4.5, 3.4, 5.5), new Vector3(0, 0.5, 0));

    // The gizmo works on a stand-in object; drags are turned into changes
    // to whatever is selected (objects, vertices, bones).
    this.proxy = new Object3D();
    scene.add(this.proxy);
    this.gizmo = new TransformControls(this.camera, this.canvas);
    this.gizmo.setSize(0.9);
    scene.add(this.gizmo.getHelper());
    this.gizmo.addEventListener('dragging-changed', (e) => {
      this.fly.enabled = !e.value;
      if (e.value) this.beginDrag();
      else this.endDrag();
    });
    this.gizmo.addEventListener('objectChange', () => this.dragChanged());
    this.gizmo.addEventListener('change', () => (this.needsRender = true));

    this.raycaster = new Raycaster();
    this.raycaster.params.Line.threshold = 0.05;
    this.boneGeo = boneGeometry();
    this.brushRing = new Mesh(
      new RingGeometry(0.94, 1, 48),
      new MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.85,
        depthTest: false,
        side: DoubleSide,
      }),
    );
    this.brushRing.renderOrder = 999;
    this.brushRing.visible = false;
    this.overlay.add(this.brushRing);
    this.boxEl = document.createElement('div');
    this.boxEl.className = 'st-box';
    this.boxEl.hidden = true;
    container.appendChild(this.boxEl);

    this.bindPointer();
    this.resize = () => {
      const w = container.clientWidth || 1;
      const h = container.clientHeight || 1;
      renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      this.needsRender = true;
    };
    this.watcher = new ResizeObserver(this.resize);
    this.watcher.observe(container);
    this.resize();
    this.last = performance.now();
    const loop = (t) => {
      this.frame = requestAnimationFrame(loop);
      const dt = Math.min(0.05, (t - this.last) / 1000);
      this.last = t;
      if (this.fly.update(dt)) this.needsRender = true;
      if (this.needsRender) {
        this.needsRender = false;
        this.render();
      }
    };
    this.frame = requestAnimationFrame(loop);
  }

  render() {
    const g = this.grid.material.uniforms;
    g.uCam.value.copy(this.camera.position);
    g.uFade.value = Math.max(40, Math.abs(this.camera.position.y) * 12);
    this.headlight.position
      .copy(this.camera.position)
      .add(new Vector3(2, 4, 1));
    this.headlight.target.position.copy(this.fly.pivot);
    this.renderer.render(this.scene, this.camera);
    this.hooks.onRender?.();
  }

  dispose() {
    cancelAnimationFrame(this.frame);
    this.watcher.disconnect();
    this.unbindPointer();
    this.fly.dispose();
    this.gizmo.detach();
    this.gizmo.dispose();
    this.scene.traverse((o) => {
      o.geometry?.dispose?.();
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) {
        if (!m) continue;
        for (const k of [
          'map',
          'roughnessMap',
          'metalnessMap',
          'aoMap',
          'bumpMap',
          'normalMap',
          'emissiveMap',
          'alphaMap',
        ])
          m[k]?.dispose?.();
        m.dispose?.();
      }
    });
    this.envMap.dispose();
    this.renderer.dispose();
    // Browsers only allow a handful of live WebGL contexts; give this one back.
    this.renderer.forceContextLoss();
    this.canvas.remove();
    this.boxEl.remove();
  }

  // ─── Syncing the document ──────────────────────────────────────────

  sync(state) {
    const prev = this.state;
    this.state = state;
    const doc = state.doc;
    const over = state.overrides ?? {};
    this.grid.visible = state.showGrid !== false;
    // Remove what's gone.
    for (const [id, n] of this.nodes)
      if (!doc.objects[id]) {
        n.node.removeFromParent();
        disposeTree(n.node);
        this.nodes.delete(id);
      }
    const cutters = this.evaluator.cutters(doc);
    this.skinned = [];
    // Build parents first so children can be attached.
    const order = [];
    const visit = (id) => {
      order.push(id);
      for (const c of doc.objects[id].children) visit(c);
    };
    for (const id of doc.roots) visit(id);
    let anyLight = false;
    for (const id of order) {
      const o = doc.objects[id];
      let n = this.nodes.get(id);
      if (!n || n.type !== o.type) {
        if (n) {
          n.node.removeFromParent();
          disposeTree(n.node);
        }
        n = { type: o.type, node: new Group() };
        n.node.userData.id = id;
        this.nodes.set(id, n);
      }
      const parent = o.parent ? this.nodes.get(o.parent)?.node : this.root;
      if (n.node.parent !== parent) parent.add(n.node);
      const ov = over.objects?.[id];
      const pos = ov?.pos ?? o.pos;
      const rot = ov?.rot ?? o.rot;
      const scl = ov?.scl ?? o.scl;
      n.node.position.set(pos[0], pos[1], pos[2]);
      n.node.rotation.set(rot[0] * RAD, rot[1] * RAD, rot[2] * RAD, 'XYZ');
      n.node.scale.set(scl[0], scl[1], scl[2]);
      const cutterShown = cutters.get(id);
      n.node.visible =
        o.visible !== false &&
        (ov?.visible ?? true) &&
        !(cutters.has(id) && !cutterShown && !state.selected.includes(id));
      if (o.type === 'mesh') this.syncMesh(o, n, state, cutters.has(id));
      else if (o.type === 'armature') this.syncArmature(o, n, state);
      else if (o.type === 'control') this.syncControl(o, n, state);
      else if (o.type === 'light') {
        this.syncLight(o, n, state);
        if (n.node.visible) anyLight = true;
      } else if (o.type === 'camera') this.syncCamera(o, n, state);
      else if (!n.pick) {
        n.pick = pickBody(0.15);
        n.pick.userData.pick = id;
        n.node.add(n.pick);
        const cross = controlGeometry('cross', 0.2);
        n.helper = new LineSegments(
          cross,
          new LineBasicMaterial({ color: 0xb0b8c8 }),
        );
        n.node.add(n.helper);
      }
    }
    // With no lights of its own the scene is lit from the camera.
    this.headlight.visible = !anyLight;
    this.hemi.intensity = anyLight ? 0.35 : 0.6;
    this.root.updateMatrixWorld(true);
    this.syncSkins(state);
    this.syncSelection(state, prev);
    this.syncEditOverlay(state);
    this.syncGhosts(state);
    this.attachGizmo(state);
    this.needsRender = true;
  }

  // Which mesh an object shows: its base mesh while it's being edited or
  // sculpted, otherwise the result of its whole stack.
  displayMesh(o, state) {
    const doc = state.doc;
    const editing =
      state.active === o.id &&
      (state.mode === 'edit' || state.mode === 'sculpt');
    if (editing)
      return {
        mesh: state.editMesh ?? this.evaluator.base(doc, o.id),
        key: `base:${o.geo}:${state.editMeshKey ?? ''}`,
      };
    return {
      mesh: this.evaluator.mesh(doc, o.id),
      key: this.evaluator.key(doc, o.id),
    };
  }

  syncMesh(o, n, state, isCutter) {
    const doc = state.doc;
    const { mesh, key } = this.displayMesh(o, state);
    const slots = Math.max(1, o.materials?.length ?? 1);
    const weightView = state.mode === 'weight' && state.active === o.id;
    const armature = o.skin?.armature ? doc.objects[o.skin.armature] : null;
    const skinned = !!(
      armature?.bones?.length &&
      o.skin &&
      !(state.mode === 'edit' && state.active === o.id) &&
      state.mode !== 'sculpt'
    );
    const geomKey = `${key}|${slots}|${skinned ? 'skin' : ''}`;
    if (n.geomKey !== geomKey || n.skinned !== skinned) {
      n.mesh?.removeFromParent();
      n.mesh?.geometry.dispose();
      const geometry = geometryFromMesh(mesh, slots);
      n.mats ??= [];
      const obj = skinned
        ? new SkinnedMesh(geometry, n.mats)
        : new Mesh(geometry, n.mats);
      obj.castShadow = true;
      obj.receiveShadow = true;
      obj.userData.pick = o.id;
      n.node.add(obj);
      n.mesh = obj;
      n.geomKey = geomKey;
      n.skinned = skinned;
      n.meshData = mesh;
      n.bindKey = null;
      n.edges?.removeFromParent();
      n.edges?.geometry.dispose();
      n.edges = null;
    }
    // Materials, one per slot, plus the outline material after them.
    const matIds = o.materials?.length ? o.materials : [doc.materialOrder[0]];
    const want = matIds.length + 1;
    while (n.mats.length < want) n.mats.push(makeMaterial());
    n.mats.length = want;
    if (!(n.mats[want - 1] instanceof MeshBasicMaterial))
      n.mats[want - 1] = outlineMaterial();
    const outlineColor = doc.materials[matIds[0]]?.outline ?? '#111111';
    n.mats[want - 1].color.set(outlineColor);
    if (isCutter) {
      n.cutterMat ??= cutterMaterial();
      n.mesh.material = n.cutterMat;
    } else if (weightView) {
      n.weightMat ??= new MeshBasicMaterial({ vertexColors: true });
      n.mesh.material = n.weightMat;
      const skin = o.skin ? remapSkin(o.skin, n.meshData) : null;
      const arr = skin?.groups[state.weightGroup] ?? null;
      const wkey = `${n.geomKey}|${state.weightGroup}|${arr ? arr.length : 0}|${state.weightVersion ?? 0}`;
      if (n.weightKey !== wkey) {
        setVertexColors(n.mesh.geometry, (vi) =>
          weightColor(arr ? arr[vi] : 0),
        );
        n.weightKey = wkey;
      }
    } else {
      n.mesh.material = n.mats;
      matIds.forEach((mid, i) => {
        const mat = doc.materials[mid];
        if (!mat) return;
        const set = mat.layers?.length ? this.textures.get(mid) : null;
        const ov = state.overrides?.materials?.[mid];
        const maps = this.mapsFor(mat, set, state);
        const mk = `${refId(mat)}|${set?.version ?? -1}|${ov ? JSON.stringify(ov) : ''}|${maps.key}`;
        n.matKeys ??= [];
        if (n.matKeys[i] !== mk) {
          applyMaterial(n.mats[i], mat, {
            overrides: ov,
            maps,
            version: set?.version ?? 0,
            flat: mat.flat,
          });
          n.matKeys[i] = mk;
        }
      });
    }
    if (o.source?.kind === 'outline') {
      // A linked outline is drawn as an inverted hull in its own colour.
      n.mesh.material = n.mats[want - 1];
      n.mats[want - 1].color.set(doc.materials[matIds[0]]?.color ?? '#111111');
      n.mesh.castShadow = false;
    }
    n.armature = skinned ? armature.id : null;
    if (skinned) this.skinned.push({ o, n, armature });
  }

  // Texture sources for a material: its layer set's canvases, or its
  // uploaded maps (decoded images kept by the page).
  mapsFor(mat, set, state) {
    const img = (id) => (id ? (state.images?.get(id) ?? null) : null);
    const m = mat.maps ?? {};
    if (set && set.map) {
      return {
        layered: true,
        color: set.canvases.color,
        orm: set.canvases.orm,
        height: mat.layers.some((l) => l.channels?.height)
          ? set.canvases.height
          : img(m.height),
        normal: img(m.normal),
        ao: img(m.ao),
        bakedAO: !!set.bakedAO,
        emissive: img(m.emissive),
        opacity: img(m.opacity),
        key: `L${Object.values(m).join(',')}|${!!set.bakedAO}`,
      };
    }
    return {
      color: img(m.color),
      rough: img(m.rough),
      metal: img(m.metal),
      ao: img(m.ao),
      height: img(m.height),
      normal: img(m.normal),
      emissive: img(m.emissive),
      opacity: img(m.opacity),
      key: `U${Object.entries(m)
        .map(([k, v]) => `${k}:${v}:${state.images?.has(v) ? 1 : 0}`)
        .join(',')}`,
    };
  }

  // ─── Armatures and skinning ────────────────────────────────────────

  syncArmature(o, n, state) {
    const show =
      state.showBones !== false &&
      (state.workspace === 'rig' ||
        state.workspace === 'animate' ||
        state.selected.includes(o.id) ||
        state.mode === 'pose' ||
        state.mode === 'bones');
    if (n.bonesKey !== o.geo || !n.bones) {
      n.boneGroup?.removeFromParent();
      n.skelRoot?.removeFromParent();
      n.boneGroup = new Group();
      n.node.add(n.boneGroup);
      n.bones = new Map();
      for (const b of o.bones) {
        const mesh = new Mesh(
          this.boneGeo,
          new MeshBasicMaterial({
            color: 0xb8bcc6,
            transparent: true,
            opacity: 0.9,
            depthTest: true,
          }),
        );
        mesh.userData.bone = { arm: o.id, bone: b.id };
        mesh.renderOrder = 5;
        n.boneGroup.add(mesh);
        n.bones.set(b.id, mesh);
      }
      // three.js bones for skinning, in the same order as o.bones.
      n.skelRoot = new Group();
      n.node.add(n.skelRoot);
      n.threeBones = new Map();
      const sorted = sortBones(o.bones);
      for (const b of sorted) {
        const tb = new Bone();
        tb.name = b.name;
        n.threeBones.set(b.id, tb);
      }
      for (const b of sorted) {
        const tb = n.threeBones.get(b.id);
        (b.parent && n.threeBones.get(b.parent)
          ? n.threeBones.get(b.parent)
          : n.skelRoot
        ).add(tb);
      }
      n.boneList = o.bones.map((b) => n.threeBones.get(b.id));
      n.bonesKey = o.geo;
    }
    n.boneGroup.visible = show;
    // Pose: stored pose, animation on top, then constraints.
    const animated = state.overrides?.bones?.[o.id];
    const pose = state.restPose ? {} : mergePose(o.pose, animated);
    const bones = applyInfluence(o.bones, state.overrides?.influence?.[o.id]);
    const controls = this.controlMatrices(state.doc, o.id, state);
    const { world } = solvePose(bones, pose, controls);
    n.posed = world;
    const selectedBones =
      state.bones?.arm === o.id ? state.bones.ids : new Set();
    for (const b of o.bones) {
      const m = world.get(b.id);
      const mesh = n.bones.get(b.id);
      if (!m || !mesh) continue;
      const l = boneLength(b);
      const p = new Vector3();
      const q = new Quaternion();
      m.decompose(p, q, new Vector3());
      mesh.position.copy(p);
      mesh.quaternion.copy(q);
      mesh.scale.set(l, l, l);
      const active = state.bones?.arm === o.id && state.bones.active === b.id;
      const sel = selectedBones.has(b.id);
      const hasIK = b.constraints?.some((c) => c.type === 'ik');
      mesh.material.color.set(
        active
          ? '#ffd0a0'
          : sel
            ? '#ff9a3c'
            : hasIK
              ? '#d8c86a'
              : b.deform === false
                ? '#7a8090'
                : '#b8bcc6',
      );
      mesh.material.opacity = state.mode === 'weight' ? 0.5 : 0.9;
    }
    // Local transforms for the three.js bones from armature-space matrices.
    for (const b of o.bones) {
      const tb = n.threeBones.get(b.id);
      const m = world.get(b.id);
      const parent = b.parent ? world.get(b.parent) : null;
      const local = parent ? parent.clone().invert().multiply(m) : m.clone();
      local.decompose(tb.position, tb.quaternion, tb.scale);
    }
  }

  // Controllers' matrices in their armature's space, for constraints.
  controlMatrices(doc, armId, state) {
    const out = new Map();
    const armWorld = worldMatrix(doc, armId, state.overrides?.objects).invert();
    for (const o of Object.values(doc.objects))
      if (o.type === 'control')
        out.set(
          o.id,
          armWorld
            .clone()
            .multiply(worldMatrix(doc, o.id, state.overrides?.objects)),
        );
    return out;
  }

  syncSkins(state) {
    for (const { o, n, armature } of this.skinned) {
      const arm = this.nodes.get(armature.id);
      if (!arm?.threeBones) {
        n.mesh.visible = false;
        continue;
      }
      n.mesh.visible = true;
      const skin = remapSkin(o.skin, n.meshData);
      const bindKey = `${n.geomKey}|${armature.geo}|${skin === o.skin ? 'same' : 'remap'}|${o.skin.n}|${matKey(n.node.matrixWorld)}|${matKey(arm.node.matrixWorld)}|${state.skinVersion ?? 0}`;
      if (n.bindKey === bindKey) continue;
      const boneIndex = new Map(armature.bones.map((b, i) => [b.name, i]));
      addSkin(n.mesh.geometry, skin, boneIndex);
      // Bind at rest: bones to their rest pose, inverses, then the pose back.
      const saved = arm.boneList.map((b) => [
        b.position.clone(),
        b.quaternion.clone(),
        b.scale.clone(),
      ]);
      const rest = new Map(armature.bones.map((b) => [b.id, restMatrix(b)]));
      for (const b of armature.bones) {
        const tb = arm.threeBones.get(b.id);
        const m = rest.get(b.id);
        const parent = b.parent ? rest.get(b.parent) : null;
        (parent ? parent.clone().invert().multiply(m) : m.clone()).decompose(
          tb.position,
          tb.quaternion,
          tb.scale,
        );
      }
      this.root.updateMatrixWorld(true);
      const skeleton = new Skeleton(arm.boneList);
      n.mesh.bind(skeleton, n.mesh.matrixWorld.clone());
      arm.boneList.forEach((b, i) => {
        b.position.copy(saved[i][0]);
        b.quaternion.copy(saved[i][1]);
        b.scale.copy(saved[i][2]);
      });
      this.root.updateMatrixWorld(true);
      n.bindKey = bindKey;
    }
  }

  syncControl(o, n, state) {
    const c = o.control;
    const key = `${c.shape}|${c.size}`;
    if (n.shapeKey !== key) {
      n.line?.removeFromParent();
      n.line?.geometry.dispose();
      n.line = new LineSegments(
        controlGeometry(c.shape, c.size),
        new LineBasicMaterial({
          color: c.color,
          depthTest: false,
          transparent: true,
        }),
      );
      n.line.renderOrder = 10;
      n.line.userData.pick = o.id;
      n.node.add(n.line);
      n.pick?.removeFromParent();
      n.pick = pickBody(c.size * 0.9);
      n.pick.userData.pick = o.id;
      n.node.add(n.pick);
      n.shapeKey = key;
    }
    const sel = state.selected.includes(o.id);
    n.line.material.color.set(sel ? '#ffffff' : c.color);
    n.line.material.opacity = sel ? 1 : 0.85;
    // FK controllers ride along with their bone.
    if (c.role?.kind === 'fk') {
      const armNode = this.nodes.get(o.parent);
      const m = armNode?.posed?.get(c.role.bone);
      if (m) {
        const p = new Vector3();
        const q = new Quaternion();
        m.decompose(p, q, new Vector3());
        n.node.position.copy(p);
        n.node.quaternion.copy(q);
        n.node.scale.set(1, 1, 1);
      }
    }
    n.node.visible = n.node.visible && state.showControls !== false;
  }

  syncLight(o, n, state) {
    const l = o.light;
    if (n.kind !== l.kind) {
      n.light?.removeFromParent();
      n.gizmo?.removeFromParent();
      n.light =
        l.kind === 'directional'
          ? new DirectionalLight()
          : l.kind === 'spot'
            ? new SpotLight()
            : l.kind === 'ambient'
              ? new AmbientLight()
              : new PointLight();
      if (n.light.target) {
        n.light.target.position.set(0, 0, -1);
        n.node.add(n.light.target);
      }
      if (l.kind === 'directional') {
        n.light.shadow.mapSize.set(1024, 1024);
        const s = n.light.shadow.camera;
        s.left = s.bottom = -12;
        s.right = s.top = 12;
        s.far = 80;
        n.light.shadow.bias = -0.0005;
        n.light.shadow.normalBias = 0.02;
      }
      n.node.add(n.light);
      n.gizmo = lightGizmo(l.kind);
      n.node.add(n.gizmo);
      n.pick?.removeFromParent();
      n.pick = pickBody(0.2);
      n.pick.userData.pick = o.id;
      n.node.add(n.pick);
      n.kind = l.kind;
    }
    n.light.color.set(l.color);
    n.light.intensity = l.intensity;
    if ('distance' in n.light) n.light.distance = l.range ?? 0;
    if ('angle' in n.light) n.light.angle = (l.angle ?? 30) * RAD;
    if ('penumbra' in n.light) n.light.penumbra = 0.3;
    n.light.castShadow = !!l.shadows && l.kind !== 'ambient';
    n.gizmo.visible = state.showHelpers !== false;
    n.gizmo.material.color.set(
      state.selected.includes(o.id) ? '#ff9a3c' : '#ffd23c',
    );
  }

  syncCamera(o, n, state) {
    const key = `${o.camera.fov}`;
    if (n.camKey !== key) {
      n.gizmo?.removeFromParent();
      n.gizmo = cameraGizmo(o.camera.fov);
      n.node.add(n.gizmo);
      n.pick?.removeFromParent();
      n.pick = pickBody(0.3);
      n.pick.userData.pick = o.id;
      n.node.add(n.pick);
      n.camKey = key;
    }
    n.gizmo.visible = state.showHelpers !== false;
    n.gizmo.material.color.set(
      state.selected.includes(o.id) ? '#ff9a3c' : '#b0b8c8',
    );
  }

  // ─── Selection outlines ────────────────────────────────────────────

  syncSelection(state) {
    for (const [id, n] of this.nodes) {
      if (n.type !== 'mesh' || !n.mesh) continue;
      const sel =
        state.selected.includes(id) &&
        state.mode !== 'edit' &&
        state.mode !== 'weight' &&
        state.mode !== 'paint';
      if (sel && !n.edges) {
        n.edges = new LineSegments(
          new EdgesGeometry(n.mesh.geometry, 30),
          new LineBasicMaterial({
            color: ORANGE,
            transparent: true,
            opacity: 0.95,
          }),
        );
        n.edges.renderOrder = 3;
        n.edges.raycast = () => {};
        n.node.add(n.edges);
      } else if (!sel && n.edges) {
        n.edges.removeFromParent();
        n.edges.geometry.dispose();
        n.edges = null;
      }
      if (n.edges) {
        n.edges.material.color.set(id === state.active ? '#ffb26b' : '#e07a20');
        // Skinned meshes move with their bones; their outline would lag behind.
        n.edges.visible = !n.skinned;
      }
    }
  }

  // ─── Edit mode ─────────────────────────────────────────────────────

  syncEditOverlay(state) {
    const on =
      state.mode === 'edit' &&
      state.active &&
      this.nodes.get(state.active)?.mesh;
    if (!on) {
      if (this.edit) {
        this.edit.group.removeFromParent();
        disposeTree(this.edit.group);
        this.edit = null;
      }
      return;
    }
    const n = this.nodes.get(state.active);
    const mesh = n.meshData;
    const sel = state.edit;
    const key = `${n.geomKey}|${sel.version}|${sel.mode}|${state.xray}`;
    if (this.edit?.key === key && this.edit.node === n.node) return;
    if (this.edit) {
      this.edit.group.removeFromParent();
      disposeTree(this.edit.group);
    }
    const group = new Group();
    const em = [...edgeMap(mesh).entries()];
    // Edges
    const ep = new Float32Array(em.length * 6);
    const ec = new Float32Array(em.length * 6);
    em.forEach(([k, e], i) => {
      ep.set(mesh.v[e.a], i * 6);
      ep.set(mesh.v[e.b], i * 6 + 3);
      const hot =
        sel.edges.has(k) || (sel.verts.has(e.a) && sel.verts.has(e.b));
      const c = hot ? [1, 0.6, 0.24] : [0.08, 0.08, 0.1];
      ec.set(c, i * 6);
      ec.set(c, i * 6 + 3);
    });
    const eg = new BufferGeometry();
    eg.setAttribute('position', new BufferAttribute(ep, 3));
    eg.setAttribute('color', new BufferAttribute(ec, 3));
    const lines = new LineSegments(
      eg,
      new LineBasicMaterial({
        vertexColors: true,
        depthTest: !state.xray,
        transparent: true,
        opacity: 0.95,
      }),
    );
    lines.renderOrder = 6;
    group.add(lines);
    // Vertices
    if (sel.mode === 'vert') {
      const vp = new Float32Array(mesh.v.length * 3);
      const vc = new Float32Array(mesh.v.length * 3);
      mesh.v.forEach((p, i) => {
        vp.set(p, i * 3);
        vc.set(sel.verts.has(i) ? [1, 0.6, 0.24] : [0.05, 0.05, 0.06], i * 3);
      });
      const vg = new BufferGeometry();
      vg.setAttribute('position', new BufferAttribute(vp, 3));
      vg.setAttribute('color', new BufferAttribute(vc, 3));
      const pts = new Points(
        vg,
        new PointsMaterial({
          size: 6,
          sizeAttenuation: false,
          vertexColors: true,
          depthTest: !state.xray,
        }),
      );
      pts.renderOrder = 7;
      group.add(pts);
    }
    // Selected faces
    const fp = [];
    const faceSel = sel.mode === 'face' ? sel.faces : new Set([...sel.faces]);
    for (const fi of faceSel) {
      const f = mesh.f[fi];
      if (!f) continue;
      for (const [a, b, c] of triangulateFace(mesh, f))
        fp.push(...mesh.v[f.v[a]], ...mesh.v[f.v[b]], ...mesh.v[f.v[c]]);
    }
    if (fp.length) {
      const fg = new BufferGeometry();
      fg.setAttribute('position', new Float32BufferAttribute(fp, 3));
      const faces = new Mesh(
        fg,
        new MeshBasicMaterial({
          color: ORANGE,
          transparent: true,
          opacity: 0.28,
          depthTest: !state.xray,
          side: DoubleSide,
          polygonOffset: true,
          polygonOffsetFactor: -2,
          polygonOffsetUnits: -2,
        }),
      );
      faces.renderOrder = 4;
      group.add(faces);
    }
    for (const c of group.children) c.raycast = () => {};
    n.node.add(group);
    this.edit = { group, key, node: n.node, edges: em, mesh };
  }

  // ─── Onion skinning ────────────────────────────────────────────────

  syncGhosts(state) {
    const key = state.onion?.key ?? null;
    if (this.ghostKey === key) return;
    this.ghostKey = key;
    this.ghosts?.removeFromParent();
    this.ghosts = null;
    if (!state.onion?.frames?.length) return;
    const group = new Group();
    const doc = state.doc;
    for (const g of state.onion.frames) {
      const mat = new MeshBasicMaterial({
        color: g.tint,
        transparent: true,
        opacity: g.opacity,
        depthWrite: false,
      });
      for (const { n, armature } of this.skinned) {
        const pose = mergePose(armature.pose, g.overrides.bones?.[armature.id]);
        const { world } = solvePose(
          armature.bones,
          pose,
          this.controlMatrices(doc, armature.id, { overrides: g.overrides }),
        );
        const bones = armature.bones.map((b) => {
          const tb = new Bone();
          const m = world.get(b.id);
          const parent = b.parent ? world.get(b.parent) : null;
          (parent ? parent.clone().invert().multiply(m) : m.clone()).decompose(
            tb.position,
            tb.quaternion,
            tb.scale,
          );
          return tb;
        });
        const holder = new Group();
        holder.matrixAutoUpdate = false;
        holder.matrix.copy(worldMatrix(doc, armature.id, g.overrides.objects));
        armature.bones.forEach((b, i) => {
          const p = b.parent
            ? armature.bones.findIndex((x) => x.id === b.parent)
            : -1;
          (p >= 0 ? bones[p] : holder).add(bones[i]);
        });
        const ghost = new SkinnedMesh(n.mesh.geometry, mat);
        ghost.bindMode = 'detached';
        group.add(holder);
        holder.updateMatrixWorld(true);
        ghost.bind(
          new Skeleton(bones, n.mesh.skeleton.boneInverses),
          n.mesh.bindMatrix,
        );
        group.add(ghost);
      }
      for (const [id, n] of this.nodes) {
        if (
          n.type !== 'mesh' ||
          n.skinned ||
          !n.mesh ||
          !g.overrides.objects?.[id]
        )
          continue;
        const ghost = new Mesh(n.mesh.geometry, mat);
        ghost.matrixAutoUpdate = false;
        ghost.matrix.copy(worldMatrix(doc, id, g.overrides.objects));
        group.add(ghost);
      }
    }
    for (const c of group.children) c.raycast = () => {};
    this.scene.add(group);
    this.ghosts = group;
  }

  // ─── Gizmo ─────────────────────────────────────────────────────────

  attachGizmo(state) {
    if (this.dragging) return;
    const tool = state.tool;
    const target = this.gizmoTarget(state);
    if (!target || !['move', 'rotate', 'scale'].includes(tool)) {
      this.gizmo.detach();
      this.gizmoKind = null;
      return;
    }
    this.gizmo.setMode(
      { move: 'translate', rotate: 'rotate', scale: 'scale' }[tool],
    );
    this.gizmo.setSpace(state.space === 'local' ? 'local' : 'world');
    this.gizmo.showX = state.axes?.x !== false;
    this.gizmo.showY = state.axes?.y !== false;
    this.gizmo.showZ = state.axes?.z !== false;
    const snap = state.snap ?? {};
    this.gizmo.setTranslationSnap(snap.grid ? snap.gridSize || 0.25 : null);
    this.gizmo.setRotationSnap(
      snap.rotate ? (snap.rotateStep || 15) * RAD : null,
    );
    this.gizmo.setScaleSnap(snap.grid ? 0.1 : null);
    this.proxy.position.copy(target.position);
    this.proxy.quaternion.copy(target.quaternion);
    this.proxy.scale.set(1, 1, 1);
    this.proxy.updateMatrixWorld(true);
    this.gizmoKind = target.kind;
    this.gizmo.attach(this.proxy);
  }

  gizmoTarget(state) {
    const doc = state.doc;
    if (state.mode === 'edit') {
      const n = this.nodes.get(state.active);
      const verts = state.edit?.all;
      if (!n?.meshData || !verts?.size) return null;
      const c = new Vector3();
      for (const i of verts) c.add(new Vector3(...n.meshData.v[i]));
      c.divideScalar(verts.size).applyMatrix4(n.node.matrixWorld);
      return {
        kind: 'verts',
        position: c,
        quaternion:
          state.space === 'local'
            ? n.node.getWorldQuaternion(new Quaternion())
            : new Quaternion(),
      };
    }
    if (
      (state.mode === 'pose' || state.mode === 'bones') &&
      state.bones?.active
    ) {
      const arm = this.nodes.get(state.bones.arm);
      const armObj = doc.objects[state.bones.arm];
      const bone = armObj?.bones.find((b) => b.id === state.bones.active);
      if (!arm || !bone) return null;
      const m =
        state.mode === 'pose' ? arm.posed?.get(bone.id) : restMatrix(bone);
      if (!m) return null;
      const w = arm.node.matrixWorld.clone().multiply(m);
      const p = new Vector3();
      const q = new Quaternion();
      w.decompose(p, q, new Vector3());
      if (state.mode === 'bones' && state.boneEnd === 'tail')
        p.copy(new Vector3(...bone.tail).applyMatrix4(arm.node.matrixWorld));
      return {
        kind: state.mode === 'pose' ? 'pose' : 'bones',
        position: p,
        quaternion:
          state.space === 'local' || state.mode === 'pose'
            ? q
            : new Quaternion(),
      };
    }
    if (state.mode !== 'object' && state.mode !== 'pose') return null;
    const ids = state.selected.filter(
      (id) =>
        doc.objects[id] &&
        !doc.objects[id].locked &&
        !(
          doc.objects[id].type === 'control' &&
          doc.objects[id].control.role?.kind === 'fk'
        ),
    );
    if (!ids.length) return null;
    const active = ids.includes(state.active) ? state.active : ids[0];
    const pos = new Vector3();
    for (const id of ids)
      pos.add(new Vector3().setFromMatrixPosition(this.worldOf(id)));
    pos.divideScalar(ids.length);
    const q = new Quaternion();
    if (state.space === 'local')
      this.worldOf(active).decompose(new Vector3(), q, new Vector3());
    return { kind: 'objects', position: pos, quaternion: q, ids };
  }

  worldOf(id) {
    const n = this.nodes.get(id);
    return n ? n.node.matrixWorld.clone() : new Matrix4();
  }

  beginDrag() {
    const state = this.state;
    this.dragging = true;
    this.hooks.onDragStart?.();
    const start = {
      proxy: this.proxy.matrixWorld.clone(),
      kind: this.gizmoKind,
    };
    if (start.kind === 'objects') {
      const ids = this.gizmoTarget(state).ids;
      // Moving a parent moves its children; don't move them twice.
      start.ids = ids.filter(
        (id) =>
          !ids.some(
            (other) => other !== id && isAncestor(state.doc, other, id),
          ),
      );
      start.world = new Map(start.ids.map((id) => [id, this.worldOf(id)]));
      start.parentWorld = new Map(
        start.ids.map((id) => {
          const p = state.doc.objects[id].parent;
          return [id, p ? this.worldOf(p) : new Matrix4()];
        }),
      );
      // Vertex snapping grabs the selection by its vertex nearest the cursor.
      if (state.snap?.vertex)
        start.grab = this.nearestVertex(
          this.pointerPx,
          new Set(start.ids),
          true,
        );
    } else if (start.kind === 'verts') {
      const n = this.nodes.get(state.active);
      start.mesh = n.meshData;
      start.objWorld = n.node.matrixWorld.clone();
      start.verts = state.edit.all;
    } else if (start.kind === 'pose' || start.kind === 'bones') {
      const arm = this.nodes.get(state.bones.arm);
      const armObj = state.doc.objects[state.bones.arm];
      start.armWorld = arm.node.matrixWorld.clone();
      start.bone = armObj.bones.find((b) => b.id === state.bones.active);
      start.bones = armObj.bones;
      start.posed = arm.posed;
      start.selectedBones = state.bones.ids;
    }
    this.dragStart = start;
  }

  dragChanged() {
    const s = this.dragStart;
    if (!s) return;
    const state = this.state;
    if (s.kind === 'objects' && this.gizmo.mode === 'translate')
      this.applySnaps(s, state);
    const delta = this.proxy.matrixWorld
      .clone()
      .multiply(s.proxy.clone().invert());
    this.emitDrag(delta, false);
  }

  applySnaps(s, state) {
    const snap = state.snap ?? {};
    if (snap.surface) {
      const hit = this.raycastScene(
        this.pointer,
        (id) =>
          !s.ids.includes(id) &&
          !s.ids.some((x) => isAncestor(state.doc, x, id)),
      );
      if (hit) {
        const n = hit.face
          ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
          : new Vector3(0, 1, 0);
        // Rest the object on the surface: its box's extent along the normal.
        const id = s.ids[0];
        const node = this.nodes.get(id);
        let offset = 0;
        const mesh = node?.meshData;
        if (mesh?.v.length) {
          const w = s.world.get(id);
          const origin = new Vector3().setFromMatrixPosition(w);
          let lowest = Infinity;
          for (const v of mesh.v)
            lowest = Math.min(
              lowest,
              new Vector3(...v).applyMatrix4(w).sub(origin).dot(n),
            );
          offset = -lowest;
        }
        this.proxy.position.copy(hit.point).addScaledVector(n, offset);
        this.proxy.updateMatrixWorld(true);
      } else if (this.pointerOnGround()) {
        // Nothing under the cursor: rest on the ground grid.
        const g = this.pointerOnGround();
        this.proxy.position.set(g.x, this.proxy.position.y, g.z);
        this.proxy.updateMatrixWorld(true);
      }
    }
    if (snap.vertex && s.grab) {
      const target = this.nearestVertex(this.pointerPx, new Set(s.ids), false);
      if (target) {
        const delta = this.proxy.matrixWorld
          .clone()
          .multiply(s.proxy.clone().invert());
        const grabNow = s.grab.world.clone().applyMatrix4(delta);
        this.proxy.position.add(target.world.clone().sub(grabNow));
        this.proxy.updateMatrixWorld(true);
      }
    }
  }

  emitDrag(delta, final) {
    const s = this.dragStart;
    const state = this.state;
    if (s.kind === 'objects') {
      const patches = [];
      for (const id of s.ids) {
        const world = delta.clone().multiply(s.world.get(id));
        const local = s.parentWorld.get(id).clone().invert().multiply(world);
        patches.push([id, trsOf(local)]);
      }
      this.hooks.onTransform({ kind: 'objects', patches, final });
    } else if (s.kind === 'verts') {
      const local = s.objWorld
        .clone()
        .invert()
        .multiply(delta)
        .multiply(s.objWorld);
      const v = s.mesh.v.map((p, i) =>
        s.verts.has(i) ? new Vector3(...p).applyMatrix4(local).toArray() : p,
      );
      this.hooks.onTransform({
        kind: 'verts',
        id: state.active,
        mesh: { v, f: s.mesh.f },
        final,
      });
    } else if (s.kind === 'pose') {
      const localDelta = s.armWorld
        .clone()
        .invert()
        .multiply(delta)
        .multiply(s.armWorld);
      const out = {};
      const ids = s.selectedBones?.size
        ? s.selectedBones
        : new Set([s.bone.id]);
      for (const id of ids) {
        const bone = s.bones.find((b) => b.id === id);
        const startM = s.posed.get(id);
        if (!bone || !startM) continue;
        // Rotation happens about the bone's own head.
        const head = new Vector3().setFromMatrixPosition(startM);
        const pivotDelta = new Matrix4()
          .makeTranslation(head.x, head.y, head.z)
          .multiply(
            stripTranslation(localDelta, this.gizmo.mode === 'translate'),
          )
          .multiply(new Matrix4().makeTranslation(-head.x, -head.y, -head.z));
        const next = (this.gizmo.mode === 'translate' ? localDelta : pivotDelta)
          .clone()
          .multiply(startM);
        const parent = bone.parent ? s.posed.get(bone.parent) : null;
        out[id] = poseFromWorld(bone, s.bones, next, parent);
      }
      this.hooks.onTransform({
        kind: 'pose',
        arm: state.bones.arm,
        poses: out,
        final,
      });
    } else if (s.kind === 'bones') {
      const localDelta = s.armWorld
        .clone()
        .invert()
        .multiply(delta)
        .multiply(s.armWorld);
      const b = s.bone;
      const end = state.boneEnd ?? 'both';
      const head =
        end === 'tail'
          ? b.head
          : new Vector3(...b.head).applyMatrix4(localDelta).toArray();
      const tail =
        end === 'head'
          ? b.tail
          : new Vector3(...b.tail).applyMatrix4(localDelta).toArray();
      this.hooks.onTransform({
        kind: 'bones',
        arm: state.bones.arm,
        bone: b.id,
        head,
        tail,
        final,
      });
    }
  }

  endDrag() {
    if (!this.dragStart) return;
    const delta = this.proxy.matrixWorld
      .clone()
      .multiply(this.dragStart.proxy.clone().invert());
    this.emitDrag(delta, true);
    this.dragStart = null;
    this.dragging = false;
    this.hooks.onDragEnd?.();
  }

  // ─── Picking ───────────────────────────────────────────────────────

  setPointer(e) {
    const r = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((e.clientX - r.left) / r.width) * 2 - 1,
      -((e.clientY - r.top) / r.height) * 2 + 1,
    );
    this.pointerPx = [e.clientX - r.left, e.clientY - r.top];
  }

  pickables(filter = () => true) {
    const out = [];
    this.root.traverseVisible((o) => {
      const id = o.userData.pick;
      if (id && filter(id)) out.push(o);
      if (o.userData.bone && o.parent?.visible) out.push(o);
    });
    return out;
  }

  raycastScene(ndc, filter = () => true, { bones = false } = {}) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = this.pickables(filter).filter(
      (o) => (bones ? true : !o.userData.bone) && (o.isMesh || o.isLine),
    );
    const hits = this.raycaster.intersectObjects(list, false);
    return hits[0] ?? null;
  }

  pickDepth(ndc) {
    const hit = this.raycastScene(new Vector2(...ndc));
    if (hit) return hit.distance;
    const g = this.groundAt(new Vector2(...ndc));
    return g ? g.distanceTo(this.camera.position) : null;
  }

  groundAt(ndc) {
    this.raycaster.setFromCamera(ndc, this.camera);
    const r = this.raycaster.ray;
    if (Math.abs(r.direction.y) < 1e-6) return null;
    const t = -r.origin.y / r.direction.y;
    return t > 0 ? r.origin.clone().addScaledVector(r.direction, t) : null;
  }

  pointerOnGround() {
    return this.groundAt(this.pointer);
  }

  // What's under the cursor: a bone, a controller, an object.
  pick(ndc) {
    const state = this.state;
    this.raycaster.setFromCamera(ndc, this.camera);
    const list = this.pickables();
    const hits = this.raycaster.intersectObjects(list, false);
    const cutters = this.evaluator.cutters(state.doc);
    for (const h of hits) {
      if (h.object.userData.bone) {
        if (
          state.workspace === 'rig' ||
          state.workspace === 'animate' ||
          state.mode === 'pose' ||
          state.mode === 'bones'
        )
          return { kind: 'bone', ...h.object.userData.bone };
        continue;
      }
      const id = h.object.userData.pick;
      if (cutters.has(id) && !cutters.get(id) && !state.selected.includes(id))
        continue;
      return { kind: 'object', id, point: h.point, face: h.faceIndex };
    }
    return { kind: 'none' };
  }

  // Edit mode: the vertex, edge or face under the cursor.
  pickElement(px) {
    const state = this.state;
    const n = this.nodes.get(state.active);
    if (!n?.meshData) return null;
    const mesh = n.meshData;
    const m = n.node.matrixWorld;
    const mode = state.edit.mode;
    const front = this.frontFacing(n);
    if (mode === 'vert') {
      let best = null;
      let bd = 12;
      mesh.v.forEach((p, i) => {
        if (!state.xray && !front.has(i)) return;
        const s = this.toScreen(new Vector3(...p).applyMatrix4(m));
        if (!s) return;
        const d = Math.hypot(s[0] - px[0], s[1] - px[1]);
        if (d < bd) {
          bd = d;
          best = i;
        }
      });
      return best === null ? null : { kind: 'vert', index: best };
    }
    if (mode === 'edge') {
      let best = null;
      let bd = 10;
      for (const [key, e] of this.edit?.edges ?? edgeMap(mesh)) {
        if (!state.xray && !(front.has(e.a) || front.has(e.b))) continue;
        const a = this.toScreen(new Vector3(...mesh.v[e.a]).applyMatrix4(m));
        const b = this.toScreen(new Vector3(...mesh.v[e.b]).applyMatrix4(m));
        if (!a || !b) continue;
        const d = segDist2D(px, a, b);
        if (d < bd) {
          bd = d;
          best = key;
        }
      }
      return best === null ? null : { kind: 'edge', key: best };
    }
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hit = this.raycaster.intersectObject(n.mesh, false)[0];
    if (!hit) return null;
    const fi = n.mesh.geometry.userData.buffers.triFace[hit.faceIndex];
    return { kind: 'face', index: fi };
  }

  // Vertices whose normal faces the camera (a cheap stand-in for visibility).
  frontFacing(n) {
    const mesh = n.meshData;
    const key = `${n.geomKey}|${matKey(this.camera.matrixWorld)}`;
    if (n.frontKey === key) return n.front;
    const inv = n.node.matrixWorld.clone().invert();
    const cam = this.camera.position.clone().applyMatrix4(inv);
    const normals = vertexNormals(mesh);
    const out = new Set();
    mesh.v.forEach((p, i) => {
      const nn = normals[i];
      if (
        (cam.x - p[0]) * nn[0] +
          (cam.y - p[1]) * nn[1] +
          (cam.z - p[2]) * nn[2] >
        0
      )
        out.add(i);
    });
    n.front = out;
    n.frontKey = key;
    return out;
  }

  toScreen(world) {
    const p = world.clone().project(this.camera);
    if (p.z > 1 || p.z < -1) return null;
    return [
      ((p.x + 1) / 2) * this.canvas.clientWidth,
      ((1 - p.y) / 2) * this.canvas.clientHeight,
    ];
  }

  // A function placing points of an object's own space on screen (0..1, y down).
  projector(id) {
    const n = this.nodes.get(id);
    if (!n) return () => null;
    const m = new Matrix4()
      .multiplyMatrices(
        this.camera.projectionMatrix,
        this.camera.matrixWorldInverse,
      )
      .multiply(n.node.matrixWorld);
    const e = m.elements;
    return (x, y, z) => {
      const w = e[3] * x + e[7] * y + e[11] * z + e[15];
      if (w <= 1e-6) return null;
      const sx = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
      const sy = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
      return [(sx + 1) / 2, (1 - sy) / 2];
    };
  }

  nearestVertex(px, exclude, inside) {
    let best = null;
    let bd = 16;
    for (const [id, n] of this.nodes) {
      if (n.type !== 'mesh' || !n.meshData || !n.node.visible) continue;
      if (inside ? !exclude.has(id) : exclude.has(id)) continue;
      if (n.meshData.v.length > 40000) continue;
      const m = n.node.matrixWorld;
      for (const p of n.meshData.v) {
        const w = new Vector3(...p).applyMatrix4(m);
        const s = this.toScreen(w);
        if (!s) continue;
        const d = Math.hypot(s[0] - px[0], s[1] - px[1]);
        if (d < bd || (inside && !best)) {
          bd = Math.min(bd, d);
          best = { world: w, id };
        }
      }
    }
    return best;
  }

  // Brush hits on the active object, in its own space.
  brushHit(ndc) {
    const state = this.state;
    const n = this.nodes.get(state.active);
    if (!n?.mesh) return null;
    this.raycaster.setFromCamera(ndc, this.camera);
    const hit = this.raycaster.intersectObject(n.mesh, false)[0];
    if (!hit) return null;
    return this.describeHit(n, hit);
  }

  describeHit(n, hit) {
    const inv = n.node.matrixWorld.clone().invert();
    const local = hit.point.clone().applyMatrix4(inv);
    const normal = hit.face ? hit.face.normal.clone() : new Vector3(0, 1, 0);
    const worldNormal = normal.clone().transformDirection(n.node.matrixWorld);
    const camLocal = this.camera.position.clone().applyMatrix4(inv);
    const s = new Vector3();
    n.node.matrixWorld.decompose(new Vector3(), new Quaternion(), s);
    const scale = Math.max(s.x, s.y, s.z) || 1;
    const perPx =
      (2 * hit.distance * Math.tan((this.camera.fov * RAD) / 2)) /
      (this.canvas.clientHeight || 1);
    return {
      id: n.node.userData.id,
      point: local.toArray(),
      world: hit.point.clone(),
      normal: normal.toArray(),
      worldNormal,
      uv: hit.uv ? [hit.uv.x, hit.uv.y] : null,
      face: n.mesh.geometry.userData.buffers?.triFace[hit.faceIndex] ?? null,
      camera: camLocal.toArray(),
      facing: camLocal.clone().sub(local).normalize().toArray(),
      localPerPx: perPx / scale,
      screen: [(this.pointer.x + 1) / 2, (1 - this.pointer.y) / 2],
      distance: hit.distance,
      up: new Vector3(0, 1, 0)
        .applyQuaternion(this.camera.quaternion)
        .transformDirection(inv)
        .toArray(),
    };
  }

  // Where the cursor is on the plane through `worldPoint` facing the camera,
  // in the active object's space (grab brushes move along it).
  planePoint(worldPoint) {
    const n = this.nodes.get(this.state.active);
    if (!n) return null;
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const normal = new Vector3(0, 0, -1).applyQuaternion(
      this.camera.quaternion,
    );
    const denom = this.raycaster.ray.direction.dot(normal);
    if (Math.abs(denom) < 1e-6) return null;
    const t =
      worldPoint.clone().sub(this.raycaster.ray.origin).dot(normal) / denom;
    const p = this.raycaster.ray.origin
      .clone()
      .addScaledVector(this.raycaster.ray.direction, t);
    return {
      world: p,
      local: p
        .clone()
        .applyMatrix4(n.node.matrixWorld.clone().invert())
        .toArray(),
    };
  }

  showBrush(hit, radiusPx) {
    if (!hit) {
      if (this.brushRing.visible) {
        this.brushRing.visible = false;
        this.needsRender = true;
      }
      return;
    }
    const r = radiusPx * hit.localPerPx;
    const n = this.nodes.get(hit.id);
    const s = new Vector3();
    n.node.matrixWorld.decompose(new Vector3(), new Quaternion(), s);
    const worldR = r * Math.max(s.x, s.y, s.z);
    this.brushRing.position
      .copy(hit.world)
      .addScaledVector(hit.worldNormal, 0.002);
    this.brushRing.quaternion.setFromUnitVectors(
      new Vector3(0, 0, 1),
      hit.worldNormal,
    );
    this.brushRing.scale.setScalar(worldR);
    this.brushRing.visible = true;
    this.needsRender = true;
  }

  bindPointer() {
    this.onDown = (e) => this.pointerDown(e);
    this.onMove = (e) => this.pointerMove(e);
    this.onUp = (e) => this.pointerUp(e);
    this.onLeave = () => this.showBrush(null);
    this.canvas.addEventListener('pointerdown', this.onDown);
    this.canvas.addEventListener('pointerleave', this.onLeave);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
  }

  unbindPointer() {
    this.canvas.removeEventListener('pointerdown', this.onDown);
    this.canvas.removeEventListener('pointerleave', this.onLeave);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
  }

  brushMode() {
    const m = this.state?.mode;
    return m === 'sculpt' || m === 'paint' || m === 'weight';
  }

  pointerDown(e) {
    if (!this.state) return;
    this.setPointer(e);
    this.canvas.focus({ preventScroll: true });
    if (e.button !== 0 || e.altKey) return;
    if (this.gizmo.object && this.gizmo.axis) return;
    if (this.brushMode()) {
      const hit = this.brushHit(this.pointer);
      this.stroke = { hit, start: hit?.world ?? null, last: hit };
      capture(this.canvas, e.pointerId);
      this.hooks.onBrush?.('start', hit, {
        event: e,
        screen: [(this.pointer.x + 1) / 2, (1 - this.pointer.y) / 2],
      });
      return;
    }
    this.press = {
      x: this.pointerPx[0],
      y: this.pointerPx[1],
      shift: e.shiftKey,
      ctrl: e.ctrlKey || e.metaKey,
      box: false,
    };
  }

  pointerMove(e) {
    if (!this.state) return;
    const inside = e.target === this.canvas || this.stroke || this.press;
    this.setPointer(e);
    if (this.stroke) {
      let hit = this.brushHit(this.pointer);
      const plane = this.stroke.start
        ? this.planePoint(this.stroke.start)
        : null;
      this.hooks.onBrush?.('move', hit, {
        event: e,
        plane,
        screen: [(this.pointer.x + 1) / 2, (1 - this.pointer.y) / 2],
      });
      if (hit) this.stroke.last = hit;
      this.showBrush(hit, this.state.brushRadius ?? 30);
      return;
    }
    if (this.press) {
      const dx = this.pointerPx[0] - this.press.x;
      const dy = this.pointerPx[1] - this.press.y;
      if (
        !this.press.box &&
        Math.hypot(dx, dy) > 5 &&
        this.state.tool === 'select' &&
        !this.dragging
      )
        this.press.box = true;
      if (this.press.box) {
        const x0 = Math.min(this.press.x, this.pointerPx[0]);
        const y0 = Math.min(this.press.y, this.pointerPx[1]);
        Object.assign(this.boxEl.style, {
          left: `${x0}px`,
          top: `${y0}px`,
          width: `${Math.abs(dx)}px`,
          height: `${Math.abs(dy)}px`,
        });
        this.boxEl.hidden = false;
      }
      return;
    }
    if (inside && this.brushMode() && !e.buttons)
      this.showBrush(this.brushHit(this.pointer), this.state.brushRadius ?? 30);
  }

  pointerUp(e) {
    if (this.stroke) {
      this.setPointer(e);
      this.hooks.onBrush?.('end', this.stroke.last, {
        event: e,
        screen: [(this.pointer.x + 1) / 2, (1 - this.pointer.y) / 2],
      });
      this.stroke = null;
      return;
    }
    const p = this.press;
    this.press = null;
    if (!p || this.dragging) return;
    this.boxEl.hidden = true;
    const mods = { shift: p.shift, ctrl: p.ctrl };
    if (p.box) {
      const rect = [
        Math.min(p.x, this.pointerPx[0]),
        Math.min(p.y, this.pointerPx[1]),
        Math.max(p.x, this.pointerPx[0]),
        Math.max(p.y, this.pointerPx[1]),
      ];
      this.hooks.onBox?.(this.boxContents(rect), mods);
      return;
    }
    if (this.state.mode === 'edit') {
      this.hooks.onEditPick?.(this.pickElement(this.pointerPx), mods);
      return;
    }
    this.hooks.onPick?.(this.pick(this.pointer), mods);
  }

  // What a dragged rectangle takes in: objects (by their centre), or in
  // edit mode vertices, edges and faces.
  boxContents([x0, y0, x1, y1]) {
    const state = this.state;
    const inside = (s) =>
      s && s[0] >= x0 && s[0] <= x1 && s[1] >= y0 && s[1] <= y1;
    if (state.mode === 'edit') {
      const n = this.nodes.get(state.active);
      if (!n?.meshData)
        return { kind: 'elements', verts: [], edges: [], faces: [] };
      const mesh = n.meshData;
      const m = n.node.matrixWorld;
      const front = this.frontFacing(n);
      const verts = [];
      mesh.v.forEach((p, i) => {
        if (
          (state.xray || front.has(i)) &&
          inside(this.toScreen(new Vector3(...p).applyMatrix4(m)))
        )
          verts.push(i);
      });
      const vs = new Set(verts);
      const edges = [...edgeMap(mesh).entries()]
        .filter(([, e]) => vs.has(e.a) && vs.has(e.b))
        .map(([k]) => k);
      const faces = [];
      mesh.f.forEach((f, fi) => {
        if (
          f.v.every((i) => vs.has(i)) ||
          (state.edit.mode === 'face' &&
            inside(
              this.toScreen(
                new Vector3(...faceCenter(mesh, f)).applyMatrix4(m),
              ),
            ) &&
            (state.xray || f.v.some((i) => front.has(i))))
        )
          faces.push(fi);
      });
      return { kind: 'elements', verts, edges, faces };
    }
    const ids = [];
    for (const [id, n] of this.nodes) {
      if (!n.node.visible || !isShown(n.node)) continue;
      const c = new Vector3();
      if (n.mesh?.geometry.boundingBox)
        n.mesh.geometry.boundingBox
          .getCenter(c)
          .applyMatrix4(n.node.matrixWorld);
      else c.setFromMatrixPosition(n.node.matrixWorld);
      if (inside(this.toScreen(c))) ids.push(id);
    }
    return { kind: 'objects', ids };
  }

  // ─── Sculpt preview ────────────────────────────────────────────────

  // Moves the displayed vertices of the active object without a rebuild.
  previewPositions(id, mesh, moved) {
    const n = this.nodes.get(id);
    if (!n?.mesh) return;
    const g = n.mesh.geometry;
    const b = g.userData.buffers;
    const pos = g.getAttribute('position');
    if (!n.vertToBuf) {
      n.vertToBuf = new Map();
      for (let i = 0; i < b.vert.length; i++) {
        const v = b.vert[i];
        if (!n.vertToBuf.has(v)) n.vertToBuf.set(v, []);
        n.vertToBuf.get(v).push(i);
      }
    }
    for (const v of moved ?? mesh.v.keys()) {
      const p = mesh.v[v];
      for (const i of n.vertToBuf.get(v) ?? []) pos.setXYZ(i, p[0], p[1], p[2]);
    }
    pos.needsUpdate = true;
    n.meshData = mesh;
    const now = performance.now();
    if (!n.lastNormals || now - n.lastNormals > 60) {
      g.computeVertexNormals();
      n.lastNormals = now;
    }
    g.computeBoundingSphere();
    this.needsRender = true;
  }

  forgetPreview(id) {
    const n = this.nodes.get(id);
    if (n) {
      n.vertToBuf = null;
      n.geomKey = null;
    }
  }

  // ─── Views ─────────────────────────────────────────────────────────

  focusOn(ids) {
    const box = {
      min: new Vector3(Infinity, Infinity, Infinity),
      max: new Vector3(-Infinity, -Infinity, -Infinity),
    };
    let any = false;
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (!n) continue;
      n.node.updateWorldMatrix(true, true);
      if (n.mesh?.geometry.boundingBox) {
        const b = n.mesh.geometry.boundingBox
          .clone()
          .applyMatrix4(n.node.matrixWorld);
        box.min.min(b.min);
        box.max.max(b.max);
      } else {
        const p = new Vector3().setFromMatrixPosition(n.node.matrixWorld);
        box.min.min(p.clone().subScalar(0.5));
        box.max.max(p.clone().addScalar(0.5));
      }
      any = true;
    }
    if (!any) {
      box.min.set(-1, 0, -1);
      box.max.set(1, 1.5, 1);
    }
    const center = box.min.clone().add(box.max).multiplyScalar(0.5);
    const radius = Math.max(0.2, box.max.distanceTo(box.min) / 2);
    this.fly.frame(center, radius);
  }

  focusPoint(world, radius = 0.5) {
    this.fly.frame(world, radius);
  }

  setView(name) {
    const dirs = {
      front: [0, 0, 1],
      back: [0, 0, -1],
      right: [1, 0, 0],
      left: [-1, 0, 0],
      top: [0, 1, 0.0001],
      bottom: [0, -1, 0.0001],
      persp: [1, 0.8, 1.2],
    };
    this.fly.setView(new Vector3(...(dirs[name] ?? dirs.persp)));
  }

  snapshot(width = 512, height = 512) {
    this.render();
    const c = document.createElement('canvas');
    c.width = width;
    c.height = height;
    const src = this.canvas;
    const s = Math.min(src.width / width, src.height / height);
    c.getContext('2d').drawImage(
      src,
      (src.width - width * s) / 2,
      (src.height - height * s) / 2,
      width * s,
      height * s,
      0,
      0,
      width,
      height,
    );
    return c;
  }

  // Posed bone matrices in world space (for the page's bone tools).
  boneWorld(armId, boneId) {
    const n = this.nodes.get(armId);
    const m = n?.posed?.get(boneId);
    return m ? n.node.matrixWorld.clone().multiply(m) : null;
  }

  invalidate() {
    this.needsRender = true;
  }

  // A texture set's canvases were painted on: re-upload the textures made from them.
  touchTextures(set) {
    const canvases = new Set(Object.values(set.canvases));
    this.root.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material])
        for (const k of [
          'map',
          'roughnessMap',
          'metalnessMap',
          'aoMap',
          'bumpMap',
        ])
          if (m?.[k] && canvases.has(m[k].image)) {
            m[k].needsUpdate = true;
            m[k].userData.version = set.version;
          }
    });
    this.needsRender = true;
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────

function disposeTree(node) {
  node.traverse((o) => {
    if (o.userData?.shared) return;
    o.geometry?.dispose?.();
  });
}

function isShown(o) {
  for (let p = o; p; p = p.parent) if (!p.visible) return false;
  return true;
}

function isAncestor(doc, a, b) {
  let p = doc.objects[b]?.parent;
  while (p) {
    if (p === a) return true;
    p = doc.objects[p]?.parent;
  }
  return false;
}

function segDist2D(p, a, b) {
  const dx = b[0] - a[0],
    dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2
    ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2))
    : 0;
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
}

function stripTranslation(m, keep) {
  if (keep) return m;
  const out = m.clone();
  out.setPosition(0, 0, 0);
  return out;
}

// IK/FK switching can be animated: animated influences override the constraint's.
function applyInfluence(bones, animated) {
  if (!animated) return bones;
  return bones.map((b) =>
    animated[b.id] === undefined
      ? b
      : {
          ...b,
          constraints: b.constraints.map((c) =>
            c.type === 'ik' ? { ...c, influence: animated[b.id] } : c,
          ),
        },
  );
}

// A stable number per object reference (materials are replaced, not
// changed, so a new reference means new settings).
const refs = new WeakMap();
let refSeq = 0;
function refId(o) {
  let id = refs.get(o);
  if (id === undefined) refs.set(o, (id = ++refSeq));
  return id;
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
