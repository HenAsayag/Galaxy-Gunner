# GALAXY GUNNER

A portrait arcade shooter for the browser. Auto-fire, curved enemy entries,
dense readable bullet patterns, weapon upgrades that arrive live in combat, and
a boss at the end of every stage.

WebGL first, Canvas 2D fallback, no dependencies, no build step.

```bash
node tools/serve.js 8123
```

Then open <http://localhost:8123>. It also runs from `file://`, with the
tuning overlay and nothing else disabled.

---

## What this is

This project was **converted** from COLOR PULSE, a circular timing game that
shared the same engine. The conversion kept every piece of working
infrastructure and replaced the gameplay layer, the art direction and the
audio. See `ASSUMPTIONS.md` for what was kept, what was replaced and why.

It is **not** a Phaser project. The kit's implementation notes suggest Phaser 3;
the existing codebase had its own WebGL layer that worked, so that was kept
rather than adding a dependency and rebuilding the render path. The kit allows
this explicitly ("Phaser 3 preferred, or retain the current engine if already
working").

## How to play

- **Touch** — drag anywhere on the playfield, all the way to its edges. The ship
  rides above your finger so it stays visible. Guns fire by themselves.
- **Desktop** — move the mouse, or steer with `WASD` / arrow keys.
- `Space` fires a bomb. `Esc` or `P` pauses.
- Your hitbox is the cockpit, not the wingspan — much smaller than the ship
  looks. Weave through bullet lanes rather than going around them.
- Losing a life resets the main gun to tier 1, removes secondary modules and
  rapid fire, and clears existing player shots. Shielded hits preserve weapons.
- **Side Barrage** fires one volley from both screen edges when collected.
- **Nova Bomb** detonates immediately on collection, clearing enemy bullets and
  damaging enemies and bosses without spending a stored bomb. These rare pickups
  are one-shot effects, not permanent upgrades.
- A red glow around an enemy means a dense attack is 220 ms away.

## Layout

```
index.html            page shell, screens, script order
styles.css            page chrome only; the canvas owns the playfield and HUD
config/
  game-config.json    runtime tuning overlay, deep-merged over src/config.js
src/                  the game (see below)
tests/rules.test.js   headless suite: node tests/rules.test.js
tools/serve.js        dependency-free static server
kit/galaxy-gunner/    the supplied conversion kit, as delivered
```

### Source modules

Loaded in this order by `index.html`; each is an ES5 IIFE attaching to `window.GG`.

| Module | Responsibility |
| --- | --- |
| `config.js` | every tunable number, in one place |
| `geometry.js` | scalars, angles, easing, Bezier evaluation |
| `rng.js` | seeded mulberry32, so a run is reproducible |
| `color.js` | parse / mix / to-float, shared by both renderers |
| `pool.js` | the object pool every transient comes from |
| `layout.js` | viewport fitting, world-unit mapping, safe-area insets |
| `assets.js` | paints every sprite into one transparent atlas at boot |
| `gl.js` | WebGL context, programs, buffers, glyph atlas |
| `renderer-gl.js` | batched sprite renderer (WebGL) |
| `renderer-2d.js` | the same drawing interface on Canvas 2D |
| `paths.js` | the spline library the enemy entries are built from |
| `patterns.js` | the bullet-pattern library |
| `effects.js` | particles, trails, hit-stop, camera impulse, floating text |
| `player.js` | ship movement, damage, invulnerability, respawn |
| `weapons.js` | the six-tier auto-fire ladder and the secondary modules |
| `enemies.js` | archetypes and the group spawner |
| `boss.js` | the three encounters, their phases and their death sequence |
| `pickups.js` | drops, magnetisation, collection |
| `director.js` | stage timeline, difficulty, the no-dead-air rule |
| `game.js` | the world: collisions, scoring, the state machine |
| `scene.js` | draw order and the HUD, written once for both backends |
| `synth.js` | every sound effect and the music loop, generated |
| `audio.js` | unlock, mute, voice cap, music bus |
| `quality.js` | quality levels and the frame-time watchdog |
| `ui.js` | screens, settings, persistence |
| `input.js` | one-drag touch, mouse and keyboard |
| `main.js` | boot, the loop, lifecycle, full screen |

## Assets

**There are no image or audio files.** Every sprite is painted into a single
1024-wide transparent atlas at boot by `src/assets.js`, and every sound is
synthesised into an `AudioBuffer` at audio-unlock by `src/synth.js`.

That was a choice forced by the kit: `03_Assets/` ships three composite concept
boards and nine **empty** folders, so there were no production sprites to load.
Generating them buys several things the brief asks for directly — one texture
means the whole frame batches into a handful of draw calls, the art stays crisp
at any device pixel ratio, and nothing is traced from any commercial title. The
palette and silhouettes follow the supplied boards, which are kept in
`kit/galaxy-gunner/boards/`.

To move to hand-authored sprites later, replace `GG.assets.build()` with a
loader that returns the same `{ canvas, frames }` shape — `frames[name]` being
`{ x, y, w, h, u0, v0, u1, v1, dw, dh }`. Nothing else has to change.

## Performance

Measured in-browser at maximum density — 60 enemies, 480 projectiles, 250
particles, 20 pickups on a 375×812 viewport at DPR 2:

| | |
| --- | --- |
| Draw calls per frame | **20** |
| Simulation cost | **0.02 ms** per frame |
| Heap growth over 5 simulated minutes | **0.9 MB** |

The batcher streams every sprite into one vertex buffer and flushes only when
the texture or the blend mode changes, so the scene draws in ordered passes
rather than sorting per sprite. Everything transient comes from a pool; the
only allocation during a run is a pool growing once toward its ceiling.

Three quality levels (High / Medium / Low) change particle budgets, trail
length, additive blending and the DPR cap. The default is chosen from device
capability and then corrected by measured frame time; a manual choice in
Settings disables the watchdog.

## Testing

```bash
node tests/rules.test.js
```

48 tests. The simulation has no DOM dependency, so the suite drives whole runs
headlessly at a fixed timestep — the pacing rules, the pool ceilings and the
numerical stability are all covered there, not just the pure maths. See
`TEST_REPORT.md` for what was verified in a browser.

## Tuning

`config/game-config.json` is deep-merged over `src/config.js` when the game is
served over http(s), so pacing, drop rates, difficulty and feel can be changed
without touching code. Opened from `file://` the fetch fails harmlessly and the
built-in defaults are used.

`?renderer=2d` forces the Canvas fallback. `?debug` draws the player hitbox.

---

Created by Hen Asayag.
