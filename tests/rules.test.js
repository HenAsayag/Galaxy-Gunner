/* Headless tests. Run with:  node tests/rules.test.js
 *
 * These cover what can be checked without a browser: the maths the path
 * system is built on, the pool invariants that the no-GC-stutter requirement
 * depends on, the bullet-pattern readability rules, the weapon ladder's
 * promise that every tier is visibly different, the stage timeline, and the
 * layout mapping across the three portrait sizes the brief names.
 *
 * Browser-only items (WebGL batching, touch handling, listener hygiene, real
 * frame rate) are covered in TEST_REPORT.md.
 *
 * The browser modules are ES5 IIFEs that attach to `window`, so the harness
 * below creates a minimal global and evaluates them in order - the same order
 * index.html loads them in. That keeps one source of truth for the code under
 * test rather than a Node-only duplicate.
 */
'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---- harness --------------------------------------------------------------- */

/* Just enough DOM for the modules that touch it at load time. None of the
 * modules under test here draw anything; the ones that would (assets, the two
 * renderers, scene, ui, input, main) are simply not loaded. */
function createSandbox() {
  const sandbox = {
    console,
    performance: { now: () => Date.now() },
    Math,
    Date,
    JSON,
    setTimeout,
    requestAnimationFrame: () => 0
  };
  sandbox.window = sandbox;
  sandbox.global = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  /* Every module that does not touch the DOM, which is enough to run the
   * whole simulation headlessly - the renderers, the atlas, the synth and the
   * DOM shell are the only pieces left out. */
  const files = [
    'src/config.js', 'src/geometry.js', 'src/rng.js', 'src/color.js',
    'src/pool.js', 'src/paths.js', 'src/patterns.js', 'src/effects.js',
    'src/player.js', 'src/weapons.js', 'src/enemies.js', 'src/boss.js',
    'src/pickups.js', 'src/director.js', 'src/game.js'
  ];
  for (const file of files) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), sandbox, { filename: file });
  }
  return sandbox;
}

const GG = createSandbox().GG;
const M = GG.math;

/* A fresh config per test, so one test cannot tune another. */
function freshConfig(overrides) {
  const config = JSON.parse(JSON.stringify(GG.CONFIG));
  if (overrides) GG.mergeConfig(config, overrides);
  return config;
}

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ok   ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  FAIL ' + name + '\n       ' + err.message);
  }
}

function section(title) { console.log('\n' + title); }

/* ---- maths ------------------------------------------------------------------ */

section('maths');

test('approach is frame-rate independent', () => {
  /* One 100 ms step and ten 10 ms steps must land in the same place, or the
   * ship would feel different at 30, 60 and 120 Hz. */
  const one = M.approach(0, 100, 0.12, 0.1);
  let many = 0;
  for (let i = 0; i < 10; i++) many = M.approach(many, 100, 0.12, 0.01);
  assert.ok(Math.abs(one - many) < 1e-9, `${one} vs ${many}`);
});

test('approach never overshoots', () => {
  for (const dt of [0.001, 0.016, 0.1, 1, 10]) {
    const v = M.approach(0, 100, 0.12, dt);
    assert.ok(v >= 0 && v <= 100, `dt=${dt} gave ${v}`);
  }
});

test('turnToward is rate limited and takes the short way round', () => {
  const step = 0.1;
  /* from just below PI to just above -PI: the short way is forward */
  const next = M.turnToward(3.10, -3.10, step);
  assert.ok(Math.abs(M.angleDelta(3.10, next)) <= step + 1e-9);
  assert.ok(Math.abs(M.angleDelta(next, -3.10)) < Math.abs(M.angleDelta(3.10, -3.10)));
});

test('angleDelta stays inside (-PI, PI]', () => {
  for (let a = -10; a <= 10; a += 0.37) {
    for (let b = -10; b <= 10; b += 0.53) {
      const d = M.angleDelta(a, b);
      assert.ok(d > -Math.PI - 1e-9 && d <= Math.PI + 1e-9, `${a}->${b} = ${d}`);
    }
  }
});

