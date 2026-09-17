import {
  Group,
  Mesh,
  InstancedMesh,
  Object3D,
  PlaneGeometry,
  CylinderGeometry,
  SphereGeometry,
  ConeGeometry,
  RingGeometry,
  BufferGeometry,
  BufferAttribute,
  MeshBasicMaterial,
  CanvasTexture,
  Color,
  Vector3,
  DoubleSide,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
} from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { buildAvatar, disposeAvatar, reachArms } from './avatar-model';
import {
  createStage,
  createSea,
  buildIsland,
  Particles,
  Tweens,
  nameTag,
  startEmote,
  playEmote,
  swingLimbs,
  blobShadow,
  easeOut,
  Shockwaves,
  dizzyStars,
} from './island-world';
import {
  HIDDEN,
  VOID,
  EXPLODED,
  DEFUSED,
  DROP_MS,
  PLAYER_COLORS,
  themeOf,
} from '../utils/minesweeper';

// Minesweeper on the island: every tile is an instance of one rounded block,
// pressed into the sand as it's dug. Players are their avatars, dropped in from
// the sky, walking about the field.

const NUMBER_COLORS = [
  '',
  '#2f6fe0',
  '#2e9e4f',
  '#e5484d',
  '#3a3fa8',
  '#9b2c2c',
  '#15999a',
  '#141414',
  '#7a7a7a',
];
const AVATAR_SCALE = 0.5;
const HIDDEN_Y = 0.17;
const OPEN_Y = -0.06;

