// The projects a person has on this machine.
//
// Ferrite keeps projects as files on disk and lists the recent ones on its
// start screen. A web page has no disk, so there are two places a project can
// live and the start screen shows both:
//
//   * here, in local storage, which is what "save" means when you have not
//     asked for a file: it survives a reload and nothing else;
//   * a `.woogi.json` file you asked for, which survives anything and is the
//     one to keep.
//
// The distinction is worth being blunt about on the page, because a browser
// clearing its site data takes the first kind with it.

import { makeProject, makeScene } from './model';

const KEY = 'video-editor:projects';
export const FORMAT = 'woogi-video-editor-1';

// What a comp can be before anybody has opened a menu. The same list Ferrite
// offers when it makes a scene, plus the vertical crops everything needs now.
export const PRESETS = [
  { id: 'hd', label: '1080p · 1920×1080', width: 1920, height: 1080, fps: 30 },
  {
    id: 'hd60',
    label: '1080p 60 · 1920×1080',
    width: 1920,
    height: 1080,
    fps: 60,
  },
  { id: 'uhd', label: '4K · 3840×2160', width: 3840, height: 2160, fps: 30 },
  { id: 'hd720', label: '720p · 1280×720', width: 1280, height: 720, fps: 30 },
  {
    id: 'vertical',
    label: 'Vertical · 1080×1920',
    width: 1080,
    height: 1920,
    fps: 30,
  },
  {
    id: 'square',
    label: 'Square · 1080×1080',
    width: 1080,
    height: 1080,
    fps: 30,
  },
  {
    id: 'film',
    label: 'Cinema 24 · 1998×1080',
    width: 1998,
    height: 1080,
    fps: 24,
  },
];

export const presetById = (id) =>
  PRESETS.find((p) => p.id === id) ?? PRESETS[0];

export function newProject({ name, preset = 'hd', durationMs = 10000 }) {
  const size = presetById(preset);
  const project = makeProject({
    name: name?.trim() || 'Untitled',
    settings: { width: size.width, height: size.height, fps: size.fps },
  });
  project.scenes = [makeScene({ name: 'Scene 1', durationMs })];
  return project;
}

/* ------------------------------------------------------------- the shelf */

const read = () => {
  try {
    const raw = localStorage.getItem(KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    // Private windows, blocked site data, a half-written entry: an unreadable
    // shelf is an empty one, never an error in the way of opening the editor.
    return [];
  }
};

const write = (list) => {
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
};

export const listProjects = () =>
  read()
    .map(({ id, name, savedAt, width, height, fps, durationMs, layers }) => ({
      id,
      name,
      savedAt,
      width,
      height,
      fps,
      durationMs,
      layers,
    }))
    .sort((a, b) => (b.savedAt ?? 0) - (a.savedAt ?? 0));

export const loadStored = (id) =>
  read().find((p) => p.id === id)?.project ?? null;

/**
 * Puts a project on the shelf under `id`, replacing what was there.
 *
 * Returns false if it would not fit: local storage is a few megabytes, and a
 * project with a lot of keyframes can reach that. The caller says so rather
 * than pretending the save happened.
 */
export function storeProject(id, project) {
  const scene = project.scenes[0] ?? {};
  const entry = {
    id,
    name: project.name || 'Untitled',
    savedAt: Date.now(),
    width: scene.width ?? project.settings.width,
    height: scene.height ?? project.settings.height,
    fps: scene.fps ?? project.settings.fps,
    durationMs: scene.durationMs ?? 0,
    layers: project.scenes.reduce((n, s) => n + s.layers.length, 0),
    project,
  };
  const list = read().filter((p) => p.id !== id);
  list.unshift(entry);
  // Twenty is more than anybody scrolls, and keeps the shelf inside the quota
  // longer than trimming only when a save fails would.
  return write(list.slice(0, 20));
}

export function forgetProject(id) {
  write(read().filter((p) => p.id !== id));
}

export function renameProject(id, name) {
  const list = read();
  const entry = list.find((p) => p.id === id);
  if (!entry) return;
  entry.name = name;
  if (entry.project) entry.project.name = name;
  write(list);
}

/* -------------------------------------------------------------- the file */

export const projectBlob = (project) =>
  new Blob([JSON.stringify({ format: FORMAT, project }, null, 2)], {
    type: 'application/json',
  });

export function readProjectFile(text) {
  const data = JSON.parse(text);
  if (data.format !== FORMAT)
    throw new Error('That is not a project from this editor.');
  if (!data.project?.scenes?.length)
    throw new Error('That project file has no scenes in it.');
  return data.project;
}

export function saveAs(project, filename) {
  const url = URL.createObjectURL(projectBlob(project));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `${project.name || 'project'}.woogi.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export const whenSaved = (at) => {
  if (!at) return 'never saved';
  const mins = Math.round((Date.now() - at) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hr ago`;
  return new Date(at).toLocaleDateString();
};
