# The JJS Skill Builder: a working handbook

Everything this project knows about the **Skill Builder** in *Jujutsu
Shenanigans* (JJS, a Roblox game): the code format, the skill and node
structure, how programs run, the patterns creators use, and the two tools
here that read and write it: **Webskill Shenanigans** (the Skill Builder in the
browser) and the **JJS Progress Bar Maker**'s skill export.

**How sure is each thing?**

- **Confirmed**: read from real exports made in JJS, or checked in-game by
  the site's owner. Three exports are kept as test fixtures (see
  [Testing](#10-testing-and-fixtures)): two complete characters with 32
  skills and about 1,900 nodes between them, and a progress bar skill.
- **Inferred**: a reading of what the data shows, not checked against JJS's
  code or in-game. Treat these as hypotheses, and move them to confirmed (or
  correct them) when you learn more.

---

## 1. The code format (confirmed)

The text the Skill Builder copies out (and imports) is:

```
base64( zstd( JSON.stringify(skills) ) )
```

- `skills` is a **JSON array** of skill objects, written compactly.
- Compression is **Zstandard**, with a standard frame. Codes always start
  `KLUv/`, the base64 of zstd's magic number.
- Each skill's program is **JSON inside JSON**: a string in its `DATA` field.

Reading one (Node, from the repo root):

```js
import { init, decompress } from '@bokuweb/zstd-wasm';
await init();
const skills = JSON.parse(Buffer.from(decompress(Buffer.from(CODE, 'base64'))).toString());
for (const s of skills) console.log(s.K_NAME, s.NAME, s.DATA && JSON.parse(s.DATA));
```

In the app: `decodeMoveset` / `encodeMoveset` in
`app/utils/skillbuilder/format.js` (for any moveset), or `decodeSkill` /
`encodeSkill` in `app/utils/jjs-skill.js`.

### Quirks to copy when writing (confirmed)

JJS's JSON comes from Roblox's encoder writing Lua tables:

- **An empty table is `[]`**, whatever it stands for, so an empty `Branch` or
  `Prop` is written `"Branch":[]`, not `{}`. Readers must accept both.
- **"For ever" is `1e38`.** JJS itself writes both `1e38` and `1e+38`, and
  reads both. The writers here produce `1e38`.
- **Floats** sometimes have 17 significant digits (`0.20510204081632656`)
  where JavaScript writes the shortest form that reads back as the same
  double (`…655`). The values are identical. Apart from this and `1e38`, a
  decode → encode round trip is **byte-for-byte identical** on both fixture
  characters.
- **Fields are sparse.** A node often leaves out fields that are at their
  usual value (e.g. a `WAIT` with no `TIME`), so readers must default them.
  Older nodes carry fewer fields than ones made recently.
- **Unknown fields and kinds must pass through untouched.** Webskill
  Shenanigans keeps anything it doesn't recognise.

---

## 2. Skills

```json
{ "ADD": true, "NAME": "Arisugawa Sparkle", "K_NAME": "SKILL", "KEY": 1,
  "COOLDOWN": 12, "TOOL TIP": "", "DATA": "{…}" }
```

`K_NAME` is the **category**, one of the five columns in the builder:

| Category | Fields besides NAME / DATA | Notes |
|---|---|---|
| `SKILL` | `KEY`, `COOLDOWN`, `TOOL TIP`, `ADD` | The numbered skills. `KEY` 1–4 are the slots. |
| `SPECIAL` | `COOLDOWN` | One per character seen. |
| `AWAKENING` | `DURATION`, `DELAY`, `COLOR` | `COLOR` is a gradient: `"255,119,0 255,215,38"` (two `r,g,b`, space-separated). `Req` is usually `BAR ≥ 99.99`. |
| `MELEE` | none | Named `"1"`–`"4"`: the M1 combo's hits. |
| `CHASE` | `COOLDOWN` | One per character seen. |

- **`KEY` conventions (confirmed):** 1–4 are the skill slots. **99** (or,
  in these characters, **9**) is a key nobody presses, which is how
  **passives** run all the time. **15** is used for **separators**.
- **Separators** like `----BASE----` are `ADD: false`, `KEY 15`, with **no
  `DATA` at all**: they're just labels in the skill list.
- **`TOOL TIP`** is the slot's hint: `"JUMP+"`, `"CLOSE+"`, `"HOLD"`,
  `"USE TWICE"`.
- `ADD` is `true` for everything that's part of the moveset.

---

## 3. A program (`DATA`)

```json
{
  "Req": [ …conditions to start… ],
  "Line": [ …nodes, run first ("Default" in the builder)… ],
  "Prop": { "REP": true, "KEEP": true, … },
  "Branch": { "OnHit": { "Line": […], "Req": […] }, … }
}
```

### `Req`: conditions (confirmed shapes)

A list of conditions that must **all** hold: on the program, to use the
skill; on a branch, to **enter** it.

```json
{ "K_NAME": "AIR", "FLIP": true }     // not in the air
{ "K_NAME": "BAR", "AMOUNT": 99.99 }  // awakening bar at least 99.99
```

| `K_NAME` | Holds when | Seen on |
|---|---|---|
| `AIR` | in the air | melee Downslam branch; `FLIP` on a skill = "not usable in the air" |
| `JUMP` | jumping | melee Uppercut branch |
| `HOLD` | the key is held | a barrage's "Walk" branch |
| `ULT` | awakened | "Awakened" branches of passives, chase and special |
| `BAR` | awakening bar ≥ `AMOUNT` | awakenings |

`FLIP: true` inverts a condition. Melee 4's `Base` branch has
`[NOT AIR, NOT JUMP]`: the ground version.

### `Prop`: flags (shapes confirmed, meanings inferred)

An object of flags, or `[]`. Seen: `USE`, `KEEP`, `REP`, `REP2`, `AWK`,
`AWK2`, `NOSTUN`, `NOCANCEL`, and `VAR` (a string).

| Flag | Seen on | Inferred meaning |
|---|---|---|
| `USE` | passives | the skill runs by itself |
| `KEEP` | most attacks | keeps running if interrupted? |
| `REP` | most attacks | can be used again / repeated? |
| `REP2` | a regen passive, one awakening | **repeats** (the regen loops for ever with it) |
| `AWK`, `AWK2` | most | usable while awakened (two awakening states?) |
| `NOSTUN` | most | usable or keeps running while stunned? |
| `NOCANCEL` | many | can't be cancelled by other actions? |
| `VAR` | `"Skill1Able"`, `"S3UseTwice"` | names a variable/tag the skill is tied to. `"S3UseTwice"` is also the tag that skill checks, for its second use. |

---

## 4. How a program runs

This model is **inferred**, but everything in the fixtures fits it, and the
owner's Safety Rails and progress bar skills depend on it working this way.
Webskill Shenanigans' simulator implements exactly this.

1. Using a skill runs its `Line` from the top. Nodes run in order; most take
   no time, and only `WAIT` (and `LOOP`'s rewinds) move time on.
2. **`BRANCH` is a gated jump.** If the named branch exists and its `Req`
   holds, control **goes there and doesn't come back**. Otherwise the line
   **carries on to the next node**. So a line of
   `BRANCH Base · BRANCH Downslam · BRANCH Uppercut` picks whichever variant's
   conditions hold (melee 4, both characters).
3. **A missing branch does nothing**, so a `BRANCH` to a name like
   `">Safety Rails"` is a **comment** (confirmed by the owner).
4. When a branch's line ends, that thread of execution ends.
5. **Loops** are a branch that ends by branching to itself
   (`1Looper: WAIT 0.1 → BRANCH Awakened → BRANCH 1Looper`), or a `LOOP` node.
6. **A hit forks.** A `HITBOX` or `PROJECTILE` that connects starts its
   `BRANCH` on the **attacker** (e.g. "OnHit": follow-ups, camera shake,
   knockback applied to the target), and `BRANCH TARGET` on the **one hit**
   ("OnHitTarget": their stun, hit effects, their reaction). On a kill,
   `BRANCH FINISHER` runs instead of `BRANCH`. These run alongside whatever
   was already running.
7. **`LAST HIT` picks who a node affects.** `-1` means whoever runs it. A
   number (0.1–3.6 seen) means "the one I last hit, if within that many
   seconds". That's how an attacker's OnHit branch pushes the *target*:
   `VELO FORCE "0, 2, 30" LAST HIT 1`.
8. **`RELATIVE FROM BRANCH`** (on VELO, VISUAL, TELEPORT…): directions are
   taken from the character that started the branch (the attacker, in a
   target branch), not the one it's applied to (inferred).
9. **`PROJECTILE TAG`** links things to a projectile. Effects and sounds with
   the same tag and `RELATIVE FROM BRANCH` follow it, and `TELEPORT` with it
   moves you to it. A projectile with `SPEED 0` is an **anchor**: a fixed
   point to hang effects on.

---

## 5. Nodes

Every node has `K_NAME`. The fixtures use **20 kinds**, listed here most-used
first, with their fields (types, and values seen). Field types:
`num`, `str`, `bool`, `"x, y, z"` (a string), `"r, g, b"`, `[a, b]` (an array).
`app/utils/skillbuilder/schema.js` holds the same catalogue as code (labels,
colours, defaults, choices).

### VISUAL (868 uses): an effect

`EFFECT` (37 seen), `TIME`, `BODY PART`, `TEXTURE` (a Roblox **image** ID, for
Billboard/Overlay/Mesh), `SIZE`→`ALT SIZE`, `POSITION`→`ALT POSITION`,
`ROTATION`→`ALT ROTATION`, `COLOR`→`ALT COLOR`, `OPACITY`→`ALT OPACITY`
(transparency: 0 is solid), `EASING STYLE` (Linear, Quad, Cubic, Exponential,
Sine, Back), `EASING DIRECTION` (In, Out, InOut), `SIZE 2`/`ALT SIZE 2`
(`"-1, -1, -1"` = unused), `AMOUNT`, `PROJECTILE TAG`, `VISUAL TAG` (a name a
`Cancel` effect removes it by), `RELATIVE FROM BRANCH`, `CAN COLLIDE`,
`CLIENT SIDED`, `RUN ON SERVER`, `CANCEL ON INTERRUPT`, `LAST HIT`.

The effect **eases from the plain values to the `ALT` ones over `TIME`**
(inferred from pairs like `SIZE 0.01 → ALT SIZE 7`).

Effects seen: Clash, Field of View, Mesh, Melee Trail, Wind Expand, Glow,
Sparks, Screen Color, Billboard, Circle Glow, Overlay, Shake Light/Medium/Heavy,
Beams, Beam, Light, 360 Wind, Whirl Slash, Distortion, Wind Streak, Flames,
Weak Lightning, Afterimage, Afterimage2, Cleave, Visibility, Black Flash,
Cancel, Mass Hit, Camera, Sphere, Energy Sparks, Star, Shine, Cursed Energy,
Ring. Body parts (R6): HumanoidRootPart, Head, Torso, Right/Left Arm,
Right/Left Leg.

### STATE (200): a state for a time, or a check for one

`STATE` (Stun, NoDash, NoJump, NoM1, NoSprint, InSkill, IFrame, Block,
SpeedMultiplier, HealthMultiplier, DirectionLock, DisableChase), `VALUE`
(1, or a multiplier like 0.2), `TIME`, `CANCEL ON END`, `DISABLE BURST`,
`LAST HIT`; and `CHECK` + `BRANCH`: **if in that state, jump** (a custom
block is `STATE Block CHECK → BRANCH Block` in a passive loop).

### WAIT (185)

`TIME`. The only thing that moves a line's time on.

### SFX (146): a sound

`ID` (Roblox sound), `VOLUME`, `START`, `END` (500 = to the end), `SPEED`,
`FADE IN`, `FADE OUT`, `PROJECTILE TAG`, `GLOBAL`, `CANCEL`, `CLIENT SIDED`,
`LAST HIT`.

### ANIM (130): an animation

`ANIM_USE`: JJS's **own animation library**, as `[set, number]`
(e.g. `[20, 17]`), or a **name** (`"Killbind"`). `PREVIEW`: the `[start, end]`
seconds of the clip to play. `SPEED` (can be negative, to play backwards),
`LOOPED`, `FADE IN`, `FADE OUT`, `LAST HIT`. `PREVIEW [0,0]` with speed 1 is
used to cancel an animation.

### VELO (113): push a character

`FORCE` `"x, y, z"`: studs/second, x right, y up, z forward (inferred from
knockbacks). `TIME`, `FADE` (slows to a stop), `TRACK` (follows facing),
`RELATIVE FROM BRANCH`, `RAGDOLL` (seconds), `TRUE RAGDOLL`, `LAST HIT`.
`"0.001, 0.001, 0.001"` for a long time **pins a character in place** (seen
during grabs).

### HITBOX (64): hit what's in a box

`SIZE`, `POSITION` (in front is +z), `ROTATION`, `DAMAGE`, `STUN` (seconds),
`BRANCH` (attacker), `BRANCH TARGET` (the one hit), `BRANCH FINISHER` (on a
kill), `ATTACK TYPE` (Melee, Domain, Bullet, Swarm), `BLOCKABLE`,
`SINGLE TARGET`, `HIT RAGDOLL`, `STUN ANIM`, `CAN KILL`, `CANCEL ENEMY`,
`CLEAR KNOCKBACK`, `IGNORE WAKEUP`, `360 BLOCK`, `HIT USER`, `DEBREE`,
`PROJECTILE TAG`, `LINK USER`, `PREVIEW` (`[0, 15]` always). `"nil"` or `""`
as a branch means none. A zero-damage hitbox is often a **detector**: its
`BRANCH` ("HitCheck") decides what to do next.

### BRANCH (53): gated jump

`BRANCH`, `RANDOM` (`"V1, V2"`: pick one at random; `BRANCH` is then `""`),
`LAST HIT`. See [section 4](#4-how-a-program-runs).

### TAG (38): named values

`TAG`, `VALUE`, `TIME`, `SET`, `ADD/REMOVE`, `CHECK`, `BRANCH`, `LAST HIT`.

| Job | Fields | Example |
|---|---|---|
| Check | `CHECK true`, `BRANCH` | `VALUE "2"` exact; `"<0"`, `">20"` compare (confirmed) |
| Add | `SET false`, numeric `VALUE` | `"1"`, `"-1"`: debug skills, regen |
| Set | `ADD/REMOVE true`, `SET true` | sets the value |
| Clear | `SET true`, `TIME 0` | expires at once |

`TIME` is how long a written value lasts (`1e38` for ever). Non-numeric
values (`"True"`, `"Yes"`) are flags, set and checked by equality.

### PARTICLE (29): a Roblox ParticleEmitter

Mirrors Roblox's ParticleEmitter: `TEXTURE`, `EMIT COUNT`, `LIFETIME`
(`"min, max"`), `SIZE`, `SPEED`, `SPREAD ANGLE`, `COLOR`, `TRANSPARENCY`,
`BRIGHTNESS`, `LIGHT EMISSION`, `LIGHT INFLUENCE`, `ZOFFSET`, `SHAPE`,
`SHAPE INOUT`, `SHAPE PARTIAL`, `EMISSION DIRECTION`, `ORIENTATION TYPE`,
`ROTATION`, `ROT SPEED`, `ACCELERATION`, `DRAG`, `RATE`, `DURATION`,
`LOCK TO PART`, `FLIPBOOK MODE/SIZE/FRAMERATE`, `SQUASH`, `BODY PART`,
`POSITION`, `PART SIZE`, `PROJECTILE TAG`, `CLIENT SIDED`, `CANCEL`,
`CANCEL ON INTERRUPT`, `RUN ON SERVER`, `LAST HIT`.

### LOOP (17)

`LOOP BACK` (nodes to go back), `LOOP AMOUNT` (times), `HOLD` (only while
the key is held). `HITBOX · WAIT 0.05 · LOOP BACK 2 × 9` = a hitbox every
0.05s, ten times (inferred: the first pass plus 9 repeats).

### PROJECTILE (13)

`PROJECTILE TAG`, `SPEED` (0 = anchor), `TIME`, `SIZE`, `POSITION`,
`ROTATION`, `DAMAGE`, `STUN`, `BRANCH TARGET`, `BRANCH COLLIDED`, `CONTINUE`
(keeps going after a hit), `ATTACK TYPE`, `AIM LAST HIT`, `REFLECT COUNT`,
`CAN KILL`, `BLOCKABLE`, `HIT RAGDOLL`, `STUN ANIM`, `CANCEL ENEMY`,
`CLEAR KNOCKBACK`, `IGNORE WAKEUP`, `CANCEL PROJECTILE`, `FILTER INTERVAL`,
`CACHE`, `HIT USER`, `360 BLOCK`, `DEBREE`, `ID CHECK`.

### SETCD (12): start a cooldown

`KEY` (-1 = this skill), `COOLDOWN` (-1 = its usual; or seconds). Often
bare (`{K_NAME:"SETCD"}`), meaning "start my cooldown now".

### GRAB (8): hold the one hit

`BODY PART` (yours), `BODY PART2` (theirs), `POSITION`, `ROTATION`, `TIME`,
`LAST HIT` (grabs whoever was hit within that window).

### Rarer kinds (1–2 uses each)

- **COUNTER**: `TIME` window; being hit by `ATTACK TYPE2` (`"Melee,Bullet"`)
  runs `BRANCH`. Also `REFLECT`, `REMOVE ON HIT`, `CONTINUE`, `CANCEL ENEMY`,
  `STUN`. Used for a dodge ("SwayAway").
- **TELEPORT**: `POSITION`, `ROTATION`, `IGNORE WALLS`,
  `RELATIVE FROM BRANCH`, `PROJECTILE TAG` (to a projectile), `LAST HIT`.
- **LOOK**: face the target for `TIME`: `SMOOTHNESS`, `CAMERA DIRECTION`,
  `HORIZONTAL ONLY`, `GROUNDED`, `RELATIVE FROM BRANCH`, `LAST HIT`.
- **HPGIB**: change health by `AMOUNT`; `CAN KILL`.
- **ULTGIB**: change the awakening bar by `AMOUNT` (`-100` empties it:
  awakenings use it).
- **SETMELEE**: `COMBO`, `OFFSET`: sets the M1 combo state.

### Palette names in the game

JJS's node palette shows **WAIT, SKILL, SPECIAL, ANIMATION, SOUND,
VELOCITY, CONNECT, HITBOX, BRANCH, …** (it scrolls). ANIMATION = `ANIM`,
SOUND = `SFX`, VELOCITY = `VELO`. Which kinds the palette's SKILL, SPECIAL
and CONNECT create isn't known yet (CONNECT is probably `GRAB`).
Webskill Shenanigans labels `SETCD` "COOLDOWN", `SETMELEE` "MELEE",
`GRAB` "CONNECT", `HPGIB` "HEALTH" and `ULTGIB` "AWK BAR".

---

## 6. Patterns (confirmed from the fixtures)

- **Variants by condition**: default line
  `BRANCH Base · BRANCH Downslam · BRANCH Uppercut`, each branch gated by
  `Req` (ground / `AIR` / `JUMP`).
- **Passive loop**: `KEY 9` or `99`, `Prop USE`. Default line `BRANCH 1Looper`,
  and `1Looper: WAIT 0.1 · BRANCH Awakened · BRANCH 1Looper`, with
  `Awakened` gated by `ULT`.
- **Random variant**: `BRANCH "" RANDOM "V1, V2"` (an awakening), or
  `RANDOM "S1, S2, S3"` (a dodge's three animations).
- **Custom block**: passive loop with `STATE Block CHECK → BRANCH Block`.
- **Use twice**: `Prop VAR "S3UseTwice"`, and the line starts with
  `TAG S3UseTwice = 1 CHECK → UseTwice`, else `BRANCH Base`.
- **Detector hitbox**: a 0-damage hitbox in a `LOOP` whose `BRANCH` is
  "HitCheck": the move continues differently when something is in front.
- **Grab-and-throw**: hit → OnHit pins you (`VELO 0.001`, `STATE IFrame`),
  `GRAB` holds them, then a finisher hitbox and a big `LAST HIT` knockback.
- **Projectile anchors**: `PROJECTILE SPEED 0` with a tag, then many
  `VISUAL`s with that tag: a whole effect built around a point.
- **Comments**: `BRANCH ">Some label"`.
- **Separators**: `ADD false`, `KEY 15`, no DATA.

### Displaying a value: the progress bar skill (confirmed in-game)

The Progress Bar Maker's export (`app/utils/jjs-skill.js`) is a passive state
machine on one tag:

```
entry:   TAG Bar = top step (for ever); BRANCH "-"
"-":     TAG Bar == N CHECK → "N"   for N from the top down to 0
         BRANCH ">Safety Rails"          (comment)
         TAG Bar "<0" CHECK → SafetyLesser
         TAG Bar ">top" CHECK → SafetyGreater
         BRANCH "-"
"N":     VISUAL Billboard TEXTURE = step N's image (TIME 0.12); WAIT 0.1; BRANCH "-"
Safety*: VISUAL (the end's image); TAG clear (SET, TIME 0); TAG set to the end
         (for ever); WAIT; BRANCH "-"
```

It comes with **`<name> Regen`** (a passive, `Prop REP2`, adding `+n` every
`s` seconds) and **`Debug: Add / Remove <name>`** (keys 1 and 2, one TAG node
each, `Prop []`). All four match the owner's hand-built versions exactly
(tests).

---

## 7. Webskill Shenanigans

`/webskill-shenanigans`, in the Magnum Opus category. It's a full-window
page (a bare route, like the Video Editor, with the logo as its way home). It's
the Skill Builder in the browser, laid out like the game's: categories and skills on the left, branch
tabs, Timeline / Conditions / Properties tabs, a colour-coded node palette,
the timeline of nodes, and an inspector.

| File | What it is |
|---|---|
| `app/utils/skillbuilder/format.js` | lossless decode/encode; branch and line helpers |
| `app/utils/skillbuilder/schema.js` | the node catalogue ([section 5](#5-nodes)) as code |
| `app/utils/skillbuilder/sim.js` | the simulator ([section 4](#4-how-a-program-runs)) |
| `app/utils/skillbuilder/starter.js` | the starter moveset, blank skills |
| `app/lazy/skill-scene.js` | the 3D view (Three.js, loaded on demand) |
| `app/components/webskill-page.gjs` | the editor |
| `app/components/ws-node-inspector.gjs` | a node's fields |

What it does:

- **Import / export** moveset codes (whole, or one skill). Saves in the
  browser (IndexedDB shelf `webskill`); remembers the working copy.
- **Edit** skills, branches (renaming updates every reference), conditions
  (with FLIP), flags, and nodes. Nodes can be added from the palette,
  dragged or moved, duplicated and deleted, with undo/redo and keyboard
  shortcuts.
- **Play**: runs the skill against a dummy 5 studs ahead, with toggles for
  Air / Jump / Hold / Awakened / bar %, and hits "if in range", "always" or
  "whiff". There's a scrubbable timeline, a log (click a line to jump to its
  node), and a HUD with the dummy's health and live states and tags.

What the simulator **doesn't** do, deliberately or because it's unknown:
blocking, the other character acting on its own, real physics or
collisions, `COUNTER` triggers, damage multipliers, cooldown enforcement,
or JJS's timing to the frame. **Animations are stand-ins**: JJS's library
isn't public, so each `ANIM_USE` gets one of eight procedural poses (always
the same one for the same animation). **Effects are drawn by family**
(glow, ring, sparks, trail, screen tint, shake, FOV). Billboard, Overlay
and textured Mesh effects use the **real Roblox texture**, fetched through
the site's Worker (`/api/roblox?kind=thumb`). **Sounds** play when
switched on and Roblox serves them publicly (`/api/roblox?kind=asset`).

---

## 8. Roblox: pictures for textures

### Decal IDs vs image IDs (confirmed)

Uploading a picture creates **two assets**: an **Image** (what `TEXTURE`
needs) and a **Decal** wrapping it. Roblox's upload API only returns the
**decal** ID. The decal's content is a tiny model whose `Decal.Texture` is
`rbxassetid://<imageId>`, and `app/utils/rbxm.js` reads it, from XML or from
binary models with LZ4 or zstd chunks.

### Privacy: Open Use (confirmed as of 2026)

New accounts upload images and decals as **Restricted**, and **JJS can't
show a Restricted picture**. They need **Open Use**: turn off Creator Hub →
Settings → Advanced → "Opt-in to restrict assets on creation" *before*
uploading, or set each asset to Open Use in the Creator Dashboard. **Open Use
can't be undone. No OAuth API sets it**: the asset-permissions API takes API
keys or a logged-in session only, and grants per game.

### Uploading from the browser (implemented; the real round trip is untested)

`app/utils/roblox.js`, used by the Progress Bar Maker:

- **OAuth 2.0 with PKCE** as a public client, in a popup that returns to
  `public/roblox-callback.html`. The code comes back over a BroadcastChannel,
  because Roblox's login can cut `window.opener`.
- Scopes: `openid profile asset:read asset:write legacy-asset:manage`.
- Upload: `POST https://apis.roblox.com/assets/v1/assets`, then poll
  `/assets/v1/operations/{id}`.
- Decal → image: `GET https://apis.roblox.com/asset-delivery-api/v1/assetId/{id}`
  returns a CDN `location`, which is fetched from `*.rbxcdn.com` and parsed.
- CORS is verified (2026) for this site's origin on all of these. The CDN
  sends `*`, and so does `tr.rbxcdn.com`, where the 3D view's textures come
  from.
- Tokens live in IndexedDB under `auth:roblox`, deliberately outside
  `woogi-`, so backups never carry them.
- Setup: register an OAuth app (redirect `<origin>/roblox-callback.html`) and
  build with `VITE_ROBLOX_CLIENT_ID`. See `.env.development`.
- Risks: the decal → image route isn't promised by Roblox; moderation can
  leave a picture blank until it's approved.

**Status:** the owner confirmed the manual path (pictures uploaded by hand,
IDs pasted in) works in-game. The OAuth path passes tests against a stubbed
Roblox but hasn't yet run against the real one.

---

## 9. Numbers and axes (inferred)

- Positions and sizes are in **studs**; an R6 character is about 5 studs
  tall.
- Local axes: **x right, y up, z forward**. A hitbox at `"0, 0, 4"` sits
  4 studs in front.
- `VELO FORCE` is studs per second for `TIME` seconds. `FORCE "0, 40, 2"`
  launches upwards (an uppercut), `"0, -100, 20"` slams down (a downslam).
- `STUN` / `TIME` values are seconds.

---

## 10. Testing and fixtures

`npm test` runs everything in headless Chrome.

- `tests/fixtures/jjs-characters.js`: **two complete characters**
  exported by the owner (12 and 20 skills). They're the contract for:
  - `tests/unit/skillbuilder-test.js`: decode → encode is lossless; every
    node kind is known; the simulator picks melee variants by condition,
    forks OnHit/OnHitTarget, loops, random branches, tags; and it runs the
    Progress Bar Maker's skill.
  - `tests/acceptance/webskill-test.js`: import, edit → export, branch
    rename, play.
- `tests/unit/jjs-skill-test.js`: the progress bar skill, Safety Rails,
  regen and debug skills must equal the owner's real exports exactly.

**When you learn something new about JJS: add the real export as a
fixture, write the test, then update this file,** moving things from
inferred to confirmed.

## 11. Open questions

- The exact meanings of `KEEP`, `REP`, `AWK`/`AWK2`, `NOSTUN`, `NOCANCEL`,
  `USE` and `VAR`.
- Whether a branch **returns** to its caller when it ends (everything so
  far fits "no").
- What the builder palette's SKILL, SPECIAL and CONNECT create, and which
  kinds exist beyond the 20 seen.
- `ANIM_USE`'s library: which `[set, number]` is which animation.
- `LAST HIT 0` exactly, `LINK USER`, `DEBREE`, `AMOUNT` on visuals,
  `RELATIVE FROM BRANCH` in every node.
- How `COUNTER`, `BLOCKABLE`, `360 BLOCK` and `IGNORE WAKEUP` interact with
  blocking.
- Whether keys 9 and 99 behave differently.
