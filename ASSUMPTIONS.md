# Conversion record and assumptions

What was kept from the previous build, what was replaced, and every decision
taken where the brief was silent or where reality did not match it.

---

## 1. The brief's premise was wrong in one respect

The task described the existing project as "a fully working Phaser 3 WebGL
mobile game", and the kit's `IMPLEMENTATION_NOTES.md` recommends
`Phaser.AUTO`.

**There is no Phaser in the repository.** The existing game was vanilla ES5
IIFE modules loaded through `<script>` tags, with a hand-written WebGL layer
(`src/gl.js`), a polar-coordinate fragment shader renderer and a Canvas 2D
fallback.

Adopting Phaser would have meant adding a ~1 MB dependency and rebuilding the
render, input, audio and scaling paths from scratch — the opposite of the
instruction not to rebuild. The kit permits keeping the engine ("Phaser 3
preferred, **or retain the current engine if already working**"), so the
existing engine was retained.

## 2. What was preserved

Everything below was working, is not gameplay-specific, and was kept:

| System | Where | Change |
| --- | --- | --- |
| WebGL context, program compilation, texture upload, glyph atlas | `src/gl.js` | wider glyph set, plus dynamic/index buffer helpers |
| Seeded RNG (mulberry32) | `src/rng.js` | namespace only |
| Colour parse / mix / to-float | `src/color.js` | namespace only |
| Audio unlock on first gesture, master gain, mute, voice cap that drops the oldest voice, attack/release ramps | `src/audio.js` | buffers now come from the synth instead of fetched WAVs; music bus added |
| `Storage` with in-memory fallback, screen router, throttled ARIA live region | `src/ui.js` | option list and panels replaced |
| Boot promise chain, rAF loop, resize handling, visibility/blur auto-pause, full-screen negotiation, WebGL→Canvas fallback selection | `src/main.js` | structure kept, wiring changed |
| Dependency-free static server, `.nojekyll` | `tools/`, root | unchanged |
| Simulation-clock discipline (pause freezes the clock; a stall is capped, not replayed) | `src/game.js` | carried over as a pattern |

## 3. What was replaced

| Removed | Why |
| --- | --- |
| `ring.js`, the ring rules in `game.js` | the entire previous gameplay |
| The polar-coordinate scene shader in `renderer-gl.js` | a shmup needs thousands of textured quads, not one analytic ring |
| `renderer-2d.js` ring drawing | same |
| `effects.js` ring feedback | replaced with pooled particles, trails, hit-stop |
| `layout.js` ring composition | replaced with world-unit viewport fitting |
| `assets.js` SVG loader | replaced with the procedural atlas |
| `geometry.js` angular maths | replaced with vector/Bezier maths |
| The ten COLOR PULSE WAVs | wrong game; replaced by synthesis |

## 4. Decisions where the brief was silent

### Rendering

- **A batched sprite renderer was added.** The previous renderer issued one
  draw call per sprite with per-sprite uniform updates. That is fine for ten
  hearts and fatal at 300 bullets plus 250 particles. The batcher streams
  interleaved vertices into one buffer and flushes only on a texture or
  blend-mode change: 20 draw calls at maximum density.
- **Both backends implement the same interface**, so `src/scene.js` is written
  once. The alternative — two scene implementations — is how fallback renderers
  drift out of sync.
- **Draw order is: background → pickups → enemies → boss → player → trails →
  projectiles → particles → flash → HUD.** Projectiles sit above every ship on
  purpose: at this density the one thing that must never be occluded is the
  thing that kills you.

### Assets

- **All art is generated at boot.** The kit's `03_Assets/` contains three
  composite concept boards and nine empty folders. Cutting clean transparent
  sprites out of a 1536×1024 marketing board is not reliable, and shipping a
  game with missing textures is not an option. Sprites are painted
  parametrically into one atlas, following the boards' palette and silhouettes.
- **All audio is synthesised at unlock.** Same reason: `03_Assets/audio/` is
  empty, and the brief requires original sound.
- The expected `assets/player`, `assets/enemies` … folders from the manifest
  therefore do not exist. `README.md` documents the single seam
  (`GG.assets.build()`) to swap in authored sprites later.

### World space

- The simulation runs in a virtual field whose **width is fixed at 450** and
  whose **height flexes between 720 and 1010** with the device aspect. Fixing
  the width keeps horizontal difficulty — the width of a bullet lane, the reach
  of a dodge — identical on every phone; flexing the height gives a full-bleed
  playfield instead of letterbox bars. Verified full-bleed on 360×640, 375×667,
  390×844, 412×915 and 430×932.
- Landscape and desktop cap the field at 760 wide and centre it, with the
  starfield painted across the margins.

### Feel

- **Follow smoothing is 0.115 s**, inside the brief's 0.10–0.16 s window, using
  a frame-rate-independent exponential approach so it feels identical at 60 and
  120 Hz.
- **The player hitbox is radius 5.5** against a 44-wide sprite — about a
  quarter of the art, per the brief's insistence that it be the cockpit.
- **Releasing the finger does not recentre the ship.** It holds station.
  Yanking the ship on release loses runs the player had already dodged.
- **A cursor gets no vertical offset**; a fingertip gets 46. A mouse does not
  cover the ship.
- **Hit-stop is 0 ms for a normal kill.** The brief's table allows it, and
  freezing on every one of several hundred kills would feel broken.

### Gameplay rules the brief did not specify

These are reconstruction defaults, chosen for this build:

- **A hit costs a life *and* one weapon tier.** This is the pressure that makes
  upgrade pickups matter. Without it the ladder only ever goes up.
- **Score**: base value × multiplier × (1 + combo × 1.2%, combo capped at 30).
  Combo expires 2.2 s after the last kill.
- **A boss's exposed core takes double damage**, so the punish window after a
  phase break is worth taking.
- **A pity timer forces a pickup every 16 kills without one.** Invisible to the
  player; it exists because a bad-luck streak would otherwise flatten a whole
  stage. Drop rates were then tuned around it.
- **Stage length is 78 s**, inside the brief's suggested 60–90 s, plus a 2.2 s
  boss warning and a ~12 s boss fight.
- **Later stages scale enemy health (+22%/stage), path speed and group size.**
  Group size matters because a player who has climbed the weapon ladder clears
  an early-stage group in about a second; scaling health alone leaves the screen
  looking empty however hard it actually is.

### Balance, and how it was arrived at

The first pass was wrong and measurement caught it. Driven by a scripted
aiming player, a 90-second run reached only weapon tier 2 and the boss would
have taken ~110 s to kill. Damage, enemy health, drop rates and boss health
were recalibrated until a 200-second run reached tier 2 at 8 s, tier 4 at 38 s
and tier 6 at 122 s, with bosses dying in ~12 s. Those numbers are reproducible
from the headless suite.

### Audio

- Music is one eight-bar loop at 146 BPM, generated from scale degrees.
- Cues are collapsed if the same one is requested twice within 28 ms — a bomb
  can kill thirty enemies in one frame, and thirty overlapping explosions is
  mud, not impact.
- Menus and pause duck the music rather than cutting it.

### Accessibility

- Reduced motion disables camera impulse and hit-stop and caps the full-screen
  flash; reduced flashing caps the flash alone. Both default to the OS
  preference until the player chooses for themselves.
- All gameplay information is also announced through a throttled ARIA live
  region.
- Quality can be forced from Settings, which disables the automatic watchdog.

## 5. Known limitations

- **The procedural art is stylised, not illustrated.** It follows the boards'
  palette, silhouettes and lighting language, but it is vector-drawn geometry,
  not the painted look of the concept boards. Swapping in authored sprite
  atlases later is a single-function change.
- **The Canvas 2D fallback is dimmer.** `globalCompositeOperation: 'lighter'`
  is a weaker approximation of additive blending than the GL path, so
  explosions have less bloom. It is a fallback, and it is correct, not pretty.
- **Enemy bullet speed does not scale with stage.** Difficulty comes from
  health, density and pattern choice. A bullet that outruns human reaction is
  not difficulty.
- **Three boss encounters, cycled by stage.** Stage 4 fights boss 1 again with
  more health.

## 6. Files left in the tree

These belong to the previous game and are no longer loaded or referenced.
Deleting them was blocked by the sandbox, so they are listed here:

```
src/ring.js
assets/svg/          (20 SVGs)
assets/audio/        (10 WAVs)
kit/ASSET_GUIDE.md  kit/MASTER_PROMPT.md  kit/README_HE.md
kit/REFERENCE_ANALYSIS.md  kit/VALIDATION.md  kit/effects-baseline.js
```

They can be removed with:

```bash
git rm -r src/ring.js assets/svg assets/audio kit/ASSET_GUIDE.md kit/MASTER_PROMPT.md kit/README_HE.md kit/REFERENCE_ANALYSIS.md kit/VALIDATION.md kit/effects-baseline.js
```

The supplied Galaxy Gunner kit lives at `kit/galaxy-gunner/` and is the source
of truth for the new game.