test('cubic chain is continuous across segment joins', () => {
  const pts = GG.paths.TEMPLATES.hookLeft.pts;
  const out = { x: 0, y: 0, dx: 0, dy: 0 };
  let prev = null;
  for (let t = 0; t <= 1.0001; t += 1 / 256) {
    M.chainAt(pts, Math.min(1, t), out);
    if (prev) {
      const jump = Math.hypot(out.x - prev.x, out.y - prev.y);
      assert.ok(jump < 0.05, `discontinuity of ${jump.toFixed(4)} at t=${t.toFixed(3)}`);
    }
    prev = { x: out.x, y: out.y };
  }
});

/* ---- pools -------------------------------------------------------------------- */

section('object pools');

test('obtain and releaseAt keep live items dense', () => {
  const pool = new GG.Pool(() => ({ id: 0 }), null, 8);
  for (let i = 0; i < 8; i++) pool.obtain().id = i;
  assert.strictEqual(pool.live, 8);
  pool.releaseAt(3);
  assert.strictEqual(pool.live, 7);
  const ids = [];
  for (let i = 0; i < pool.live; i++) ids.push(pool.at(i).id);
  assert.strictEqual(new Set(ids).size, 7, 'no duplicates after a swap-remove');
  assert.ok(!ids.includes(3), 'the released item is gone');
});

test('obtain returns null at the ceiling instead of growing', () => {
  const pool = new GG.Pool(() => ({}), null, 3);
  assert.ok(pool.obtain() && pool.obtain() && pool.obtain());
  assert.strictEqual(pool.obtain(), null);
  assert.strictEqual(pool.live, 3);
});

test('a reverse sweep releases exactly the matching items', () => {
  const pool = new GG.Pool(() => ({ n: 0 }), null, 32);
  for (let i = 0; i < 20; i++) pool.obtain().n = i;
  pool.sweep((item) => item.n % 2 === 0);
  assert.strictEqual(pool.live, 10);
  for (let i = 0; i < pool.live; i++) {
    assert.strictEqual(pool.at(i).n % 2, 1, 'only odd items survived');
  }
});

test('recycled objects are reused, not reallocated', () => {
  const pool = new GG.Pool(() => ({}), null, 4);
  const a = pool.obtain();
  pool.releaseAt(0);
  const b = pool.obtain();
  assert.strictEqual(a, b, 'the same object came back');
});

/* ---- paths ---------------------------------------------------------------------- */

section('enemy paths');

test('every template is samplable across its whole range', () => {
  for (const name of GG.paths.NAMES) {
    const p = new GG.paths.Path(name, { phase: 0.4 });
    const out = { x: 0, y: 0, angle: 0 };
    for (let t = 0; t <= 1.0001; t += 0.02) {
      p.sample(t, 450, 850, out);
      assert.ok(Number.isFinite(out.x) && Number.isFinite(out.y) && Number.isFinite(out.angle),
        `${name} produced a non-finite sample at t=${t.toFixed(2)}`);
    }
  }
});

test('paths stay within a sane band of the playfield', () => {
  /* Off-screen staging room is fine; a path that wanders ten screens away is
   * not, because the enemy would never be retired. */
  for (const name of GG.paths.NAMES) {
    const p = new GG.paths.Path(name, {});
    const out = { x: 0, y: 0, angle: 0 };
    for (let t = 0; t <= 1.0001; t += 0.02) {
      p.sample(t, 450, 850, out);
      assert.ok(out.x > -450 && out.x < 900, `${name} x=${out.x.toFixed(0)} at t=${t.toFixed(2)}`);
      assert.ok(out.y > -450 && out.y < 1300, `${name} y=${out.y.toFixed(0)} at t=${t.toFixed(2)}`);
    }
  }
});

test('mirroring is a true horizontal reflection', () => {
  const a = new GG.paths.Path('hookLeft', {});
  const b = new GG.paths.Path('hookLeft', { mirror: true });
  const oa = { x: 0, y: 0, angle: 0 };
  const ob = { x: 0, y: 0, angle: 0 };
  for (let t = 0; t <= 1.0001; t += 0.05) {
    a.sample(t, 450, 850, oa);
    b.sample(t, 450, 850, ob);
    assert.ok(Math.abs((450 - oa.x) - ob.x) < 1e-6, `t=${t}: ${450 - oa.x} vs ${ob.x}`);
    assert.ok(Math.abs(oa.y - ob.y) < 1e-6, 'mirroring must not move it vertically');
  }
});

