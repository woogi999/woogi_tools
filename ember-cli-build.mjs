import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import EmberApp from 'ember-cli/lib/broccoli/ember-app.js';
import { compatBuild } from '@embroider/compat';

export default async function (defaults) {
  const { setConfig } = await import('@warp-drive/core/build-config');
  const { buildOnce } = await import('@embroider/vite');

  const app = new EmberApp(defaults, {
    // Add options here
  });

  setConfig(app, dirname(fileURLToPath(import.meta.url)), {
    // this should be the most recent <major>.<minor> version for
    // which all deprecations have been fully resolved
    // and should be updated when that changes
    compatWith: '5.8',
    deprecations: {
      // ... list individual deprecations that have been resolved here
    },
  });

  return compatBuild(app, buildOnce, {
    // Modules in app/lazy are left out of the app's entrypoint, so a dynamic
    // import() of one really does split it (and its dependencies, like
    // three.js) into a chunk that only downloads when it's needed.
    staticAppPaths: ['lazy'],
  });
}
