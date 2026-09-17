import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { modifier } from 'ember-modifier';
import { htmlSafe } from '@ember/template';
import Icon from './icon';
import CopyButton from './copy-button';
import { keepState } from '../utils/tool-state';
import { askConfirm } from '../utils/confirm';
import {
  KINDS,
  OFF_BOARD,
  SIZE_RANGE,
  NAME_MAX,
  listLevels,
  saveLevel,
  deleteLevel,
  newLevel,
  encodeLevel,
  decodeLevel,
  blankCells,
} from '../utils/levels';

// Draw your own island for Snake, or your own minefield for Minesweeper.
//
// This lives inside each game's own page, opened from its lobby, rather than
// being a tool of its own: a level only means anything in the game it was drawn
// for, and you want to go straight from finishing one to playing it.
//
// You build it on the island itself. The 3D view is where the work happens:
// the pointer picks a square on the ground, dragging lays a stroke, and the
// island around it regenerates as you change the board's shape. The flat grid
// underneath is kept as a second way in, because it is the one that works from
// the keyboard and the one that shows a whole large level at a glance.
//
// The level is one string of characters (see utils/levels.js), so painting is
// just swapping a character: no per-square components, and a 40 x 40 grid stays
// responsive under a dragged pointer.

const eq = (a, b) => a === b;

export default class LevelEditor extends Component {
  @tracked name = '';
  @tracked width = 20;
  @tracked height = 20;
  @tracked cells = blankCells(20, 20);
  @tracked brush = 'r';
  @tracked levelId = null;
  @tracked importCode = '';
  @tracked message = '';
  @tracked saved = [];
  @tracked sceneFailed = false;
  @tracked showGrid = false;
  @tracked hovered = null;
  scene = null;

  sizeRange = SIZE_RANGE;
  nameMax = NAME_MAX;
  painting = null;

  constructor(owner, args) {
    super(owner, args);
    // Per game, so a Snake level in progress and a Minesweeper one do not
    // overwrite each other.
    keepState(
      this,
      `level-editor-${this.game}`,
      ['name', 'width', 'height', 'cells', 'brush', 'levelId', 'showGrid'],
      () => {
        if (!this.kinds.some((k) => k.char === this.brush))
          this.brush = this.kinds[1].char;
        this.refresh();
      },
    );
  }

  // The game is whichever page the editor was opened from: there is no picker,
  // because there is nowhere else to be.
  get game() {
    return this.args.game === 'mines' ? 'mines' : 'snake';
  }

  get gameLabel() {
    return this.game === 'mines' ? 'Minesweeper' : 'Snake';
  }

  refresh = () => (this.saved = listLevels(this.game));

  // ─── The island ──────────────────────────────────────────────────────
  // three.js is loaded only when the editor is opened, the way the games do.

  editor = modifier((canvas) => {
    let live = null;
    let stopped = false;
    import('../lazy/level-editor-3d')
      .then(({ createEditor }) => {
        if (stopped) return;
        live = createEditor(canvas, {
          onPaint: this.paintSquare,
          onHover: (square) => (this.hovered = square),
        });
        this.scene = live;
        this.pushToScene();
      })
      .catch(() => (this.sceneFailed = true));
    return () => {
      stopped = true;
      this.scene = null;
      live?.dispose();
    };
  });

  // Reading the level here is what subscribes this to every change to it.
  syncScene = modifier(() => {
    const level = this.level;
    this.pushToScene(level);
  });

  pushToScene(level = this.level) {
    if (!this.scene) return;
    this.scene.setBoard({
      game: this.game,
      width: level.width,
      height: level.height,
      // The three shapes, as strings of 1s and 0s: cheap to compare, so only a
      // stroke that changes one of them sends the island off to rebuild.
      mask: [...level.cells].map((c) => (OFF_BOARD.has(c) ? 0 : 1)).join(''),
      land: [...level.cells].map((c) => (c === '~' ? 0 : 1)).join(''),
      water: [...level.cells].map((c) => (c === 'w' ? 1 : 0)).join(''),
      seed: level.width * 31 + level.height,
    });
    this.scene.setPieces(level.cells);
  }

