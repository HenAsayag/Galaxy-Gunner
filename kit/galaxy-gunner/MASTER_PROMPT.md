# MASTER PROMPT — Convert Existing WebGL Game into a Galaxy Gunner–Style Vertical Arcade Shooter

You are modifying an EXISTING browser game. Do not rebuild the project from scratch unless technically unavoidable. Preserve the existing WebGL/mobile infrastructure, input abstraction, loading pipeline, audio manager, pooling system, pause/save/settings systems and deployment structure where possible. Replace the gameplay layer, pacing, enemy logic, combat presentation and art direction so the result matches the feel demonstrated in the supplied gameplay reference video.

## Non-negotiable target
Create a fast, portrait-first vertical arcade shooter inspired by the reference video: the player ship remains in the lower portion of the battlefield, moves freely by drag/touch, fires continuously, enemy craft enter from the top and sides on curved paths, projectiles fill the screen, kills cause immediate bright explosions, collectible weapon upgrades appear directly inside combat, and the action rarely stops.

The result must be original. Do not copy proprietary logos, exact ship silhouettes, exact enemy sprites, sounds, level names or UI artwork from any commercial title. Recreate the gameplay grammar, timing, camera behavior and feedback with original assets.

## Platform and rendering
- Phaser 3 preferred, or retain the current engine if already working.
- Renderer: WebGL first. Canvas only as fallback.
- Target 60 FPS on recent iOS/Android devices.
- Portrait reference aspect: 450x850 / approximately 9:17.
- Support 360x640 through 430x932 portrait screens and landscape fallback.
- Use devicePixelRatio responsibly; cap render resolution on weak phones.
- All movement and animation must be delta-time based.
- Use object pools for bullets, enemies, particles and pickups.

## Controls
### Mobile
- One-finger drag anywhere in the lower 75% of the screen to move the ship.
- Ship follows finger with a small vertical offset so the finger does not cover the ship.
- Auto-fire is ALWAYS ON during active gameplay.
- No virtual joystick required in the default mode.
- Optional special ability buttons may sit on the lower-left/lower-right edges.
- Multi-touch must not interrupt movement.

### Desktop
- Mouse move or click-drag controls ship position.
- WASD / Arrow keys also supported.
- Auto-fire by default.
- Space may trigger the equipped active skill.

## Camera / battlefield
- Portrait scrolling battlefield.
- Player generally occupies bottom 20–30% of the screen.
- Camera itself should not follow the ship horizontally; the battlefield remains stable.
- Background scrolls downward slowly to imply forward flight.
- Add subtle camera impulse only for large explosions, elite kills, player damage and bosses.

## Exact combat feel from the video
The reference shows constant layered action rather than discrete stop/start formations. Recreate these properties:

1. Enemies continuously stream in while previous projectiles are still on screen.
2. Many enemies enter using curved Bezier-like trajectories rather than straight vertical motion.
3. Small ships peel in from both upper corners and sides.
4. Enemy groups can cross paths and rotate while descending.
5. Player fire is dense and visually upgrades during the run.
6. Enemy bullets use highly readable colors and travel in rows, arcs, spreads and aimed streams.
7. Kills produce immediate orange/yellow flash explosions.
8. Pickups remain visible amid chaos using glow, bobbing motion and strong color coding.
9. Large upgrade messages appear briefly in the middle/upper-middle of the playfield without pausing the game.
10. There should almost never be more than ~0.5–0.8 sec with nothing to shoot.

## Player ship
Create one original hero fighter with six visual upgrade tiers.

Base characteristics:
- small, sharp silhouette
- bright engine glow
- centered hitbox smaller than visible sprite
- mild left/right banking while moving
- subtle recoil when weapon burst intensifies

Player movement:
- very responsive
- use interpolation / follow smoothing around 0.10–0.16 sec
- clamp to screen safe area
- max lateral speed high enough to dodge bullet lanes
- vertical movement allowed through roughly lower 55–60% of screen

Player hitbox:
- make it significantly smaller than the art, centered around cockpit/core
- show a tiny optional hitbox indicator during debug mode

On damage:
- 70–100 ms white flash
- circular shield crack / flash
- quick 2–4 px screen impulse
- brief invulnerability 1.2–1.8 sec
- blinking alpha during invulnerability

