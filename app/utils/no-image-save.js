import { modifier } from 'ember-modifier';

// The 3D games draw into a WebGL canvas, which the browser treats as an image:
// right-clicking one offers "Save image as…" and a long press on iOS opens the
// share sheet, both of which interrupt the game and save a meaningless frame.
// Put {{noImageSave}} on a game canvas to turn those off. It only blocks the
// image menu; every other pointer, key and gesture handler is untouched.
export default modifier((element) => {
  const stop = (event) => event.preventDefault();
  element.addEventListener('contextmenu', stop);
  // Safari's long-press callout, for the versions that still ignore the CSS.
  element.addEventListener('dragstart', stop);
  return () => {
    element.removeEventListener('contextmenu', stop);
    element.removeEventListener('dragstart', stop);
  };
});
