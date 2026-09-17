// The World Radio's globe: the Earth, one green dot per station, and a
// crosshair in the middle. You turn the world under the crosshair and the
// station nearest to it is the one tuned in, the way radio.garden works.

import {
  Scene,
  PerspectiveCamera,
  WebGLRenderer,
  SphereGeometry,
  MeshPhongMaterial,
  MeshBasicMaterial,
  Mesh,
  AmbientLight,
  DirectionalLight,
  Color,
  TextureLoader,
  BufferGeometry,
  Float32BufferAttribute,
  Points,
  PointsMaterial,
  Vector3,
  Raycaster,
  Vector2,
  BackSide,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const RADIUS = 1;
// A public copy of the same dark Earth map radio.garden-style globes use.
const EARTH_TEXTURE =
  'https://unpkg.com/three-globe@2.31.0/example/img/earth-dark.jpg';

export function latLongToVector(lat, lon, radius = RADIUS) {
  const phi = ((90 - lat) * Math.PI) / 180;
  const theta = ((lon + 180) * Math.PI) / 180;
  return new Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export function createGlobe(canvas, { onTune, onHover, onClick }) {
  const scene = new Scene();
  scene.background = new Color('#05070c');
  const camera = new PerspectiveCamera(40, 1, 0.01, 100);
  camera.position.set(0, 0, 3.2);
  const renderer = new WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const earth = new Mesh(
    new SphereGeometry(RADIUS, 64, 64),
    new MeshPhongMaterial({
      color: '#12233a',
      shininess: 6,
      specular: '#0a1420',
    }),
  );
  scene.add(earth);
  // A soft rim so the planet reads as a ball against the black.
  const glow = new Mesh(
    new SphereGeometry(RADIUS * 1.03, 48, 48),
    new MeshBasicMaterial({
      color: '#2a9d5c',
      transparent: true,
      opacity: 0.08,
      side: BackSide,
    }),
  );
  scene.add(glow);
  scene.add(new AmbientLight('#ffffff', 1.6));
  const sun = new DirectionalLight('#ffffff', 1.2);
  sun.position.set(5, 3, 5);
  scene.add(sun);

  new TextureLoader().load(
    EARTH_TEXTURE,
    (texture) => {
      earth.material.map = texture;
      earth.material.color.set('#ffffff');
      earth.material.needsUpdate = true;
    },
    undefined,
    () => {
      // Offline or blocked: the plain blue ball with the dots still works.
    },
  );

  const controls = new OrbitControls(camera, canvas);
  controls.enablePan = false;
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.rotateSpeed = 0.45;
  controls.minDistance = 1.35;
  controls.maxDistance = 5;
  controls.zoomSpeed = 0.6;

  let points = null;
  let stations = [];
  const raycaster = new Raycaster();
  raycaster.params.Points.threshold = 0.02;
  const centre = new Vector2(0, 0);
  const pointer = new Vector2();
  let tuned = -1;
  let hovered = -1;

  function setStations(list) {
    stations = list;
    if (points) {
      scene.remove(points);
      points.geometry.dispose();
      points.material.dispose();
    }
    const positions = new Float32Array(list.length * 3);
    list.forEach((s, i) => {
      const v = latLongToVector(s.lat, s.lon, RADIUS * 1.005);
      positions[i * 3] = v.x;
      positions[i * 3 + 1] = v.y;
      positions[i * 3 + 2] = v.z;
    });
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
    points = new Points(
      geometry,
      new PointsMaterial({
        color: '#4ade80',
        size: 0.018,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.95,
      }),
    );
    scene.add(points);
  }

  // The station under the crosshair: the closest dot to the ray through the
  // middle of the view, as long as it's on the side facing us.
  function nearestToCentre() {
    if (!points) return -1;
    raycaster.setFromCamera(centre, camera);
    const hits = raycaster.intersectObject(earth);
    if (!hits.length) return -1;
    const at = hits[0].point;
    let best = -1;
    let bestD = Infinity;
    const pos = points.geometry.attributes.position.array;
    for (let i = 0; i < stations.length; i++) {
      const dx = pos[i * 3] - at.x;
      const dy = pos[i * 3 + 1] - at.y;
      const dz = pos[i * 3 + 2] - at.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    // Further than ~6° of arc away is "nothing here".
    return bestD < 0.012 ? best : -1;
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect();
    pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!points) return -1;
    raycaster.setFromCamera(pointer, camera);
    raycaster.params.Points.threshold = 0.012 * camera.position.length();
    const hits = raycaster.intersectObject(points);
    if (!hits.length) return -1;
    // Dots on the far side of the globe are hidden behind it.
    const earthHit = raycaster.intersectObject(earth)[0];
    const hit = hits.find(
      (h) => !earthHit || h.distance <= earthHit.distance + 0.03,
    );
    return hit ? hit.index : -1;
  }

  let downAt = null;
  canvas.addEventListener(
    'pointerdown',
    (e) => (downAt = [e.clientX, e.clientY]),
  );
  canvas.addEventListener('pointerup', (e) => {
    if (!downAt || Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) > 4)
      return;
    const i = pick(e);
    if (i >= 0) onClick?.(stations[i], i);
  });
  canvas.addEventListener('pointermove', (e) => {
    const i = pick(e);
    if (i !== hovered) {
      hovered = i;
      onHover?.(i >= 0 ? stations[i] : null);
      canvas.style.cursor = i >= 0 ? 'pointer' : 'grab';
    }
  });

  function flyTo(lat, lon) {
    const target = latLongToVector(lat, lon, camera.position.length());
    camera.position.copy(target);
    camera.lookAt(0, 0, 0);
    controls.update();
  }

  function resize() {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(canvas);
  resize();

  let running = true;
  let lastTune = 0;
  function frame(now) {
    if (!running) return;
    controls.update();
    if (now - lastTune > 120) {
      lastTune = now;
      const i = nearestToCentre();
      if (i !== tuned) {
        tuned = i;
        onTune?.(i >= 0 ? stations[i] : null, i);
      }
    }
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setStations,
    flyTo,
    autoRotate(on) {
      controls.autoRotate = on;
      controls.autoRotateSpeed = 0.4;
    },
    dispose() {
      running = false;
      observer.disconnect();
      controls.dispose();
      renderer.dispose();
      earth.geometry.dispose();
      earth.material.map?.dispose();
      earth.material.dispose();
      points?.geometry.dispose();
      points?.material.dispose();
    },
  };
}
