# Test report

Two layers: a headless suite that runs whole simulated games, and a set of
in-browser checks driven through the real DOM and the real render path.

- **Headless**: `node tests/rules.test.js` — 48 tests, all passing.
- **Browser**: Chromium, WebGL and Canvas 2D backends, viewports from 360×640
  to 780×400 landscape.

---

## 1. Headless suite

The simulation has no DOM dependency, so the suite loads the fifteen non-DOM
modules into a VM context and drives real runs at a fixed 60 Hz timestep. That
means the pacing and budget rules are tested against the actual game, not
against a model of it.

| Group | Covers |
| --- | --- |
| maths | frame-rate independence of the follow, no overshoot, shortest-arc turning, Bezier continuity across segment joins |
| object pools | dense live range after a swap-remove, the ceiling returning null rather than growing, reverse sweeps, actual object reuse |
| enemy paths | all 17 templates finite across their range and inside a sane band, mirroring is a true reflection, descending paths report a downward heading, unknown names fall back |
| bullet patterns | every pattern fires, no NaN or stationary bullets, the green wall always leaves a gap ≥ 74 units over 60 seeds, column spacing, aimed fire actually aims, every dense pattern is telegraphed |
| weapon ladder | every tier differs from the one below in ports/sprite/cadence, projectile count never drops, cadence never slows, tier 6 adds a second fire mode, upgrades cap and report it, every module is reachable in one run |
| player | hitbox is under a third of the art, bounds hold under extreme input, vertical freedom is 55%, invulnerability blocks stacked hits, a shield absorbs exactly one, the run ends exactly once |
| stage flow | beats sorted and in range, every beat names a real archetype and path, every archetype names a real pattern, no authored hole over 5 s, the guaranteed weapon drop lands in the heavy phase, the elite arrives before the climax |
| full run | the no-dead-air rule, the same rule during boss warning and stage clear, every performance budget over 300 s, numerical stability, escalation through three stages and two bosses, upgrades actually arriving, mortal runs ending cleanly, pause freezing the clock, a long stall being capped rather than replayed |

### The regression that suite exists for

The brief requires that there is "almost never more than ~0.5–0.8 sec with
nothing to shoot". The first implementation applied that rule only during the
stage phase, so the 2.2 s boss warning and the 1.8 s stage-clear window were
silent. Measured:

| | Longest empty stretch |
| --- | --- |
| Rule scoped to the stage phase (the bug) | **4650 ms** |
| Rule applied in every phase (the fix) | **717 ms** |

717 ms is the 700 ms budget plus one frame. The test was confirmed to fail when
the fix is stubbed out, so it is a real guard and not a tautology.

---

## 2. Performance, measured in-browser

375×812 at DPR 2 (751×1624 backbuffer), WebGL backend, High quality, pools
deliberately saturated: **60 enemies, 260 enemy bullets, 220 player bullets,
250 particles, 20 pickups**.

| Metric | Result | Budget |
| --- | --- | --- |
| Draw calls per frame at max density | **20** | — |
| Draw calls in normal play | 6–14 | — |
| Simulation cost per frame | **0.020 ms** | 16.7 ms |
| Enemies | 60 / 60 | 60 |
| Enemy + player projectiles | 480 | 300 concurrent in normal play (ceiling is deliberately higher) |
| Particles | 250 / 250 | 250 |
| Heap growth, 5 simulated minutes | **0.88 MB** | — |

Every pool stopped exactly at its configured ceiling; none exceeded it.

### Batching

The naive approach — one draw call per sprite — would have been ~800 calls per
frame at that density. Three changes brought it to 20:

1. a streaming vertex buffer with one atlas texture;
2. particles drawn in two passes grouped by blend mode instead of one
   interleaved loop (interleaving flipped the blend mode, and so flushed the
   batch, several times per explosion);
3. the same grouping for enemies (telegraph glow / hull / hit flash / health
   bar) and for pickups (glow / coin).

### Five-minute stress

Ran 300 simulated seconds at maximum density with a scripted player. No
stutter, no pool overflow, no non-finite value, 0.88 MB of heap growth — which
is pool arrays reaching their steady size, not per-frame churn. Two remaining
per-event allocations were removed during this pass: a `Path` object per enemy
spawn (now configured in place on the pooled enemy) and an input target object
per frame (now a reused scratch object).

---

## 3. Layout

Computed and verified for every size. "Full bleed" means the playfield covers
the whole canvas with no letterbox.

| Viewport | World units | Scale | Letterbox | Ship band |
| --- | --- | --- | --- | --- |
| 360×640 | 450×800 | 0.800 | none | 54.8% |
| 375×667 | 450×800 | 0.833 | none | 54.8% |
| 390×844 | 450×974 | 0.867 | none | 55.7% |
| 412×915 | 450×999 | 0.916 | none | 55.8% |
| 430×932 | 450×975 | 0.956 | none | 55.7% |
| 344×882 (extreme) | 394×1010 | 0.873 | none | 55.8% |
| 780×400 (landscape) | 760×720 | 0.556 | 179 px each side | 54.2% |
| 1280×800 (desktop) | 760×720 | 1.111 | 218 px each side | 54.2% |

