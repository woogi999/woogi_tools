import Route from '@ember/routing/route';

export default class ThirdPartyStuffRoute extends Route {
  // The "has moved" note is for the visit an old link made, not later ones.
  resetController(controller, isExiting) {
    if (isExiting) controller.from = null;
  }
}
