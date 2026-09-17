// The Level Editor's scene: you build the level on the island itself rather
// than on a drawing of it, so what you are looking at while you work is what
// the game will hand you.
//
// It is assembled from the games' own pieces (buildIsland, makeObstacle, the
// sea), which is the whole point: there is no second idea of what a level looks
// like that could drift away from the real one.
//
//   const editor = createEditor(canvas, { onPaint, onHover });
//   editor.setBoard({ game, width, height, mask, land, water, seed });
//   editor.setPieces(cells);
//   editor.dispose();
//
// Two costs are kept apart on purpose. Changing the board's shape means a new
// island and a new checkered texture, which is the expensive one; changing a
// square's contents only rebuilds the small group of obstacles. Painting a
// stroke across the grid therefore stays smooth as long as the brush is not
// the cut-out one, and even then rebuilds are coalesced to one a frame.

import {
  Group,
  Mesh,
  Raycaster,
  Vector2,
  Vector3,
  Plane,
  SphereGeometry,
  RingGeometry,
  MeshBasicMaterial,
  DoubleSide,
} from 'three';
import {
  createStage,
  createSea,
  buildIsland,
  makeObstacle,
  cellToWorld,
  seeded,
} from './island-world';

// Which island theme each game wears, so a Snake level looks like a Snake
// island and a Minesweeper one like a minefield.
const THEME = { snake: 'meadow', mines: 'palms' };
// The editor's characters, as the games' obstacle kinds.
const KIND = { r: 'rock', p: 'palm' };
// Shapes, not things: sea, beach and water are the terrain's business.
const SHAPE = new Set(['~', 's', 'w']);

const MIN_ZOOM = 0.55;
const MAX_ZOOM = 2.4;

// A mine is the one thing a game never shows you, so the editor draws its own
// marker rather than borrowing the buried model.
function mineMarker(kit) {
  const marker = new Mesh(
    kit.geometry('editor-mine', () => new SphereGeometry(0.3, 12, 9)),
    kit.toon('#2b2b2b'),
  );
  marker.position.y = 0.26;
  return marker;
}

