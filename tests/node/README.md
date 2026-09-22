# Node checks for the Video Editor

Pure-JS suites for the parts of the editor that need no browser. Fast, so run
them constantly while working; the Chrome acceptance suite (`npm test`) is the
slow one that catches rendering and lifecycle bugs.

```sh
node tests/node/ferrite-model.mjs    # scenes, keyframes, easings, effects, keymap
node tests/node/ferrite-render.mjs   # the compositor's decisions, via a recording context
```

Both print a single line and exit non-zero on failure.

`ferrite-render.mjs` stubs `document.createElement('canvas')` with a context
that writes down what it was asked to do, so it can assert paint order,
visibility, mattes and the filter strings without a real canvas.

## Regenerating the effect catalogue

`app/utils/ferrite/effects.js` is generated from Ferrite's Rust source
(`E:\coding_projects\Project_Ferrite\crates\ferrite-core\src\effects.rs`) and
then hand-finished. If upstream changes:

```sh
python tests/node/gen-effects.py        # translates 143 of the 145
python tests/node/gen-effects-hand.py   # appends the two whose bodies branch
npx prettier --write app/utils/ferrite/effects.js
node tests/node/ferrite-model.mjs       # asserts the slot counts still match
```

The two hand-written entries are Long Shadow and Ramp: their Rust bodies
contain `if`/loops that the translator does not attempt.

See `app/utils/ferrite/HANDOFF.md` for the open work.
