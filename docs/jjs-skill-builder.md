# The JJS Skill Builder: a working handbook

Everything this project knows about the **Skill Builder** in *Jujutsu
Shenanigans* (JJS, a Roblox game): the code format, the skill and node
structure, how programs run, the patterns creators use, and the two tools
here that read and write it: **Webskill Shenanigans** (the Skill Builder in the
browser), the **JJS Progress Bar Maker**'s skill export, and the ready-made
skills in **JJS Stuff → Templates**.

**How sure is each thing?**

- **Confirmed**: read from real exports made in JJS, or checked in-game by
  the site's owner. The exports kept as test fixtures (see
  [Testing](#10-testing-and-fixtures)) are four complete characters and a
  progress bar skill.
- **Inferred**: a reading of what the data shows, not checked against JJS's
  code or in-game. Treat these as hypotheses, and move them to confirmed (or
  correct them) when you learn more.
- **From the guides**: community write-ups kept in the git-ignored
  `jjs_training_data/` ("Skill-Builder Tutorial.md", a node-by-node rundown
  from February 2026; "CB Notes.md" and "Variants.md", notes from the JJS
  Discord). They fill gaps, but **when they disagree with the owner or with
  what's confirmed here, the owner and this file win**. Where they disagree,
  this file says so.

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

- **`KEY` conventions (confirmed):** 1–9 are the skill slots, though vanilla or base JJS characters only use 1-4.
- **99** is a key nobody presses, which is how **passives** run all the time. **99** can also be used for **separators**, as by nature it is an unpressable key.
- **Separators** like `----BASE----` are `ADD: false`, `KEY 99 (or an unpressable value like 15)`, with **no
  `DATA` at all**: they're just labels in the skill list.
- **`TOOL TIP`** is the slot's hint: `"JUMP+"`, `"CLOSE+"`, `"HOLD"`,
  `"USE TWICE"`.
- `ADD` is `true` for everything that's part of the moveset.

**Character block vs moveset block** (from the guides): a *character* block
in build mode holds a whole character (M1s, skills, special, awakening,
chase), and with "Show in List" it joins the character list. The older
*moveset*, *special* and *awakening* blocks replace a single slot. A `CHASE`
replaces the forward dash, and needn't be a dash at all.

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
| `HP` | Has Health: more health than the value (flipped, less) | the owner's export, written bare as `{"K_NAME":"HP"}` with its defaults |

`FLIP: true` inverts a condition. Melee 4's `Base` branch has
`[NOT AIR, NOT JUMP]`: the ground version. The builder shows `FLIP` as a
green toggle and "off" as red, which the guides call "backwards": In Air
*red* means only in the air, *green* only on the ground.

The game's Conditions tab also has (from the guides; their `K_NAME`s haven't
been seen in an export yet): **Has Target** (facing a player or NPC),
**Is In Domain**, and
**Durability** (the skill is lost after that many uses: with Use When
Obtained, it's how a spawn-in move runs once). Has Awk Bar is `BAR`:
more than `AMOUNT`, or with `FLIP`, less.

### `Prop`: flags

An object of flags, or `[]`. Seen: `USE`, `KEEP`, `REP`, `REP2`, `AWK`,
`AWK2`, `NOSTUN`, `NOCANCEL`, and `VAR` (a string). The first four rows are
**confirmed by the owner**. The rest are matched to the game's Properties
list (from the guides), which comes in the same pairs, and to the fixtures.

| Flag | Properties toggle | Meaning |
|---|---|---|
| `USE` | Use When Obtained | the skill is used **as soon as it's obtained**, i.e. on spawn. Every passive has it. |
| `KEEP` | Keep when moveset switches | the skill stays when the moveset changes (a character block or another custom event): for **weapons and arsenal** |
| `NOSTUN` | No Stun | the skill **doesn't stun you**: you can move, dash and use other skills while it runs |
| `NOCANCEL` | No Cancel | being hit **doesn't interrupt it** |
| `VAR` | Variant | a tag name. While that tag is active, the skill **can be used even on cooldown** (confirmed) and through stun (guides). `"S3UseTwice"` is the tag the skill checks for its second use. |
| `REP` | Replace Skill if Occupied (inferred) | takes the key's slot even if something's in it. On nearly every keyed skill. |
| `REP2` | Prevent Override (inferred) | can't be replaced by another skill. On an awakening and the regen passive. |
| `AWK` | Hide in Awakening (inferred) | on **every base skill** in character 2, and on passives |
| `AWK2` | Hide in Base (inferred) | on **every awakened skill** in character 2, and on passives |

That's why passives have **both `NOSTUN` and `NOCANCEL`** (owner): a
passive runs for ever, so it mustn't stun you or be cut off when you're hit.
Passives also carry both `AWK` and `AWK2`, harmless on a key nobody presses.

Other Properties with no flag seen yet: Damage Multiplier, Knockback
Multiplier (negative reverses it), Invincible, and Use on Death.

---

## 4. How a program runs

This model is **inferred**, but everything in the fixtures fits it, and the
owner's Safety Rails and progress bar skills depend on it working this way.
Webskill Shenanigans' simulator implements exactly this.

1. Using a skill runs its `Line` from the top. Nodes run in order; only
   `WAIT` takes real time, though the guides say each node is spaced about
   **0.01 s** from the next, which adds up in long loops. (The simulator
   counts nodes as instant.)
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
6. **A hit moves the line on.** A `HITBOX` that connects sends the
   **attacker's** line to its `BRANCH` (e.g. "OnHit": follow-ups, camera
   shake, knockback applied to the target), and **the rest of the line is
   dropped** (guides). It also starts `BRANCH TARGET` on the **one hit**
   ("OnHitTarget": their stun, hit effects, their reaction), alongside
   whatever they were doing. `BRANCH FINISHER` replaces `BRANCH` when the
   hit leaves them on 1 HP or less. The fixtures depend on this: the
   blocked-recoil detector after every M1, and the dash's "nobody there"
   stun, are only reached when the real hit didn't land. **A projectile's
   `BRANCH` and `BRANCH COLLIDED` do the same** when they happen, later:
   they replace the line that fired the projectile, wherever it has got to.
   (`BRANCH COLLIDED` is confirmed by the owner. The guides say it of
   `BRANCH`, and the simulator follows both.) A skill runs one line at a time.
