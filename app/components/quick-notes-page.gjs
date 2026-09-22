import Component from '@glimmer/component';
import { tracked } from '@glimmer/tracking';
import { service } from '@ember/service';
import { on } from '@ember/modifier';
import { fn } from '@ember/helper';
import { htmlSafe } from '@ember/template';
import { modifier } from 'ember-modifier';
import ToolPage from './tool-page';
import Icon from './icon';
import ColourField from './colour-field';
import NoteOverlay from './note-overlay';
import {
  NOTE_FONTS,
  NOTE_COLORS,
  DEFAULT_NOTE_COLOR,
  STICKER_EMOJIS,
} from '../utils/notes-constants';
import { htmlToPlainText } from '../utils/html-text';
import { askConfirm } from '../utils/confirm';

const eq = (a, b) => a === b;
const not = (a) => !a;

function fontStackFor(note) {
  if (note.font === 'custom' && note.customFont)
    return `'${note.customFont.name}', sans-serif`;
  return (NOTE_FONTS.find((f) => f.key === note.font) ?? NOTE_FONTS[0]).stack;
}

const surfaceStyle = (note) =>
  htmlSafe(note.doodle?.height ? `--ink-height:${note.doodle.height}px;` : '');
const noteAccentStyle = (note) =>
  htmlSafe(
    `--note-accent:${note.color || 'var(--accent)'};--note-font:${fontStackFor(note)};`,
  );
const swatchStyle = (hex) => htmlSafe(`background:${hex};`);
const fontPreviewStyle = (font) => htmlSafe(`font-family:${font.stack};`);

function stickyStyle(note, index) {
  const bg = note.color || NOTE_COLORS[index % NOTE_COLORS.length];
  const tilt = (index % 2 === 0 ? -1 : 1) * (2 + (index % 3));
  return htmlSafe(
    `background:${bg};--tilt:${tilt}deg;font-family:${fontStackFor(note)};`,
  );
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
  return htmlSafe(`left:${s.x * u}cqw;top:${s.y * u}cqw;${size}`);
}

let stickerCounter = 0;
const newStickerId = () =>
  `s${Date.now().toString(36)}${(stickerCounter++).toString(36)}`;

export default class QuickNotesPage extends Component {
  @service notes;

  @tracked railCollapsed = false;
  @tracked selectedFolderId = null; // null = All Notes, 'unfiled', or a folder id
  @tracked view = 'list'; // 'list' | 'edit'
  @tracked selectedNoteId = null;
  @tracked showCustomize = false;
  @tracked showStickerMenu = false;
  @tracked stickerTab = 'emoji';
  @tracked stickerPopoverStyle = null;
  @tracked drawMode = false;
  @tracked creatingFolder = false;
  @tracked newFolderName = '';

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
      this.folders.find((f) => f.id === this.selectedFolderId)?.name ?? 'Notes'
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
    this.notes.updateNote(this.selectedNoteId, { font: key, customFont: null });

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
    if (!sel || sel.rangeCount === 0 || !this.editorEl.contains(sel.anchorNode))
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
    this.stickerPopoverStyle = htmlSafe(
      `top:${rect.bottom + window.scrollY + 6}px;left:${left}px;`,
    );
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