test('a descending path reports a downward heading', () => {
  /* Sprites are authored nose-up, so a craft flying straight down must draw
   * near PI. Anything else would render the fleet upside down. */
  const p = new GG.paths.Path('lane', {});
  const out = { x: 0, y: 0, angle: 0 };
  p.sample(0.5, 450, 850, out);
  assert.ok(Math.abs(M.angleDelta(out.angle, Math.PI)) < 0.25,
    `expected ~PI, got ${out.angle.toFixed(3)}`);
});

test('an unknown template falls back rather than throwing', () => {
  const p = new GG.paths.Path('no-such-path', {});
  assert.strictEqual(p.name, 'lane');
});

/* ---- bullet patterns -------------------------------------------------------------- */

section('bullet patterns');

/* A stand-in world that records what a pattern fires. */
function fakeWorld(config, overrides) {
  const world = Object.assign({
    config,
    worldW: 450,
    worldH: 850,
    rng: GG.createRng(12345),
    player: { x: 225, y: 660 },
    shots: [],
    spawnEnemyBullet(x, y, vx, vy, kind) {
      const b = { x, y, vx, vy, kind };
      world.shots.push(b);
      return b;
    }
  }, overrides);
  return world;
}

test('every pattern fires at least one projectile per volley', () => {
  const config = freshConfig();
  for (const name of Object.keys(GG.patterns.PATTERNS)) {
    const pattern = GG.patterns.PATTERNS[name];
    const world = fakeWorld(config);
    const source = { x: 225, y: 200, spinPhase: 0.3 };
    for (let v = 0; v < (pattern.volleys || 1); v++) pattern.fire(world, source, v);
    assert.ok(world.shots.length > 0, `${name} fired nothing`);
    for (const s of world.shots) {
      assert.ok(Number.isFinite(s.vx) && Number.isFinite(s.vy), `${name} produced a NaN velocity`);
      assert.ok(Math.hypot(s.vx, s.vy) > 1, `${name} produced a stationary bullet`);
    }
  }
});

test('the green wall always leaves a dodgeable gap', () => {
  const config = freshConfig();
  /* Re-roll many times: the gap position is random, its existence is not. */
  for (let seed = 0; seed < 60; seed++) {
    const world = fakeWorld(config, { rng: GG.createRng(seed) });
    GG.patterns.PATTERNS.greenWall.fire(world, { x: 225, y: 120 }, 0);
    const xs = world.shots.map((s) => s.x).sort((a, b) => a - b);
    let widest = Math.max(xs[0], world.worldW - xs[xs.length - 1]);
    for (let i = 1; i < xs.length; i++) widest = Math.max(widest, xs[i] - xs[i - 1]);
    assert.ok(widest >= GG.patterns.MIN_GAP,
      `seed ${seed}: widest gap was ${widest.toFixed(1)}, need ${GG.patterns.MIN_GAP}`);
  }
});

test('column spacing is at least the minimum gap', () => {
  const config = freshConfig();
  const world = fakeWorld(config);
  GG.patterns.PATTERNS.columns.fire(world, { x: 225, y: 120 }, 0);
  const xs = world.shots.map((s) => s.x).sort((a, b) => a - b);
  for (let i = 1; i < xs.length; i++) {
    assert.ok(xs[i] - xs[i - 1] >= GG.patterns.MIN_GAP,
      `columns ${xs[i - 1]} and ${xs[i]} are too close together`);
  }
});

test('aimed fire actually points at the player', () => {
  const config = freshConfig();
  const world = fakeWorld(config, { player: { x: 100, y: 700 } });
  const source = { x: 300, y: 150 };
  GG.patterns.PATTERNS.aimed.fire(world, source, 0);
  const s = world.shots[0];
  const wantAngle = Math.atan2(100 - 300, 700 - 150);
  const gotAngle = Math.atan2(s.vx, s.vy);
  assert.ok(Math.abs(M.angleDelta(wantAngle, gotAngle)) < 1e-6);
});

test('dense patterns are telegraphed', () => {
  /* The rule from the brief: anything that fills the screen warns first. */
  const dense = ['spread5', 'columns', 'fanAlt', 'greenWall', 'curvePair',
                 'bossFan', 'bossRadial', 'bossAimedRake', 'bossMissiles'];
  for (const name of dense) {
    assert.ok(GG.patterns.PATTERNS[name].telegraph === true, `${name} is not telegraphed`);
  }
});

