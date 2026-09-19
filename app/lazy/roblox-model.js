// A Roblox asset's 3D view, from the OBJ, MTL and textures Roblox draws its
// own 3D thumbnails with. Loaded on demand: Three.js is not small.
//
//   const view = await mountRobloxModel(container, parts);
//   view.dispose();

import {
  AmbientLight,
  Box3,
  DirectionalLight,
  LoadingManager,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader.js';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader.js';

const CDN = (hash) => `/api/roblox?kind=cdn&hash=${hash}`;
const HASH = /([a-f0-9]{32})/;

export async function mountRobloxModel(container, parts) {
  const scene = new Scene();
  scene.background = null;
  const camera = new PerspectiveCamera(40, 1, 0.1, 5000);
  const renderer = new WebGLRenderer({ antialias: true, alpha: true });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  container.append(renderer.domElement);

  scene.add(new AmbientLight(0xffffff, 1.6));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(3, 5, 4);
  scene.add(key);
  const fill = new DirectionalLight(0xffffff, 0.8);
  fill.position.set(-4, 2, -3);
  scene.add(fill);

  // Every file the loaders ask for is a hash on Roblox's CDN, fetched through the Worker.
  const manager = new LoadingManager();
  manager.setURLModifier((url) => {
    const hash = url.match(HASH)?.[1];
    return hash ? CDN(hash) : url;
  });

  let materials = null;
  if (parts.mtl) {
    try {
      materials = await new MTLLoader(manager).loadAsync(CDN(parts.mtl));
      materials.preload();
    } catch {
      materials = null;
    }
  }
  const objLoader = new OBJLoader(manager);
  if (materials) objLoader.setMaterials(materials);
  const model = await objLoader.loadAsync(CDN(parts.obj));
  scene.add(model);

  // Sit the model in the middle and pull the camera back to fit it.
  const box = new Box3().setFromObject(model);
  const centre = box.getCenter(new Vector3());
  const size = box.getSize(new Vector3()).length() || 1;
  model.position.sub(centre);
  camera.position.set(size * 0.6, size * 0.45, size * 0.9);
  camera.near = size / 100;
  camera.far = size * 20;
  camera.updateProjectionMatrix();

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 1.5;
  controls.addEventListener('start', () => (controls.autoRotate = false));

  let disposed = false;
  const resize = () => {
    const w = container.clientWidth || 300;
    const h = container.clientHeight || 300;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();

  const frame = () => {
    if (disposed) return;
    controls.update();
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  };
  frame();

  return {
    dispose() {
      disposed = true;
      observer.disconnect();
      controls.dispose();
      model.traverse((o) => {
        o.geometry?.dispose?.();
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) {
          if (!m) continue;
          for (const v of Object.values(m)) v?.isTexture && v.dispose();
          m.dispose?.();
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
