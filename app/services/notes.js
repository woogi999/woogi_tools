import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

const KEY = 'woogi-quick-notes';

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return {
      folders: Array.isArray(parsed?.folders) ? parsed.folders : [],
      notes: Array.isArray(parsed?.notes) ? parsed.notes : [],
    };
  } catch {
    return { folders: [], notes: [] };
  }
}

let nextId = Date.now();
const newId = (prefix) => `${prefix}${(nextId++).toString(36)}`;

const newNote = (folderId) => ({
  id: newId('n'),
  folderId,
  title: '',
  contentHtml: '',
  color: null,
  font: 'sans',
  doodle: { drawingDataUrl: null, stickers: [] },
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

export default class NotesService extends Service {
  @tracked folders;
  @tracked notes;
  // Set by the command palette when a note search result is chosen from
  // outside the tool; the Quick Notes page watches this and opens it.
  @tracked openRequestId = null;

  constructor() {
    super(...arguments);
    const data = load();
    this.folders = data.folders;
    this.notes = data.notes;
  }

  requestOpen(id) {
    this.openRequestId = id;
  }

  persist() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({ folders: this.folders, notes: this.notes }),
      );
    } catch {
      // storage blocked (private mode): notes still work for this visit
    }
  }

  createFolder(name) {
    this.folders = [...this.folders, { id: newId('f'), name }];
    this.persist();
  }

  renameFolder(id, name) {
    this.folders = this.folders.map((f) => (f.id === id ? { ...f, name } : f));
    this.persist();
  }

  deleteFolder(id) {
    this.folders = this.folders.filter((f) => f.id !== id);
    this.notes = this.notes.map((n) =>
      n.folderId === id ? { ...n, folderId: null } : n,
    );
    this.persist();
  }

  createNote(folderId = null) {
    const note = newNote(folderId);
    this.notes = [note, ...this.notes];
    this.persist();
    return note;
  }

  updateNote(id, patch) {
    this.notes = this.notes.map((n) =>
      n.id === id ? { ...n, ...patch, updatedAt: Date.now() } : n,
    );
    this.persist();
  }

  exportData() {
    return {
      app: 'woogi-quick-notes',
      version: 1,
      exportedAt: new Date().toISOString(),
      folders: this.folders,
      notes: this.notes,
    };
  }

  // Adds folders and notes from an export, skipping any whose id already exists.
  importData(data) {
    if (!Array.isArray(data?.notes) || !Array.isArray(data?.folders))
      throw new Error('That file is not a Quick Notes export.');
    const folderIds = new Set(this.folders.map((f) => f.id));
    const noteIds = new Set(this.notes.map((n) => n.id));
    const folders = data.folders.filter(
      (f) => f?.id && typeof f.name === 'string' && !folderIds.has(f.id),
    );
    const notes = data.notes.filter((n) => n?.id && !noteIds.has(n.id));
    this.folders = [...this.folders, ...folders];
    this.notes = [...notes, ...this.notes];
    this.persist();
    return { folders: folders.length, notes: notes.length };
  }

  clearAll() {
    this.folders = [];
    this.notes = [];
    this.persist();
  }

  deleteNote(id) {
    this.notes = this.notes.filter((n) => n.id !== id);
    this.persist();
  }
}