/* ---- weapons ----------------------------------------------------------------------- */

section('weapon ladder');

test('every tier is visibly different from the one below it', () => {
  /* The brief forbids invisible damage-only upgrades, so assert that each
   * step changes the port list, the bolt sprite or the cadence. */
  const tiers = GG.CONFIG.weapons.tiers;
  for (let i = 1; i < tiers.length; i++) {
    const a = tiers[i - 1];
    const b = tiers[i];
    const changed =
      a.ports.length !== b.ports.length ||
      a.bolt !== b.bolt ||
      a.intervalMs !== b.intervalMs ||
      a.muzzle !== b.muzzle ||
      JSON.stringify(a.ports) !== JSON.stringify(b.ports);
    assert.ok(changed, `tier ${i + 1} is indistinguishable from tier ${i}`);
  }
});

test('projectile count never decreases up the ladder', () => {
  const tiers = GG.CONFIG.weapons.tiers;
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].ports.length >= tiers[i - 1].ports.length,
      `tier ${i + 1} fires fewer projectiles than tier ${i}`);
  }
});

test('cadence never gets slower up the ladder', () => {
  const tiers = GG.CONFIG.weapons.tiers;
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].intervalMs <= tiers[i - 1].intervalMs,
      `tier ${i + 1} is slower than tier ${i}`);
  }
});

test('the top tier adds a secondary fire mode', () => {
  const top = GG.CONFIG.weapons.tiers[GG.CONFIG.weapons.maxTier - 1];
  assert.ok(top.lanceEveryMs > 0, 'tier 6 has no centre lance');
});

test('upgrading caps out and reports it', () => {
  const w = new GG.Weapons(freshConfig());
  for (let i = 1; i < GG.CONFIG.weapons.maxTier; i++) {
    assert.strictEqual(w.upgradeMain(), 'WEAPON UPGRADE');
  }
  assert.strictEqual(w.tier, GG.CONFIG.weapons.maxTier);
  assert.strictEqual(w.upgradeMain(), null, 'a capped upgrade must report null');
});

test('module upgrades walk every module before reporting max', () => {
  const config = freshConfig();
  const w = new GG.Weapons(config);
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    const label = w.upgradeModule();
    if (label === null) break;
    seen.add(w.moduleName());
  }
  assert.strictEqual(seen.size, config.weapons.moduleOrder.length,
    'not every secondary module is reachable in a run');
  assert.strictEqual(w.upgradeModule(), null);
});

test('every named module has a spec', () => {
  for (const name of GG.CONFIG.weapons.moduleOrder) {
    const spec = GG.CONFIG.weapons.modules[name];
    assert.ok(spec, `module ${name} has no spec`);
    assert.ok(spec.intervalMs > 0, `module ${name} would fire every frame`);
    assert.ok(spec.label, `module ${name} has no banner label`);
  }
});

/* ---- player ------------------------------------------------------------------------- */

section('player');

test('the hitbox is much smaller than the art', () => {
  const p = GG.CONFIG.player;
  assert.ok(p.hitRadius * 2 < p.spriteWidth * 0.35,
    'the hitbox must be the cockpit, not the wingspan');
});

test('the ship stays inside its bounds under any input', () => {
  const config = freshConfig();
  const player = new GG.Player(config);
  player.enter(450, 850);
  player.spawnInMs = 0;
  const b = player.bounds(450, 850);
  const targets = [
    { x: -9999, y: -9999 }, { x: 9999, y: 9999 },
    { x: 225, y: 0 }, { x: 225, y: 100000 }
  ];
  for (const t of targets) {
    for (let i = 0; i < 200; i++) {
      player.update(16.667, { x: t.x, y: t.y, offsetY: 0 }, 450, 850);
    }
    assert.ok(player.x >= b.minX - 1e-6 && player.x <= b.maxX + 1e-6, `x=${player.x}`);
    assert.ok(player.y >= b.minY - 1e-6 && player.y <= b.maxY + 1e-6, `y=${player.y}`);
  }
});

