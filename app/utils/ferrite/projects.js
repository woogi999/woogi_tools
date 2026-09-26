// The projects a person has on this machine.
//
// Ferrite keeps projects as files on disk and lists the recent ones on its
// start screen. A web page has no disk, so there are two places a project can
// live and the start screen shows both:
//
//   * here, in the site's IndexedDB shelf, which is what "save" means when
//     you have not asked for a file: it survives a reload and nothing else;
//   * a `.woogi.json` file you asked for, which survives anything and is the
//     one to keep.
//
// The distinction is worth being blunt about on the page, because a browser
// clearing its site data takes the first kind with it.

import { makeProject, makeScene } from './model';
import { makeShelf } from '../idb-store';

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

const shelf = makeShelf('video-editor');

// Projects used to sit in one localStorage entry, which ran out of room after
// a few. Move any from there onto the shelf, once.
let moved = null;
function moveOldShelf() {
  moved ??= (async () => {
    let old;
    try {
      old = JSON.parse(localStorage.getItem(KEY) || '[]');
    } catch {
      return;
    }
    if (!Array.isArray(old) || !old.length) return;
    let all = true;
    for (const { project, ...summary } of old)
      if (project) all = (await shelf.store(summary.id, summary, project)) && all;
    if (all) localStorage.removeItem(KEY);
  })();
  return moved;
}

export async function listProjects() {
  await moveOldShelf();
  return shelf.list();
}

export async function loadStored(id) {
  await moveOldShelf();
  return (await shelf.load(id)) ?? null;
}

/**
 * Puts a project on the shelf under `id`, replacing what was there.
 *
 * Resolves false if the browser wouldn't keep it (out of room, or storage
 * turned off). The caller says so rather than pretending the save happened.
 */
export function storeProject(id, project) {
  const scene = project.scenes[0] ?? {};
  return shelf.store(
    id,
    {
      name: project.name || 'Untitled',
      width: scene.width ?? project.settings.width,
      height: scene.height ?? project.settings.height,
      fps: scene.fps ?? project.settings.fps,
      durationMs: scene.durationMs ?? 0,
      layers: project.scenes.reduce((n, s) => n + s.layers.length, 0),
    },
    project,
  );
}

export const forgetProject = (id) => shelf.forget(id);

export async function renameProject(id, name) {
  const project = await shelf.load(id);
  const summary = (await shelf.list()).find((p) => p.id === id);
  if (project && summary)
    await shelf.store(id, { ...summary, name }, { ...project, name });
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