export function createEditor(canvas, { onPaint, onHover } = {}) {
  const stage = createStage(canvas, { fov: 40 });
  const { scene, camera, kit } = stage;

  let board = {
    game: 'snake',
    width: 20,
    height: 20,
    mask: null,
    land: null,
    water: null,
    seed: 1,
  };
  let sea = null;
  let island = null;
  let pieces = new Group();
  scene.add(pieces);

  // The view is the one a tile editor wants: looking down at the board from a
  // little way back, sliding over it with WASD rather than turning around it.
  // The angles are still there (shift-drag, and the turn buttons) because the
  // whole point of building on the island is being able to look at it, but
  // nothing moves unless you move it.
  const HOME = { yaw: 0, pitch: 1.18, zoom: 1 };
  let yaw = HOME.yaw;
  let pitch = HOME.pitch;
  let zoom = HOME.zoom;
  // What the camera is looking at: panning moves this, not the camera.
  const target = new Vector3(0, 0, 0);

  // ─── Picking ─────────────────────────────────────────────────────────
  // Squares are picked against the flat plane the field sits on rather than
  // against the tiles, so a square still answers when a palm is standing on it.
  const ray = new Raycaster();
  const groundPlane = new Plane(new Vector3(0, 1, 0), 0);
  const pointer = new Vector2();
  const hit = new Vector3();

  const cursor = new Mesh(
    new RingGeometry(0.34, 0.5, 4),
    new MeshBasicMaterial({
      color: '#ffffff',
      transparent: true,
      opacity: 0.9,
      side: DoubleSide,
      depthTest: false,
    }),
  );
  cursor.rotation.x = -Math.PI / 2;
  cursor.rotation.z = Math.PI / 4;
  cursor.position.y = 0.4;
  cursor.renderOrder = 30;
  cursor.visible = false;
  scene.add(cursor);

  // The square under the pointer, or null if it is off the board.
  function squareAt(event) {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(pointer, camera);
    if (!ray.ray.intersectPlane(groundPlane, hit)) return null;
    const x = Math.floor(hit.x + board.width / 2);
    const y = Math.floor(hit.z + board.height / 2);
    if (x < 0 || y < 0 || x >= board.width || y >= board.height) return null;
    return [x, y];
  }

  // ─── Building ────────────────────────────────────────────────────────

  let rebuildBoard = false;
  let rebuildPieces = false;
  let cellsNow = '';

  function makeIsland() {
    island?.removeFromParent();
    sea?.mesh.removeFromParent();
    sea?.dispose();
    island = buildIsland(kit, {
      width: board.width,
      depth: board.height,
      theme: THEME[board.game] ?? 'meadow',
      // Snake's edges are walls; a minefield has no fence round it.
      walls: board.game === 'snake',
      seed: board.seed,
      mask: board.mask,
      land: board.land,
      water: board.water,
    });
    sea = createSea(island.userData.terrain);
    scene.add(island, sea.mesh);
  }

  function makePieces() {
    pieces.removeFromParent();
    pieces = new Group();
    const rand = seeded(board.width * 7 + board.height * 13 + 1);
    const limit = Math.min(cellsNow.length, board.width * board.height);
    for (let i = 0; i < limit; i++) {
      const char = cellsNow[i];
      // '.' is empty and '~' is a square cut out of the board, which the island
      // itself shows: neither has anything standing on it.
      // '.' is empty; sea, beach and water are the island's own shape, not a
      // thing standing on a square.
      if (char === '.' || !char || SHAPE.has(char)) continue;
      const [x, z] = cellToWorld(
        board.width,
        board.height,
        i % board.width,
        Math.floor(i / board.width),
      );
      const piece =
        char === 'm'
          ? mineMarker(kit)
          : makeObstacle(kit, KIND[char] ?? 'rock', Math.floor(rand() * 1000));
      if (!piece) continue;
      piece.position.set(x, 0.02, z);
      pieces.add(piece);
    }
    scene.add(pieces);
  }

  function setBoard(next) {
    const changed =
      next.game !== board.game ||
      next.width !== board.width ||
      next.height !== board.height ||
      next.seed !== board.seed ||
      String(next.mask) !== String(board.mask) ||
      String(next.land) !== String(board.land) ||
      String(next.water) !== String(board.water);
    board = { ...board, ...next };
    if (changed) rebuildBoard = true;
  }

  function setPieces(cells) {
    if (cells === cellsNow) return;
    cellsNow = cells ?? '';
    rebuildPieces = true;
  }

  // ─── Controls ────────────────────────────────────────────────
  // Built the way a tile editor is: WASD or the arrow keys slide the view over
  // the board, the wheel zooms, and left-dragging paints. Turning the island is
  // still there (shift-drag, Q and E, the buttons) because looking at what you
  // have built from another angle is half the reason it is in 3D, but the
  // default is flat and still, so painting a long stroke goes where you aimed.

  let painting = null; // the pointer id currently laying squares
  let dragging = null; // { id, x, y, turn }
  const touches = new Map();
  let pinch = 0;
  const held = new Set();
  let hovering = false;

  const clampZoom = (z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, z));

  // The view can leave the board, but not so far that it is lost at sea.
  function clampTarget() {
    const reach = Math.max(board.width, board.height) * 0.7 + 6;
    target.x = Math.max(-reach, Math.min(reach, target.x));
    target.z = Math.max(-reach, Math.min(reach, target.z));
  }

  // Panning is relative to where the camera is pointing, so "up" is always
  // away from you however far the island has been turned.
  function pan(forward, right, amount) {
    target.x += (Math.sin(yaw) * forward + Math.cos(yaw) * right) * amount;
    target.z += (Math.cos(yaw) * forward - Math.sin(yaw) * right) * amount;
    clampTarget();
  }

  const onPointerDown = (event) => {
    canvas.focus?.({ preventScroll: true });
    canvas.setPointerCapture?.(event.pointerId);
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    if (touches.size > 1) {
      // A second finger: stop painting and start pinching instead.
      painting = null;
      dragging = null;
      pinch = 0;
      return;
    }
    const orbit = event.shiftKey;
    const square =
      orbit || event.button === 2 || event.button === 1
        ? null
        : squareAt(event);
    if (square) {
      painting = event.pointerId;
      onPaint?.(square, true);
    } else {
      // Off the board, right, or middle: drag the view. Shift turns it instead.
      dragging = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        turn: orbit,
      };
    }
  };

  const onPointerMove = (event) => {
    if (touches.has(event.pointerId))
      touches.set(event.pointerId, [event.clientX, event.clientY]);

    if (touches.size > 1) {
      const [a, b] = [...touches.values()];
      const gap = Math.hypot(a[0] - b[0], a[1] - b[1]);
      if (pinch) zoom = clampZoom(zoom * (pinch / gap));
      pinch = gap;
      return;
    }
    if (painting === event.pointerId) {
      const square = squareAt(event);
      if (square) onPaint?.(square, false);
      return;
    }
    if (dragging?.id === event.pointerId) {
      const dx = event.clientX - dragging.x;
      const dy = event.clientY - dragging.y;
      if (dragging.turn) {
        yaw -= dx * 0.008;
        pitch = Math.max(0.3, Math.min(1.5, pitch - dy * 0.006));
      } else {
        // Roughly a square per square: the ground keeps up with the pointer.
        const scale = 0.0055 * zoom * Math.max(board.width, board.height);
        pan(dy * scale, -dx * scale, 1);
      }
      dragging.x = event.clientX;
      dragging.y = event.clientY;
      return;
    }
    const square = squareAt(event);
    onHover?.(square);
    if (square) {
      const [wx, wz] = cellToWorld(
        board.width,
        board.height,
        square[0],
        square[1],
      );
      cursor.position.set(wx, 0.4, wz);
      cursor.visible = true;
    } else {
      cursor.visible = false;
    }
  };

  const onPointerUp = (event) => {
    touches.delete(event.pointerId);
    if (touches.size < 2) pinch = 0;
    if (painting === event.pointerId) painting = null;
    if (dragging?.id === event.pointerId) dragging = null;
  };

  const onEnter = () => (hovering = true);
  const onLeave = () => {
    hovering = false;
    cursor.visible = false;
    onHover?.(null);
  };

  const onWheel = (event) => {
    event.preventDefault();
    zoom = clampZoom(zoom * (event.deltaY > 0 ? 1.08 : 0.93));
  };
  // Right-dragging to pan should not also open the browser's menu.
  const onContextMenu = (event) => event.preventDefault();

  // Keys work when the pointer is over the canvas or it has the focus, so you
  // can drive it straight away without first knowing to click on it, and the
  // page still scrolls normally everywhere else.
  const MOVE_KEYS = new Set([
    'w',
    'a',
    's',
    'd',
    'q',
    'e',
    'arrowup',
    'arrowdown',
    'arrowleft',
    'arrowright',
    '+',
    '=',
    '-',
    '_',
  ]);
  const listening = () => hovering || document.activeElement === canvas;
  const onKeyDown = (event) => {
    if (!listening() || event.ctrlKey || event.metaKey || event.altKey) return;
    const key = event.key.toLowerCase();
    if (!MOVE_KEYS.has(key)) return;
    event.preventDefault();
    held.add(key);
  };
  const onKeyUp = (event) => held.delete(event.key.toLowerCase());
  // A window that loses focus mid-stride would otherwise pan forever.
  const onBlur = () => held.clear();

  canvas.tabIndex = 0;
  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup', onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);
  canvas.addEventListener('pointerenter', onEnter);
  canvas.addEventListener('pointerleave', onLeave);
  canvas.addEventListener('wheel', onWheel, { passive: false });
  canvas.addEventListener('contextmenu', onContextMenu);
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);
  window.addEventListener('blur', onBlur);

  // ─── The frame ───────────────────────────────────────────────────────

  stage.onFrame((dt, now) => {
    // One rebuild a frame at most, however many edits landed since the last.
    if (rebuildBoard) {
      rebuildBoard = false;
      rebuildPieces = true;
      makeIsland();
    }
    if (rebuildPieces) {
      rebuildPieces = false;
      makePieces();
    }

    if (held.size) {
      const step = dt * 14 * zoom;
      let forward = 0;
      let right = 0;
      if (held.has('w') || held.has('arrowup')) forward -= 1;
      if (held.has('s') || held.has('arrowdown')) forward += 1;
      if (held.has('a') || held.has('arrowleft')) right -= 1;
      if (held.has('d') || held.has('arrowright')) right += 1;
      if (forward || right) {
        const len = Math.hypot(forward, right);
        pan(forward / len, right / len, step);
      }
      if (held.has('q')) yaw -= dt * 1.1;
      if (held.has('e')) yaw += dt * 1.1;
      if (held.has('+') || held.has('=')) zoom = clampZoom(zoom * (1 - dt));
      if (held.has('-') || held.has('_')) zoom = clampZoom(zoom * (1 + dt));
    }

    const span = Math.max(board.width, board.height);
    const radius = (span * 0.95 + 9) * zoom;
    camera.position.set(
      target.x + Math.sin(yaw) * radius * Math.cos(pitch - 0.55),
      Math.max(3, radius * Math.sin(pitch)),
      target.z + Math.cos(yaw) * radius * Math.cos(pitch - 0.55),
    );
    camera.lookAt(target);
    sea?.update(now / 1000, camera);
  });

  return {
    setBoard,
    setPieces,
    // For the buttons next to the canvas.
    zoomBy(factor) {
      zoom = clampZoom(zoom * factor);
    },
    turnBy(radians) {
      yaw += radians;
    },
    panBy(forward, right) {
      pan(forward, right, Math.max(board.width, board.height) * 0.12);
    },
    resetView() {
      yaw = HOME.yaw;
      pitch = HOME.pitch;
      zoom = HOME.zoom;
      target.set(0, 0, 0);
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerenter', onEnter);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      stage.dispose();
    },
  };
}
