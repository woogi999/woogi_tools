// Keeps track of a list of downloads for a page: which are running, how far
// along each is, what went wrong, and how to stop them. Used by the Bunkr and
// Mega downloaders, whose rows are drawn by components/download-row.svelte.
//
// Progress is only ever what was measured (bytes received, out of the size
// when it is known); see utils/video-download.js.

import { formatBytes } from './video-download.js';

export class DownloadJobs {
  // key -> { state: 'going' | 'done' | 'failed', stage, received, total, error }
  jobs = $state.raw({});
  controllers = new Map();

  get working() {
    return Object.values(this.jobs).some((job) => job.state === 'going');
  }

  set(key, patch) {
    this.jobs = { ...this.jobs, [key]: { ...this.jobs[key], ...patch } };
  }

  cancel = (key) => this.controllers.get(key)?.abort();

  // Stops everything and forgets it, for when the list itself changes.
  reset() {
    for (const controller of this.controllers.values()) controller.abort();
    this.controllers.clear();
    this.jobs = {};
  }

  // Runs one download. `work({ signal, onProgress, onStage })` does it and
  // gives back what to say once it is done. Resolves to whether it finished.
  async run(key, work) {
    this.controllers.get(key)?.abort();
    const controller = new AbortController();
    this.controllers.set(key, controller);
    const { signal } = controller;
    const mine = () => this.controllers.get(key) === controller;
    this.set(key, {
      state: 'going',
      stage: 'Starting',
      received: 0,
      total: 0,
      error: null,
    });
    try {
      const said = await work({
        signal,
        onProgress: ({ received, total }) =>
          mine() && this.set(key, { received, total }),
        onStage: (stage) =>
          mine() && this.set(key, { stage, received: 0, total: 0 }),
      });
      if (mine()) this.set(key, { state: 'done', stage: said });
      return true;
    } catch (error) {
      if (!mine()) return false;
      if (signal.aborted) {
        const jobs = { ...this.jobs };
        delete jobs[key];
        this.jobs = jobs;
      } else this.set(key, { state: 'failed', error: error.message });
      return false;
    } finally {
      if (mine()) this.controllers.delete(key);
    }
  }

  // How a row's download is going, ready for DownloadRow.
  view(key) {
    const job = this.jobs[key];
    const going = job?.state === 'going';
    let status = null;
    if (going) {
      const amount = job.total
        ? `${formatBytes(job.received)} of ${formatBytes(job.total)}`
        : job.received
          ? `${formatBytes(job.received)} so far (size not given)`
          : null;
      status = [job.stage, amount].filter(Boolean).join(': ');
    } else if (job?.state === 'done') status = job.stage;
    return {
      going,
      done: job?.state === 'done',
      failed: job?.state === 'failed',
      hasTotal: Boolean(job?.total),
      fraction: job?.total ? Math.min(1, job.received / job.total) : 0,
      status,
      error: job?.state === 'failed' ? job.error : null,
    };
  }
}

const ICONS = { video: 'video', audio: 'music', photo: 'image' };
const TYPES = [
  ['video', /\.(mp4|m4v|mov|mkv|webm|avi|wmv|flv|ts)$/i],
  ['audio', /\.(mp3|m4a|aac|opus|ogg|wav|flac)$/i],
  ['photo', /\.(jpe?g|png|gif|webp|avif|heic|bmp|svg)$/i],
];

// 'video' | 'audio' | 'photo' | 'file', going by the name.
export const typeOfName = (name) =>
  TYPES.find(([, pattern]) => pattern.test(name ?? ''))?.[0] ?? 'file';

export const iconOfType = (type) => ICONS[type] ?? 'file';