On death:
- layered explosion sequence
- 8–16 debris particles
- expanding ring
- 250–400 ms hit-stop/slowdown feeling
- respawn animation from bottom

## Auto-fire weapon ladder
The core weapon should visibly change during upgrades.

### Tier 1
single narrow blue bolt stream

### Tier 2
faster single stream + stronger muzzle flash

### Tier 3
triple narrow stream

### Tier 4
triple stream + outer side bolts

### Tier 5
dense 5-way forward fan

### Tier 6
5-way fan + periodic high-damage center laser / missile support

Do not implement upgrades as invisible damage multipliers only. Every upgrade must alter projectile count, width, color intensity, muzzle VFX, cadence or secondary fire.

## Secondary weapon modules
Implement several swappable modules inspired by the variety visible in the video:
- homing micro-missiles
- side lasers
- chain lightning
- green plasma burst
- rotating drone shots
- piercing beam
- explosive rockets

At least one secondary module should fire automatically on a cooldown while the main gun continues firing.

## Upgrade pickups
Pickups fall or drift slowly downward and may slightly magnetize toward the player when close.

Required pickups:
- Weapon Upgrade
- Missile Upgrade
- Shield
- Rapid Fire
- Score Multiplier
- Magnet
- Bomb / screen-clear charge

### Weapon Upgrade presentation
When collected:
- pickup accelerates into ship
- short radial glow burst
- temporary green/yellow HUD flash
- show `WEAPON UPGRADE` for ~650–900 ms
- text scales from 0.8 -> 1.1 -> 1.0
- do NOT stop gameplay
- play a bright ascending audio cue

## Enemy archetypes
Build original enemies but match the behavior density of the reference.

### Scout
- tiny fast ship
- curves in and exits quickly
- low HP

### Twin Wing
- flies in mirrored pairs
- fires 2-way orange spread

### Dart
- makes fast diagonal passes
- leaves short trail

### Turret Drone
- slows mid-screen
- emits 3–5 shot horizontal/angled patterns

### Missile Craft
- fires homing or gently curving missiles

### Spinner
- rotates while releasing radial bullets

### Heavy
- larger body, more HP
- fires dense orange rows

### Elite Carrier
- medium miniboss
- escorts smaller craft and releases adds

## Enemy path system
Create a reusable spline/Bezier path engine.

Path templates:
- upper-left hook to center
- upper-right hook to center
- mirrored S curve
- shallow U
- deep U
- loop-and-exit
- diagonal sweep
- crossing X
- corkscrew
- circular orbit
- side entry then vertical dive
- snake chain
- wave chain
- staggered V
- converging arc
- diverging arc

Each spawned group receives:
- path template
- path duration
- local offset
- firing phase
- formation spacing
- optional path reversal

Enemies may continue firing while traveling on the path.

## Bullet-hell patterns
Enemy projectiles must stay readable despite density.

Patterns:
- straight lane
- 3-way spread
- 5-way spread
- aimed shot
- aimed burst
- parallel orange columns
- curved missile pair
- rotating radial burst
- alternating left/right fan
- slow green wall
- blue dotted arc

Rules:
- early waves leave generous gaps
- never create unavoidable full-width walls
- telegraph dense attacks with a 150–300 ms charge glow
- use distinct colors for projectile families

## Missile behavior visible in reference
Some projectiles should trace long curved white/bright trails across the battlefield.

Implement homing missiles with:
- delayed target acquisition
- max turn rate rather than instant turning
- curved trail generated from pooled trail points
- target retarget on enemy destruction
- bright explosion on impact

## VFX language
### Standard kill
- 50–80 ms emissive flash
- orange/yellow explosion sprite or particle burst
- 4–10 sparks
- 1–3 fragments
- tiny score popup

### Heavy kill
- two-stage blast
- slightly larger shock ring
- stronger flash
- 2–3 px camera impulse

### Laser hit
- bright contact flare
- short additive line

### Missile impact
- expanding orange core
- smoke puff
- fragments

### Pickup
- ring burst
- sparkle particles
- icon scale pop

### Player max weapon
- stronger blue/cyan muzzle glow
- persistent energy trail
- occasional lens-flare-like bloom, used sparingly