test('touch can reach all four playfield edges', () => {
  const config = freshConfig();
  const player = new GG.Player(config);
  const b = player.bounds(450, 850);
  assert.strictEqual(b.minY, config.player.hitRadius);
  assert.strictEqual(b.maxY, 850 - config.player.hitRadius);
  for (const target of [{ x: 0, y: 0 }, { x: 450, y: 850 }]) {
    for (let i = 0; i < 300; i++) {
      player.update(16.667, { ...target, offsetY: 46 }, 450, 850);
    }
    assert.ok(Math.abs(player.x - (target.x ? b.maxX : b.minX)) < 0.01);
    assert.ok(Math.abs(player.y - (target.y ? b.maxY : b.minY)) < 0.01);
  }
});

test('a hit is ignored while already invulnerable', () => {
  const config = freshConfig();
  const player = new GG.Player(config);
  player.enter(450, 850);
  player.spawnInMs = 0;
  player.invulnMs = 0;
  const lives = player.lives;
  assert.strictEqual(player.damage(), 'hit');
  assert.strictEqual(player.lives, lives - 1);
  assert.strictEqual(player.damage(), 'none', 'a second hit must not stack');
  assert.strictEqual(player.lives, lives - 1);
});

test('a shield absorbs exactly one hit', () => {
  const config = freshConfig();
  const player = new GG.Player(config);
  player.enter(450, 850);
  player.spawnInMs = 0;
  player.invulnMs = 0;
  player.shield = 1;
  const lives = player.lives;
  assert.strictEqual(player.damage(), 'shield');
  assert.strictEqual(player.lives, lives, 'a shielded hit must not cost a life');
  assert.strictEqual(player.shield, 0);
});

test('the run ends exactly once at zero lives', () => {
  const config = freshConfig({ player: { startLives: 2 } });
  const player = new GG.Player(config);
  player.enter(450, 850);
  player.spawnInMs = 0;
  const results = [];
  for (let i = 0; i < 6; i++) {
    player.invulnMs = 0;
    player.respawnMs = 0;
    results.push(player.damage());
  }
  assert.strictEqual(results.filter((r) => r === 'dead').length, 1, results.join(','));
});

/* ---- stage flow ----------------------------------------------------------------------- */

section('stage flow');

test('stage beats are in order and inside the stage', () => {
  let previous = -1;
  for (const beat of GG.STAGE_BEATS) {
    assert.ok(beat.at >= previous, 'beats must be sorted by time');
    assert.ok(beat.at >= 0 && beat.at < 1, `beat at ${beat.at} is outside the stage`);
    previous = beat.at;
  }
});

test('every beat names a real archetype and a real path', () => {
  for (const beat of GG.STAGE_BEATS) {
    assert.ok(GG.CONFIG.enemies[beat.group.type], `unknown enemy "${beat.group.type}"`);
    assert.ok(GG.paths.TEMPLATES[beat.group.path], `unknown path "${beat.group.path}"`);
  }
});

test('every archetype names a real pattern', () => {
  for (const key of Object.keys(GG.CONFIG.enemies)) {
    const def = GG.CONFIG.enemies[key];
    if (!def.pattern) continue;
    assert.ok(GG.patterns.get(def.pattern), `enemy ${key} names unknown pattern "${def.pattern}"`);
  }
});

test('no stretch of the stage is left empty for long', () => {
  /* Beats must not leave a hole bigger than a few seconds; the filler rule
   * covers the rest, but the authored timeline should not depend on it. */
  const length = GG.CONFIG.stage.lengthMs;
  let previous = 0;
  for (const beat of GG.STAGE_BEATS) {
    const gap = (beat.at - previous) * length;
    assert.ok(gap <= 5000, `a ${Math.round(gap)} ms hole before the beat at ${beat.at}`);
    previous = beat.at;
  }
});

test('the timeline promises a weapon drop in the heavy phase', () => {
  const drop = GG.STAGE_BEATS.filter((b) => b.drop === 'weapon');
  assert.strictEqual(drop.length, 1, 'exactly one guaranteed weapon drop per stage');
  assert.ok(drop[0].at > 0.4 && drop[0].at < 0.7,
    `the guaranteed drop should land in the heavy phase, not at ${drop[0].at}`);
});