7. **`LAST HIT` picks who a node affects.** `-1` means whoever runs it. A
   number (0.1–3.6 seen) means "the ones I last hit, if within that many
   seconds" (several, for most nodes). That's how an attacker's OnHit branch
   pushes the *target*: `VELO FORCE "0, 2, 30" LAST HIT 1`. The guides warn
   that **a hit only counts if its `STUN` isn't 0**: any tiny stun will do,
   which is why detector hitboxes have `STUN -1` or `0.0001`. A `BRANCH` with
   `LAST HIT 1` runs the branch on the one hit (only one), and your own line
   carries on. If your line ends while they're still in it, you're free and
   the cooldown starts (bleeds, blinds).
8. **`RELATIVE FROM BRANCH`** (on VELO, VISUAL, TELEPORT…): directions are
   taken from the character that started the branch (the attacker, in a
   target branch), not the one it's applied to (inferred).
9. **`PROJECTILE TAG`** links things to a projectile. Effects and sounds with
   the same tag and `RELATIVE FROM BRANCH` follow it, and `TELEPORT` with it
   moves you to it. A projectile with `SPEED 0` is an **anchor**: a fixed
   point to hang effects on.

---

## 5. Nodes

Every node has `K_NAME`. The fixtures use **21 kinds**, listed here most-used
first (the counts are from the first two characters), with their fields (types, and values seen). Field types:
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

The effect **eases towards its `ALT` values over `TIME`**, but each `ALT` works
differently (confirmed by the owner unless marked):

- **`ALT POSITION` is a move, not a destination.** It's added to `POSITION`:
  `POSITION "5, 0, 0"` with `ALT POSITION "-10, 0, 0"` ends at `-5, 0, 0`.
  **Setting one unanchors the visual**: it no longer follows the character
  it came from. The exceptions are **Billboard** (below) and **immovable
  visuals** such as **Wind Expand**.
