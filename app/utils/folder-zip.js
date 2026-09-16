// Dropping (or picking) a folder: walks it, then packs everything into a .zip
// so the rest of a tool only ever deals with one file. All in the browser.

import { zip } from 'fflate';

const MAX_ENTRIES = 5000;

// A folder picked with <input webkitdirectory> arrives as a flat file list, each
// file carrying its path. Group them by the top folder they came from.
export function groupByFolder(fileList) {
  const folders = new Map();
  const loose = [];
  for (const file of fileList) {
    const path = file.webkitRelativePath || '';
    if (!path.includes('/')) {
      loose.push(file);
      continue;
    }
    const [name, ...rest] = path.split('/');
    if (!folders.has(name)) folders.set(name, { name, files: [] });
    folders.get(name).files.push({ path: rest.join('/'), file });
  }
  return { loose, folders: [...folders.values()] };
}

// A drop can hold both files and folders; only the entry API can tell them apart.
export async function collectDrop(dataTransfer) {
  const items = [...(dataTransfer.items ?? [])].filter((item) => item.kind === 'file');
  const entries = items.map((item) => item.webkitGetAsEntry?.()).filter(Boolean);
  if (!entries.length) return { loose: [...dataTransfer.files], folders: [] };
  const loose = [];
  const folders = [];
  for (const entry of entries) {
    if (entry.isDirectory) folders.push({ name: entry.name, files: await readDirectory(entry, '') });
    else loose.push(await fileOf(entry));
  }
  return { loose, folders };
}

async function readDirectory(entry, prefix) {
  const out = [];
  for (const child of await readEntries(entry.createReader())) {
    if (out.length > MAX_ENTRIES) break;
    if (child.isDirectory) out.push(...(await readDirectory(child, `${prefix}${child.name}/`)));
    else out.push({ path: `${prefix}${child.name}`, file: await fileOf(child) });
  }
  return out;
}

// readEntries hands back at most a hundred at a time, so keep asking until it stops.
function readEntries(reader) {
  return new Promise((resolve) => {
    const all = [];
    const next = () =>
      reader.readEntries((batch) => {
        if (!batch.length) return resolve(all);
        all.push(...batch);
        next();
      }, () => resolve(all));
    next();
  });
}

const fileOf = (entry) => new Promise((resolve, reject) => entry.file(resolve, reject));

// Packs a folder's files into a .zip File, named after the folder.
export async function zipFolder({ name, files }, { onProgress } = {}) {
  const entries = {};
  let read = 0;
  for (const { path, file } of files) {
    entries[path] = new Uint8Array(await file.arrayBuffer());
    onProgress?.(++read / (files.length + 1));
  }
  const data = await new Promise((resolve, reject) => {
    zip(entries, { level: 6 }, (error, out) => (error ? reject(error) : resolve(out)));
  });
  onProgress?.(1);
  return new File([data], `${name || 'folder'}.zip`, { type: 'application/zip' });
}
