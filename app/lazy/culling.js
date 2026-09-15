import { Box3, Frustum, Matrix4, Quaternion, Ray, Vector3, Sphere } from 'three';

// Cheap visibility culling for the 3D scenes, on every device.
//
// three.js already skips meshes outside the camera's view, but it checks every
// mesh on its own, every frame: an avatar is dozens of meshes plus their ink
// outlines. This hides whole groups at once instead, and adds occlusion
// culling: groups completely hidden behind a big solid shape (the table top,
// a head) aren't drawn at all.
//
// Occlusion is done on the CPU against a few simple convex stand-ins, not the
// real meshes, and it's conservative: a group is only hidden when every corner
// of its bounding box is behind the *same* occluder. Because the occluders are
// convex, that means the whole box is behind it, so nothing visible ever pops out.
// Checks run a few times a second, not every frame.
//
//   const culler = createCuller(camera);
//   culler.addOccluder({ type: 'disc', center, radius })   // horizontal disc, facing up and down
//   culler.addOccluder({ type: 'sphere', object, radius })  // follows `object`'s world position
//   culler.track(group)                                     // hidden when off screen or occluded
//   culler.update(now)                                      // once per frame, before rendering

const CHECK_MS = 120;
const PAD = 1.06;

const toPoint = new Vector3();
const ray = new Ray();
const hit = new Vector3();
const worldBox = new Box3();
const sphere = new Sphere();
const projection = new Matrix4();
const eye = new Vector3();
const boxSize = new Vector3();
// Turning the view more than this (radians) since the last check checks again straight away.
const TURN_RECHECK = 0.04;

export function createCuller(camera, { checkMs = CHECK_MS } = {}) {
  const frustum = new Frustum();
  const occluders = [];
  const tracked = new Map(); // object -> { local: Box3, corners: Vector3[8] }
  let nextCheck = 0;
  const lastTurn = new Quaternion();
  let stats = { tracked: 0, hidden: 0, occluded: 0 };

  function localBox(object) {
    // The object's bounds in its own space, measured once with it at rest.
    object.updateWorldMatrix(true, true);
    const inverse = new Matrix4().copy(object.matrixWorld).invert();
    const box = new Box3();
    object.traverse((child) => {
      if (!child.isMesh && !child.isSprite && !child.isPoints) return;
      const geometry = child.geometry;
      if (!geometry) return;
      if (!geometry.boundingBox) geometry.computeBoundingBox();
      const childBox = geometry.boundingBox.clone().applyMatrix4(new Matrix4().multiplyMatrices(inverse, child.matrixWorld));
      box.union(childBox);
    });
    if (box.isEmpty()) return null;
    // A little slack for breathing, bobbing and waving.
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3()).multiplyScalar(PAD);
    return new Box3().setFromCenterAndSize(center, size);
  }

  // Distance along the ray to where it passes through the occluder, or Infinity.
  function occlusionDistance(occluder, origin, direction) {
    ray.set(origin, direction);
    if (occluder.type === 'disc') {
      const { center, radius } = occluder;
      if (Math.abs(direction.y) < 1e-6) return Infinity;
      const t = (center.y - origin.y) / direction.y;
      if (t <= 0) return Infinity;
      const x = origin.x + direction.x * t - center.x;
      const z = origin.z + direction.z * t - center.z;
      return x * x + z * z <= radius * radius ? t : Infinity;
    }
    if (occluder.type === 'sphere') {
      occluder.object.getWorldPosition(sphere.center);
      sphere.radius = occluder.radius;
      return ray.intersectSphere(sphere, hit) ? origin.distanceTo(hit) : Infinity;
    }
    return Infinity;
  }

  function check(object, entry) {
    const origin = eye;
    object.updateWorldMatrix(true, false);
    const { local, corners } = entry;
    worldBox.makeEmpty();
    const points = [local.min.x, local.max.x].flatMap((x) => [local.min.y, local.max.y].flatMap((y) => [local.min.z, local.max.z].map((z) => [x, y, z])));
    points.forEach(([x, y, z], i) => {
      corners[i].set(x, y, z).applyMatrix4(object.matrixWorld);
      worldBox.expandByPoint(corners[i]);
    });
    // Off-screen tests use a generous box, so a group is already drawn as it turns into view.
    if (!frustum.intersectsBox(worldBox.clone().expandByScalar(worldBox.getSize(boxSize).length() * 0.2))) return 'outside';
    // Occluded only if one occluder covers every corner.
    for (const occluder of occluders) {
      if (occluder.ignore?.(object)) continue;
      let all = true;
      for (const point of corners) {
        toPoint.subVectors(point, origin);
        const distance = toPoint.length();
        toPoint.divideScalar(distance);
        if (occlusionDistance(occluder, origin, toPoint) >= distance) {
          all = false;
          break;
        }
      }
      if (all) return 'occluded';
    }
    return 'visible';
  }

  return {
    addOccluder(occluder) {
      occluders.push(occluder);
      return occluder;
    },
    removeOccluder(occluder) {
      const i = occluders.indexOf(occluder);
      if (i >= 0) occluders.splice(i, 1);
    },
    track(object) {
      const local = localBox(object);
      if (!local) return;
      tracked.set(object, { local, corners: Array.from({ length: 8 }, () => new Vector3()) });
      nextCheck = 0;
    },
    untrack(object) {
      if (tracked.delete(object)) object.visible = true;
    },
    // Forces a check on the next update (after a big camera or layout change).
    invalidate() {
      nextCheck = 0;
    },
    update(now = performance.now()) {
      camera.updateMatrixWorld();
      const turned = camera.getWorldQuaternion(new Quaternion()).angleTo(lastTurn) > TURN_RECHECK;
      if (now < nextCheck && !turned) return;
      camera.getWorldQuaternion(lastTurn);
      camera.getWorldPosition(eye);
      nextCheck = now + checkMs;
      projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(projection);
      let hidden = 0;
      let occluded = 0;
      for (const [object, entry] of tracked) {
        if (!object.parent) {
          tracked.delete(object);
          continue;
        }
        const result = check(object, entry);
        object.visible = result === 'visible';
        if (result !== 'visible') hidden++;
        if (result === 'occluded') occluded++;
      }
      stats = { tracked: tracked.size, hidden, occluded };
    },
    get stats() {
      return stats;
    },
    dispose() {
      for (const object of tracked.keys()) object.visible = true;
      tracked.clear();
      occluders.length = 0;
    },
  };
}