- **`ALT POSITION` is in the visual's own rotated axes** (inferred from the
  owner's fishing rod, where it fits to within a stud). It reads as if JJS
  places the visual at `origin * CFrame.new(POSITION) * CFrame.Angles(ROTATION)`
  and tweens it to *that* `* CFrame.new(ALT POSITION) * CFrame.Angles(ALT ROTATION)`,
  so `POSITION` is in the body part's axes but the move is not. With
  `ROTATION "-90, 180, 0"` the move's axes are `(x, y, z)` → `(right, back,
  down)`: `ALT POSITION "0.5, -55, -4"` moves 55 forward, 4 **up** and 0.5
  right. It also explains why the move is added rather than being a
  destination. At `ROTATION "0, 0, 0"` the two sets of axes are the same,
  which is why most visuals don't show it. The owner's tests fit this: a
  positive y reeled the tip back, and a `+4` in z sent it down. The tip's
  *pivot* isn't the rod's visible tip, though, so calibrate alignment by eye
  rather than from this sum. (Placing the tip 4 studs up, as the sum
  suggested, looked worse.)
- **`ALT ROTATION` needs an `ALT POSITION`** (a bug): without one it's
  ignored. The fix is a tiny move like `ALT POSITION "0, 0.0001, 0"`, which
  also unanchors it, so **a visual can't both spin and stay pinned to a
  limb**. (The dash's wind streaks use `"0, 0.001, 0"` for this.)
- **`ALT SIZE` is a multiplier** of `SIZE` (guides): `SIZE 25, ALT SIZE 2`
  ends at 50. To end at a size *s*, use *s* / `SIZE`.
- **`SIZE 2` and `ALT SIZE 2` override** `SIZE` and `ALT SIZE`: absolute
  sizes per axis (`"x, y, z"`), so you can squash and stretch.
  `"-1, -1, -1"` means unused.
- `OPACITY` → `ALT OPACITY` and `COLOR` → `ALT COLOR` fade as you'd expect.
- **`BODY PART`**: the guides say most effects need `POSITION "0, -1, 0.15"`
  to sit in the hand on an arm.
- **`RUN ON SERVER`** runs it on the server rather than on each client.
  That's heavier, so it's for auras, weapons and states, not attack effects.
  It's a different thing from **`CLIENT SIDED`** (only the user sees it).
- **`TEXTURE`** wants the **image** (texture) ID, not the decal's (see
  [section 8](#8-roblox-pictures-for-textures)).

- **`Billboard`** is placed **pseudo-2D** (confirmed by the owner in-game): its
  `POSITION` is on the screen around the body part, not in the world.
  **x** goes across, and negative is to the **right**. **y** goes up and down
  (negative is down). **z** is a **layer**, like a z-index: negative draws it
  in front of the character, positive behind. A y only sticks if **`ALT
  POSITION`** holds **minus twice** that y: `POSITION "0, 4, 0"` wants
  `ALT POSITION "0, -8, 0"`. The Progress Bar Maker writes the pair for you
  (`billboardAlt` in `app/utils/jjs-skill.js`), and its 3D preview
  (`app/lazy/bar-scene.js`) places the billboard this way.
- **`Mesh`**: `AMOUNT` is the **mesh ID** and `TEXTURE` its texture (inferred:
  a katana is `AMOUNT 10447572102, TEXTURE 10447572165`). With `TIME 1e38`,
  `CANCEL ON INTERRUPT` and a `VISUAL TAG`, it's a **worn item**.
- **`Cancel`**: removes the effects with the same `VISUAL TAG` (confirmed by
  the auto-sheathing passive, which moves a sword between back and hand this
  way). **The Cancel must be on the same `BODY PART`** as the visual it
  cancels (owner). The guides add that its `RUN ON SERVER` must match too.
  Most of its other fields do nothing.
- Quirks from the guides:
  - **Field of View**: `AMOUNT` positive zooms out, negative in.
  - **Screen Color**: `AMOUNT` 1 down to 0.01 fades it, and negative inverts
    the colours (impact frames).
  - **Blood**: `AMOUNT` drops, `SIZE` the radius.
  - **Dismantle** only shows with an `ALT POSITION` (even `0, 0, 0.01`).
  - **Mass Hit** only shows with a `POSITION`, and its `ALT POSITION` turns
    it.
  - **Overlay**: a picture over the target's screen.
  - **Camera**: a fixed camera for the target; only the positions, the
    rotations, `TIME` and `LAST HIT` matter.

Effects seen: Clash, Field of View, Mesh, Melee Trail, Wind Expand, Glow,
Sparks, Screen Color, Billboard, Circle Glow, Overlay, Shake Light/Medium/Heavy,
Beams, Beam, Light, 360 Wind, Whirl Slash, Distortion, Wind Streak, Flames,
Weak Lightning, Afterimage, Afterimage2, Cleave, Visibility, Black Flash,
Cancel, Mass Hit, Camera, Sphere, Energy Sparks, Star, Shine, Cursed Energy,
Ring, and (from the later exports) Burst, Slash, Wind Ring. Body parts (R6): HumanoidRootPart, Head, Torso, Right/Left Arm,
Right/Left Leg.

### STATE (200): a state for a time, or a check for one

`STATE` (Stun, NoDash, NoJump, NoM1, NoSprint, InSkill, IFrame, Block,
SpeedMultiplier, HealthMultiplier, DirectionLock, DisableChase,
Scale (`VALUE "0.9"` for ever: a smaller character), NoBlock), `VALUE`
(1, or a multiplier like 0.2), `TIME`, `CANCEL ON END`, `DISABLE BURST`,
`LAST HIT`; and `CHECK` + `BRANCH`: **if in that state, jump** (a custom
block is `STATE Block CHECK → BRANCH Block` in a passive loop).

From the guides:

- **`CANCEL ON END`** ends the line the state was set from when the state runs
  out. That's how the dash's 1.2 s states cap the dash.
- **`Stun`** stops new actions but not a move already running.
- **`Block`** blocks without the animation.
- **`DirectionLock`** stops turning.
- **`NoChase`** stops only the forward dash; **`NoDash`** stops every dash.
- **`SpeedMultiplier`** and **`JumpMultiplier`** multiply walk speed (16)
  and jump power (40).
- **`DISABLE BURST`** blocks burst for the time.

**A state can't be cancelled** (owner): once set, it lasts its whole `TIME`.
If a move can end early (say, a hook that catches someone close), don't give
it one long `InSkill`. Set short states and top them up along the line, and
have each branch it can jump to set its own. When the line leaves, the top-ups
stop, and what's left runs out within one short interval.

### WAIT (185)

`TIME`. The only thing that moves a line's time on.

### SFX (146): a sound

`ID` (Roblox sound), `VOLUME`, `START`, `END` (500 = to the end), `SPEED`,
`FADE IN`, `FADE OUT`, `PROJECTILE TAG`, `GLOBAL`, `CANCEL`, `CLIENT SIDED`,
`LAST HIT`. `CANCEL` stops the sounds with the same `ID` (guides). Most
sounds need `VOLUME` 2–3 to be heard.

### ANIM (130): an animation

`ANIM_USE`: JJS's **own animation library**, as `[set, number]`
(e.g. `[20, 17]`), or a **name** (`"Killbind"`). `PREVIEW`: the `[start, end]`
seconds of the clip to play. `SPEED` (can be negative, to play backwards),
`LOOPED`, `FADE IN`, `FADE OUT`, `LAST HIT`. `PREVIEW [0,0]` with speed 1 is
used to cancel an animation. An animation stops when the skill does; on the
one hit (`LAST HIT 1`), it plays while they're stunned (guides).

### VELO (113): push a character

`FORCE` `"x, y, z"`: studs/second, **x left** (negative is right), y up,
z forward. `TIME`, `FADE` (slows to a stop), `TRACK` (follows facing),
`RELATIVE FROM BRANCH` (on a target, directions come from whoever started
the branch), `RAGDOLL` (seconds), `TRUE RAGDOLL` (can't be ragdoll-cancelled),
`LAST HIT`.
`"0.001, 0.001, 0.001"` for a long time **pins a character in place** (seen
during grabs).

**A newer VELO replaces the one in progress** (inferred; the simulator does
this). The dash's OnHit pin stops the dash, and in the owner's air fishing
rod a hover pin holds a boost where it ends. Pushes don't add up, so a pin
set while a boost is still running cuts the boost off.

### HITBOX (64): hit what's in a box

`SIZE`, `POSITION` (in front is +z), `ROTATION`, `DAMAGE`, `STUN` (seconds),
`BRANCH` (attacker), `BRANCH TARGET` (the one hit), `BRANCH FINISHER` (on a
kill), `ATTACK TYPE` (Melee, Domain, Bullet, Swarm), `BLOCKABLE`,
`SINGLE TARGET`, `HIT RAGDOLL`, `STUN ANIM`, `CAN KILL`, `CANCEL ENEMY`,
`CLEAR KNOCKBACK`, `IGNORE WAKEUP`, `360 BLOCK`, `HIT USER`, `DEBREE`,
`PROJECTILE TAG`, `LINK USER`, `PREVIEW` (`[0, 15]` always). `"nil"` or `""`
as a branch means none. A zero-damage hitbox is often a **detector**: its
`BRANCH` ("HitCheck") decides what to do next.

From the guides:

- `CAN KILL` off leaves them on 1 HP (finisher variants).
- `SINGLE TARGET` hits the one nearest the box's centre.
- `360 BLOCK` on lets it be blocked from any side; off, it breaks a block
  from behind.
- `HIT RAGDOLL` hits ragdolled characters.
- `CANCEL ENEMY` cancels their move (with a stun of 0.1 or less and it off,
  it doesn't).
- `CLEAR KNOCKBACK` stops their knockback and picks them up from a ragdoll.
- `DEBREE` is debris size: 0 none, -1 breaks the ground without debris.
- A long box usually wants its z `POSITION` at half its z `SIZE`, so it
  starts at you.

### BRANCH (53): gated jump

`BRANCH`, `RANDOM` (`"V1, V2"`: pick one at random; `BRANCH` is then `""`),
`LAST HIT`. See [section 4](#4-how-a-program-runs). Branch names are
**case-sensitive**. `RANDOM` is typed `V1,V2` with no spaces, and the game
spaces it out itself.

### TAG (38): named values

`TAG`, `VALUE`, `TIME`, `SET`, `ADD/REMOVE`, `CHECK`, `BRANCH`, `LAST HIT`.

| Job | Fields | Example |
|---|---|---|
| Check | `CHECK true`, `BRANCH` | `VALUE "2"` exact; `"<0"`, `">20"` compare (confirmed) |
| Add | `ADD/REMOVE true` (or absent), `SET false`, numeric `VALUE` | `"1"`, `"-1"`: debug skills, regen |
| Set | `SET true` | sets the value, whatever it was |
| Clear | `SET true`, `TIME 0` | expires at once |

`TIME` is how long a written value lasts (`1e38` for ever). Non-numeric
values (`"True"`, `"Yes"`) are flags, set and checked by equality.

**Bug: a plain `SET` sometimes doesn't take** (owner). The sure way is to
**clear, then set**: `SET` with `TIME 0`, then `SET` the value for as long
as you want. The tag is **reactivated** rather than added to or rewritten,
which dodges the bug. The Safety Rails do exactly this, and so should
anything that must land. (The guides suggest other workarounds, such as
adding 0 for 0.0001 s and waiting it out before adding the value; the
owner's clear-then-set is the one used here.)

More from the guides:

- The **latest write's `TIME` wins**: set 1 for 3 s and then add 0 for 2 s,
  and the tag is gone after 2 s.
- **An expired tag is gone**: no check matches it, not even `"0"` or `""`.
  Tags also go when their owner dies.
- `CHECK` with `LAST HIT` (checking someone else's tag) is reported as
  buggy: keep `LAST HIT -1`.
- One guide (April 2026) warned that `<`/`>` checks were broken. **The
  owner's bars use them and work**, so this file treats them as working.
- "For ever" is `1e38` here. The guides use `1e+250` (or `1e+20` if that
  fails); `1e38` is what the game itself writes.

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
0.05s, ten times (inferred: the first pass plus 9 repeats; the guides agree
that the first pass counts). The guides call loop timing with `HOLD`
unreliable, and suggest a short `WAIT` inside every loop.

### PROJECTILE (13)

`PROJECTILE TAG`, `SPEED` (0 = anchor), `TIME`, `SIZE`, `POSITION`,
`ROTATION`, `DAMAGE`, `STUN`, `BRANCH TARGET`, `BRANCH COLLIDED`, `CONTINUE`
(keeps going after a hit), `ATTACK TYPE`, `AIM LAST HIT`, `REFLECT COUNT`,
`CAN KILL`, `BLOCKABLE`, `HIT RAGDOLL`, `STUN ANIM`, `CANCEL ENEMY`,
`CLEAR KNOCKBACK`, `IGNORE WAKEUP`, `CANCEL PROJECTILE`, `FILTER INTERVAL`,
`CACHE`, `HIT USER`, `360 BLOCK`, `DEBREE`, `ID CHECK`.

From the owner's tests (the fishing rod, below):

- **`BRANCH COLLIDED` works**, and it's the only node that can
  detect the ground or a wall. One guide calls it non-functional; the owner
  says otherwise. It runs **as you** (a `VELO` in it launched the owner), and
  it appears to **replace your line**, like a hitbox's `BRANCH`: a rod whose
  probes collided during the wind-up just stopped there (owner). So the
  collided branch has to carry the rest of the move itself. (An earlier
  test seemed to show the line carrying on; the stopped rod is the clearer
  evidence.) A Field of View in it didn't show, nor did a Glow with the
  projectile's `PROJECTILE TAG`, but a Mesh with that tag did.
- **`ROTATION` steers it**: `"30, 0, 0"` flew upwards, so to aim down,
  use a negative x. That's the **opposite** of a visual's `ROTATION`, where
  a positive x tilts the forward axis down (inferred: projectiles seem to be
  turned in Roblox's own axes, visuals in JJS's).
- A `TIME` as short as **0.02 s** works: the rod's probes (`SPEED 350`,
  about 7 studs each) find walls.

From the guides:

- It flies along your +z.
- `ROTATION` turns its hitbox and affects where it is going forward.
- `SPEED` is studs per second, for `TIME` seconds.
- `AIM LAST HIT 1` aims at whoever you last hit.
- `CONTINUE` off stops it at the first wall or character.
- `FILTER INTERVAL` sets the i-frames between its hits (0 hits every tick).

### SETCD (12): start a cooldown

`KEY` (-1 = this skill), `COOLDOWN` (-1 = its usual; or seconds). Often
bare (`{K_NAME:"SETCD"}`), meaning "start my cooldown now".

### GRAB (8): hold the one hit

`BODY PART` (yours), `BODY PART2` (theirs), `POSITION`, `ROTATION`, `TIME`,
`LAST HIT` (grabs whoever was hit within that window).

From the guides:

- **The one held can't be hurt** for `TIME`.
- A very short `TIME` (0.01) just repositions them.
- `"0, 0, 4"` with `ROTATION "0, 180, 0"` holds them in front, facing you.
- As with every `LAST HIT`, the hit must have had a stun.

### Rarer kinds (1–2 uses each)

- **COUNTER**: `TIME` window; being hit by `ATTACK TYPE2` (`"Melee,Bullet"`)
  cancels the damage and runs `BRANCH`. Also `REFLECT`, `REMOVE ON HIT` (the
  window closes on the first counter), `CONTINUE`, `CANCEL ENEMY`, `STUN`
  (on the one countered). Used for a dodge ("SwayAway"). No base counter
  takes Explosion or Domain attacks.
- **TELEPORT**: `POSITION`, `ROTATION`, `IGNORE WALLS`,
  `RELATIVE FROM BRANCH`, `PROJECTILE TAG` (to a projectile), `LAST HIT`.
- **LOOK**: face the target for `TIME`: `SMOOTHNESS`, `CAMERA DIRECTION`,
  `HORIZONTAL ONLY`, `GROUNDED`, `RELATIVE FROM BRANCH`, `LAST HIT`.
  With `CAMERA DIRECTION` on and `HORIZONTAL ONLY` off, you face where the
  camera points, **pitch included**. Everything placed relative to you
  (hitboxes, projectiles, visuals, VELO) then aims up or down with you
  (owner, the air fishing rod). The owner on pairing it with a
  `DirectionLock`: "look + directionlock makes it so that your look works
  with shift lock, not the other way around". The lock doesn't stop the LOOK.
- **HPGIB**: change health by `AMOUNT`; `CAN KILL`.
- **ULTGIB**: change the awakening bar by `AMOUNT` (`-100` empties it:
  awakenings use it).
- **SETMELEE**: `COMBO`, `OFFSET`: sets the M1 combo state.
- **SKILL** (the palette's SKILL): uses a **base-game move**: `MOVE`,
  `START` (how far in to start, e.g. only a move's impact), `SPEED` (0
  freezes it), `HOLD FOR` (seconds held, for hold variants),
  `ENABLE VARIANTS` (e.g. aerial ones), `CANCEL LAST` (cancels every earlier
  SKILL and SPECIAL). **`MOVE "Cancel"`** does the same as `CANCEL LAST`.
  It's seen once, in Gon's "Swap Block": blocking cancels the move in
  progress and swaps stance.

### Palette names in the game

The node palette, in the guides' order: **WAIT, HIT CANCEL, LOOP, SKILL,
SPECIAL, ANIMATION, SOUND, VELOCITY, CONNECT, HITBOX, BRANCH, GRAB, VISUAL,
PROJECTILE, COUNTER, TAG, STATE**, and the misc nodes **Add Awakening**
(`ULTGIB`), **Add Health** (`HPGIB`) and **Add Evasion**. ANIMATION = `ANIM`,
SOUND = `SFX`, VELOCITY = `VELO`. Palette entries not yet seen in an export
(their `K_NAME`s are unknown):

- **HIT CANCEL**: after a `WAIT` of the same length, checks whether you hit
  anyone in the last `TIME`. With `FLIP` (green) a *miss* stops the line and
  leaves you in endlag; off, a *hit* does. With a `BRANCH`, that branch runs
  instead of the endlag.
- **SPECIAL**: like SKILL, for a base-game special (`SPEED`, `CANCEL LAST`,
  `ENABLE VARIANTS`). It doesn't replace your own special.
- **CONNECT**: sends `SIGNAL` to build-mode blocks within `DISTANCE` studs,
  for `TIME`. It is **not** `GRAB`, which is its own palette entry.
- **Add Evasion**: changes the ragdoll-cancel meter.

Webskill Shenanigans labels `SETCD` "COOLDOWN", `SETMELEE` "MELEE",
`HPGIB` "HEALTH" and `ULTGIB` "AWK BAR". (It used to label `GRAB`
"CONNECT"; now it's "GRAB".)

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
- **Blocked recoil** (every M1 in both later characters): after the real
  hitbox (blockable, `BRANCH OnHit`, `BRANCH TARGET OnHitTarget`), a second,
  0-damage, unblockable hitbox in the same place with `BRANCH "Blocked"`.
  Blocked leaves you open: `NoJump`/`NoDash`, the swing replayed from the
  hit moment at half speed, and a wait.
- **Stacks**: a hit adds 1 to a tag for 8 s (`ADD/REMOVE true`, `SET false`,
  `VALUE "1"`); moves check `== 2` for an enhanced version, which clears the
  tag (`SET`, `TIME 0`); a passive loop shows an aura while it's 2.
- **Tag as a flag with a timeout**: set `UseKatana = "True"` for 4 s from
  every move; a passive notices it's gone (see Auto-sheathing below).
- **Separators**: `ADD false`, `KEY 15`, no DATA.

### The fishing rod: techniques confirmed in-game

The owner's hook-and-grapple skill (built node by node in this project; the
source is in `jjs_training_data/`) put several tricks to work:

- **A detector ladder instead of a counter.** Ten 0-damage, unblockable
  `STUN -1` hitboxes, 6, 12, … 60 studs long, fired shortest first. The
  first to touch someone jumps to its own `CatchN` branch, and the hit
  drops the rest of the line, so *which* hitbox hit is the distance. Pace
  them with `WAIT`s to trail an eased visual.
- **Detect, then really hit.** Detectors are unblockable, so blocking
  doesn't spam the block sound. `CatchN` fires one blockable hitbox of the
  same size: if it lands, pull; if it's blocked, just reel in.
- **Take a travelling visual off and redraw it.** The cast's tip and line
  carry `VISUAL TAG`s, and `CatchN` cancels them (Cancels on the same body
  part) and draws them again at length N.
- **Short states, topped up.** A state can't be cancelled, so the line sets
  0.15–0.45 s at a time, and each branch it can jump to sets its own.
- **A probe ladder for walls.** Ten 0.02 s projectiles, one per 6-stud
  stretch, nearest first, each with `BRANCH COLLIDED "WallN"`. The collided
  branch replaces the line, so each `WallN` *is* the rest of the move (the
  remaining wind-up with the later probes turned into plain `WAIT`s, the
  cast, the detectors up to N, then `GrappleN`). The first wall found
  wins, and no tag has to carry the news.
- **An air variant**: `BRANCH Air1` (with `Req AIR`) before `BRANCH 1`. It
  adds a faded boost (`"0, 25, -20"` for 0.2 s: about 2.5 up and 2 back),
  hover pins until the cast's own pin, and a pitch-following `LOOK`.

### Variant recipes (from the guides)

Not seen in the fixtures, but standard in the community. Wherever a recipe
sets a tag that must land, use the owner's clear-then-set
([TAG](#tag-38-named-values)).

- **Use twice.** Name a tag in `Prop VAR` ("use-twice"). The default line
  starts `TAG use-twice == 1 CHECK → variant`. After the first use's move,
  set the tag to 1 for the window you allow. The `variant` branch sets it
  back to 0, then does the second move. For more uses, chain more values.
- **Hold for a time.**
  1. Set a counter tag to 0.
  2. Loop over `WAIT 0.01 · add 1 · CHECK counter == N → held` with a `HOLD`
     loop, so it only runs while the key is down.
  3. Letting go early falls through to the normal move.
- **Hold to repeat.** `SKILL … · WAIT 0.1 · LOOP BACK 2 × 50, HOLD`.
- **Modes.** The special adds 1 to a "mode" tag on its first use and -1 on
  its second (a use-twice). Moves start with `CHECK mode == 1 → mode1`.
- **Press R mid-move.** The move has `NOSTUN`, with a `STATE Stun` standing
  in for real stun. It sets `r-variant = 1` for the window. The special
  checks it, clears it, and does the variant.
- **Random.** `BRANCH "" RANDOM "b1,b2,b3"`.
- **Changes after use.** At the end, set `variant = 1` for cooldown + the
  window. At the start, `CHECK variant == 1 → variant`, which clears it.

### Base-game timings (from the guides)

These are replicas, where no export shows the real thing:

- **Vanilla M1**: `WAIT 0.25`, the hitbox, `STATE NoM1` 0.15 s. The owner's
  Accurate M1s (below) come from a real export and win where they differ.
- **Vanilla dash**:
  1. `VELO "0, 0, 50"` for 0.1 s.
  2. A blockable hitbox.
  3. HIT CANCEL 0.1 s (red).
  4. `LOOP BACK 3 × 25`.

  The Accurate dash below is the real one.

### Displaying a value: the progress bar skill (confirmed in-game)

The Progress Bar Maker's export (`app/utils/jjs-skill.js`) is a passive state
machine on one tag, in one of two styles. Both start the same way and share
the `-` dispatcher (the checks from the top step down, the rails, `BRANCH "-"`).

**Complex** (the default; the owner's lag-proof version, matched exactly by a
test). Each step is shown **once, for ever**, and taken off by `Cancel`
effects that name its `VISUAL TAG`, so nothing is drawn again until the tag
changes:

```
"N":           VISUAL Billboard, step N's image, TIME 1e38, VISUAL TAG "BarN"
               VISUAL Cancel "BarLesser", "BarGreater" (the rails' billboards)
               VISUAL Cancel, VISUAL TAG "BarK"   for every other step K
               BRANCH ">Checks"                    (comment)
               TAG Bar == K CHECK → "K"            for every other K, top down
               BRANCH ">Safety Rails"              (comment, with the rails)
               TAG Bar "<0" → SafetyLesser; TAG Bar ">top" → SafetyGreater
               WAIT 0.05
               LOOP BACK (other steps + 2 rails + 3), LOOP AMOUNT 1e38
SafetyLesser:  the empty picture under its own tag "BarLesser"; Cancel every
               step; BRANCH "SafetyLesserHold"
SafetyLesserHold:
               the tag cleared and set to 0 (SET, TIME 0; SET, for ever:
               the clear-then-set that dodges the SET bug);
               then the same checks (not for 0) and loop, but "<0" comes back
               here: a pseudo-min
SafetyGreater / SafetyGreaterHold: the same with the full picture,
               "BarGreater" and the top step: a pseudo-max
```

**Why the Holds** (a fix on the owner's version): in that version a rail's own
loop sent a second push past its end back to the rail, which drew another
billboard on top of the first without cancelling it. A bar kept at full by
regen (or spammed past an end) piled them up, and the picture thickened. The
Hold re-clamps the tag without drawing, so a billboard is only drawn when the
picture on show changes. (Cancelling the rail's own tag before drawing would
also stop the pile-up, but it would redraw on every push, and could flicker.)

`LOOP BACK` counts the nodes from `>Checks` to the `WAIT`: the checks, the two
comments and the wait (without rails: the checks, `>Checks` and the wait). It
lands on `>Checks`, so the loop only ever checks.

**Legacy** (the first version). Each step is shown briefly and the dispatcher
runs again, which draws it again, for ever:

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
(tests), and are the same in both styles.

### Auto-sheathing (confirmed from the owner's katana export)

A passive (`KEY 9`, the usual passive `Prop`) with two loops on one tag:

```
default:     wear Katana (Mesh on Torso) and Scabbard, for ever; → Looper
Looper:      WAIT 0.02; TAG UseKatana == "True" → Unsheath; → Looper
Unsheath:    Cancel "Katana"; wear "KatanaHand" (Mesh on Right Arm); → KeepKatana
KeepKatana:  WAIT 0.02; TAG UseKatana == "True" → KeepKatana; → Sheath
Sheath:      sound, animation [13,4], WAIT 0.3, Cancel "KatanaHand",
             wear "Katana" again, a red flash at the hip; → Looper
```

Every move that uses the sword sets `UseKatana = "True"` (`SET`, 4 s), so
the sword comes out with the first swing and goes back 4 s after the last.

### Accurate M1s (confirmed from the owner's Gon export)

M1s timed like JJS's own. Hits 1–3 are identical apart from the animation
and the trailing limb: `BRANCH Base`; Base = animation, `NoJump`/`NoDash`
0.4 s, `SpeedMultiplier 0.75` 0.5 s, a Melee Trail, the swing sound,
`WAIT 0.2`, a 3-damage 0.75 s-stun `7, 7, 6` hitbox at `0, 0.7, 4`, the
blocked-recoil hitbox, `WAIT 0.16`. OnHit pushes both forward (`0, 0, 10`,
0.2 s). Hit 4 tries `Down` (`AIR`), `Up` (`JUMP`), then `Base`: 4 damage,
knockback (`0, 0, 40`, uppercut `0, 36, 3`, downslam `0, -50, 3`,
unblockable, taller box), then recovery: the swing at half speed, a
self-`Stun` 0.75 s and `WAIT 0.8`.

### Accurate dash (confirmed from the owner's Gon export)

The `CHASE` skill (cooldown 6, `Prop NOSTUN`). Its line tries `Air` (`AIR`),
then `Base`; the export also had a `Blink` variant, switched on by a
`BlinkVar` tag, which the template leaves out.

```
Base:      SpeedMultiplier 0.4 / NoJump / InSkill for 1.2 s (CANCEL ON END),
           two sounds, VELO "0, 0, 80" for 0.5 s (TRACK, FADE), animation [1,19],
           dust, FOV 15, wind streaks, trails on every limb, wind meshes,
           3 gusts 0.1 s apart (LOOP),
           a 0-damage single-target detector (STUN -1, "7, 7, 9") → HitCheck,
           WAIT 0.05, LOOP back 2 × 5  (six looks in front),
           nobody there: Stun 0.36 (CANCEL ON END), the animation's end, FOV back
Air:       the same without the dust and streaks
HitCheck:  the real hit (4 damage, 0.75 s stun) → OnHit / OnHitTarget,
           and the blocked detector → Blocked
OnHit:     Stun 0.24, pinned (VELO 0.001), knock them "0, 0, 25", the end
Blocked:   Stun 0.75, pinned, the end at half speed
```

`CANCEL ON END` is set on the dash's own 1.2 s states: when they run out,
the dash's line ends, which caps how long the dash lasts (guides).

### Percentage damage (built here, untested in-game)

Damage is always a fixed number, so a share of someone's **health left**
takes a lookup. What it rests on:

- A branch sent to the one hit (`BRANCH TARGET`, or a `BRANCH` with
  `LAST HIT`) is **run by them** (confirmed: character 2's "Possess" is a
  projectile's `BRANCH TARGET` whose `HPGIB -2` hurts the one hit). So an
  `HPGIB` there changes *their* health, and a branch's conditions there
  should read *their* Has Health (inferred).
- **Has Health** is the only way to read health. It's `HP` (confirmed,
  from the owner's export, which wrote it bare with its defaults left out).
  The template writes `{ "K_NAME": "HP", "AMOUNT": n, "FLIP": false }`,
  the shape of `BAR`: that its value is `AMOUNT` is **inferred**. The name
  is one constant, `HAS_HEALTH`.

The ladder is a **binary search**: health is cut into steps `(lo, hi]` (1 HP
by default, up to a highest health), and each branch tries its upper half
(`Req` Has Health above the half's low end) before falling into its lower
half. 100 steps take 7 hops, not 100 (each node costs about 0.01 s). The
last branch takes the share of its step's `hi` with `HPGIB`, so the damage
is exact for whole health and rounds up within a step. Above the highest
health, they lose the share of the highest.

```
"20%":            BRANCH "20% over 100" (Req HP > 100) → HPGIB -20
                  BRANCH "20% 0-100"
"20% 0-100":      BRANCH "20% 50-100" (Req HP > 50), else BRANCH "20% 0-50"
…
"20% 57-58":      (Req HP > 57) HPGIB -11.6
```

Two modes. **Current HP** takes the share of what they have (above), and
hurts most at full. **Missing HP** is the reverse: the share of what they've
lost from the max health you give, so each step `(lo, hi]` takes
`share × (max − hi)`, full health takes nothing (the branch is empty), and so
does anything above the max.

`HPGIB` isn't a hit: it goes through blocks, i-frames and damage
multipliers, and only kills with `CAN KILL`. Two ways to start it:

- **One skill**: the hitbox's `BRANCH TARGET "20%"`, with a stun.
- **Any move**: a passive (key 9) loops `WAIT 0.05 · TAG PctDamage == "20"
  CHECK → Take 20%`. Take clears the tag and runs `BRANCH "20%"` with
  `LAST HIT 1` on whoever you last hit, then loops. Moves clear the tag and
  set it to `"20"` for 0.3 s in their OnHit. The tag's value picks the
  share, so one passive holds up to four. Whether a passive's `LAST HIT`
  sees a hit made by another skill is inferred.

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

The simulator follows what's been learned in-game: a projectile's `ROTATION`
x pitches it (positive up). `BRANCH` and `BRANCH COLLIDED` replace the line
that fired it. The **ground** is always there for `BRANCH COLLIDED`, and a
**wall** can be set in the play bar ("Wall", studs in front). A newer VELO
replaces the one in progress. The 3D view moves a visual's `ALT POSITION`
along its own turned axes (`turn` in `sim.js`).

What the simulator **doesn't** do, deliberately or because it's unknown:
blocking, the other character acting on its own, real physics or
collisions (a wall stops projectiles, not characters), a `LOOK`'s pitch, `COUNTER` triggers, damage multipliers, cooldown enforcement,
or JJS's timing to the frame. **Animations are stand-ins**: JJS's library
isn't public, so each `ANIM_USE` gets one of eight procedural poses (always
the same one for the same animation). **Effects are drawn by family**
(glow, ring, sparks, trail, screen tint, shake, FOV). Billboard, Overlay
and textured Mesh effects use the **real Roblox texture**, fetched through
the site's Worker (`/api/roblox?kind=thumb`). **Sounds** play when
switched on and Roblox serves them publicly (`/api/roblox?kind=asset`).

### JJS Stuff → Templates

`app/utils/jjs-templates.js`, shown by `app/components/jjs-templates.gjs`:
a form per template, and the code to import. Each template was lifted node
for node from a real export, and with its defaults builds exactly that
export (tests). The page never names where a template came from, or whose it
was: each has a figurative tagline instead (`from`).

| Template | From | Makes |
|---|---|---|
| Progress bar | the Progress Bar Maker (`buildSkill`) | the bar, regen and debug skills |
| Auto-sheathing weapon | the katana's `SheathPassive` | the passive, and a key-1 debug skill that draws the weapon |
| Accurate M1s | Gon's M1s | MELEE 1–4 |
| Accurate dash | Gon's chase, without its blink | CHASE |
| Percentage damage | built here, not lifted (section 6) | the passive and try-out punches on keys 1–4, or a skill per share with its own ladder |

To add one: add the export as a fixture, write its `build` from the export's
nodes, and test that its defaults reproduce the export.

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

## 9. Numbers and axes

- Positions and sizes are in **studs**; an R6 character is about 5 studs
  tall.
- Local axes: **x left (negative is right), y up, z forward**. The owner
  confirmed negative x is right for billboards, and both guides say it for
  every position. (This file used to say x right; the simulator and 3D
  view now follow x left.) A hitbox at `"0, 0, 4"` sits 4 studs in front.
- `VELO FORCE` is studs per second for `TIME` seconds. `FORCE "0, 40, 2"`
  launches upwards (an uppercut), `"0, -100, 20"` slams down (a downslam).
- `STUN` / `TIME` values are seconds.

---

## 10. Testing and fixtures

`npm test` runs everything in headless Chrome.

- `tests/fixtures/jjs-characters.js`: **four complete characters**
  exported by the owner: `CHARACTER_1`, `CHARACTER_2` (12 and 20 skills),
  `KATANA` (auto-sheathing) and `GON` (accurate M1s). The originals are in
  the git-ignored `jjs_training_data/`. They're the contract for:
  - `tests/unit/skillbuilder-test.js`: decode → encode is lossless; every
    node kind is known; the simulator picks melee variants by condition,
    forks OnHit/OnHitTarget, loops, random branches, tags; and it runs the
    Progress Bar Maker's skill.
  - `tests/acceptance/webskill-test.js`: import, edit → export, branch
    rename, play.
- `tests/unit/jjs-templates-test.js`: each template, with its defaults,
  equals the export it came from.
- `tests/unit/jjs-skill-test.js`: the progress bar skill, Safety Rails,
  regen and debug skills must equal the owner's real exports exactly.

**When you learn something new about JJS: add the real export as a
fixture, write the test, then update this file,** moving things from
inferred to confirmed.

## 11. Open questions

- Whether `REP`, `REP2`, `AWK` and `AWK2` really are Replace if Occupied,
  Prevent Override, Hide in Awakening and Hide in Base.
- Whether a branch **returns** to its caller when it ends (everything so
  far fits "no").
- The `K_NAME`s of HIT CANCEL, SPECIAL, CONNECT and Add Evasion, and of the
  conditions Has Target, Is In Domain and Durability. Has Health is `HP`,
  but the name of its value field (assumed `AMOUNT`) and whether it's
  health or a percentage of it aren't confirmed. What
  `SKILL`'s other moves are.
- Whether a projectile's `BRANCH` replaces the line as `BRANCH COLLIDED`
  does (the guides say so, and the simulator assumes it).
- Why a Field of View and a Glow didn't show from a collided branch or on
  a projectile, when sounds, VELOs and Meshes did.
- `ANIM_USE`'s library: which `[set, number]` is which animation.
- `LAST HIT 0` exactly, `LINK USER`, `DEBREE`, `AMOUNT` on visuals,
  `RELATIVE FROM BRANCH` in every node.
- How `COUNTER`, `BLOCKABLE`, `360 BLOCK` and `IGNORE WAKEUP` interact with
  blocking.
- Whether keys 9 and 99 behave differently.
