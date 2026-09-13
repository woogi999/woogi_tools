import Service from '@ember/service';
import { tracked } from '@glimmer/tracking';

const KEY = 'woogi-favourites';

function load() {
  try {
    const parsed = JSON.parse(localStorage.getItem(KEY));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export default class FavouritesService extends Service {
  @tracked routes = load();

  has(route) {
    return this.routes.includes(route);
  }

  clear() {
    this.routes = [];
    try {
      localStorage.removeItem(KEY);
    } catch {
      // nothing stored to remove
    }
  }

  toggle(route) {
    this.routes = this.has(route) ? this.routes.filter((r) => r !== route) : [...this.routes, route];
    try {
      localStorage.setItem(KEY, JSON.stringify(this.routes));
    } catch {
      // storage blocked (private mode): favourites still work for this visit
    }
  }
}
