// Where on screen a theme change should grow out from: the middle of the
// control that was pressed, or the pointer if the event has no target box.
export function originOf(event) {
  const box = event?.currentTarget?.getBoundingClientRect?.();
  if (box?.width) return { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  if (event?.clientX || event?.clientY) return { x: event.clientX, y: event.clientY };
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}