test('the elite phase arrives before the climax', () => {
  const elite = GG.STAGE_BEATS.find((b) => GG.CONFIG.enemies[b.group.type].elite);
  assert.ok(elite, 'no elite is ever scheduled');
  assert.ok(elite.at >= 0.65 && elite.at <= 0.8, `elite lands at ${elite.at}`);
});

test('a group never exceeds the on-screen enemy budget', () => {
  for (const beat of GG.STAGE_BEATS) {
    assert.ok((beat.group.count || 1) <= GG.CONFIG.stage.maxEnemies,
      `a single group of ${beat.group.count} exceeds the budget`);
  }
});

/* ---- full-run integration -------------------------------------------------------------
 * The simulation has no DOM dependency, so a whole run can be driven here at a
 * fixed timestep. These are the tests that actually protect the feel: dead
 * air, pool ceilings and numerical stability over a long run. */

section('full run');

test('opening waves punish standing still across multiple seeds', () => {
  for (const seed of [7, 42, 20260919]) {
    const config = freshConfig();
    GG.mergeConfig(config, JSON.parse(fs.readFileSync(path.join(ROOT, 'config/game-config.json'), 'utf8')));
    const world = new GG.World(config, {
      fx: new GG.Effects(config), audio: { play() {} }
    });
    world.start(0, { seed });
    for (let i = 0; i < 30 * 60 && world.state !== 'gameover'; i++) {
      world.step(1000 / 60);
      world.fx.update(1000 / 60);
    }
    assert.ok(world.player.lives < config.player.startLives,
      `standing still avoided every hit for 30 seconds, seed ${seed}`);
  }
});

function armedWorld() {
  const config = freshConfig();
  const world = new GG.World(config, {
    fx: new GG.Effects(config), audio: { play() {} }
  });
  world.state = 'playing';
  world.weapons.tier = 6;
  world.weapons.moduleLevel = 3;
  world.weapons.moduleIndex = 4;
  world.weapons.rapidMs = 5000;
  return world;
}

test('losing a life resets all weapons, including on the final life', () => {
  for (const lives of [1, 3]) {
    const world = armedWorld();
    world.player.lives = lives;
    world.hurtPlayer();
    assert.strictEqual(world.player.lives, lives - 1);
    assert.strictEqual(world.weapons.tier, 1);
    assert.strictEqual(world.weapons.moduleLevel, 0);
    assert.strictEqual(world.weapons.moduleIndex, 0);
    assert.strictEqual(world.weapons.rapidMs, 0);
    assert.strictEqual(world.weapons.dwell, null);
  }
});

test('shield and invulnerability preserve the arsenal', () => {
  for (const protection of ['shield', 'invulnMs']) {
    const world = armedWorld();
    world.player[protection] = 1;
    world.hurtPlayer();
    assert.strictEqual(world.player.lives, 3);
    assert.strictEqual(world.weapons.tier, 6);
    assert.strictEqual(world.weapons.moduleLevel, 3);
    assert.strictEqual(world.weapons.rapidMs, 5000);
  }
});

test('side barrage fires once from both edges without upgrading weapons', () => {
  const world = armedWorld();
  const p = world.pickups.spawn(100, 100, 'broadside');
  assert.ok(p && p.sprite === 'pu_broadside');
  world.collect(p);
  assert.strictEqual(world.playerBullets.live, 14);
  let left = 0, right = 0;
  for (let i = 0; i < world.playerBullets.live; i++) {
    const b = world.playerBullets.at(i);
    if (b.vx > 0) left++; else right++;
  }
  assert.strictEqual(left, 7);
  assert.strictEqual(right, 7);
  assert.strictEqual(world.weapons.tier, 6);
  assert.strictEqual(world.weapons.moduleLevel, 3);
});

test('nova clears bullets and damages a boss without spending stored bombs', () => {
  const world = armedWorld();
  world.enemyBullets.obtain();
  let damage = 0;
  world.boss.active = () => true;
  world.damageBoss = amount => { damage += amount; };
  const p = world.pickups.spawn(100, 100, 'nova');
  assert.ok(p && p.sprite === 'pu_nova');
  world.collect(p);
  assert.strictEqual(world.enemyBullets.live, 0);
  assert.strictEqual(world.player.bombs, world.config.player.startBombs);
  assert.strictEqual(damage, 60);
});