function numberTexture(n) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '900 104px Moderustic, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#ffffff';
  ctx.strokeText(String(n), 64, 70);
  ctx.fillStyle = NUMBER_COLORS[n];
  ctx.fillText(String(n), 64, 70);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export function createMinesScene(canvas) {
  const stage = createStage(canvas, { fov: 45 });
  const { scene, camera, kit, calm } = stage;
  const tweens = new Tweens();
  const particles = new Particles(800);
  scene.add(particles.points);
  const shockwaves = new Shockwaves(scene, tweens);
  const dummy = new Object3D();
  const color = new Color();
  const tmp = new Vector3();

  let field = null; // { width, height, group, sea, tiles, tileY[], tileGoal[], animating:Set, numbers:Map, flags:Map, mines:Map }
  const people = new Map(); // id -> { avatar, emote, tag, shadow, x, y, face, drop, action }
  let view = null;
  let myId = null;
  // Whose shoulder the camera sits over. Normally yours; when you're out of the
  // game and watching, whoever you chose to follow.
  let watchId = null;
  let avatars = new Map();
  let lastEvent = 0;
  let me = null; // the local player's own position, ahead of the host's
  let shake = 0;
  const camTarget = new Vector3();
  const camPos = new Vector3(0, 20, 20);
  let dropStart = 0;

  const numberMaterials = NUMBER_COLORS.map((_, n) =>
    n
      ? new MeshBasicMaterial({
          map: numberTexture(n),
          transparent: true,
          depthWrite: false,
        })
      : null,
  );
  const numberPlane = new PlaneGeometry(0.72, 0.72);
  numberPlane.rotateX(-Math.PI / 2);

  const cursor = new Mesh(
    new RingGeometry(0.5, 0.62, 4, 1, Math.PI / 4),
    new MeshBasicMaterial({
      color: '#fff3b0',
      transparent: true,
      opacity: 0.95,
      side: DoubleSide,
      depthWrite: false,
    }),
  );
  cursor.rotation.x = -Math.PI / 2;
  cursor.renderOrder = 6;
  cursor.visible = false;
  scene.add(cursor);

  // ─── The field ─────────────────────────────────────────────────────

  function buildField(v) {
    const theme = themeOf(v.theme);
    const key = `${v.width}x${v.height}:${theme.id}:${(v.mask ?? []).join('')}:${(v.land ?? []).join('')}:${(v.water ?? []).join('')}`;
    if (field?.key === key) return;
    if (field) {
      field.group.removeFromParent();
      field.sea.mesh.removeFromParent();
      field.sea.dispose();
    }
    const group = buildIsland(kit, {
      width: v.width,
      depth: v.height,
      theme: theme.island,
      walls: true,
      seed: v.width * 13 + 3,
      mask: v.mask,
      land: v.land ?? v.mask,
      water: v.water ?? null,
    });
    // The sea reads its shoreline from the island's own terrain.
    const sea = createSea(group.userData.terrain);
    const count = v.width * v.height;
    const tiles = new InstancedMesh(
      new RoundedBoxGeometry(0.94, 0.34, 0.94, 2, 0.07),
      kit.toon('#ffffff'),
      count,
    );
    tiles.setColorAt(0, color.set('#ffffff'));
    group.add(tiles);
    scene.add(sea.mesh, group);
    field = {
      key,
      theme,
      width: v.width,
      height: v.height,
      group,
      sea,
      tiles,
      tileY: new Float32Array(count).fill(HIDDEN_Y),
      // Cut-out squares start as themselves, so no tile is ever laid there.
      shown: Array.from({ length: count }, (_, i) =>
        v.cells[i] === VOID ? VOID : HIDDEN,
      ),
      animating: new Map(),
      numbers: new Map(),
      flags: new Map(),
      mines: new Map(),
    };
    for (let i = 0; i < count; i++) placeTile(i, HIDDEN_Y, 1);
    tiles.instanceMatrix.needsUpdate = true;
    tiles.instanceColor.needsUpdate = true;
    camTarget.set(0, 0, 0);
  }

  const worldX = (x) => x - field.width / 2;
  const worldZ = (y) => y - field.height / 2;

  function placeTile(i, y, squash) {
    const x = i % field.width;
    const row = Math.floor(i / field.width);
    const cell = field.shown[i];
    dummy.position.set(worldX(x + 0.5), y, worldZ(row + 0.5));
    dummy.rotation.set(0, 0, 0);
    // A square the level cut out has no tile at all: scaled away rather than
    // skipped, since these are instances of one mesh.
    dummy.scale.set(1, cell === VOID ? 0 : squash, 1);
    dummy.updateMatrix();
    field.tiles.setMatrixAt(i, dummy.matrix);
    const odd = (x + row) % 2;
    field.tiles.setColorAt(
      i,
      color.set(
        cell === HIDDEN
          ? field.theme.grass[odd]
          : cell === EXPLODED
            ? '#3a2b23'
            : cell === DEFUSED
              ? '#a9c4d8'
              : field.theme.sand[odd],
      ),
    );
  }

  // Tiles that have just been uncovered sink in a ripple out from where the dig was.
  function syncCells(v, origin) {
    const now = performance.now();
    for (let i = 0; i < v.cells.length; i++) {
      const cell = v.cells[i];
      if (cell === field.shown[i]) continue;
      const x = i % field.width;
      const y = Math.floor(i / field.width);
      const delay = origin ? Math.hypot(x - origin[0], y - origin[1]) * 28 : 0;
      field.shown[i] = cell;
      field.animating.set(i, {
        start: now + (calm ? 0 : Math.min(delay, 700)),
        from: field.tileY[i],
        to: cell === HIDDEN ? HIDDEN_Y : OPEN_Y,
      });
      const old = field.numbers.get(i);
      if (old) {
        old.removeFromParent();
        field.numbers.delete(i);
      }
      if (cell > 0 && cell < EXPLODED) {
        const label = new Mesh(numberPlane, numberMaterials[cell]);
        label.userData.sharedMaterial = true;
        label.position.set(worldX(x + 0.5), OPEN_Y + 0.19, worldZ(y + 0.5));
        label.scale.setScalar(0.001);
        label.renderOrder = 4;
        field.group.add(label);
        field.numbers.set(i, label);
        tweens.add(
          260,
          (t) => label.scale.setScalar(Math.max(0.001, easeOut(t))),
          { delay: calm ? 0 : Math.min(delay, 700) + 120 },
        );
      }
      // A mine that has gone off is gone: the tile keeps the scorch mark (its
      // own colour, above) and the bomb itself is taken off the field.
      if (cell === EXPLODED) removeMine(i);
      if (cell === DEFUSED) showMine(i, true, true);
    }
    // Every mine still in the ground, once the game is over. Ones that have
    // already blown are not put back.
    if (v.mines)
      v.mines.forEach(
        (mine, i) =>
          mine &&
          !field.mines.has(i) &&
          v.cells[i] !== EXPLODED &&
          showMine(i, false),
      );
  }

  // Takes the mine off a tile, for one that has just gone off. The tile is left
  // scorched; there is nothing left of the bomb to look at.
  function removeMine(i) {
    const mine = field.mines.get(i);
    if (!mine) return;
    field.mines.delete(i);
    mine.removeFromParent();
  }

  // `armed` is a mine someone's defusing right now: it pops into sight so everyone can see what they're up to.
  function showMine(i, exploded, defused = false, armed = false) {
    const have = field.mines.get(i);
    if (have) {
      have.position.y = exploded ? OPEN_Y + 0.35 : HIDDEN_Y + 0.35;
      if (exploded || defused) {
        have.userData.armed = false;
        have.scale.setScalar(1);
      }
      return;
    }
    const mine = new Group();
    const ball = new Mesh(
      kit.geometry('mine-ball', () => new SphereGeometry(0.22, 14, 10)),
      kit.toon('#2b2b2b'),
    );
    mine.add(withInk(ball));
    const spike = kit.geometry(
      'mine-spike',
      () => new ConeGeometry(0.05, 0.16, 6),
    );
    for (const [rx, rz] of [
      [0, 0],
      [Math.PI, 0],
      [Math.PI / 2, 0],
      [-Math.PI / 2, 0],
      [0, Math.PI / 2],
      [0, -Math.PI / 2],
    ]) {
      const s = new Mesh(spike, kit.toon('#3d3d3d'));
      const holder = new Group();
      holder.rotation.set(rx, 0, rz);
      s.position.y = 0.24;
      holder.add(s);
      mine.add(holder);
    }
    const glint = new Mesh(
      kit.geometry('mine-glint', () => new SphereGeometry(0.05, 6, 4)),
      kit.toon(defused ? '#4cd964' : '#ff5050'),
    );
    glint.position.set(-0.08, 0.14, 0.14);
    mine.add(glint);
    const x = i % field.width;
    const y = Math.floor(i / field.width);
    mine.position.set(
      worldX(x + 0.5),
      exploded ? OPEN_Y + 0.35 : HIDDEN_Y + 0.35,
      worldZ(y + 0.5),
    );
    mine.scale.setScalar(0.001);
    mine.userData.armed = armed;
    field.group.add(mine);
    field.mines.set(i, mine);
    tweens.add(
      calm ? 1 : 380,
      (t) => mine.scale.setScalar(Math.max(0.001, easeOut(t))),
      { delay: exploded ? 0 : Math.random() * 600 },
    );
  }

  function withInk(mesh) {
    mesh.add(new Mesh(mesh.geometry, kit.outlineThin));
    return mesh;
  }

  // Flags: a pole and a waving pennant in the colour of whoever planted it.
  function syncFlags(v) {
    const owners = new Map(v.players.map((p) => [p.id, p]));
    for (let i = 0; i < v.flags.length; i++) {
      const owner = v.cells[i] === HIDDEN ? v.flags[i] : null;
      const existing = field.flags.get(i);
      if (existing?.userData.owner === owner) continue;
      if (existing) {
        const flag = existing;
        field.flags.delete(i);
        tweens.add(
          calm ? 1 : 200,
          (t) => flag.scale.setScalar(Math.max(0.001, 1 - t)),
          { done: () => flag.removeFromParent() },
        );
      }
      if (!owner) continue;
      const player = owners.get(owner);
      const flag = makeFlag(
        PLAYER_COLORS[(player?.color ?? 0) % PLAYER_COLORS.length],
      );
      flag.userData.owner = owner;
      const x = i % field.width;
      const y = Math.floor(i / field.width);
      flag.position.set(worldX(x + 0.5), HIDDEN_Y + 0.17, worldZ(y + 0.5));
      flag.userData.phase = Math.random() * 6;
      field.group.add(flag);
      field.flags.set(i, flag);
      tweens.add(calm ? 1 : 320, (t) => {
        flag.position.y = HIDDEN_Y + 0.17 + (1 - easeOut(t)) * 1.2;
      });
    }
  }

  const pennantGeometry = (() => {
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(
        new Float32Array([0, 0.72, 0, 0, 0.44, 0, 0.36, 0.58, 0]),
        3,
      ),
    );
    g.computeVertexNormals();
    return g;
  })();

  function makeFlag(hex) {
    const flag = new Group();
    const pole = new Mesh(
      kit.geometry(
        'flag-pole',
        () => new CylinderGeometry(0.025, 0.03, 0.76, 6),
      ),
      kit.toon('#6b4424'),
    );
    pole.position.y = 0.38;
    flag.add(pole);
    const cloth = new Mesh(pennantGeometry, kit.toon(hex, { double: true }));
    flag.add(cloth);
    const base = new Mesh(
      kit.geometry(
        'flag-base',
        () => new CylinderGeometry(0.1, 0.12, 0.05, 10),
      ),
      kit.toon('#5c4a3a'),
    );
    flag.add(base);
    flag.userData.cloth = cloth;
    return flag;
  }

  // ─── People ────────────────────────────────────────────────────────

  function makePerson(p, index) {
    const hex = PLAYER_COLORS[p.color % PLAYER_COLORS.length];
    const input = avatars.get(p.id);
    const holder = new Group();
    let avatar = null;
    if (input) {
      avatar = buildAvatar(input, kit);
      avatar.scale.setScalar(AVATAR_SCALE);
      holder.add(avatar);
    }
    const shadow = blobShadow(kit, 0.32);
    shadow.position.y = HIDDEN_Y + 0.19;
    scene.add(shadow);
    const tag = nameTag(p.id === myId ? 'You' : p.name, hex, { bot: p.bot });
    tag.sprite.position.y = 1.45;
    holder.add(tag.sprite);
    const stamina = staminaBar();
    stamina.sprite.position.y = 1.78;
    holder.add(stamina.sprite);
    scene.add(holder);
    const stars = dizzyStars(kit);
    scene.add(stars);
    return {
      holder,
      avatar,
      stars,
      stamina,
      lastStep: 0,
      emote: null,
      tag,
      shadow,
      x: p.x,
      y: p.y,
      face: p.face,
      phase: Math.random() * 6,
      dropDelay: index * 180,
      action: null,
      landed: false,
      stunnedShown: 0,
    };
  }

  // A little stamina bar that floats over a player's head (redrawn only when it changes).
  function staminaBar() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 20;
    const ctx = canvas.getContext('2d');
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    const sprite = new Sprite(
      new SpriteMaterial({ map: texture, transparent: true, depthTest: false }),
    );
    sprite.renderOrder = 10;
    sprite.scale.set(0.9, 0.14, 1);
    sprite.visible = false;
    let last = '';
    return {
      sprite,
      draw(value, winded) {
        const key = `${Math.round(value)}|${winded}`;
        if (key === last) return;
        last = key;
        ctx.clearRect(0, 0, 128, 20);
        ctx.fillStyle = '#141414';
        ctx.beginPath();
        ctx.roundRect(0, 0, 128, 20, 10);
        ctx.fill();
        ctx.fillStyle = winded ? '#e5484d' : '#f2b90d';
        ctx.beginPath();
        ctx.roundRect(3, 3, Math.max(0, 122 * (value / 100)), 14, 7);
        ctx.fill();
        texture.needsUpdate = true;
      },
    };
  }

  function removePerson(person) {
    person.stamina.sprite.material.map.dispose();
    person.stamina.sprite.material.dispose();
    person.holder.removeFromParent();
    person.shadow.removeFromParent();
    person.stars.removeFromParent();
    if (person.avatar) disposeAvatar(person.avatar);
    person.tag.sprite.material.map.dispose();
    person.tag.sprite.material.dispose();
  }

  function syncPeople(v) {
    const ids = v.players.map((p) => p.id).join();
    if ([...people.keys()].join() !== ids) {
      for (const person of people.values()) removePerson(person);
      people.clear();
      v.players.forEach((p, i) => people.set(p.id, makePerson(p, i)));
    }
  }

  // ─── Events: digs, booms, flags ───────────────────────────────────

  function tileCentre(x, y, lift = 0.3) {
    return tmp.set(worldX(x + 0.5), lift, worldZ(y + 0.5));
  }

  function playEvents(v, fresh) {
    let origin = null;
    for (const event of v.events) {
      if (event.id <= lastEvent) continue;
      lastEvent = event.id;
      if (fresh) continue;
      const person = people.get(event.by);
      if (event.kind === 'dig') {
        origin = [event.x, event.y];
        particles.emit(
          tileCentre(event.x, event.y),
          calm ? 5 : 14 + Math.min(20, event.count),
          ['#a47148', '#c89b6d', '#8fd16a'],
          { speed: 1.8, up: 3.2, life: 0.7, size: 0.2 },
        );
        shockwaves.add(
          worldX(event.x + 0.5),
          OPEN_Y + 0.2,
          worldZ(event.y + 0.5),
          '#fff7dd',
          { size: 1 + Math.min(4, event.count * 0.15), duration: 420 },
        );
        if (person) person.action = { kind: 'dig', start: performance.now() };
        if (person?.avatar && event.count >= 10) startEmote(person, 'joy', 150);
      } else if (event.kind === 'boom') {
        origin = [event.x, event.y];
        particles.emit(
          tileCentre(event.x, event.y, 0.5),
          calm ? 12 : 60,
          ['#ffd84d', '#ff8a3d', '#e5484d', '#ffffff'],
          { speed: 4.5, up: 5, life: 0.8, size: 0.4 },
        );
        particles.emit(
          tileCentre(event.x, event.y, 0.4),
          calm ? 6 : 26,
          ['#4a4a4a', '#6e6e6e', '#2b2b2b'],
          { speed: 1.2, up: 2.5, life: 1.6, size: 0.6, gravity: -0.4 },
        );
        shockwaves.add(
          worldX(event.x + 0.5),
          0.3,
          worldZ(event.y + 0.5),
          '#ffd84d',
          { size: 4.5, duration: 520 },
        );
        shockwaves.add(
          worldX(event.x + 0.5),
          0.28,
          worldZ(event.y + 0.5),
          '#ff8a3d',
          { size: 3, duration: 700, delay: 80 },
        );
        // Explosions stun nearby: a wide ring showing the blast's reach, and everyone caught in it reels.
        if (event.radius)
          shockwaves.add(
            worldX(event.x + 0.5),
            0.26,
            worldZ(event.y + 0.5),
            '#ffffff',
            { size: (event.radius + 0.5) * 2, duration: 600, delay: 40 },
          );
        for (const id of [event.by, ...(event.stunned ?? [])]) {
          const hit = people.get(id);
          if (!hit?.avatar) continue;
          startEmote(hit, 'stunned');
          hit.action = { kind: 'blast', start: performance.now() };
        }
        if (
          !calm &&
          (event.by === myId ||
            Math.hypot(
              event.x + 0.5 - (me?.x ?? 0),
              event.y + 0.5 - (me?.y ?? 0),
            ) < 5)
        )
          shake = event.by === myId ? 0.6 : 0.3;
      } else if (event.kind === 'defusing') {
        // The mine pops up out of the tile, so everyone can see what's stopped them.
        showMine(event.y * field.width + event.x, false, false, true);
        if (person?.avatar) startEmote(person, 'shocked');
        shockwaves.add(
          worldX(event.x + 0.5),
          HIDDEN_Y + 0.22,
          worldZ(event.y + 0.5),
          '#ff5050',
          { size: 1.4, duration: 400 },
        );
      } else if (event.kind === 'defused') {
        origin = [event.x, event.y];
        if (person?.avatar) startEmote(person, 'joy', 150);
        particles.emit(
          tileCentre(event.x, event.y, 0.5),
          calm ? 6 : 24,
          ['#4cd964', '#ffffff', '#a9c4d8'],
          { speed: 2.4, up: 3.5, life: 0.8, size: 0.24 },
        );
        shockwaves.add(
          worldX(event.x + 0.5),
          OPEN_Y + 0.22,
          worldZ(event.y + 0.5),
          '#4cd964',
          { size: 2.4, duration: 520 },
        );
      } else if (event.kind === 'flag') {
        if (person) person.action = { kind: 'flag', start: performance.now() };
        const owner = v.players.find((p) => p.id === event.by);
        shockwaves.add(
          worldX(event.x + 0.5),
          HIDDEN_Y + 0.2,
          worldZ(event.y + 0.5),
          PLAYER_COLORS[(owner?.color ?? 0) % PLAYER_COLORS.length],
          { size: 0.9, duration: 360 },
        );
        particles.emit(
          tileCentre(event.x, event.y, 0.4),
          calm ? 3 : 8,
          ['#ffffff', '#fff3b0'],
          { speed: 1, up: 2, life: 0.5, size: 0.18 },
        );
      } else if (event.kind === 'over') {
        for (const [id, p] of people) {
          if (!p.avatar) continue;
          if (event.winner === id) startEmote(p, 'cheer', 300);
          else if (v.players.length > 1) startEmote(p, 'sad', 500);
        }
        if (event.winner) {
          const winner = v.players.find((p) => p.id === event.winner);
          for (let i = 0; i < (calm ? 1 : 4); i++) {
            tweens.add(1, () => {}, {
              delay: 400 + i * 350,
              done: () =>
                particles.emit(
                  tmp.set(
                    worldX(winner.x) + (Math.random() - 0.5) * 2,
                    2.8,
                    worldZ(winner.y) + (Math.random() - 0.5) * 2,
                  ),
                  40,
                  ['#ff6b81', '#ffd84d', '#7ed957', '#4d8ff0', '#ffffff'],
                  { speed: 3, up: 5, life: 1.4, size: 0.28, gravity: 5 },
                ),
            });
          }
        }
      }
    }
    return origin;
  }

  // ─── Frame ─────────────────────────────────────────────────────────

  // A mine being defused ticks away, swelling and shrinking. Once whoever's on it is done
  // (defused, blown up, or it was only practice) it settles, or goes again if it was never a mine.
  function pulseMines(now, v) {
    const busy = new Set();
    for (const p of v?.players ?? [])
      if (p.defusing) busy.add(p.defusing.y * field.width + p.defusing.x);
    for (const [i, mine] of field.mines) {
      if (!mine.userData.armed) continue;
      if (busy.has(i)) {
        mine.scale.setScalar(1 + Math.sin(now / 130) * 0.12);
      } else if (v && v.cells[i] === HIDDEN && !v.mines?.[i]) {
        mine.removeFromParent();
        field.mines.delete(i);
      } else {
        mine.userData.armed = false;
        mine.scale.setScalar(1);
      }
    }
  }

  function drawTiles(now) {
    if (!field.animating.size) return;
    for (const [i, anim] of field.animating) {
      if (now < anim.start) continue;
      const t = Math.min(1, (now - anim.start) / 220);
      const y = anim.from + (anim.to - anim.from) * easeOut(t);
      field.tileY[i] = y;
      const squash = field.shown[i] === HIDDEN ? 1 : 1 - 0.45 * easeOut(t);
      placeTile(i, y, squash);
      if (t >= 1) field.animating.delete(i);
    }
    field.tiles.instanceMatrix.needsUpdate = true;
    field.tiles.instanceColor.needsUpdate = true;
  }

  function drawPeople(now, dt) {
    if (!view) return;
    const dropping = view.status === 'drop';
    for (const p of view.players) {
      const person = people.get(p.id);
      if (!person) continue;
      const mine = p.id === myId && me;
      const target = mine ? me : p;
      // Other people glide towards where the host last saw them.
      const k = mine ? 1 : Math.min(1, dt * 12);
      person.x += (target.x - person.x) * k;
      person.y += (target.y - person.y) * k;
      const moving = mine ? me.moving : p.moving;
      if (moving)
        person.face = angleLerp(person.face, target.face, Math.min(1, dt * 14));
      const wx = worldX(person.x);
      const wz = worldZ(person.y);

      // Dropping in from the sky, one after another, with a squash on landing.
      let lift = 0;
      if (dropping || !person.landed) {
        const t = Math.max(
          0,
          Math.min(1, (now - dropStart - person.dropDelay) / (DROP_MS * 0.7)),
        );
        lift = (1 - t * t) * 14;
        if (t >= 1 && !person.landed) {
          person.landed = true;
          particles.emit(
            tmp.set(wx, 0.35, wz),
            calm ? 6 : 22,
            ['#e9d5a0', '#ffffff', '#8fd16a'],
            { speed: 2.4, up: 1.5, life: 0.6, size: 0.3 },
          );
          if (person.avatar)
            tweens.add(calm ? 1 : 300, (s) =>
              person.avatar.scale.set(
                AVATAR_SCALE * (1 + Math.sin(s * Math.PI) * 0.25),
                AVATAR_SCALE * (1 - Math.sin(s * Math.PI) * 0.25),
                AVATAR_SCALE * (1 + Math.sin(s * Math.PI) * 0.25),
              ),
            );
        }
      }
      person.holder.position.set(wx, HIDDEN_Y + 0.17 + lift, wz);
      person.holder.rotation.y = person.face;
      person.shadow.position.set(wx, HIDDEN_Y + 0.19, wz);
      person.shadow.scale.setScalar(0.32 * Math.max(0.3, 1 - lift / 14));
      person.tag.draw(p.dead ? `${p.score} · out` : `${p.score}`);
      person.holder.visible = !p.left;
      // Stamina over the head: shown while it isn't full (or you're winded), with the Stamina running rule.
      const staminaValue = mine ? (me.stamina ?? 100) : (p.stamina ?? 100);
      const winded = mine ? Boolean(me.winded) : Boolean(p.winded);
      const showStamina =
        view.run === 'stamina' && !p.dead && (staminaValue < 99.5 || winded);
      person.stamina.sprite.visible = showStamina;
      if (showStamina) person.stamina.draw(staminaValue, winded);
      person.shadow.visible = !p.left;

      const avatar = person.avatar;
      if (!avatar) continue;
      const running = moving && (mine ? me.running : p.running);
      const tired = view.run === 'stamina' && winded && !p.dead;
      if (moving) person.phase += dt * (running ? 17 : tired ? 6 : 9);
      // A puff of dust at each footstep: a big kick of it when running.
      const step = Math.floor(person.phase / Math.PI);
      if (moving && step !== person.lastStep) {
        person.lastStep = step;
        if (!calm && running) {
          const back = tmp.set(
            wx - Math.sin(person.face) * 0.25,
            HIDDEN_Y + 0.22,
            wz - Math.cos(person.face) * 0.25,
          );
          particles.emit(back, 6, ['#e9d5a0', '#ffffff', '#cdb784'], {
            speed: 1.4,
            up: 1.2,
            life: 0.5,
            size: 0.3,
            gravity: 1.5,
          });
        } else if (!calm)
          particles.emit(
            tmp.set(wx, HIDDEN_Y + 0.2, wz),
            2,
            ['#e9d5a0', '#ffffff'],
            { speed: 0.6, up: 0.8, life: 0.4, size: 0.2, gravity: 2 },
          );
      }
      // Running: white streaks peel off behind. Winded: sweat drops fly and a huff of breath now and then.
      if (!calm && running && Math.random() < dt * 22) {
        const side = (Math.random() - 0.5) * 0.5;
        particles.emit(
          tmp.set(
            wx - Math.sin(person.face) * 0.3 + Math.cos(person.face) * side,
            HIDDEN_Y + 0.5 + Math.random() * 0.5,
            wz - Math.cos(person.face) * 0.3 - Math.sin(person.face) * side,
          ),
          1,
          ['#ffffff', '#fff7dd'],
          { speed: 0.3, up: 0.1, life: 0.28, size: 0.16, gravity: 0 },
        );
      }
      if (!calm && tired && Math.random() < dt * 5) {
        avatar.userData.head.getWorldPosition(tmp);
        particles.emit(tmp.setY(tmp.y + 0.15), 1, ['#7cc7ff', '#b8e2ff'], {
          speed: 1.1,
          up: 1.6,
          life: 0.55,
          size: 0.14,
          gravity: 5,
        });
      }
      if (!calm && tired && Math.random() < dt * 1.6) {
        avatar.userData.head.getWorldPosition(tmp);
        particles.emit(
          tmp.set(
            tmp.x + Math.sin(person.face) * 0.25,
            tmp.y - 0.05,
            tmp.z + Math.cos(person.face) * 0.25,
          ),
          3,
          ['#ffffff', '#e8eef2'],
          { speed: 0.4, up: 0.3, life: 0.6, size: 0.26, gravity: -0.3 },
        );
      }
      // Seeing stars while stunned. Being down (waiting to respawn, or to
      // spend a life) looks the same as being out, just not for good.
      const out = p.dead || p.downMs > 0;
      person.stars.visible = p.stun > 0 || out;
      if (p.stun > 0 || out) {
        avatar.userData.head.getWorldPosition(tmp);
        person.stars.position.set(tmp.x, tmp.y + 0.3, tmp.z);
        person.stars.userData.update(now);
      }
      swingLimbs(
        avatar,
        person.phase,
        running ? 1 : moving ? (tired ? 0.45 : 0.7) : 0,
      );
      // Leaning into a run; hunched over, bobbing with heavy breaths, when winded.
      avatar.rotation.set(
        running ? 0.32 : tired ? 0.22 + Math.sin(now / 260) * 0.05 : 0,
        0,
        0,
      );
      avatar.position.set(
        0,
        moving ? Math.abs(Math.sin(person.phase)) * (running ? 0.09 : 0.05) : 0,
        0,
      );
      const action = person.action;
      if (action) {
        const t = (now - action.start) / 420;
        if (t >= 1) person.action = null;
        else if (action.kind === 'dig') {
          // A stamp: lean in and slam both hands down.
          const down = Math.sin(t * Math.PI);
          avatar.rotation.x = down * 0.5;
          reachArms(avatar, [
            [-0.12, 0.7 - down * 0.5, 0.3 + down * 0.2],
            [0.12, 0.7 - down * 0.5, 0.3 + down * 0.2],
          ]);
        } else if (action.kind === 'flag') {
          reachArms(avatar, [
            [-0.25, 0.4, 0.1],
            [0.2, 0.55 + Math.sin(t * Math.PI) * 0.4, 0.35],
          ]);
        } else if (action.kind === 'blast') {
          avatar.position.y += Math.sin(Math.min(1, t * 1.4) * Math.PI) * 0.9;
          avatar.rotation.x = -Math.sin(t * Math.PI) * 0.8;
        }
      }
      if ((p.stun > 0 || out) && !person.emote) startEmote(person, 'stunned');
      avatar.position.y += playEmote(person, kit, now);
      // Knocked out: flat on its back where the mine went off, limbs splayed.
      if (out && !person.action) {
        person.down = Math.min(1, (person.down ?? 0) + dt * 4);
        avatar.rotation.x = (-Math.PI / 2) * person.down;
        avatar.position.y = 0.12 * person.down;
        reachArms(avatar, [
          [-0.55, 0.75, 0.05],
          [0.55, 0.75, 0.05],
        ]);
      } else if (!out) person.down = 0;
    }
  }

  const angleLerp = (a, b, t) => {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  };

  stage.onFrame((dt, now) => {
    tweens.tick(now);
    if (!field) return;
    field.sea.update(now / 1000, camera);
    drawTiles(now);
    pulseMines(now, view);
    drawPeople(now, dt);
    for (const flag of field.flags.values())
      flag.userData.cloth.rotation.y =
        Math.sin(now / 260 + flag.userData.phase) * 0.35;
    particles.tick(dt, camera, stage.renderer);

    // The cursor on the tile under your feet.
    const self = me && view?.status === 'playing' ? me : null;
    cursor.visible = Boolean(self);
    if (self) {
      const tx = Math.max(0, Math.min(field.width - 1, Math.floor(self.x)));
      const ty = Math.max(0, Math.min(field.height - 1, Math.floor(self.y)));
      const i = ty * field.width + tx;
      cursor.position.set(
        worldX(tx + 0.5),
        field.tileY[i] + 0.19,
        worldZ(ty + 0.5),
      );
      cursor.scale.setScalar(1 + Math.sin(now / 180) * 0.04);
      cursor.material.color.set(
        field.shown[i] === HIDDEN ? '#fff3b0' : '#ffffff',
      );
      cursor.material.opacity = field.shown[i] === HIDDEN ? 0.95 : 0.35;
    }

    // Camera: over your shoulder while playing, the whole field before and after.
    const portrait = Math.max(1, 1 / camera.aspect);
    const person = people.get(watchId ?? myId);
    const following = view?.status === 'playing' && person?.landed;
    const span = Math.max(field.width, field.height);
    const goal = following
      ? tmp.set(worldX(person.x), 0, worldZ(person.y))
      : tmp.set(0, 0, 0);
    camTarget.lerp(goal, Math.min(1, dt * 3));
    const distance = (following ? 10 : span * 0.75 + 3) * portrait ** 0.8;
    const goalPos = new Vector3(
      camTarget.x,
      distance * 1.15,
      camTarget.z + distance * 0.85,
    );
    camPos.lerp(goalPos, Math.min(1, dt * 2.5));
    camera.position.copy(camPos);
    if (shake > 0) {
      shake = Math.max(0, shake - dt);
      camera.position.x += (Math.random() - 0.5) * shake;
      camera.position.y += (Math.random() - 0.5) * shake;
    }
    camera.lookAt(camTarget.x, 0, camTarget.z + 0.3);
  });

  return {
    // The host's view of the game, the viewer's id, and avatars by player id.
    setView(next, options = {}) {
      if (!next) return;
      myId = options.myId ?? myId;
      // null is a real value here: it means stop spectating and go back to yourself.
      if ('watchId' in options) watchId = options.watchId ?? null;
      avatars = options.avatars ?? avatars;
      const fresh = !view || (next.status === 'drop' && view.status !== 'drop');
      if (fresh) {
        for (const person of people.values()) removePerson(person);
        people.clear();
        if (field) {
          field.group.removeFromParent();
          field.sea.mesh.removeFromParent();
          field.tiles.geometry.dispose();
          field = null;
        }
        lastEvent = 0;
        dropStart = performance.now() - (DROP_MS - next.dropLeft);
      }
      view = next;
      buildField(next);
      syncPeople(next);
      const origin = playEvents(next, false);
      syncCells(next, origin);
      syncFlags(next);
    },
    // Everyone else's position on screen (-1..1 each way), for the off-screen arrows.
    markers() {
      if (!view) return [];
      const out = [];
      for (const p of view.players) {
        const person = people.get(p.id);
        if (p.id === myId || p.left || !person?.landed) continue;
        const point = new Vector3(
          worldX(person.x),
          0.9,
          worldZ(person.y),
        ).project(camera);
        out.push({
          id: p.id,
          name: p.name,
          color: PLAYER_COLORS[p.color % PLAYER_COLORS.length],
          x: point.x,
          y: point.y,
          behind: point.z > 1,
        });
      }
      return out;
    },
    // Where you are right now on this device, ahead of the host's next update.
    setMe(position) {
      me = position;
    },
    dispose() {
      for (const person of people.values()) removePerson(person);
      people.clear();
      for (const material of numberMaterials) {
        material?.map.dispose();
        material?.dispose();
      }
      numberPlane.dispose();
      pennantGeometry.dispose();
      stage.dispose();
    },
  };
}