## Hit stop and timing
Use tiny hit-stop to make major impacts feel strong:
- normal kill: 0 ms
- heavy kill: 10–18 ms
- elite: 20–35 ms
- player hit: 30–50 ms
- boss phase break: 50–90 ms

Do not freeze gameplay repeatedly for basic kills.

## Score / HUD
Match the compact presentation from the reference video.

Top area:
- pause/settings icon near a corner
- large white pixel/digital-style score near the upper center
- optional stage/wave label

Do not use a large boxed HUD.

During gameplay show only information that matters:
- score
- lives/shield
- weapon tier
- bomb/special count

Upgrade messages can appear near upper-middle.

## Level pacing
Design stages as one continuous intensity curve.

Suggested 60–90 sec stage:
- 0–10 sec: low-pressure entry groups
- 10–25 sec: overlapping curved formations
- 25–40 sec: first dense bullet patterns
- 40–55 sec: heavy enemies + upgrade drop
- 55–70 sec: elite wave
- final: miniboss/boss or high-density climax

Avoid traditional pauses where a title card stops combat before every small wave.

## Boss encounters
Bosses should occupy roughly 25–45% of screen width and remain primarily in upper half.

Phases should include:
- wide orange bullet fans
- moving laser columns
- homing missiles with curved trails
- add spawns
- vulnerable core opening

Telegraph every large attack.

Boss destruction:
- several internal explosions over 2–4 sec
- glowing core instability
- debris release
- final flash + shockwave

## Backgrounds
The uploaded reference appears visually muted behind gameplay so bullets stay readable.

Create backgrounds using:
- dark space / atmospheric cloud layer
- subtle asteroids / debris / planet surfaces
- slow scrolling
- slight fog/haze overlay
- low contrast behind active bullet zones

Never let background brightness compete with projectiles.

## Mobile performance budget
For mid-range mobile hardware target approximately:
- 60 active enemies max
- 300 player/enemy projectiles max
- 250 pooled particle sprites max visible
- 20–40 trail emitters max
- no per-frame DOM work
- atlas textures whenever possible
- batch additive particles where supported

Implement quality levels:
- High: bloom-like additive VFX, full trails, more particles
- Medium: reduced particles and trail samples
- Low: simplified explosions, shorter trails, lower DPR cap

Automatically choose a sensible default based on device capability, with manual override in settings.

## Orientation and mobile browser behavior
- Portrait is primary.
- Use CSS `100dvh` and safe-area insets.
- Prevent browser page scrolling during gameplay.
- Handle touchcancel.
- Pause on visibilitychange / blur.
- Resume safely without instant player death.
- Keep all essential UI inside notch-safe regions.

## Audio
Create original arcade SFX:
- rapid player shots
- upgrade pickup rise
- laser
- missile launch
- missile impact
- small explosion
- heavy explosion
- shield hit
- player hit
- boss warning

Use lightweight looping music:
- synth/space arcade energy
- BPM should support fast play
- no copied music or sound effects

## File integration
Use the supplied assets folder as reference and implementation source. If a supplied sheet contains multiple visual concepts, crop/replace it with production-ready transparent sprites before final release.

Expected project areas:
- assets/player
- assets/enemies
- assets/bosses
- assets/projectiles
- assets/powerups
- assets/vfx
- assets/ui
- assets/backgrounds
- assets/audio

## Required polish pass
Before considering the task complete:
1. Remove any dead moments from stage flow.
2. Confirm player can weave between dense projectile lanes on a phone screen.
3. Tune ship follow smoothing so it feels direct, not floaty.
4. Make curved enemy paths smooth at 60 FPS.
5. Add trails to missiles and selected enemy craft.
6. Make every kill readable with flash + explosion.
7. Make weapon upgrades visually obvious immediately.
8. Verify portrait layout on 360x640, 390x844 and 430x932.
9. Stress-test with maximum bullets/effects for 5 minutes.
10. Ensure no allocations cause recurring garbage-collection stutter.

## Final acceptance criteria
The converted game should be recognizable at a glance as the same TYPE OF EXPERIENCE shown in the video: portrait arcade shooting, auto-fire, dense colorful bullets, tiny responsive player ship, curved enemy entries, immediate explosions, weapon upgrades occurring live in combat and almost uninterrupted forward momentum.

It must feel like a polished mobile arcade title rather than a demo, while using an original visual identity and original assets.