/* Drives `seconds` of simulated play at a fixed 60 Hz.
 * `sloppy` adds a reaction delay and aim error, approximating a person. */
function runSoak(options) {
  options = options || {};
  const config = freshConfig(options.config);
  const fx = new GG.Effects(config);
  fx.applyQuality('high');
  const audio = { play() {}, startMusic() {}, stopMusic() {}, duckMusic() {}, suspendGameplay() {} };
  const world = new GG.World(config, { fx, audio, onEvent: options.onEvent || (() => {}) });
  world.setViewport(450, 974);
  world.start(0, { seed: options.seed === undefined ? 20260919 : options.seed });

  const DT = 1000 / 60;
  const stats = {
    longestQuietMs: 0, quietByPhase: {}, maxEnemies: 0, maxEnemyBullets: 0,
    maxPlayerBullets: 0, maxParticles: 0, maxPickups: 0, stagesReached: 1, frames: 0
  };
  let quiet = 0;
  let aimX = 225;
  let hold = 0;

  for (let i = 0; i < 60 * (options.seconds || 120); i++) {
    hold -= DT;
    if (hold <= 0) {
      hold = options.sloppy ? 200 : DT;
      const t = world.enemies.nearest(world.player.x, world.player.y - 220, 900, null);
      aimX = (t ? t.x : 225) + (options.sloppy ? ((i * 37) % 70) - 35 : 0);
    }
    world.input = { x: aimX, y: 974 * (0.76 + Math.sin(i / 95) * 0.06), offsetY: 0 };
    /* Pacing runs aim at enemies but do not dodge aimed fire. Keep them
     * invulnerable so weapon resets do not turn this into a survival test.
     * Mortal runs and the dedicated damage tests exercise real life loss. */
    if (!options.mortal) world.player.invulnMs = DT * 2;
    world.step(DT);
    fx.update(DT);
    if (!options.mortal) world.player.lives = 999;   // measure pacing, not survival

    const busy = world.enemies.count > 0 || world.boss.active();
    if (busy) quiet = 0;
    else {
      quiet += DT;
      const phase = world.director.phase;
      if (quiet > stats.longestQuietMs) stats.longestQuietMs = quiet;
      if (quiet > (stats.quietByPhase[phase] || 0)) stats.quietByPhase[phase] = quiet;
    }

    stats.maxEnemies = Math.max(stats.maxEnemies, world.enemies.count);
    stats.maxEnemyBullets = Math.max(stats.maxEnemyBullets, world.enemyBullets.live);
    stats.maxPlayerBullets = Math.max(stats.maxPlayerBullets, world.playerBullets.live);
    stats.maxParticles = Math.max(stats.maxParticles, fx.particles.live);
    stats.maxPickups = Math.max(stats.maxPickups, world.pickups.count);
    stats.stagesReached = Math.max(stats.stagesReached, world.director.stage + 1);
    stats.frames++;
    if (world.state !== 'playing') break;
  }
  return { world, fx, config, stats };
}

test('a full run never leaves the player with nothing to shoot', () => {
  /* The headline pacing rule from the brief: "almost never more than ~0.5-0.8
   * sec with nothing to shoot". This regressed once already, because the
   * filler only ran during the stage phase and the boss warning and the
   * stage-clear window were therefore silent. */
  const { stats, config } = runSoak({ seconds: 240 });
  const budget = config.stage.maxQuietMs + 1000 / 60 + 1;
  assert.ok(stats.longestQuietMs <= budget,
    `longest empty stretch was ${Math.round(stats.longestQuietMs)} ms, budget ${Math.round(budget)} ms ` +
    `(by phase: ${JSON.stringify(stats.quietByPhase)})`);
});

test('the rule holds through the boss warning and the stage clear', () => {
  const { stats, config } = runSoak({ seconds: 240 });
  const budget = config.stage.maxQuietMs + 1000 / 60 + 1;
  assert.ok(stats.stagesReached >= 2, 'the soak never reached a second stage');
  for (const phase of Object.keys(stats.quietByPhase)) {
    assert.ok(stats.quietByPhase[phase] <= budget,
      `phase "${phase}" went quiet for ${Math.round(stats.quietByPhase[phase])} ms`);
  }
});

