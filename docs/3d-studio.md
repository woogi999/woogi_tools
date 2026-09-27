# 3D Studio

`/3d-studio` is a general-purpose 3D modeller, texture painter, rigger and
animator. It is a Magnum Opus page (beta), full-window like the Video Editor
and Webskill Shenanigans, so it is listed in `BARE_ROUTES`
(`app/templates/application.gjs`) and `STINGER_ROUTES`
(`app/services/stinger.js`).

## Where things are

| Path                                                           | What it is                                                                                                        |
| -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `app/components/studio-page.gjs`                               | The page shell: menu bar, workspace tabs, layout, viewport host                                                   |
| `app/components/studio/state.js`                               | `StudioState`: all tracked state and actions (core, history, selection, objects, files)                           |
| `app/components/studio/state-{model,paint,rig,anim}.js`        | Actions mixed into `StudioState`, by area                                                                         |
| `app/components/studio/*.gjs`                                  | Panels: tool strip, outliner, object/material/texture/rig/anim panels, timeline, UV editor, dialogs, number field |
| `app/lazy/studio/`                                             | The engine, loaded on demand in one chunk with three.js (`index.js` is the entry)                                 |
| `app/styles/_studio.scss`                                      | Styles (`st-` prefix)                                                                                             |
| `tests/acceptance/studio-test.js`, `tests/unit/studio-test.js` | Tests                                                                                                             |

Panels receive the state as `@s` and call its actions directly; actions are
bound in the constructor so templates can pass them bare. Mixins are copied
onto the prototype **by descriptor** (reading their getters on the mixin
object would run them with the wrong `this`).

## The data model (`lazy/studio/doc.js`)

The document is plain data and is never mutated: every edit makes a new
document sharing everything untouched. Undo is a list of old documents
(`commit()` in `state.js`); drags and scrubs pass `merge` so one gesture is
one undo step. Painted pixels live outside the document in a pixel store
(`Map` of layer id → `Uint8ClampedArray`s) with their own undo entries
(before/after rectangles).

- **Objects**: `mesh`, `group`, `empty`, `armature`, `camera`, `light`,
  `control`, in a tree (`parent`/`children`, `roots`).
- **Meshes are recipes**: `source` is a primitive (`{ kind: 'primitive',
prim, params }`), an edited mesh (`{ kind: 'mesh', mesh }`) or a linked
  outline (`{ kind: 'outline', of }`), plus a `stack` of modifiers. Changing
  either bumps `geo`, which the mesh cache keys on.
- **Booleans** are modifiers whose `operand` is another object (a child of
  the model, flagged `cutter`).
- **Mesh format** (`mesh.js`): `{ v: [[x,y,z]], f: [{ v, uv, m, s }] }` —
  polygons of any size, UVs per face corner, material slot, smooth flag.

## Pipeline

```
doc ─► Evaluator (evaluate.js) ─► mesh per object, cached by
        own geo + cutters' geo + cutters' relative transforms
    ─► TextureEngine (textures.js) ─► per-material texel map + composited canvases
    ─► view.js ─► three.js scene (incremental sync by id / key / reference)
```

- `view.sync(state)` runs whenever `StudioState.viewState` changes (a
  modifier reads it). The view never changes the document; picks, gizmo
  drags and brush strokes go back to the state through hooks.
- Texture painting and generators work on a **texel map**: the mesh
  rasterised into UV space so each texel knows its 3D position and normal.
  Brushes reach texels by 3D distance (strokes cross UV seams); generators
  evaluate 3D noise (no seams). Generators run asynchronously in chunks at
  up to 512², then are spread over the texture; a layer waiting on one isn't
  drawn until it's ready.
- Rig poses are solved in `rig.js` (`solvePose`: FK, then IK by CCD with
  pole alignment, IK/FK blend, copy rotation, track to) and pushed onto
  three.js bones; skinning is on the GPU.
- Animation (`anim.js`) is evaluated into overrides the view lays over the
  document; the document only changes when you key something.
- Exporters (`export.js`) are a registry; add a format by adding an entry.
  Clips are baked per frame with constraints solved.

## Testing

`npm test` runs the acceptance tests in headless Chrome with SwiftShader.
Shader compilation there is slow, so keep the number of distinct material
variants small (a long first frame trips testem's 10-second heartbeat). The
viewport keeps its drawing buffer so tests can read pixels back, and the
canvas carries `studioView` for inspecting the three.js scene.

## Known limits

- Bevel is a chamfer (rounded bevels come from repeated chamfering);
  booleans are BSP CSG, which can leave T-junctions on complex cuts.
- Edit-mode visibility uses vertex normals facing the camera (use X-ray to
  select through).
- Weights follow modifier changes by nearest rest position, which is fine
  for retuning but not for large topology changes.
- Retargeting copies local rotations (rigs built alike match well) and
  scales root motion by height.
