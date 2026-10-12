import Route from '@ember/routing/route';
import { service } from '@ember/service';

// JJS Stuff moved out of the site into Arayashiki, a desktop app. Old links
// land on Third Party Stuff, which explains the move.
export default class JjsStuffRoute extends Route {
  @service router;

  from = 'jjs-stuff';

  beforeModel() {
    this.router.replaceWith('third-party-stuff', {
      queryParams: { from: this.from },
    });
  }
}
