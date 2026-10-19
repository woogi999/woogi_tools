<script module>
  import { onDestroy } from 'svelte';
  import Component from '../core/component.js';
  import { service } from '../core/services.js';
  import { modifier } from '../core/modifier.js';
  import { truthy, on, prop } from '../core/helpers.js';
  import { destroy } from '../core/destroyable.js';
  import ToolPage from './tool-page.svelte';
  import MountInto from '../core/mount-into.svelte';
  import Icon from './icon.svelte';
  import ColourField from './colour-field.svelte';
  import NoteOverlay from './note-overlay.svelte';
  import {
    NOTE_FONTS,
    NOTE_COLORS,
    DEFAULT_NOTE_COLOR,
    STICKER_EMOJIS,
  } from '../utils/notes-constants.js';
  import { htmlToPlainText } from '../utils/html-text.js';
  import { askConfirm } from '../utils/confirm.svelte.js';

  const eq = (a, b) => a === b;
  const not = (a) => !a;

  function fontStackFor(note) {
    if (note.font === 'custom' && note.customFont)
      return `'${note.customFont.name}', sans-serif`;
    return (NOTE_FONTS.find((f) => f.key === note.font) ?? NOTE_FONTS[0]).stack;
  }

  const surfaceStyle = (note) =>
    note.doodle?.height ? `--ink-height:${note.doodle.height}px;` : '';
  const noteAccentStyle = (note) =>
    `--note-accent:${note.color || 'var(--accent)'};--note-font:${fontStackFor(note)};`;
  const swatchStyle = (hex) => `background:${hex};`;
  const fontPreviewStyle = (font) => `font-family:${font.stack};`;

  function stickyStyle(note, index) {
    const bg = note.color || NOTE_COLORS[index % NOTE_COLORS.length];
    const tilt = (index % 2 === 0 ? -1 : 1) * (2 + (index % 3));
    return `background:${bg};--tilt:${tilt}deg;font-family:${fontStackFor(note)};`;
  }

  function noteSnippet(note) {
    const text = htmlToPlainText(note.contentHtml);
    return text.length > 90 ? `${text.slice(0, 90)}…` : text;
  }

  function registerFontFace(name, dataUrl) {
    if ([...document.fonts].some((f) => f.family === name)) return;
    const face = new FontFace(name, `url(${dataUrl})`);
    face
      .load()
      .then((loaded) => document.fonts.add(loaded))
      .catch(() => {});
  }

  // Previews scale the editor's pixel positions down to the card with container units.
  const PREVIEW_FALLBACK_WIDTH = 600;
  const previewUnit = (note) =>
    100 / (note.doodle?.width || PREVIEW_FALLBACK_WIDTH);
  const hasDoodle = (note) =>
    Boolean(note.doodle?.drawingDataUrl || note.doodle?.stickers?.length);
  function previewStickerStyle(note, s) {
    const u = previewUnit(note);
    const size =
      s.type === 'emoji'
        ? `font-size:${s.size * u}cqw;`
        : `width:${s.size * u}cqw;height:${s.size * u}cqw;`;
    return `left:${s.x * u}cqw;top:${s.y * u}cqw;${size}`;
  }

  let stickerCounter = 0;
  const newStickerId = () =>
    `s${Date.now().toString(36)}${(stickerCounter++).toString(36)}`;

  class QuickNotesPage extends Component {
    notes = service('notes');

    railCollapsed = $state.raw(false);
    selectedFolderId = $state.raw(null); // null = All Notes, 'unfiled', or a folder id
    view = $state.raw('list'); // 'list' | 'edit'
    selectedNoteId = $state.raw(null);
    showCustomize = $state.raw(false);
    showStickerMenu = $state.raw(false);
    stickerTab = $state.raw('emoji');
    stickerPopoverStyle = $state.raw(null);
    drawMode = $state.raw(false);
    creatingFolder = $state.raw(false);
    newFolderName = $state.raw('');

    editorEl = null;
    fonts = NOTE_FONTS;
    colors = NOTE_COLORS;
    emojis = STICKER_EMOJIS;

    constructor() {
      super(...arguments);
      for (const note of this.notes.notes) {
        if (note.customFont)
          registerFontFace(note.customFont.name, note.customFont.dataUrl);
      }
    }

    // Lets the command palette open a specific note from outside the tool.
    watchOpenRequest = modifier(() => {
      const id = this.notes.openRequestId;
      if (id && this.notes.notes.some((n) => n.id === id)) {
        this.selectedNoteId = id;
        this.view = 'edit';
        this.drawMode = false;
        this.notes.openRequestId = null;
      }
    });

    // ─── Rail / folders ──────────────────────────────────────────────────

    toggleRail = () => (this.railCollapsed = !this.railCollapsed);

    get folders() {
      return this.notes.folders;
    }

    get folderTitle() {
      if (this.selectedFolderId === null) return 'All Notes';
      if (this.selectedFolderId === 'unfiled') return 'Unfiled';
      return (
        this.folders.find((f) => f.id === this.selectedFolderId)?.name ??
        'Notes'
      );
    }

    selectFolder = (id) => {
      this.selectedFolderId = id;
      this.view = 'list';
    };

    startNewFolder = () => (this.creatingFolder = true);
    setNewFolderName = (event) => (this.newFolderName = event.target.value);

    submitNewFolder = (event) => {
      event.preventDefault();
      if (!this.creatingFolder) return;
      const name = this.newFolderName.trim();
      if (name) this.notes.createFolder(name);
      this.newFolderName = '';
      this.creatingFolder = false;
    };

    renameFolder = (id) => {
      const folder = this.folders.find((f) => f.id === id);
      const name = window.prompt('Rename folder', folder?.name ?? '');
      if (name && name.trim()) this.notes.renameFolder(id, name.trim());
    };

    deleteFolder = async (id, event) => {
      event?.stopPropagation();
      if (
        !(await askConfirm({
          title: 'Delete this folder?',
          message: 'The folder goes; its notes move to Unfiled.',
          confirmLabel: 'Hold to delete',
          holdMs: 1500,
        }))
      )
        return;
      if (this.selectedFolderId === id) this.selectedFolderId = null;
      this.notes.deleteFolder(id);
    };

    // ─── List / navigation ───────────────────────────────────────────────

    get visibleNotes() {
      const all = this.notes.notes;
      const list =
        this.selectedFolderId === null
          ? all
          : this.selectedFolderId === 'unfiled'
            ? all.filter((n) => !n.folderId)
            : all.filter((n) => n.folderId === this.selectedFolderId);
      return [...list].sort((a, b) => b.updatedAt - a.updatedAt);
    }

    get currentNote() {
      return this.notes.notes.find((n) => n.id === this.selectedNoteId) ?? null;
    }

    createNote = () => {
      const folderId =
        this.selectedFolderId && this.selectedFolderId !== 'unfiled'
          ? this.selectedFolderId
          : null;
      const note = this.notes.createNote(folderId);
      this.openNote(note.id);
    };

    openNote = (id) => {
      this.selectedNoteId = id;
      this.view = 'edit';
      this.showCustomize = false;
      this.showStickerMenu = false;
      this.drawMode = false;
    };

    backToList = () => {
      this.view = 'list';
      this.drawMode = false;
    };

    deleteNote = async (id, event) => {
      event?.stopPropagation();
      if (
        !(await askConfirm({
          title: 'Delete this note?',
          message: 'It can’t be brought back.',
          confirmLabel: 'Hold to delete',
          holdMs: 1500,
        }))
      )
        return;
      if (this.selectedNoteId === id) this.view = 'list';
      this.notes.deleteNote(id);
    };

    setTitle = (event) =>
      this.notes.updateNote(this.selectedNoteId, { title: event.target.value });

    // ─── Customize ───────────────────────────────────────────────────────

    toggleCustomize = () => (this.showCustomize = !this.showCustomize);
    setColor = (hex) =>
      this.notes.updateNote(this.selectedNoteId, { color: hex });
    setFont = (key) =>
      this.notes.updateNote(this.selectedNoteId, {
        font: key,
        customFont: null,
      });

    uploadCustomFont = (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        const name = `note-font-${this.selectedNoteId}`;
        registerFontFace(name, reader.result);
        this.notes.updateNote(this.selectedNoteId, {
          font: 'custom',
          customFont: { name, dataUrl: reader.result },
        });
      };
      reader.readAsDataURL(file);
    };

    // ─── Write mode (contenteditable) ───────────────────────────────────

    setEditorContent = modifier((element, [noteId, html]) => {
      this.editorEl = element;
      if (element.dataset.noteId !== String(noteId)) {
        element.innerHTML = html ?? '';
        element.dataset.noteId = String(noteId);
      }
    });

    onEditorInput = (event) => {
      this.notes.updateNote(this.selectedNoteId, {
        contentHtml: event.target.innerHTML,
      });
    };

    syncFromEditor() {
      if (!this.editorEl) return;
      this.notes.updateNote(this.selectedNoteId, {
        contentHtml: this.editorEl.innerHTML,
      });
    }

    onEditorKeydown = (event) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
        return;
      const command = { b: 'bold', i: 'italic' }[event.key.toLowerCase()];
      if (!command) return;
      event.preventDefault();
      this.exec(command);
    };

    exec = (command) => {
      this.editorEl?.focus();
      document.execCommand(command, false, null);
      this.syncFromEditor();
    };

    formatBlock = (tag) => {
      this.editorEl?.focus();
      document.execCommand('formatBlock', false, tag);
      this.syncFromEditor();
    };

    insertCodeInline = () => {
      this.editorEl?.focus();
      const sel = window.getSelection();
      if (
        !sel ||
        sel.rangeCount === 0 ||
        !this.editorEl.contains(sel.anchorNode)
      )
        return;
      const range = sel.getRangeAt(0);
      const code = document.createElement('code');
      if (range.collapsed) code.textContent = 'code';
      else code.appendChild(range.extractContents());
      range.insertNode(code);
      this.syncFromEditor();
    };

    // ─── Draw + stickers overlay ─────────────────────────────────────────

    toggleDraw = () => {
      this.drawMode = !this.drawMode;
      this.showStickerMenu = false;
    };

    get popoverHost() {
      return document.body;
    }

    // The popover renders into <body> so the notes shell's overflow can't clip it;
    // it's anchored under the button in page coordinates.
    toggleStickerMenu = (event) => {
      this.drawMode = false;
      if (this.showStickerMenu) {
        this.showStickerMenu = false;
        return;
      }
      const rect = event.currentTarget.getBoundingClientRect();
      const left =
        Math.max(8, Math.min(rect.right - 220, window.innerWidth - 228)) +
        window.scrollX;
      this.stickerPopoverStyle = `top:${rect.bottom + window.scrollY + 6}px;left:${left}px;`;
      this.showStickerMenu = true;
    };

    dismissStickerMenu = modifier((element) => {
      const onPointer = (event) => {
        if (
          !element.contains(event.target) &&
          !event.target.closest('.sticker-toggle')
        )
          this.showStickerMenu = false;
      };
      const onKey = (event) => {
        if (event.key === 'Escape') this.showStickerMenu = false;
      };
      document.addEventListener('pointerdown', onPointer);
      document.addEventListener('keydown', onKey);
      return () => {
        document.removeEventListener('pointerdown', onPointer);
        document.removeEventListener('keydown', onKey);
      };
    });

    setStickerTab = (tab) => (this.stickerTab = tab);

    onOverlayChange = (patch) => {
      this.notes.updateNote(this.selectedNoteId, {
        doodle: { ...this.currentNote.doodle, ...patch },
      });
    };

    addEmojiSticker = (emoji) => {
      const sticker = {
        id: newStickerId(),
        type: 'emoji',
        content: emoji,
        x: 20,
        y: 20,
        size: 40,
      };
      this.onOverlayChange({
        stickers: [...(this.currentNote.doodle?.stickers ?? []), sticker],
      });
      this.showStickerMenu = false;
    };

    uploadImageSticker = (event) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file?.type.startsWith('image/')) return;
      const reader = new FileReader();
      reader.onload = () => {
        const sticker = {
          id: newStickerId(),
          type: 'image',
          content: reader.result,
          x: 20,
          y: 20,
          size: 90,
        };
        this.onOverlayChange({
          stickers: [...(this.currentNote.doodle?.stickers ?? []), sticker],
        });
      };
      reader.readAsDataURL(file);
      this.showStickerMenu = false;
    };
  }
