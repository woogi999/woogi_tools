import Route from '@ember/routing/route';
import { service } from '@ember/service';

// Uno was renamed Woono. Old links still work; invite links carry their
// ?room= code, which the router would drop, so those reload at the new path.
export default class UnoRoute extends Route {
  @service router;

  beforeModel() {
    if (window.location.search) {
      window.location.replace(window.location.href.replace(/\/uno(?=[?#]|$)/, '/woono'));
      return;
    }
    this.router.replaceWith('woono');
  }
}
