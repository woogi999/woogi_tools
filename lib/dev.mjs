// `npm run dev`: Vite, with a bigger libuv thread pool. Node resolves host
// names on that pool, four at a time by default, and User Profiling's local
// API (lib/dev-api-plugin.mjs) asks thousands of different sites at once;
// with four, lookups queue until the checks time out. The size can only be
// set before Node starts, hence this wrapper rather than a line in the config.

import { spawn } from 'node:child_process';

const vite = spawn('npx', ['vite', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: true,
  env: {
    ...process.env,
    UV_THREADPOOL_SIZE: process.env.UV_THREADPOOL_SIZE ?? '64',
  },
});
vite.on('exit', (code) => (process.exitCode = code ?? 0));