  <template>
    <ToolPage
      @route="quick-notes"
      @subtitle="Write, doodle and add stickers to your notes, then sort them into folders. Saved in your browser, no account needed."
    >
      <div
        class="notes-shell"
        {{this.watchOpenRequest this.notes.openRequestId}}
      >
        <aside class="notes-rail {{if this.railCollapsed 'is-collapsed'}}">
          <button
            type="button"
            class="notes-rail-toggle"
            aria-label="{{if this.railCollapsed 'Expand' 'Collapse'}} folders"
            {{on "click" this.toggleRail}}
          >
            <Icon
              @name={{if this.railCollapsed "chevrons-right" "chevrons-left"}}
              @size={{14}}
            />
          </button>
          <div class="notes-rail-items" inert={{this.railCollapsed}}>
            <button
              type="button"
              class="notes-rail-item
                {{if (eq this.selectedFolderId null) 'active'}}"
              {{on "click" (fn this.selectFolder null)}}
            >
              <Icon @name="notebook" @size={{15}} />
              All Notes
            </button>
            <button
              type="button"
              class="notes-rail-item
                {{if (eq this.selectedFolderId 'unfiled') 'active'}}"
              {{on "click" (fn this.selectFolder "unfiled")}}
            >
              <Icon @name="file-text" @size={{15}} />
              Unfiled
            </button>
            <div class="notes-rail-divider"></div>
            {{#each this.folders as |folder|}}
              <div class="notes-rail-row">
                <button
                  type="button"
                  class="notes-rail-item
                    {{if (eq this.selectedFolderId folder.id) 'active'}}"
                  {{on "click" (fn this.selectFolder folder.id)}}
                >
                  <Icon @name="folder" @size={{15}} />
                  <span class="notes-rail-label">{{folder.name}}</span>
                </button>
                <div class="notes-rail-row-actions">
                  <button
                    type="button"
                    class="notes-rail-icon-btn"
                    aria-label="Rename folder"
                    {{on "click" (fn this.renameFolder folder.id)}}
                  ><Icon @name="square-pen" @size={{12}} /></button>
                  <button
                    type="button"
                    class="notes-rail-icon-btn"
                    aria-label="Delete folder"
                    {{on "click" (fn this.deleteFolder folder.id)}}
                  ><Icon @name="x" @size={{12}} /></button>
                </div>
              </div>
            {{/each}}
            {{#if this.creatingFolder}}
              <form
                class="notes-new-folder"
                {{on "submit" this.submitNewFolder}}
              >
                <input
                  type="text"
                  placeholder="Folder name"
                  aria-label="Folder name"
                  value={{this.newFolderName}}
                  {{on "input" this.setNewFolderName}}
                  {{on "blur" this.submitNewFolder}}
                />
              </form>
            {{else}}
              <button
                type="button"
                class="notes-rail-item is-add"
                {{on "click" this.startNewFolder}}
              ><Icon @name="folder-plus" @size={{15}} /> New Folder</button>
            {{/if}}
          </div>
        </aside>

        <div class="notes-main">
          {{#if (eq this.view "edit")}}
            {{#if this.currentNote}}
              <div
                class="notes-editor"
                style={{noteAccentStyle this.currentNote}}
              >
                <div class="notes-editor-head">
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Back to notes"
                    {{on "click" this.backToList}}
                  ><Icon @name="arrow-left" @size={{15}} /></button>
                  <input
                    type="text"
                    class="notes-title-input"
                    placeholder="Untitled"
                    aria-label="Note title"
                    value={{this.currentNote.title}}
                    {{on "input" this.setTitle}}
                  />
                  <div class="notes-editor-actions">
                    <button
                      type="button"
                      class="editor-tool {{if this.showCustomize 'active'}}"
                      aria-label="Customize note"
                      {{on "click" this.toggleCustomize}}
                    ><Icon @name="palette" @size={{15}} /></button>
                    <button
                      type="button"
                      class="editor-tool is-danger"
                      aria-label="Delete note"
                      {{on "click" (fn this.deleteNote this.currentNote.id)}}
                    ><Icon @name="trash-2" @size={{15}} /></button>
                  </div>
                </div>

                {{#if this.showCustomize}}
                  <div class="notes-customize pop-in">
                    <div class="notes-customize-row">
                      <span class="qr-label is-muted">Colour</span>
                      <div class="notes-color-row">
                        {{#each this.colors as |c|}}
                          <button
                            type="button"
                            class="notes-color-swatch
                              {{if (eq this.currentNote.color c) 'active'}}"
                            style={{swatchStyle c}}
                            {{on "click" (fn this.setColor c)}}
                          ></button>
                        {{/each}}
                        <ColourField
                          @label="Custom note colour"
                          @value={{if
                            this.currentNote.color
                            this.currentNote.color
                            DEFAULT_NOTE_COLOR
                          }}
                          @onChange={{this.setColor}}
                        />
                      </div>
                    </div>
                    <div class="notes-customize-row">
                      <span class="qr-label is-muted">Font</span>
                      <div class="notes-font-row">
                        {{#each this.fonts as |font|}}
                          <button
                            type="button"
                            class="qr-chip
                              {{if
                                (eq this.currentNote.font font.key)
                                'active'
                              }}"
                            style={{fontPreviewStyle font}}
                            {{on "click" (fn this.setFont font.key)}}
                          >{{font.label}}</button>
                        {{/each}}
                        <label
                          class="qr-chip
                            {{if (eq this.currentNote.font 'custom') 'active'}}"
                        >
                          <Icon @name="type" @size={{12}} />
                          Upload font
                          <input
                            type="file"
                            accept=".woff,.woff2,.ttf,.otf"
                            class="sr-only"
                            {{on "change" this.uploadCustomFont}}
                          />
                        </label>
                      </div>
                      {{#if this.currentNote.customFont}}
                        <p class="tool-hint">Using "{{this.currentNote.customFont.name}}"</p>
                      {{/if}}
                    </div>
                  </div>
                {{/if}}

                <div class="editor-toolbar">
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Bold"
                    title="Bold (Ctrl+B)"
                    {{on "click" (fn this.exec "bold")}}
                  ><Icon @name="bold" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Italic"
                    title="Italic (Ctrl+I)"
                    {{on "click" (fn this.exec "italic")}}
                  ><Icon @name="italic" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool is-text"
                    {{on "click" (fn this.formatBlock "H1")}}
                  >H1</button>
                  <button
                    type="button"
                    class="editor-tool is-text"
                    {{on "click" (fn this.formatBlock "H2")}}
                  >H2</button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Bullet list"
                    {{on "click" (fn this.exec "insertUnorderedList")}}
                  ><Icon @name="list" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Numbered list"
                    {{on "click" (fn this.exec "insertOrderedList")}}
                  ><Icon @name="list-ordered" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Quote"
                    {{on "click" (fn this.formatBlock "BLOCKQUOTE")}}
                  ><Icon @name="quote" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Inline code"
                    {{on "click" this.insertCodeInline}}
                  ><Icon @name="code" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool"
                    aria-label="Divider"
                    {{on "click" (fn this.exec "insertHorizontalRule")}}
                  ><Icon @name="minus" @size={{14}} /></button>
                  <span class="editor-toolbar-spacer"></span>
                  <button
                    type="button"
                    class="editor-tool {{if this.drawMode 'active'}}"
                    aria-label="Draw"
                    title="Draw"
                    {{on "click" this.toggleDraw}}
                  ><Icon @name="pen-line" @size={{14}} /></button>
                  <button
                    type="button"
                    class="editor-tool sticker-toggle
                      {{if this.showStickerMenu 'active'}}"
                    aria-label="Add sticker or image"
                    title="Sticker"
                    {{on "click" this.toggleStickerMenu}}
                  ><Icon @name="sticker" @size={{14}} /></button>
                  {{#if this.showStickerMenu}}
                    {{#in-element this.popoverHost insertBefore=null}}
                      <div
                        class="sticker-popover pop-in"
                        style={{this.stickerPopoverStyle}}
                        {{this.dismissStickerMenu}}
                      >
                        <div class="sticker-tabs">
                          <button
                            type="button"
                            class="qr-chip
                              {{if (eq this.stickerTab 'emoji') 'active'}}"
                            {{on "click" (fn this.setStickerTab "emoji")}}
                          >Emoji</button>
                          <button
                            type="button"
                            class="qr-chip
                              {{if (eq this.stickerTab 'upload') 'active'}}"
                            {{on "click" (fn this.setStickerTab "upload")}}
                          >Image</button>
                        </div>
                        {{#if (eq this.stickerTab "emoji")}}
                          <div class="emoji-grid">
                            {{#each this.emojis as |emoji|}}
                              <button
                                type="button"
                                class="emoji-btn"
                                {{on "click" (fn this.addEmojiSticker emoji)}}
                              >{{emoji}}</button>
                            {{/each}}
                          </div>
                        {{else}}
                          <label class="btn sticker-upload-btn">
                            <Icon @name="image-plus" @size={{14}} />
                            Choose image
                            <input
                              type="file"
                              accept="image/*"
                              class="sr-only"
                              {{on "change" this.uploadImageSticker}}
                            />
                          </label>
                        {{/if}}
                      </div>
                    {{/in-element}}
                  {{/if}}
                </div>

                <div
                  class="note-surface"
                  style={{surfaceStyle this.currentNote}}
                >
                  {{! a contenteditable surface is a multi-line text box, and
                  saying so is what makes it reachable and announced }}
                  <div
                    class="notes-content"
                    contenteditable="true"
                    role="textbox"
                    aria-multiline="true"
                    aria-label="Note body"
                    spellcheck="true"
                    {{this.setEditorContent
                      this.selectedNoteId
                      this.currentNote.contentHtml
                    }}
                    {{on "input" this.onEditorInput}}
                    {{on "keydown" this.onEditorKeydown}}
                  ></div>
                  <NoteOverlay
                    @noteKey={{this.selectedNoteId}}
                    @doodle={{this.currentNote.doodle}}
                    @onChange={{this.onOverlayChange}}
                    @drawing={{this.drawMode}}
                    @interactive={{not this.drawMode}}
                  />
                </div>
              </div>
            {{/if}}
          {{else}}
            <div class="notes-list-head">
              <h3>{{this.folderTitle}}</h3>
            </div>
            <div class="sticky-grid">
              <button
                type="button"
                class="sticky-note is-add"
                {{on "click" this.createNote}}
              >
                <Icon @name="file-plus" @size={{22}} />
                <span>New Note</span>
              </button>
              {{#each this.visibleNotes as |note index|}}
                <StickyCard
                  @note={{note}}
                  @index={{index}}
                  @onOpen={{fn this.openNote note.id}}
                  @onDelete={{fn this.deleteNote note.id}}
                />
              {{/each}}
            </div>
          {{/if}}
        </div>
      </div>
    </ToolPage>
  </template>
}

const StickyCard = <template>
  <div class="sticky-note" style={{stickyStyle @note @index}}>
    {{#if (hasDoodle @note)}}
      <div class="sticky-doodle" aria-hidden="true">
        {{#if @note.doodle.drawingDataUrl}}
          <img
            class="sticky-doodle-ink"
            src={{@note.doodle.drawingDataUrl}}
            alt=""
          />
        {{/if}}
        {{#each @note.doodle.stickers as |sticker|}}
          <span
            class="sticky-doodle-sticker"
            style={{previewStickerStyle @note sticker}}
          >
            {{#if (eq sticker.type "emoji")}}{{sticker.content}}{{else}}<img
                src={{sticker.content}}
                alt=""
              />{{/if}}
          </span>
        {{/each}}
      </div>
    {{/if}}
    <button
      type="button"
      class="sticky-delete"
      aria-label="Delete note"
      {{on "click" @onDelete}}
    ><Icon @name="x" @size={{12}} /></button>
    <button type="button" class="sticky-note-btn" {{on "click" @onOpen}}>
      <span class="sticky-title">{{if
          @note.title
          @note.title
          "Untitled"
        }}</span>
      <span class="sticky-snippet">{{noteSnippet @note}}</span>
    </button>
  </div>
</template>;
