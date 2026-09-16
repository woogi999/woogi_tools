// Opening archives in the browser with 7-Zip compiled to WebAssembly: ZIP, 7z,
// RAR, TAR and the gzipped/bzipped/xz'd sorts, plus ISO, CAB, DMG and friends.

import { loadSevenZip } from './converters/engines';

export const OPENABLE = ['zip', '7z', 'rar', 'tar', 'gz', 'tgz', 'bz2', 'xz', 'zst', 'iso', 'cab', 'arj', 'lzh', 'wim', 'dmg', 'rpm', 'deb', 'cpio', 'jar', 'apk', 'epub', 'xpi', 'whl', 'crx', 'vhd', 'msi'];

const extOf = (name) => (name.split('.').pop() || '').toLowerCase();
export const canOpen = (name) => OPENABLE.includes(extOf(name));

// One 7-Zip instance per archive, so nothing leaks between them.
async function open(file, { password = '' } = {}) {
  const create = await loadSevenZip();
  const z = await create();
  const run = (args) => {
    try {
      z.callMain(args);
    } catch (error) {
      if (error?.status) throw new Error('7-Zip couldn’t read this archive — it may be damaged, or need a password.');
    }
  };
  const source = `/archive.${extOf(file.name) || 'bin'}`;
  z.FS.writeFile(source, new Uint8Array(await file.arrayBuffer()));
  return { z, run, source, password: password ? [`-p${password}`] : [] };
}

// Everything inside, with its path and size, without unpacking to disk first.
export async function listArchive(file, options = {}) {
  const { z, run, source, password } = await open(file, options);
  z.FS.mkdir('/out');
  run(['x', source, '-o/out', '-y', ...password]);
  const entries = [];
  const walk = (dir, prefix) => {
    for (const name of z.FS.readdir(dir)) {
      if (name === '.' || name === '..') continue;
      const full = `${dir}/${name}`;
      const stat = z.FS.stat(full);
      // 16384 is the directory bit in Emscripten's stat mode.
      if (stat.mode & 16384) walk(full, `${prefix}${name}/`);
      else entries.push({ path: `${prefix}${name}`, name, size: stat.size, full });
    }
  };
  walk('/out', '');
  // The instance is kept alive so files can be pulled out without unpacking twice.
  return { entries: entries.sort((a, b) => a.path.localeCompare(b.path)), read: (entry) => new Uint8Array(z.FS.readFile(entry.full)) };
}

// A .tar.gz is two layers: the outer gzip, then the tar inside it.
export function looksDoubleWrapped(entries) {
  return entries.length === 1 && entries[0].name.toLowerCase().endsWith('.tar');
}

export async function unwrapTar(bytes, name) {
  const file = new File([bytes], name, { type: 'application/x-tar' });
  return listArchive(file);
}

const TYPES = {
  txt: 'text/plain', md: 'text/markdown', json: 'application/json', csv: 'text/csv', xml: 'application/xml', html: 'text/html',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml',
  pdf: 'application/pdf', mp3: 'audio/mpeg', mp4: 'video/mp4', wav: 'audio/wav',
};

export const typeOf = (name) => TYPES[extOf(name)] ?? 'application/octet-stream';
export const isText = (name) => ['txt', 'md', 'json', 'csv', 'xml', 'html', 'js', 'ts', 'css', 'yml', 'yaml', 'ini', 'cfg', 'log', 'sh', 'py', 'java', 'c', 'h', 'cpp', 'rs', 'go', 'toml'].includes(extOf(name));
export const isImage = (name) => ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif'].includes(extOf(name));
