import { module, test } from 'qunit';
import { Matrix4, Vector3 } from 'three';
import * as M from 'woogi-tools/lazy/studio/mesh';
import { buildPrimitive, PRIMITIVES } from 'woogi-tools/lazy/studio/primitives';
import { subtract, union, intersect } from 'woogi-tools/lazy/studio/csg';
import {
  autoUnwrap,
  uvIslands,
  uvStats,
  packIslands,
} from 'woogi-tools/lazy/studio/uv';
import {
  buildTemplate,
  solvePose,
  boneLength,
  autoWeights,
  mirrorName,
} from 'woogi-tools/lazy/studio/rig';
import {
  newClip,
  setKey,
  sampleTrack,
  moveKeys,
  keyRef,
  autoBoneMap,
} from 'woogi-tools/lazy/studio/anim';
import {
  starterDoc,
  addBoolean,
  duplicate,
  removeObjects,
  updateObject,
} from 'woogi-tools/lazy/studio/doc';
import { Evaluator } from 'woogi-tools/lazy/studio/evaluate';
import { toFile, fromFile } from 'woogi-tools/lazy/studio/project';

// Signed volume: positive only when every face winds outwards.
function volume(m) {
  let v = 0;
  for (const f of m.f)
    for (const [a, b, c] of M.triangulateFace(m, f))
      v += M.dot(m.v[f.v[a]], M.cross(m.v[f.v[b]], m.v[f.v[c]])) / 6;
  return v;
}

// Edges not shared by exactly two faces (a closed mesh has none).
const openEdges = (m) =>
  [...M.edgeMap(m).values()].filter((e) => e.faces.length !== 2).length;
const close = (a, b, eps = 1e-3) => Math.abs(a - b) < eps;

