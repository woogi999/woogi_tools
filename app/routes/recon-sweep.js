import Route from '@ember/routing/route';
import { service } from '@ember/service';

// Merged into Domain Lookup, which now runs every domain source at once and
// has the subdomain list and the map as tabs. Old links still land there.
export default class ReconSweepRoute extends Route {
  @service router;

  beforeModel() {
    this.router.replaceWith('domain-lookup');
  }
}