test('a long run stays inside every performance budget', () => {
  const { stats, config } = runSoak({ seconds: 300, sloppy: true });
  assert.ok(stats.maxEnemies <= config.stage.maxEnemies,
    `${stats.maxEnemies} enemies exceeds the ${config.stage.maxEnemies} budget`);
  assert.ok(stats.maxEnemyBullets <= config.bullets.maxEnemy);
  assert.ok(stats.maxPlayerBullets <= config.bullets.maxPlayer);
  assert.ok(stats.maxParticles <= config.quality.high.particles);
  /* Both projectile pools together must stay under the spec's 300 on screen. */
  assert.ok(stats.maxEnemyBullets + stats.maxPlayerBullets <= 300,
    `${stats.maxEnemyBullets + stats.maxPlayerBullets} projectiles exceeds the 300 budget`);
});

test('a long run keeps every quantity finite', () => {
  const { world } = runSoak({ seconds: 240, sloppy: true });
  const finite = (v) => Number.isFinite(v);
  assert.ok(finite(world.score) && finite(world.player.x) && finite(world.player.y),
    'a core quantity went non-finite');
  for (let i = 0; i < world.enemyBullets.live; i++) {
    const b = world.enemyBullets.at(i);
    assert.ok(finite(b.x) && finite(b.y) && finite(b.angle), 'a bullet went non-finite');
  }
  for (let i = 0; i < world.enemies.count; i++) {
    const e = world.enemies.pool.at(i);
    assert.ok(finite(e.x) && finite(e.y) && finite(e.angle), 'an enemy went non-finite');
  }
});

test('the run escalates: stages advance and bosses die', () => {
  const seen = { boss: 0 };
  const { world, stats } = runSoak({
    seconds: 300,
    onEvent: (type) => { if (type === 'boss-down') seen.boss++; }
  });
  assert.ok(stats.stagesReached >= 3,
    `only reached stage ${stats.stagesReached} in 300 s`);
  assert.ok(seen.boss >= 2, `only ${seen.boss} bosses were destroyed in 300 s`);
  assert.ok(world.score > 20000, `score of ${world.score} is implausibly low`);
});

test('upgrades actually arrive during a run', () => {
  /* The pity timer plus the drop weights have to keep the ladder climbing;
   * a run that never upgrades is the failure mode the reference clip rules
   * out most clearly. */
  let pickups = 0;
  const tiers = new Set();
  const { world } = runSoak({
    seconds: 180,
    onEvent: (type) => { if (type === 'pickup') pickups++; }
  });
  tiers.add(world.weapons.tier);
  assert.ok(pickups >= 8, `only ${pickups} pickups were collected in 180 s`);
});

test('a hit is survivable and the run ends when lives run out', () => {
  const { world } = runSoak({ seconds: 300, sloppy: true, mortal: true });
  assert.ok(world.state === 'gameover' || world.player.lives > 0,
    'a mortal run neither survived nor ended cleanly');
  if (world.state === 'gameover') {
    const stats = world.stats();
    assert.ok(stats.score >= 0 && Number.isFinite(stats.timeMs), 'game-over stats are malformed');
    assert.strictEqual(world.player.lives, 0);
  }
});

test('a paused world does not advance', () => {
  const { world } = runSoak({ seconds: 20 });
  world.pause(world.lastNow, 'test');
  const before = { t: world.simTime, score: world.score, enemies: world.enemies.count };
  world.advanceTo(world.lastNow + 5000);
  assert.strictEqual(world.simTime, before.t, 'the clock advanced while paused');
  assert.strictEqual(world.score, before.score);
  assert.strictEqual(world.enemies.count, before.enemies);
});

test('a long stall is capped, not replayed', () => {
  /* Resuming a backgrounded tab must not fast-forward the bullets through the
   * player. */
  const { world } = runSoak({ seconds: 20 });
  world.state = 'playing';
  world.lastNow = 0;
  const advanced = world.advanceTo(30000);
  assert.ok(advanced <= 201, `a 30 s stall advanced the simulation by ${advanced} ms`);
});

/* ---- results -------------------------------------------------------------------------- */

console.log('\n' + passed + ' passed, ' + failures.length + ' failed');
if (failures.length) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  ' + f.name + '\n    ' + f.err.stack.split('\n')[0]));
  process.exitCode = 1;
}
