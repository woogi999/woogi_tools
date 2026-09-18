// The "gravity" easter egg on the home page: type gravity, press I'm Feeling
// Lucky, and everything on the first screen drops to the bottom of the window
// like Google Gravity. Matter.js does the physics (loaded only when the egg
// hatches): boxes tumble, land on a corner and tip over, pile up on one
// another, and can be picked up by any point and swung around it.
//
// Nothing leaves the normal layout; each body is moved with a CSS transform
// from where it was when gravity kicked in. The room is the first screen of
// the page: positions are page coordinates, the floor is one window height
// down, so the pile scrolls away with the page and is still there when you
// come back up.

const WALL = 200;
const rand = (a, b) => a + Math.random() * (b - a);

export async function startGravity(elements) {
  // Matter ships as a CommonJS bundle, so its pieces hang off the default export.
  const matter = await import('matter-js');
  const { Engine, Bodies, Body, Composite, Constraint, Vector } =
    matter.default ?? matter;

  const engine = Engine.create({ enableSleeping: true });
  engine.gravity.y = 1.4;
  const world = engine.world;
  const bodies = [];
  let frame = null;
  let last = performance.now();

  const H = window.innerHeight;
  const W = window.innerWidth;
  const still = { isStatic: true, friction: 0.8 };
  Composite.add(world, [
    Bodies.rectangle(W / 2, H + WALL / 2, W + 2 * WALL, WALL, still),
    Bodies.rectangle(-WALL / 2, H / 2 - H * 2, WALL, H * 6, still),
    Bodies.rectangle(W + WALL / 2, H / 2 - H * 2, WALL, H * 6, still),
  ]);

  // A DOM element becomes a box centred where the element's box is, with the
  // element's top-left (ox, oy) remembered so the transform can be relative.
  const add = (el, x, y, w, h, { ox = x, oy = y, spin = 0.05 } = {}) => {
    const body = Bodies.rectangle(x + w / 2, y + h / 2, w, h, {
      restitution: 0.25,
      friction: 0.5,
      frictionAir: 0.012,
      density: 0.002,
    });
    Body.setAngularVelocity(body, rand(-spin, spin));
    const entry = { el, body, w, h, ox, oy };
    bodies.push(entry);
    Composite.add(world, body);
    el.classList.add('is-falling');
    el.style.willChange = 'transform';
    return entry;
  };

  for (const el of elements) {
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height) continue;
    add(el, r.left, r.top, r.width, r.height);
  }

  const render = ({ el, body, w, h, ox, oy }) => {
    const x = body.position.x - w / 2 - ox;
    const y = body.position.y - h / 2 - oy;
    el.style.transform = `translate(${x}px, ${y}px) rotate(${body.angle}rad)`;
  };

  const tick = (now) => {
    const dt = Math.min(1000 / 30, now - last);
    last = now;
    Engine.update(engine, dt);
    for (const b of bodies) if (!b.body.isSleeping) render(b);
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);

  // ─── Picking things up ─────────────────────────────────────────────
  //
  // A grab is a pin through the body at the point under the pointer: the body
  // hangs from it, swings when the pointer moves and flies off when let go.

  let drag = null;
  const page = (event) => ({
    x: event.clientX + window.scrollX,
    y: event.clientY + window.scrollY,
  });
  const entryAt = (target) =>
    bodies.find((b) => b.el === target || b.el.contains(target));

  const onDown = (event) => {
    if (event.button !== 0) return;
    const entry = entryAt(event.target);
    if (!entry) return;
    // The search box still has to take typing, so a press on a field or a
    // button is a press, not a grab, unless the pointer then moves.
    const at = page(event);
    drag = {
      entry,
      start: at,
      // Where the pin goes through, in the body's own frame.
      local: Vector.rotate(
        Vector.sub(at, entry.body.position),
        -entry.body.angle,
      ),
      pin: null,
    };
  };

  const onMove = (event) => {
    if (!drag) return;
    const at = page(event);
    if (!drag.pin) {
      if (Vector.magnitude(Vector.sub(at, drag.start)) < 6) return;
      const { body } = drag.entry;
      body.isSleeping = false;
      drag.pin = Constraint.create({
        bodyA: body,
        pointA: drag.local,
        pointB: at,
        length: 0,
        stiffness: 0.15,
        damping: 0.08,
      });
      Composite.add(world, drag.pin);
      drag.entry.el.classList.add('is-held');
      window.getSelection?.()?.removeAllRanges();
    }
    drag.pin.pointB = at;
    event.preventDefault();
  };

  const onUp = () => {
    if (!drag) return;
    if (drag.pin) {
      Composite.remove(world, drag.pin);
      const { el } = drag.entry;
      el.classList.remove('is-held');
      // A click that turned into a throw shouldn't also follow a link.
      const swallow = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
      };
      el.addEventListener('click', swallow, { capture: true, once: true });
      setTimeout(
        () => el.removeEventListener('click', swallow, { capture: true }),
        0,
      );
    }
    drag = null;
  };

  window.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove, { passive: false });
  window.addEventListener('pointerup', onUp, true);
  window.addEventListener('pointercancel', onUp, true);

  return {
    // Drops an element that sits at the top-left corner of its parent in from
    // above the window, at a random spot. Later ones in a batch start higher
    // up, so they arrive one after another.
    drop(el, order = 0) {
      const home = el.parentElement.getBoundingClientRect();
      const { width: w, height: h } = el.getBoundingClientRect();
      const x = rand(0, Math.max(0, W - w));
      const y = -h - rand(20, 160) - order * 140;
      const entry = add(el, x, y, w, h, {
        ox: home.left + window.scrollX,
        oy: home.top + window.scrollY,
        spin: 0.12,
      });
      Body.setVelocity(entry.body, { x: rand(-3, 3), y: 0 });
      render(entry);
    },
    stop() {
      cancelAnimationFrame(frame);
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      for (const { el } of bodies) {
        el.classList.remove('is-falling', 'is-held');
        el.style.transform = '';
        el.style.willChange = '';
      }
      bodies.length = 0;
      Engine.clear(engine);
    },
  };
}