module('Unit | 3D Studio', function () {
  test('every primitive is closed and faces outwards', function (assert) {
    for (const kind of Object.keys(PRIMITIVES).filter((k) => k !== 'plane')) {
      const m = buildPrimitive(kind);
      assert.strictEqual(openEdges(m), 0, `${kind} is closed`);
      assert.true(volume(m) > 0, `${kind} winds outwards`);
    }
    assert.strictEqual(
      openEdges(buildPrimitive('plane')),
      4,
      'a plane has a border',
    );
    assert.true(
      close(volume(buildPrimitive('cube')), 1),
      'a unit cube holds 1',
    );
  });

  test('cylinder parameters stay live', function (assert) {
    const c = buildPrimitive('cylinder', { sides: 8 });
    assert.strictEqual(c.f.length, 10, '8 sides, 2 caps');
    const cone = buildPrimitive('cylinder', { sides: 8, radiusTop: 0 });
    assert.strictEqual(cone.f.length, 9, 'a zero top radius closes to a point');
    assert.strictEqual(openEdges(cone), 0);
  });

  test('extrude, inset, bevel, loop cut and bridge keep meshes closed', function (assert) {
    const cube = buildPrimitive('cube');
    const top = cube.f.findIndex((f) => M.faceNormal(cube, f)[1] > 0.9);
    const ex = M.extrudeFaces(cube, new Set([top]), 0.5).mesh;
    assert.strictEqual(ex.f.length, 10);
    assert.true(close(volume(ex), 1.5), 'extruded half a unit');
    assert.strictEqual(openEdges(ex), 0);
    const ins = M.insetFaces(cube, new Set([top]), 0.1).mesh;
    assert.strictEqual(ins.f.length, 10);
    assert.true(close(volume(ins), 1));
    const bev = M.bevel(cube, 0.1);
    assert.strictEqual(bev.f.length, 26, '6 faces, 12 edge strips, 8 corners');
    assert.strictEqual(openEdges(bev), 0);
    assert.true(volume(bev) < 1, 'a bevel takes a little off');
    assert.true(volume(bev) > 0.9, 'but only a little');
    const cut = M.loopCut(cube, [...M.edgeMap(cube).keys()][0], 2).mesh;
    assert.strictEqual(openEdges(cut), 0);
    assert.true(close(volume(cut), 1));
    const two = M.merge(
      cube,
      M.mapVerts(cube, (p) => [p[0] + 3, p[1], p[2]]),
    );
    const a = two.f.findIndex((f, i) => i < 6 && M.faceNormal(two, f)[0] > 0.9);
    const b = two.f.findIndex(
      (f, i) => i >= 6 && M.faceNormal(two, f)[0] < -0.9,
    );
    const bridged = M.bridgeFaces(two, new Set([a, b]));
    assert.strictEqual(openEdges(bridged), 0);
    assert.true(
      close(volume(bridged), 4),
      'two cubes and the 2-unit tunnel between them',
    );
  });

  test('booleans measure up', function (assert) {
    const cube = buildPrimitive('cube');
    const rod = buildPrimitive('cylinder', {
      radiusTop: 0.2,
      radiusBottom: 0.2,
      height: 2,
      sides: 48,
    });
    const hole = Math.PI * 0.04 * 0.996; // a 48-gon is a little less than a circle
    assert.true(close(volume(subtract(cube, rod)), 1 - hole, 5e-3), 'subtract');
    assert.true(close(volume(intersect(cube, rod)), hole, 5e-3), 'intersect');
    assert.true(close(volume(union(cube, rod)), 1 + hole, 5e-3), 'union');
  });

  test('a boolean is only re-run when its inputs move', function (assert) {
    let doc = starterDoc();
    const cube = doc.roots[0];
    let cutter;
    [doc, cutter] = addBoolean(doc, cube, 'subtract');
    const ev = new Evaluator();
    const k = ev.key(doc, cube);
    assert.strictEqual(
      ev.key(updateObject(doc, cube, { pos: [4, 0, 0] }), cube),
      k,
      'moving the whole model doesn’t',
    );
    assert.notStrictEqual(
      ev.key(updateObject(doc, cutter, { pos: [0, 0, 0] }), cube),
      k,
      'moving the cutter does',
    );
    const [copy, made] = duplicate(doc, [cube]);
    const op = copy.objects[made[0]].stack[0].params.operand;
    assert.notStrictEqual(op, cutter, 'a copy cuts with its own cutter');
    assert.strictEqual(copy.objects[op].parent, made[0]);
    assert.strictEqual(
      removeObjects(doc, [cutter]).objects[cube].stack[0].params.operand,
      null,
      'deleting a cutter leaves the boolean empty',
    );
  });

  test('auto unwrap: islands without overlap, packed into the square', function (assert) {
    const torus = buildPrimitive('torus');
    const u = autoUnwrap(torus);
    const s = uvStats(u);
    assert.strictEqual(s.overlap, 0);
    assert.true(uvIslands(u).length > 1);
    const inside = packIslands(u).f.every((f) =>
      f.uv.every(
        ([x, y]) => x >= -1e-6 && x <= 1 + 1e-6 && y >= -1e-6 && y <= 1 + 1e-6,
      ),
    );
    assert.true(inside, 'every UV inside the square');
  });

  test('two-bone IK reaches its target and bends towards the pole', function (assert) {
    const { bones, controls } = buildTemplate('humanoid', {
      min: [-0.5, 0, -0.3],
      max: [0.5, 2, 0.3],
    });
    const fore = bones.find((b) => b.name === 'LeftForeArm');
    const pole = controls.find(
      (c) => c.role.kind === 'pole' && c.role.bone === fore.id,
    );
    const rig = bones.map((b) =>
      b.id === fore.id
        ? {
            ...b,
            constraints: [
              { type: 'ik', target: 'T', pole: 'P', chain: 2, influence: 1 },
            ],
          }
        : b,
    );
    const goal = new Vector3(0.3, 1.5, 0.1);
    const { world } = solvePose(
      rig,
      {},
      new Map([
        ['T', new Matrix4().makeTranslation(goal.x, goal.y, goal.z)],
        ['P', new Matrix4().makeTranslation(...pole.pos)],
      ]),
    );
    const wrist = new Vector3(0, boneLength(fore), 0).applyMatrix4(
      world.get(fore.id),
    );
    assert.true(
      wrist.distanceTo(goal) < 1e-3,
      `wrist on target (${wrist.distanceTo(goal)})`,
    );
    assert.true(
      new Vector3().setFromMatrixPosition(world.get(fore.id)).z < 0,
      'the elbow bends back, towards its pole',
    );
  });

  test('automatic weights add up to one', function (assert) {
    const { bones } = buildTemplate('humanoid');
    const body = M.mapVerts(
      M.subdivide(
        buildPrimitive('cube', { width: 1, height: 2, depth: 0.6 }),
        1,
      ),
      (p) => [p[0], p[1] + 1, p[2]],
    );
    const skin = autoWeights(body, bones);
    let worst = 0;
    for (let i = 0; i < skin.n; i++) {
      let sum = 0;
      for (const g of Object.values(skin.groups)) sum += g[i];
      worst = Math.max(worst, Math.abs(1 - sum));
    }
    assert.true(worst < 1e-5);
    assert.strictEqual(mirrorName('LeftArm'), 'RightArm');
    assert.strictEqual(mirrorName('hand.L'), 'hand.R');
  });

  test('keys: bezier eases between keys and never overshoots a peak', function (assert) {
    let clip = newClip('Walk');
    const t = { kind: 'object', id: 'x' };
    clip = setKey(clip, t, 'pos', 0, [0, 0, 0]);
    clip = setKey(clip, t, 'pos', 10, [1, 2, 0]);
    clip = setKey(clip, t, 'pos', 20, [2, 0, 0]);
    const track = clip.tracks[0];
    assert.deepEqual(sampleTrack(track, 10), [1, 2, 0], 'on the key');
    for (let f = 0; f <= 20; f++)
      assert.true(sampleTrack(track, f)[1] <= 2 + 1e-9, `no overshoot at ${f}`);
    const moved = moveKeys(clip, new Set([keyRef(track, track.keys[1])]), 3);
    assert.deepEqual(
      moved.clip.tracks[0].keys.map((k) => k.f),
      [0, 13, 20],
    );
    assert.deepEqual(
      autoBoneMap(
        [{ name: 'mixamorig:LeftForeArm' }, { name: 'Pelvis' }],
        [{ name: 'LeftForeArm' }, { name: 'Hips' }, { name: 'LeftArm' }],
      ),
      { 'mixamorig:LeftForeArm': 'LeftForeArm', Pelvis: 'Hips' },
    );
  });

  test('project files round-trip, typed arrays included', function (assert) {
    const doc = starterDoc();
    const pixels = new Map([
      [
        'lyr1',
        {
          size: 2,
          color: new Uint8ClampedArray([
            1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
          ]),
          pbr: new Uint8ClampedArray(16),
        },
      ],
    ]);
    const back = fromFile(toFile(doc, pixels));
    assert.deepEqual(
      Object.keys(back.doc.objects).sort(),
      Object.keys(doc.objects).sort(),
    );
    assert.deepEqual(
      [...back.pixels.get('lyr1').color],
      [...pixels.get('lyr1').color],
    );
    assert.true(back.pixels.get('lyr1').color instanceof Uint8ClampedArray);
    assert.throws(() => fromFile('{"nope":1}'), /isn’t a 3D Studio project/);
  });
});