</script>

<script>
  let args = $props();
  const self = new QuickNotesPage(args);
  onDestroy(() => destroy(self));
</script>

{#snippet StickyCard(args)}
  <div class="sticky-note" style={stickyStyle(args.note, args.index)}>
    {#if truthy(hasDoodle(args.note))}
      <div class="sticky-doodle" aria-hidden="true">
        {#if truthy(args.note?.doodle?.drawingDataUrl)}
          <img
            class="sticky-doodle-ink"
            src={args.note?.doodle?.drawingDataUrl}
            alt=""
          />
        {/if}
        {#each args.note?.doodle?.stickers ?? [] as sticker}
          <span
            class="sticky-doodle-sticker"
            style={previewStickerStyle(args.note, sticker)}
          >
            {#if truthy(eq(sticker?.type, 'emoji'))}{sticker?.content}{:else}<img
                src={sticker?.content}
                alt=""
              />{/if}
          </span>
        {/each}
      </div>
    {/if}
    <button
      type="button"
      class="sticky-delete"
      aria-label="Delete note"
      onclick={args.onDelete}><Icon name="x" size={12} /></button
    >
    <button type="button" class="sticky-note-btn" onclick={args.onOpen}>
      <span class="sticky-title"
        >{truthy(args.note?.title) ? args.note?.title : 'Untitled'}</span
      >
      <span class="sticky-snippet">{noteSnippet(args.note)}</span>
    </button>
  </div>
{/snippet}

<ToolPage
  route="quick-notes"
  subtitle="Write, doodle and add stickers to your notes, then sort them into folders. Saved in your browser, no account needed."
>
  <div
    class="notes-shell"
    {@attach self.watchOpenRequest?.([self.notes?.openRequestId])}
  >
    <aside
      class="notes-rail {truthy(self.railCollapsed) ? 'is-collapsed' : ''}"
    >
      <button
        type="button"
        class="notes-rail-toggle"
        aria-label="{truthy(self.railCollapsed)
          ? 'Expand'
          : 'Collapse'} folders"
        onclick={self.toggleRail}
      >
        <Icon
          name={truthy(self.railCollapsed) ? 'chevrons-right' : 'chevrons-left'}
          size={14}
        />
      </button>
      <div class="notes-rail-items" inert={self.railCollapsed}>
        <button
          type="button"
          class="notes-rail-item
                {truthy(eq(self.selectedFolderId, null)) ? 'active' : ''}"
          onclick={(..._r) => self.selectFolder(null, ..._r)}
        >
          <Icon name="notebook" size={15} />
          All Notes
        </button>
        <button
          type="button"
          class="notes-rail-item
                {truthy(eq(self.selectedFolderId, 'unfiled')) ? 'active' : ''}"
          onclick={(..._r) => self.selectFolder('unfiled', ..._r)}
        >
          <Icon name="file-text" size={15} />
          Unfiled
        </button>
        <div class="notes-rail-divider"></div>
        {#each self.folders ?? [] as folder}
          <div class="notes-rail-row">
            <button
              type="button"
              class="notes-rail-item
                    {truthy(eq(self.selectedFolderId, folder?.id))
                ? 'active'
                : ''}"
              onclick={(..._r) => self.selectFolder(folder?.id, ..._r)}
            >
              <Icon name="folder" size={15} />
              <span class="notes-rail-label">{folder?.name}</span>
            </button>
            <div class="notes-rail-row-actions">
              <button
                type="button"
                class="notes-rail-icon-btn"
                aria-label="Rename folder"
                onclick={(..._r) => self.renameFolder(folder?.id, ..._r)}
                ><Icon name="square-pen" size={12} /></button
              >
              <button
                type="button"
                class="notes-rail-icon-btn"
                aria-label="Delete folder"
                {@attach on('click', (..._r) =>
                  self.deleteFolder(folder?.id, ..._r),
                )}><Icon name="x" size={12} /></button
              >
            </div>
          </div>
        {/each}
        {#if truthy(self.creatingFolder)}
          <form class="notes-new-folder" onsubmit={self.submitNewFolder}>
            <input
              type="text"
              placeholder="Folder name"
              aria-label="Folder name"
              {@attach prop('value', () => self.newFolderName)}
              onblur={self.submitNewFolder}
              oninput={self.setNewFolderName}
            />
          </form>
        {:else}
          <button
            type="button"
            class="notes-rail-item is-add"
            onclick={self.startNewFolder}
            ><Icon name="folder-plus" size={15} /> New Folder</button
          >
        {/if}
      </div>
    </aside>

    <div class="notes-main">
      {#if truthy(eq(self.view, 'edit'))}
        {#if truthy(self.currentNote)}
          <div class="notes-editor" style={noteAccentStyle(self.currentNote)}>
            <div class="notes-editor-head">
              <button
                type="button"
                class="editor-tool"
                aria-label="Back to notes"
                onclick={self.backToList}
                ><Icon name="arrow-left" size={15} /></button
              >
              <input
                type="text"
                class="notes-title-input"
                placeholder="Untitled"
                aria-label="Note title"
                {@attach prop('value', () => self.currentNote?.title)}
                oninput={self.setTitle}
              />
              <div class="notes-editor-actions">
                <button
                  type="button"
                  class="editor-tool {truthy(self.showCustomize)
                    ? 'active'
                    : ''}"
                  aria-label="Customize note"
                  onclick={self.toggleCustomize}
                  ><Icon name="palette" size={15} /></button
                >
                <button
                  type="button"
                  class="editor-tool is-danger"
                  aria-label="Delete note"
                  {@attach on('click', (..._r) =>
                    self.deleteNote(self.currentNote?.id, ..._r),
                  )}><Icon name="trash-2" size={15} /></button
                >
              </div>
            </div>

            {#if truthy(self.showCustomize)}
              <div class="notes-customize pop-in">
                <div class="notes-customize-row">
                  <span class="qr-label is-muted">Colour</span>
                  <div class="notes-color-row">
                    {#each self.colors ?? [] as c}
                      <button
                        type="button"
                        class="notes-color-swatch
                              {truthy(eq(self.currentNote?.color, c))
                          ? 'active'
                          : ''}"
                        style={swatchStyle(c)}
                        onclick={(..._r) => self.setColor(c, ..._r)}
                      ></button>
                    {/each}
                    <ColourField
                      label="Custom note colour"
                      value={truthy(self.currentNote?.color)
                        ? self.currentNote?.color
                        : DEFAULT_NOTE_COLOR}
                      onChange={self.setColor}
                    />
                  </div>
                </div>
                <div class="notes-customize-row">
                  <span class="qr-label is-muted">Font</span>
                  <div class="notes-font-row">
                    {#each self.fonts ?? [] as font}
                      <button
                        type="button"
                        class="qr-chip
                              {truthy(eq(self.currentNote?.font, font?.key))
                          ? 'active'
                          : ''}"
                        style={fontPreviewStyle(font)}
                        onclick={(..._r) => self.setFont(font?.key, ..._r)}
                        >{font?.label}</button
                      >
                    {/each}
                    <label
                      class="qr-chip
                            {truthy(eq(self.currentNote?.font, 'custom'))
                        ? 'active'
                        : ''}"
                    >
                      <Icon name="type" size={12} />
                      Upload font
                      <input
                        type="file"
                        accept=".woff,.woff2,.ttf,.otf"
                        class="sr-only"
                        onchange={self.uploadCustomFont}
                      />
                    </label>
                  </div>
                  {#if truthy(self.currentNote?.customFont)}
                    <p class="tool-hint"
                      >Using "{self.currentNote?.customFont?.name}"</p
                    >
                  {/if}
                </div>
              </div>
            {/if}

            <div class="editor-toolbar">
              <button
                type="button"
                class="editor-tool"
                aria-label="Bold"
                title="Bold (Ctrl+B)"
                onclick={(..._r) => self.exec('bold', ..._r)}
                ><Icon name="bold" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Italic"
                title="Italic (Ctrl+I)"
                onclick={(..._r) => self.exec('italic', ..._r)}
                ><Icon name="italic" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool is-text"
                onclick={(..._r) => self.formatBlock('H1', ..._r)}>H1</button
              >
              <button
                type="button"
                class="editor-tool is-text"
                onclick={(..._r) => self.formatBlock('H2', ..._r)}>H2</button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Bullet list"
                onclick={(..._r) => self.exec('insertUnorderedList', ..._r)}
                ><Icon name="list" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Numbered list"
                onclick={(..._r) => self.exec('insertOrderedList', ..._r)}
                ><Icon name="list-ordered" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Quote"
                onclick={(..._r) => self.formatBlock('BLOCKQUOTE', ..._r)}
                ><Icon name="quote" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Inline code"
                onclick={self.insertCodeInline}
                ><Icon name="code" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool"
                aria-label="Divider"
                onclick={(..._r) => self.exec('insertHorizontalRule', ..._r)}
                ><Icon name="minus" size={14} /></button
              >
              <span class="editor-toolbar-spacer"></span>
              <button
                type="button"
                class="editor-tool {truthy(self.drawMode) ? 'active' : ''}"
                aria-label="Draw"
                title="Draw"
                onclick={self.toggleDraw}
                ><Icon name="pen-line" size={14} /></button
              >
              <button
                type="button"
                class="editor-tool sticker-toggle
                      {truthy(self.showStickerMenu) ? 'active' : ''}"
                aria-label="Add sticker or image"
                title="Sticker"
                onclick={self.toggleStickerMenu}
                ><Icon name="sticker" size={14} /></button
              >
              {#if truthy(self.showStickerMenu)}
                {#snippet stickerPopover()}
                  <div
                    class="sticker-popover pop-in"
                    style={self.stickerPopoverStyle}
                    {@attach self.dismissStickerMenu?.()}
                  >
                    <div class="sticker-tabs">
                      <button
                        type="button"
                        class="qr-chip
                              {truthy(eq(self.stickerTab, 'emoji'))
                          ? 'active'
                          : ''}"
                        onclick={(..._r) => self.setStickerTab('emoji', ..._r)}
                        >Emoji</button
                      >
                      <button
                        type="button"
                        class="qr-chip
                              {truthy(eq(self.stickerTab, 'upload'))
                          ? 'active'
                          : ''}"
                        onclick={(..._r) => self.setStickerTab('upload', ..._r)}
                        >Image</button
                      >
                    </div>
                    {#if truthy(eq(self.stickerTab, 'emoji'))}
                      <div class="emoji-grid">
                        {#each self.emojis ?? [] as emoji}
                          <button
                            type="button"
                            class="emoji-btn"
                            onclick={(..._r) =>
                              self.addEmojiSticker(emoji, ..._r)}
                            >{emoji}</button
                          >
                        {/each}
                      </div>
                    {:else}
                      <label class="btn sticker-upload-btn">
                        <Icon name="image-plus" size={14} />
                        Choose image
                        <input
                          type="file"
                          accept="image/*"
                          class="sr-only"
                          onchange={self.uploadImageSticker}
                        />
                      </label>
                    {/if}
                  </div>
                {/snippet}
                <MountInto snippet={stickerPopover} target={self.popoverHost} />
              {/if}
            </div>

            <div class="note-surface" style={surfaceStyle(self.currentNote)}>
              <!-- a contenteditable surface is a multi-line text box, and
                  saying so is what makes it reachable and announced -->
              <div
                class="notes-content"
                contenteditable="true"
                role="textbox"
                aria-multiline="true"
                aria-label="Note body"
                spellcheck="true"
                onkeydown={self.onEditorKeydown}
                oninput={self.onEditorInput}
                {@attach self.setEditorContent?.([
                  self.selectedNoteId,
                  self.currentNote?.contentHtml,
                ])}
              ></div>
              <NoteOverlay
                noteKey={self.selectedNoteId}
                doodle={self.currentNote?.doodle}
                onChange={self.onOverlayChange}
                drawing={self.drawMode}
                interactive={not(self.drawMode)}
              />
            </div>
          </div>
        {/if}
      {:else}
        <div class="notes-list-head">
          <h3>{self.folderTitle}</h3>
        </div>
        <div class="sticky-grid">
          <button
            type="button"
            class="sticky-note is-add"
            onclick={self.createNote}
          >
            <Icon name="file-plus" size={22} />
            <span>New Note</span>
          </button>
          {#each self.visibleNotes ?? [] as note, index}
            {@render StickyCard({
              note: note,
              index: index,
              onOpen: (..._r) => self.openNote(note?.id, ..._r),
              onDelete: (..._r) => self.deleteNote(note?.id, ..._r),
            })}
          {/each}
        </div>
      {/if}
    </div>
  </div>
</ToolPage>
