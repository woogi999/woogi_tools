<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import Icon from './icon.svelte';
  import CopyButton from './copy-button.svelte';
  import { keepState } from '../utils/tool-state.js';
  import { askConfirm } from '../utils/confirm.svelte.js';
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
  } from '../utils/levels.js';

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

  class LevelEditor extends Component {
    name = $state.raw('');
    width = $state.raw(20);
    height = $state.raw(20);
    cells = $state.raw(blankCells(20, 20));
    brush = $state.raw('r');
    levelId = $state.raw(null);
    importCode = $state.raw('');
    message = $state.raw('');
    saved = $state.raw([]);
    sceneFailed = $state.raw(false);
    showGrid = $state.raw(false);
    hovered = $state.raw(null);
    scene = null;

    sizeRange = SIZE_RANGE;
    nameMax = NAME_MAX;
    painting = null;

    constructor(args) {
      super(args);
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
      import('../lazy/level-editor-3d.js')
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
      return `--cols:${this.width}`;
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
      const stored = saveLevel({
        ...this.level,
        name: this.name || 'Untitled',
      });
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
  }
</script>

<script>
  let args = $props();
  const self = new LevelEditor(args);
  onDestroy(() => destroy(self));
</script>

<div class="le-page pop-in">
  <div class="le-bar">
    <h2 class="qr-heading">{self.gameLabel} level editor</h2>
    <label class="le-field">
      <span class="qr-label is-muted">Name</span>
      <input
        type="text"
        class="math-input"
        maxlength={self.nameMax}
        placeholder="My island"
        {@attach prop('value', () => self.name)}
        oninput={self.setName}
      />
    </label>
    <label class="le-field is-small">
      <span class="qr-label is-muted">Width</span>
      <input
        type="number"
        class="math-input"
        min="8"
        max="40"
        {@attach prop('value', () => self.width)}
        onchange={self.setWidth}
      />
    </label>
    <label class="le-field is-small">
      <span class="qr-label is-muted">Height</span>
      <input
        type="number"
        class="math-input"
        min="8"
        max="40"
        {@attach prop('value', () => self.height)}
        onchange={self.setHeight}
      />
    </label>
    {#if truthy(args.onClose)}
      <button type="button" class="btn le-close" onclick={args.onClose}
        ><Icon name="x" size={13} /> Back to the lobby</button
      >
    {/if}
  </div>

  <div class="le-main">
    <div class="le-tools">
      <h3 class="qr-heading">Brush</h3>
      <ul class="le-brushes">
        {#each self.kinds ?? [] as k}
          {#if !truthy(eq(k?.char, '.'))}
            <li>
              <button
                type="button"
                class="le-brush {truthy(eq(self.brush, k?.char))
                  ? 'active'
                  : ''}"
                aria-pressed={truthy(eq(self.brush, k?.char))
                  ? 'true'
                  : 'false'}
                onclick={(..._r) => self.setBrush(k?.char, ..._r)}
              >
                <span class="le-swatch is-{k?.id}" aria-hidden="true"></span>
                <span class="le-brush-text">
                  <strong>{k?.label}</strong>
                  <span class="tool-hint">{k?.hint}</span>
                </span>
              </button>
            </li>
          {/if}
        {/each}
      </ul>
      <p class="tool-hint"
        >Drag on the island to paint. Dragging from a square that already has
        the brush on it rubs it out again.</p
      >
      <p class="tool-hint"
        >Move around with W, A, S and D (or the arrow keys), zoom with the
        wheel, and hold Shift while dragging to tilt the island. Q and E turn
        it.</p
      >

      <div class="le-actions">
        <button type="button" class="btn" onclick={self.fillEdges}
          ><Icon name="square" size={13} /> Edge</button
        >
        <button type="button" class="btn" onclick={self.roundOff}
          ><Icon name="circle-dot" size={13} />
          Round off</button
        >
        <button type="button" class="btn" onclick={self.clear}
          ><Icon name="eraser" size={13} />
          Clear</button
        >
        <button type="button" class="btn le-new" onclick={self.newLevel}
          ><Icon name="plus" size={13} /> New</button
        >
        <button type="button" class="btn le-save" onclick={self.saveNow}
          ><Icon name="save" size={13} />
          Save</button
        >
        <button type="button" class="btn active le-play" onclick={self.playIt}
          ><Icon name="play" size={13} /> Save and play</button
        >
      </div>
      <p class="tool-hint"
        >{self.counts?.filled}
        things on
        {self.counts?.playable}
        playable squares.</p
      >
      {#if truthy(self.problem)}<p class="tool-error">{self.problem}</p>{/if}
      {#if truthy(self.message)}<p class="tool-hint">{self.message}</p>{/if}
    </div>

    <div class="le-canvas-col">
      <div class="le-stage">
        {#if truthy(self.sceneFailed)}
          <p class="fs-empty"
            >The 3D editor couldn't start on this device (WebGL is needed). The
            grid below still works.</p
          >
        {:else}
          <canvas
            class="le-stage-canvas"
            aria-label="The level you are building, on its island"
            {@attach self.editor?.()}
            {@attach self.syncScene?.()}
          ></canvas>
          <div class="le-view-btns">
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Turn left"
              onclick={self.turnLeft}
              ><Icon name="chevrons-left" size={13} /></button
            >
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Turn right"
              onclick={self.turnRight}
              ><Icon name="chevrons-right" size={13} /></button
            >
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Zoom in"
              onclick={self.zoomIn}><Icon name="plus" size={13} /></button
            >
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Zoom out"
              onclick={self.zoomOut}><Icon name="minus" size={13} /></button
            >
            <button
              type="button"
              class="qr-icon-btn"
              aria-label="Reset the view"
              onclick={self.resetView}
              ><Icon name="refresh-cw" size={13} /></button
            >
          </div>
        {/if}
      </div>
      <div class="le-grid-head">
        <span class="tool-hint">{self.hoverLabel}</span>
        <button
          type="button"
          class="btn {truthy(self.showGrid) ? 'active' : ''}"
          aria-pressed={truthy(self.showGrid) ? 'true' : 'false'}
          onclick={self.toggleGrid}
          ><Icon name="grid-3x3" size={13} /> Flat grid</button
        >
      </div>
      {#if truthy(self.showGrid)}
        <div class="le-grid-wrap">
          <div
            class="le-grid is-{self.game}"
            style={self.gridStyle}
            role="group"
            aria-label="Level grid"
            {@attach self.grid?.()}
          >
            {#each self.squares ?? [] as sq}
              <button
                type="button"
                class="le-cell is-{sq?.kind}"
                data-i={sq?.i}
                aria-label={sq?.label}
                onclick={(..._r) => self.tap(sq?.i, ..._r)}
              ></button>
            {/each}
          </div>
        </div>
      {/if}
    </div>
  </div>

  <div class="le-lower">
    <section class="le-share">
      <h3 class="qr-heading">Share it</h3>
      <p class="tool-hint"
        >Send this code to a friend and they can paste it in below. It carries
        the whole level, so it works with no internet between you.</p
      >
      <div class="le-share-row">
        <code class="le-code">{self.shareCode}</code>
        <CopyButton value={self.shareCode} />
      </div>
      <div class="le-share-row">
        <input
          type="text"
          class="math-input"
          aria-label="A level share code to load"
          placeholder="Paste a code here"
          {@attach prop('value', () => self.importCode)}
          oninput={self.setImportCode}
        />
        <button
          type="button"
          class="btn le-load"
          disabled={truthy(self.importCode) ? false : true}
          onclick={self.importLevel}
          ><Icon name="download" size={13} /> Load</button
        >
      </div>
    </section>

    <section class="le-saved">
      <h3 class="qr-heading">Your levels</h3>
      {#if truthy(self.saved?.length)}
        <ul class="le-list">
          {#each self.saved ?? [] as lv (lv?.id)}
            <li
              class="le-list-row {truthy(eq(lv?.id, self.levelId))
                ? 'is-open'
                : ''}"
            >
              <button
                type="button"
                class="le-list-open"
                onclick={(..._r) => self.load(lv, ..._r)}
              >
                <strong>{lv?.name}</strong>
                <span class="tool-hint"
                  >{lv?.width}
                  ×
                  {lv?.height}</span
                >
              </button>
              <button
                type="button"
                class="qr-icon-btn"
                aria-label="Delete {lv?.name}"
                onclick={(..._r) => self.remove(lv, ..._r)}
                ><Icon name="trash-2" size={13} /></button
              >
            </li>
          {/each}
        </ul>
      {:else}
        <p class="fs-empty">Nothing saved yet. Draw something and press Save.</p
        >
      {/if}
    </section>
  </div>
</div>