  // Dragging on the island paints. `first` is the square the stroke started on,
  // which is what decides whether the stroke draws or rubs out.
  paintSquare = ([x, y], first) => {
    const index = y * this.width + x;
    if (first)
      this.painting = this.cells[index] === this.brush ? '.' : this.brush;
    this.paint(index);
  };

  zoomIn = () => this.scene?.zoomBy(0.8);
  zoomOut = () => this.scene?.zoomBy(1.25);
  turnLeft = () => this.scene?.turnBy(-0.4);
  turnRight = () => this.scene?.turnBy(0.4);
  resetView = () => this.scene?.resetView();
  panUp = () => this.scene?.panBy(-1, 0);
  panDown = () => this.scene?.panBy(1, 0);
  panLeft = () => this.scene?.panBy(0, -1);
  panRight = () => this.scene?.panBy(0, 1);

  get kinds() {
    return KINDS[this.game] ?? KINDS.snake;
  }

  get hoverLabel() {
    if (!this.hovered) return 'Drag on the island to paint.';
    const [x, y] = this.hovered;
    const kind = this.kinds.find(
      (k) => k.char === (this.cells[y * this.width + x] ?? '.'),
    );
    return `Square ${x + 1}, ${y + 1}: ${kind?.label ?? 'Empty'}`;
  }

  // One entry per square, for the flat grid. The index is what painting writes to.
  get squares() {
    const kindOf = Object.fromEntries(this.kinds.map((k) => [k.char, k]));
    return Array.from({ length: this.width * this.height }, (_, i) => {
      const char = this.cells[i] ?? '.';
      const kind = kindOf[char] ?? this.kinds[0];
      return {
        i,
        kind: kind.id,
        label: `${(i % this.width) + 1}, ${Math.floor(i / this.width) + 1}: ${kind.label}`,
      };
    });
  }

  get gridStyle() {
    // Only ever a number this component produced, so it is safe to mark as such.
    return htmlSafe(`--cols:${this.width}`);
  }

  get counts() {
    // Sea, beach and water shape the board rather than stand on it.
    const filled = [...this.cells].filter(
      (c) => c !== '.' && !OFF_BOARD.has(c),
    ).length;
    const playable = [...this.cells].filter((c) => !OFF_BOARD.has(c)).length;
    return { filled, playable };
  }

  get problem() {
    // Every level needs somewhere to play, whatever the game.
    if (!this.counts.playable)
      return 'There is no board left. Leave some of it to play on.';
    if (this.game !== 'mines') return '';
    const mines = [...this.cells].filter((c) => c === 'm').length;
    if (!mines) return 'Put at least one mine in before you save it.';
    if (mines >= this.counts.playable)
      return 'Leave somewhere safe to dig: it cannot be all mines.';
    return '';
  }

  get shareCode() {
    return encodeLevel(this.level);
  }

  get level() {
    return {
      id: this.levelId ?? undefined,
      game: this.game,
      name: this.name,
      width: this.width,
      height: this.height,
      cells: this.cells,
    };
  }

  // ─── Painting ────────────────────────────────────────────────────────

  paint(index) {
    if (index < 0 || index >= this.cells.length) return;
    const char = this.painting ?? this.brush;
    if (this.cells[index] === char) return;
    this.cells =
      this.cells.slice(0, index) + char + this.cells.slice(index + 1);
  }

  // A drag paints a stroke. Which character it lays is decided by the square it
  // started on, so dragging from a filled square rubs out and from an empty one
  // draws: the behaviour every paint program has.
  grid = modifier((element) => {
    const indexAt = (target) => {
      const cell = target?.closest?.('[data-i]');
      return cell ? Number(cell.dataset.i) : -1;
    };
    const down = (event) => {
      const i = indexAt(event.target);
      if (i < 0) return;
      event.preventDefault();
      this.painting = this.cells[i] === this.brush ? '.' : this.brush;
      this.paint(i);
      element.setPointerCapture?.(event.pointerId);
    };
    const move = (event) => {
      if (this.painting === null) return;
      // The pointer is captured by the grid, so find the square underneath it.
      this.paint(
        indexAt(document.elementFromPoint(event.clientX, event.clientY)),
      );
    };
    const up = () => (this.painting = null);
    element.addEventListener('pointerdown', down);
    element.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    return () => {
      element.removeEventListener('pointerdown', down);
      element.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
    };
  });

