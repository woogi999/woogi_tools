import { destroy } from './destroyable.js';
import RouterService from './router.svelte.js';
import FavouritesService from '../services/favourites.svelte.js';
import HandoffService from '../services/handoff.svelte.js';
import NotesService from '../services/notes.svelte.js';
import OfflineService from '../services/offline.svelte.js';
import PipService from '../services/pip.svelte.js';
import SettingsService from '../services/settings.svelte.js';
import StingerService from '../services/stinger.svelte.js';
import ToolVisibilityService from '../services/tool-visibility.svelte.js';

// The site's shared services, by name. Each is made the first time it is asked
// for and then shared: `pip = service('pip')` in a class field.
const SERVICES = {
  router: RouterService,
  favourites: FavouritesService,
  handoff: HandoffService,
  notes: NotesService,
  offline: OfflineService,
  pip: PipService,
  settings: SettingsService,
  stinger: StingerService,
  'tool-visibility': ToolVisibilityService,
};

const instances = new Map();

export function service(name) {
  let instance = instances.get(name);
  if (!instance) {
    const Service = SERVICES[name];
    if (!Service) throw new Error(`No service named "${name}"`);
    instance = new Service();
    instances.set(name, instance);
  }
  return instance;
}

// For the tests: each test starts with new services, as a fresh visit would.
export function resetServices() {
  const all = [...instances.values()].reverse();
  instances.clear();
  for (const instance of all) destroy(instance);
}
