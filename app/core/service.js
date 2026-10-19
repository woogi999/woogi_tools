// The base for the site's services (app/services). Each one is a single shared
// instance, made the first time something asks for it: see services.js.
export default class Service {
  // Called once by destroy() (the tests reset every service between tests).
  willDestroy() {}
}
