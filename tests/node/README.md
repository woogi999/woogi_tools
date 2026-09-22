# Node checks

Pure-JS suites for the parts that need no browser. Fast, so run
them constantly while working; the Chrome acceptance suite (`npm test`) is the
slow one that catches rendering and lifecycle bugs.

```sh
node tests/node/ferrite-model.mjs    # scenes, keyframes, easings, effects, keymap
node tests/node/ferrite-render.mjs   # the compositor's decisions, via a recording context
node tests/node/stft-test.mjs        # the transform the separation models are fed through
```

Each prints a single line and exits non-zero on failure.

`stft-test.mjs` matters more than it looks. A separation model handed a subtly
wrong spectrogram does not fail — it returns noise — so the transform is
checked against a brute-force DFT rather than only against itself. It is what
caught the radix-2 FFT quietly mangling MDX-Net's 6144-sample window, 6144 not
being a power of two.

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