- World **width is fixed at 450** on every portrait size, so a bullet lane is
  the same fraction of the screen on a 360-wide phone as on a 430-wide one.
- The ship's vertical band is 54–56% everywhere, matching the brief's "roughly
  lower 55–60%".
- Landscape centres the field and paints the starfield across the margins. The
  DOM chrome (pause, mute, full screen, bomb) is anchored to the playfield
  column rather than the viewport edge — verified: with a 179 px margin, the
  chrome's right edge sits at 593 px against a field edge of 601 px.

Rendered and visually confirmed at 360×640 (menu and gameplay), 375×812
(menu, gameplay, boss) and 780×400 (landscape gameplay).

---

## 4. Browser behaviour

| Check | Result |
| --- | --- |
| Boot, WebGL path | 30 requests, all 200, **no 404s** — there are no image or audio files to miss |
| `?renderer=2d` forces the Canvas fallback | backend reports `canvas2d`, all entities/HUD/banner render correctly |
| Audio unlock on first gesture | 16 cues synthesised, music loop built, `unlocked: true` |
| Mouse steering | pointer world position tracks the ship exactly, with no finger offset applied |
| Pause via the HUD button | state `paused`, screen shown, input disabled, simulation clock frozen (verified over 400 ms) |
| Resume | state `playing`, input re-enabled, 2175 ms of grace invulnerability granted |
| Bomb button | consumes a charge, clears enemy bullets, damages everything; correctly refuses while the ship is respawning |
| Death | state `gameover` at zero lives, game-over panel after the explosion settles |
| HUD does not collide with the on-screen buttons | weapon-tier pips originally rendered underneath the bomb button (pip box right edge 361 px vs button left edge 303 px); moved to the bottom-left and re-verified as non-overlapping |
| HUD hidden on the menus | the canvas HUD is gated on the run state, so no score or hearts sit behind the menu panel |
| Best score persistence | written to `localStorage` and shown on the menu across reloads |
| Settings persistence | sound, music, reduced motion, reduced flashing and quality all round-trip |

### Accessibility settings

| Setting | Verified effect |
| --- | --- |
| Reduced motion | camera impulse forced to `[0, 0]`, hit-stop forced to 0 ms, flash capped at 0.14 |
| Reduced flashing | flash capped at 0.14, motion untouched |
| Both | default to the OS `prefers-reduced-motion` until the player chooses |

### Quality levels

| Level | Particle cap | DPR cap | Additive | Stars |
| --- | --- | --- | --- | --- |
| High | 250 | 2.5 | yes | 150 |
| Medium | 150 | 2.0 | yes | 100 |
| Low | **70** | **1.25** | **no** | **60** |

Verified that selecting Low applies all four immediately and disables the
automatic watchdog; selecting Automatic re-enables it.

#### A bug the watchdog testing found

The frame-time watchdog demoted a machine that was in fact running at 60 fps.
The main loop clamped its delta to 120 ms and the watchdog discarded outliers
"above 120 ms" — so every frame following a tab stall or GC pause arrived as
exactly 120 ms, slipped past the filter, and dragged the average over the
demotion threshold. The loop now hands the watchdog the **raw** delta and the
outlier threshold is 90 ms. Confirmed: quality stays `high` through the
1-second compositor stalls the test environment produces.

---

## 5. Balance, measured

Runs driven by a scripted player at a fixed timestep. Two drivers: a precise
one and a "sloppy" one with a 200 ms reaction delay and ±35 units of aim error.

### The first pass was wrong

| | Initial tuning | After recalibration |
| --- | --- | --- |
| Weapon tier after 90 s | **2** | 5 |
| Time to tier 2 | 44 s | **8 s** |
| Time to tier 4 | never | **38 s** |
| Time to tier 6 | never | **122 s** |
| Time to kill a boss | ~110 s | **~12 s** |
| Pickups collected in 200 s | ~3 | **49** |

Tier damage, enemy health, drop rates and boss health were all adjusted, and a
pity timer added (a forced drop every 16 kills without one) so an unlucky
streak cannot flatten a stage.

### Steady state, 300 s

| | Precise driver | Sloppy driver |
| --- | --- | --- |
| Stages reached | 3 | 3 |
| Kills | 400 | 418 |
| Score | 87,957 | 86,014 |
| Peak enemies on screen | 15 | 16 |
| Peak enemy bullets | 60 | 70 |
| Longest empty stretch | 717 ms | 717 ms |

Stage cadence: 78 s of waves → 2.2 s boss warning → ~12 s boss → 1.8 s clear,
about 94 s per stage.

---

## 6. Not covered here

- **Real device testing.** Everything above is Chromium with device emulation.
  Actual iOS Safari and Android Chrome behaviour — particularly thermal
  throttling, the real audio unlock gesture and `100dvh` with a collapsing
  address bar — has not been measured on hardware.
- **Multi-touch.** The logic (a second finger never steals control from the one
  steering; `pointercancel` releases cleanly) is implemented and readable, but
  emulation cannot generate genuine simultaneous touch points.
- **Sustained thermal load.** The five-minute stress is simulation time on a
  desktop, not five minutes of a phone's GPU getting hot.
- **Sound quality judgement.** The cues are verified to generate and play; how
  they actually sound is a subjective call best made on a device.