  // Keyboard and assistive tech: pressing a square lays the current brush.
  tap = (index) => {
    this.painting = this.cells[index] === this.brush ? '.' : this.brush;
    this.paint(index);
    this.painting = null;
  };

  // ─── Editing ─────────────────────────────────────────────────────────

  setBrush = (char) => (this.brush = char);
  toggleGrid = () => (this.showGrid = !this.showGrid);
  setName = (event) => (this.name = event.target.value.slice(0, NAME_MAX));
  setImportCode = (event) => (this.importCode = event.target.value);

  // Resizing keeps what you have drawn where it was, rather than reflowing it.
  resize(width, height) {
    const [lo, hi] = SIZE_RANGE;
    const w = Math.max(lo, Math.min(hi, Math.round(Number(width)) || lo));
    const h = Math.max(lo, Math.min(hi, Math.round(Number(height)) || lo));
    let next = '';
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++)
        next +=
          x < this.width && y < this.height
            ? this.cells[y * this.width + x]
            : '.';
    this.width = w;
    this.height = h;
    this.cells = next;
  }

  setWidth = (event) => this.resize(event.target.value, this.height);
  setHeight = (event) => this.resize(this.width, event.target.value);

  clear = () => (this.cells = blankCells(this.width, this.height));

  fillEdges = () => {
    let next = '';
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const edge =
          x === 0 || y === 0 || x === this.width - 1 || y === this.height - 1;
        next += edge ? this.brush : this.cells[y * this.width + x];
      }
    this.cells = next;
  };

  // Rounds the board off into an island shape, which is the shape most people
  // want the moment they discover they can cut squares out at all.
  roundOff = () => {
    const halfW = this.width / 2;
    const halfD = this.height / 2;
    let next = '';
    for (let y = 0; y < this.height; y++)
      for (let x = 0; x < this.width; x++) {
        const u = Math.abs((x + 0.5 - halfW) / halfW);
        const v = Math.abs((y + 0.5 - halfD) / halfD);
        const out = Math.pow(u, 3.2) + Math.pow(v, 3.2) > 1;
        const was = this.cells[y * this.width + x];
        next += out ? '~' : was === '~' ? '.' : was;
      }
    this.cells = next;
  };

  newLevel = () => {
    const fresh = newLevel(this.game, this.width, this.height);
    this.levelId = null;
    this.name = '';
    this.cells = fresh.cells;
    this.message = '';
  };

  saveNow = () => {
    if (this.problem) {
      this.message = this.problem;
      return;
    }
    const stored = saveLevel({ ...this.level, name: this.name || 'Untitled' });
    if (!stored) {
      this.message = "That level couldn't be saved.";
      return;
    }
    this.levelId = stored.id;
    this.name = stored.name;
    this.refresh();
    this.message = `Saved “${stored.name}”. Pick it in the lobby under Your level.`;
  };

  // Save it and go straight back to the lobby with it chosen, which is what you
  // actually want once a level is finished.
  playIt = () => {
    this.saveNow();
    if (this.problem) return;
    this.args.onPlay?.(this.levelId);
  };

  load = (level) => {
    this.levelId = level.id;
    this.name = level.name;
    this.width = level.width;
    this.height = level.height;
    this.cells = level.cells;
    this.message = '';
  };

  remove = async (level) => {
    if (
      !(await askConfirm({
        title: `Delete “${level.name}”?`,
        message:
          'This level is only saved in this browser, so it cannot be recovered.',
        confirmLabel: 'Hold to delete',
        cancelLabel: 'Keep it',
      }))
    )
      return;
    deleteLevel(this.game, level.id);
    if (this.levelId === level.id) this.newLevel();
    this.refresh();
  };

  importLevel = () => {
    const level = decodeLevel(this.importCode);
    if (!level) {
      this.message =
        "That code didn't make sense. Copy the whole thing and try again.";
      return;
    }
    if (level.game !== this.game) {
      this.message = `That code is a ${level.game === 'mines' ? 'Minesweeper' : 'Snake'} level. Open the editor in that game to load it.`;
      return;
    }
    this.load(level);
    const stored = saveLevel(level);
    this.levelId = stored?.id ?? null;
    this.refresh();
    this.importCode = '';
    this.message = `Loaded “${level.name}” and saved it here.`;
  };

  <template>
    <div class="le-page pop-in">
      <div class="le-bar">
        <h2 class="qr-heading">{{this.gameLabel}} level editor</h2>
        <label class="le-field">
          <span class="qr-label is-muted">Name</span>
          <input
            type="text"
            class="math-input"
            maxlength={{this.nameMax}}
            placeholder="My island"
            value={{this.name}}
            {{on "input" this.setName}}
          />
        </label>
        <label class="le-field is-small">
          <span class="qr-label is-muted">Width</span>
          <input
            type="number"
            class="math-input"
            min="8"
            max="40"
            value={{this.width}}
            {{on "change" this.setWidth}}
          />
        </label>
        <label class="le-field is-small">
          <span class="qr-label is-muted">Height</span>
          <input
            type="number"
            class="math-input"
            min="8"
            max="40"
            value={{this.height}}
            {{on "change" this.setHeight}}
          />
        </label>
        {{#if @onClose}}
          <button
            type="button"
            class="btn le-close"
            {{on "click" @onClose}}
          ><Icon @name="x" @size={{13}} /> Back to the lobby</button>
        {{/if}}
      </div>

      <div class="le-main">
        <div class="le-tools">
          <h3 class="qr-heading">Brush</h3>
          <ul class="le-brushes">
            {{#each this.kinds key="char" as |k|}}
              {{#unless (eq k.char ".")}}
                <li>
                  <button
                    type="button"
                    class="le-brush {{if (eq this.brush k.char) 'active'}}"
                    aria-pressed={{if (eq this.brush k.char) "true" "false"}}
                    {{on "click" (fn this.setBrush k.char)}}
                  >
                    <span
                      class="le-swatch is-{{k.id}}"
                      aria-hidden="true"
                    ></span>
                    <span class="le-brush-text">
                      <strong>{{k.label}}</strong>
                      <span class="tool-hint">{{k.hint}}</span>
                    </span>
                  </button>
                </li>
              {{/unless}}
            {{/each}}
          </ul>
          <p class="tool-hint">Drag on the island to paint. Dragging from a
            square that already has the brush on it rubs it out again.</p>
          <p class="tool-hint">Move around with W, A, S and D (or the arrow
            keys), zoom with the wheel, and hold Shift while dragging to tilt
            the island. Q and E turn it.</p>

          <div class="le-actions">
            <button
              type="button"
              class="btn"
              {{on "click" this.fillEdges}}
            ><Icon @name="square" @size={{13}} /> Edge</button>
            <button type="button" class="btn" {{on "click" this.roundOff}}><Icon
                @name="circle-dot"
                @size={{13}}
              />
              Round off</button>
            <button type="button" class="btn" {{on "click" this.clear}}><Icon
                @name="eraser"
                @size={{13}}
              />
              Clear</button>
            <button
              type="button"
              class="btn le-new"
              {{on "click" this.newLevel}}
            ><Icon @name="plus" @size={{13}} /> New</button>
            <button
              type="button"
              class="btn le-save"
              {{on "click" this.saveNow}}
            ><Icon @name="save" @size={{13}} />
              Save</button>
            <button
              type="button"
              class="btn active le-play"
              {{on "click" this.playIt}}
            ><Icon @name="play" @size={{13}} /> Save and play</button>
          </div>
          <p class="tool-hint">{{this.counts.filled}}
            things on
            {{this.counts.playable}}
            playable squares.</p>
          {{#if this.problem}}<p class="tool-error">{{this.problem}}</p>{{/if}}
          {{#if this.message}}<p class="tool-hint">{{this.message}}</p>{{/if}}
        </div>

        <div class="le-canvas-col">
          <div class="le-stage">
            {{#if this.sceneFailed}}
              <p class="fs-empty">The 3D editor couldn't start on this device
                (WebGL is needed). The grid below still works.</p>
            {{else}}
              <canvas
                class="le-stage-canvas"
                aria-label="The level you are building, on its island"
                {{this.editor}}
                {{this.syncScene}}
              ></canvas>
              <div class="le-view-btns">
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Turn left"
                  {{on "click" this.turnLeft}}
                ><Icon @name="chevrons-left" @size={{13}} /></button>
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Turn right"
                  {{on "click" this.turnRight}}
                ><Icon @name="chevrons-right" @size={{13}} /></button>
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Zoom in"
                  {{on "click" this.zoomIn}}
                ><Icon @name="plus" @size={{13}} /></button>
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Zoom out"
                  {{on "click" this.zoomOut}}
                ><Icon @name="minus" @size={{13}} /></button>
                <button
                  type="button"
                  class="qr-icon-btn"
                  aria-label="Reset the view"
                  {{on "click" this.resetView}}
                ><Icon @name="refresh-cw" @size={{13}} /></button>
              </div>
            {{/if}}
          </div>
          <div class="le-grid-head">
            <span class="tool-hint">{{this.hoverLabel}}</span>
            <button
              type="button"
              class="btn {{if this.showGrid 'active'}}"
              aria-pressed={{if this.showGrid "true" "false"}}
              {{on "click" this.toggleGrid}}
            ><Icon @name="grid-3x3" @size={{13}} /> Flat grid</button>
          </div>
          {{#if this.showGrid}}
            <div class="le-grid-wrap">
              <div
                class="le-grid is-{{this.game}}"
                style={{this.gridStyle}}
                role="group"
                aria-label="Level grid"
                {{this.grid}}
              >
                {{#each this.squares key="i" as |sq|}}
                  <button
                    type="button"
                    class="le-cell is-{{sq.kind}}"
                    data-i={{sq.i}}
                    aria-label={{sq.label}}
                    {{on "click" (fn this.tap sq.i)}}
                  ></button>
                {{/each}}
              </div>
            </div>
          {{/if}}
        </div>
      </div>

      <div class="le-lower">
        <section class="le-share">
          <h3 class="qr-heading">Share it</h3>
          <p class="tool-hint">Send this code to a friend and they can paste it
            in below. It carries the whole level, so it works with no internet
            between you.</p>
          <div class="le-share-row">
            <code class="le-code">{{this.shareCode}}</code>
            <CopyButton @value={{this.shareCode}} />
          </div>
          <div class="le-share-row">
            <input
              type="text"
              class="math-input"
              aria-label="A level share code to load"
              placeholder="Paste a code here"
              value={{this.importCode}}
              {{on "input" this.setImportCode}}
            />
            <button
              type="button"
              class="btn le-load"
              disabled={{if this.importCode false true}}
              {{on "click" this.importLevel}}
            ><Icon @name="download" @size={{13}} /> Load</button>
          </div>
        </section>

        <section class="le-saved">
          <h3 class="qr-heading">Your levels</h3>
          {{#if this.saved.length}}
            <ul class="le-list">
              {{#each this.saved key="id" as |lv|}}
                <li
                  class="le-list-row {{if (eq lv.id this.levelId) 'is-open'}}"
                >
                  <button
                    type="button"
                    class="le-list-open"
                    {{on "click" (fn this.load lv)}}
                  >
                    <strong>{{lv.name}}</strong>
                    <span class="tool-hint">{{lv.width}}
                      ×
                      {{lv.height}}</span>
                  </button>
                  <button
                    type="button"
                    class="qr-icon-btn"
                    aria-label="Delete {{lv.name}}"
                    {{on "click" (fn this.remove lv)}}
                  ><Icon @name="trash-2" @size={{13}} /></button>
                </li>
              {{/each}}
            </ul>
          {{else}}
            <p class="fs-empty">Nothing saved yet. Draw something and press
              Save.</p>
          {{/if}}
        </section>
      </div>
    </div>
  </template>
}
