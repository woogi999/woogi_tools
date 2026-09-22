# Video Editor — where the work is up to

Working notes for whoever picks this up next (including a later session of me,
after a context reset). Everything here has been measured, not guessed.

---

## What exists and works

`/video-editor` is a port of **Project Ferrite** (`E:\coding_projects\Project_Ferrite`,
a native Rust/Iced broadcast-graphics app) — its _editor_ half only. It is a
bare route: no site chrome, full viewport, its own menu bar with the logo
linking home.

| File                                   | What it is                                                            |
| -------------------------------------- | --------------------------------------------------------------------- |
| `app/utils/ferrite/model.js`           | Scenes, layers, style, keyframes, 7 easings, parenting, mattes, clock |
| `app/utils/ferrite/effects.js`         | The 145-effect catalogue, generated from Rust (see below)             |
| `app/utils/ferrite/render.js`          | The compositor — one `drawScene` for viewport _and_ export            |
| `app/utils/ferrite/timeline.js`        | The timeline canvas: ruler, bars, keyframes, playhead, hit testing    |
| `app/utils/ferrite/theme.js`           | Resolves site CSS tokens into canvas-safe colours                     |
| `app/utils/ferrite/keymap.js`          | 68 actions, 62 bound                                                  |
| `app/utils/ferrite/gpu.js`             | WebGL2 shader passes (see the open task)                              |
| `app/utils/ferrite/shaders.js`         | GLSL ports of Ferrite's WGSL                                          |
| `app/utils/ferrite/shader-map.js`      | catalogue knobs → shader uniforms                                     |
| `app/components/video-editor-page.gjs` | The shell + all editor state (Ferrite's `app.rs`)                     |
| `app/components/ferrite/*.gjs`         | The seven panels                                                      |
| `app/styles/_ferrite.scss`             | Theme, built entirely on the site's own tokens                        |

**Tests — use these, they have caught every real bug so far.**

- `npm test` → real Chrome, `tests/acceptance/video-editor-test.js` (17 tests).
- `node tests/node/ferrite-model.mjs` and `node tests/node/ferrite-render.mjs`
  — fast, no browser. See `tests/node/README.md`.
- 3 failures in `tests/acceptance/smoke-test.js` are **pre-existing and not
  ours** (an "Image Editor" → "Image Darkroom" rename in commit `96b6d3c`, a
  `.qr-export` count, a `.credit-list` count). Files untouched by this work.

---

## Effects: done

All 145 render. Started at 63 doing nothing.

Ferrite implements effects as **WGSL shaders** (`ferrite-gpu/src/shaders.rs`,
registry near line 3780); the CSS fragment each also emits was only the
fallback for its browser-document output, and where CSS has no word for a
thing that fallback is an identity value like `blur(0px)`. The fix is a WebGL2
pass:

| File                         | Role                                                               |
| ---------------------------- | ------------------------------------------------------------------ |
| `gpu.js`                     | WebGL2 singleton, program cache, ping-pong targets, `runPasses()`  |
| `shaders.js`                 | distort shaders + the shared helper library; merges the colour set |
| `shaders-colour.js`          | colour, keying, channel and stylize shaders                        |
| `shader-map.js`              | effect name → `{ shader, pack(values), colours? }`                 |
| `model.js` → `effectSteps()` | walks the stack once, flushing CSS before each shader              |
| `render.js` → `applyStack()` | applies the steps to a layer's surface, in author order            |

**77 effects are shader-backed**; the other 88 were always fine as CSS. Two
acceptance tests guard it: _"the shader pass runs and moves pixels"_ and
_"every mapped shader compiles"_ — a shader that will not compile is reported,
not thrown, so that second test is the only way to notice.

### The blur that was a row of copies

The blurs were real neighbourhood samplers and still looked like _afterimages_:
the layer printed several times in a line rather than smeared. The taps were
right; the **gaps between them** were the problem. A 90px directional blur over
25 taps puts them nearly 8px apart, so 7 of every 8 pixels along the streak
were never read, and what you see is a row of ghosts.

No reweighting fixes that — the information was not sampled. The fix is to make
each tap cover its own gap by reading from a **mip level whose texels are as
wide as the spacing**: `lodFor(gapInTexels)` in the shader common, `tapLod` /
`tapBoxLod` instead of `tapAt`, and `gl.generateMipmap` on the input texture and
on every pass output in `gpu.js`. It is also cheaper than the tap count it
replaces.

Every blur computes its own gap, and the radial blur computes it _per pixel_ —
the taps spread with the distance from the centre, which is why a radial blur is
sharp in the middle and smeared at the rim.

Guarded by "a wide blur is a smear, not a row of copies", which runs the shader
directly and asserts there are **no dark pixels inside the span of the streak**.
A brightness comparison cannot see ghosting; a hole check can.

### Blur is still clipped to the layer's box

A layer is painted into a surface exactly its own size, and the effect stack
runs on that surface, so a blur has nowhere to spread past the layer's edge.
After Effects grows the buffer instead. Fixing it means padding the surface by
the stack's reach and offsetting the draw — contained, but it touches the matte,
shadow and motion-blur paths, so it is written down rather than done.

### The start page and the render queue

`view` on the page component is `'home'` or `'editor'`. A web editor that opens
on an empty timeline has silently answered "is my work still here?" with the
wrong answer, so it opens on the start page instead: what is on this machine,
how to make a new project, how to bring one in from a file.

Two kinds of saving, and the difference matters enough to say on the page:
`saveHere` puts the project in local storage (survives a reload, dies with the
site data), `saveProject` writes a `.woogi.json` (survives anything).

The render queue (`export.js`, `export-modal.gjs`) has two engines, because a
browser cannot do what Ferrite does in one way:

- `live` — `captureStream` + `MediaRecorder`. Carries the sound, drops frames
  when the comp is heavy, so a "30fps" file is whatever the machine managed.
- `exact` — every frame drawn, seeked and encoded through FFmpeg. Frame
  accurate, slower, and silent: the mixer is a live graph with no clock to play
  it against offline.

The choice is on the panel with its consequence next to it. Formats: WebM
VP9/VP8, MP4 H.264, GIF, PNG sequence (zip) and a single PNG frame; resolution
is a divisor as in After Effects; the span is the comp, the work area, or two
numbers; and Render Settings can switch effects, motion blur and solo off for
this render without touching the comp (`noEffects`, `noMotionBlur`,
`ignoreSolo` on `drawScene`).

A frame-by-frame render holds every PNG until the encoder has them, so the
panel warns above ~700MB rather than letting the tab die.

### The flip that hid for weeks

Every shader pass was **vertically flipping the picture**. A 2D canvas counts
rows from the top and GL counts them from the bottom, and the mismatch was at
the handover. It went unnoticed because the test that guarded the pass used a
_left/right_ split — which cannot see a vertical flip. It only showed up when
the user noticed Channel Mixer "flipping my layer upside down": a colour shader
cannot flip anything, so the flip had to be in the pipeline.

Resolved once, in `gpu.js`, by reading the source rectangle bottom-to-top in
the final `blitFramebuffer`. Everything inside the pipeline stays in image
space, so `vUv` means what it looks like and a stack of passes agrees with
itself. **`a shader pass does not flip the picture`** now guards it with a
top/bottom split.

### Rough edges deliberately left

- **Warp** has eight styles upstream, three in the shader; the rest fall to the
  nearest. Port the real `FX_WARP` when convenient.
- **Displace** is driven by its own luminance plus noise: Ferrite displaces by
  _another layer_, and there is no second layer to hand in yet.
- **Sphere/Cylinder Wrap** do the geometry but ignore their lighting knobs.
- **Channel Blur** and the other blurs use fixed kernels rather than separable
  two-pass ones, so very large radii are softer than Ferrite's.
- **Median** approximates with the midpoint of the extremes on a ring rather
  than a true sort.
- **Motion blur** samples the shutter nine times. Fast motion over a long
  shutter will band; raise `SHUTTER_SAMPLES` in `render.js` if it shows.
- `uParams` is six `vec4`s and `uColours` four. Widen in `gpu.js` `HEAD` if
  something needs more.

### Adding or fixing one

1. `grep -n "const FX_<NAME>" ferrite-gpu/src/shaders.rs`, port the body into
   `SHADERS`. WGSL→GLSL is mechanical: `vec2<f32>` → `vec2`,
   `textureSampleLevel(tex_a, samp, uv, 0.0)` → `texture(uTex, uv)`,
   `fx.params[i].x` → `uParams[i].x`, `select(a, b, c)` → `c ? b : a`.
   **`box_uv`/`from_box_uv` are identity here** — each layer already owns a
   surface exactly its own size.
2. Add the `SHADER_EFFECTS` entry. Check the catalogue's parameter order first;
   it rarely matches the shader's.
3. `node tests/node/ferrite-model.mjs`, then `npm test`.

## Gotchas already paid for — do not rediscover these

1. **Never write a tracked field in a component constructor.** Glimmer runs it
   inside an open render transaction; reading then writing throws "already been
   used previously in the same computation" and takes the _whole app_ down.
   `app/utils/tool-state.js` defers to a microtask for this reason.
2. **`ResizeObserver` callbacks must not write state that changes layout**
   without a change-guard and an rAF defer, or Chrome reports "loop completed
   with undelivered notifications" and QUnit fails the whole module.
3. **`Icon` throws on an unknown name.** Check `app/components/icon.gjs` before
   using one. Icons come from `sketchyicons`, not lucide.
4. **Canvas `fillStyle` silently ignores what it cannot parse.** The site's
   greys compute to `oklch(0.985 0 none)`. `theme.js` normalises every colour
   through a real canvas before use — keep doing that for any new colour.
5. **`nth-child` on the menu bar is off by one** — the brand logo is the first
   child. Select menus with `[data-menu="Layer"]`.
6. In `.gjs`, only JavaScript may appear outside `<template>`; a `{{! }}`
   comment there is a parse error.
7. **`setPointerCapture` throws** when the pointer has already gone — a
   synthetic event, a cancelled gesture. Optional chaining does not help: the
   method exists, it just refuses, and the throw escapes as a global error that
   fails a whole QUnit module. Use the `grabPointer`/`freePointer` helpers.
8. **`click()` in tests does not fire pointer events.** A control that only
   listens for `pointerdown`/`pointerup` is unreachable by click, by keyboard
   and by assistive tech. Keep an `on click` alongside any drag gesture.
9. **Menu rows carry `data-row` slugs** and menu buttons `data-menu`. Select by
   those, never `nth-child` — adding a row silently moves everything below it.
10. **A test that cannot see the bug is worse than no test.** The shader guard
    used a left/right split and missed a vertical flip in all 77 effects for
    weeks. Choose fixtures that are asymmetric in every axis the code touches.
11. `npm run lint:js` is **broken repo-wide** (stale Embroider cache pointing at
    `E:\coding_projects\JJS_Tools`). `rm -rf node_modules/.embroider` + reinstall
    would fix it. Not caused by this work.

---

## Deliberately not ported

Ferrite's production half, all of it: the surface host process, the WebGPU
engine, the frame bridge, browser-source outputs, the REST control API, the
live data gateway, take-to-program, and the Live and Automate workspaces. The
workspace rail that used to hold the last two has been removed.

_Scene animations_ were kept — without a program bus there is nothing to trigger
them, but they still work as named sub-compositions. Removable if unwanted.

**11.** **A blanket string replace in a test file will rewrite the helper it
just added.** Turning every `await visit('/video-editor')` into
`await openEditor()` turned `openEditor`'s own first line into a call to itself:
28 tests died with `Maximum call stack size exceeded` and the stack testem
printed named none of them. Anchor the replace, or write the helper afterwards.
