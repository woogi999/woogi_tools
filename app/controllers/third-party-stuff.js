import Controller from '@ember/controller';
import { tracked } from '@glimmer/tracking';

// ?from= names the page an old link pointed at (see routes/jjs-stuff.js), so
// the page can say where it went.
export default class ThirdPartyStuffController extends Controller {
  queryParams = ['from'];
  @tracked from = null;

  dismiss = () => (this.from = null);
}
