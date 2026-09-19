/* GALAXY GUNNER — central tuning configuration.
 *
 * One place for every number the gameplay layer reads. config/game-config.json
 * is deep-merged on top when the game is served over http(s); opened from
 * file:// the fetch fails harmlessly and these defaults are used.
 *
 * World units: the simulation runs in a virtual portrait field whose WIDTH is
 * BASE_W. Height flexes with the device aspect between minHeight and
 * maxHeight, so a 9:16 and a 9:19.5 phone both get a full-bleed playfield with
 * identical horizontal difficulty. src/layout.js does the mapping.
 */
(function (global) {
  'use strict';

  var CONFIG = {
    meta: {
      title: 'GALAXY GUNNER',
      credit: 'Hen Asayag',
      status: 'Original assets and audio, generated at runtime'
    },

    /* ---- viewport ------------------------------------------------------- */
    view: {
      baseWidth: 450,        /* design width, from the reference clip */
      designHeight: 850,
      minHeight: 720,        /* landscape / short windows */
      maxHeight: 1010,       /* very tall phones */
      maxWidth: 760,         /* landscape fallback cap; wider gets letterboxed */
      maxDpr: 2.5
    },

    /* ---- palette (sampled from the supplied concept boards) ------------- */
    palette: {
      space: '#04060f',
      nebulaA: '#0a1a3c',
      nebulaB: '#1b0a36',
      star: '#cfe4ff',
      hull: '#33517d',
      hullDark: '#16243d',
      hullLight: '#8fb4e8',
      cockpit: '#53e0ff',
      engine: '#39c8ff',
      playerBolt: '#5ad8ff',
      playerBoltHot: '#eaffff',
      laser: '#b46bff',
      plasma: '#57ff8f',
      enemyBolt: '#ff7a1a',
      enemyBoltHot: '#ffe08a',
      enemyRed: '#ff3355',
      enemyGreen: '#5dff7a',
      enemyBlue: '#49b6ff',
      missile: '#ffd9a0',
      blast: '#ffb229',
      blastHot: '#fff6d0',
      shield: '#49d8ff',
      white: '#ffffff',
      danger: '#ff2d4d',
      gold: '#ffc23c'
    },

    /* ---- player --------------------------------------------------------- */
    player: {
      spriteWidth: 44,
      hitRadius: 5.5,          /* far smaller than the art, per the spec */
      followTau: 0.115,        /* seconds; 0.10-0.16 window from the brief */
      fingerOffsetY: 46,       /* ship sits above the finger */
      maxSpeed: 1500,          /* world units / sec */
      bankMax: 0.32,           /* radians of roll at full lateral speed */
      bankTau: 0.09,
      marginX: 20,
      topFraction: 0.40,       /* highest the ship may fly, as a share of H */
      bottomMargin: 42,
      startLives: 3,
      maxLives: 5,
      startBombs: 2,
      maxBombs: 5,
      invulnMs: 1500,
      respawnMs: 900,
      damageFlashMs: 85,
      blinkHz: 9
    },

    /* ---- weapon ladder --------------------------------------------------
     * Every tier changes projectile COUNT, SPREAD, SIZE or CADENCE - never a
     * silent damage multiplier. `ports` are muzzle offsets in world units,
     * `angle` in radians from straight up. */
    weapons: {
      maxTier: 6,
      rapidFactor: 0.62,       /* cadence multiplier while Rapid Fire is up */
      /* Damage is tuned so tier 1 one-shots a scout and the ladder roughly
       * doubles single-target output by tier 3 and quadruples it by tier 6.
       * A tier that does not visibly shorten the time-to-kill is not an
       * upgrade, it is a cosmetic. */
      tiers: [
        { /* 1 */ intervalMs: 130, damage: 2.0, bolt: 'bolt_s', speed: 980, muzzle: 0.55,
          ports: [{ x: 0, y: -18, a: 0 }] },
        { /* 2 */ intervalMs: 102, damage: 2.2, bolt: 'bolt_s', speed: 1060, muzzle: 0.75,
          ports: [{ x: -3, y: -19, a: 0 }, { x: 3, y: -19, a: 0 }] },
        { /* 3 */ intervalMs: 100, damage: 2.4, bolt: 'bolt_m', speed: 1080, muzzle: 0.9,
          ports: [{ x: 0, y: -21, a: 0 }, { x: -11, y: -10, a: -0.035 }, { x: 11, y: -10, a: 0.035 }] },
        { /* 4 */ intervalMs: 94, damage: 2.5, bolt: 'bolt_m', speed: 1110, muzzle: 1.0,
          ports: [{ x: 0, y: -21, a: 0 }, { x: -11, y: -10, a: -0.03 }, { x: 11, y: -10, a: 0.03 },
                  { x: -19, y: -2, a: -0.22 }, { x: 19, y: -2, a: 0.22 }] },
        { /* 5 */ intervalMs: 88, damage: 2.8, bolt: 'bolt_l', speed: 1150, muzzle: 1.15,
          ports: [{ x: 0, y: -22, a: 0 }, { x: -8, y: -16, a: -0.11 }, { x: 8, y: -16, a: 0.11 },
                  { x: -18, y: -4, a: -0.27 }, { x: 18, y: -4, a: 0.27 }] },
        { /* 6 */ intervalMs: 82, damage: 3.2, bolt: 'bolt_l', speed: 1200, muzzle: 1.35,
          lanceEveryMs: 620, lanceDamage: 14,
          ports: [{ x: 0, y: -22, a: 0 }, { x: -8, y: -16, a: -0.12 }, { x: 8, y: -16, a: 0.12 },
                  { x: -18, y: -4, a: -0.29 }, { x: 18, y: -4, a: 0.29 }] }
      ],
      /* Secondary modules. One is always equipped and fires on its own clock
       * while the main gun keeps going. */
      modules: {
        missiles:  { label: 'HOMING MISSILES', intervalMs: 880, damage: 3.2, speed: 520,
                     turnRate: 4.4, acquireMs: 190, count: 2 },
        sidelaser: { label: 'SIDE LASERS',     intervalMs: 1150, damage: 0.9, dwellMs: 420 },
        chain:     { label: 'CHAIN LIGHTNING', intervalMs: 1000, damage: 2.0, jumps: 3, range: 150 },
        plasma:    { label: 'PLASMA BURST',    intervalMs: 940, damage: 2.4, speed: 620, count: 5, blast: 34 },
        drones:    { label: 'ORBIT DRONES',    intervalMs: 300, damage: 1.0, speed: 900, orbit: 34 },
        pierce:    { label: 'PIERCING BEAM',   intervalMs: 1500, damage: 1.5, dwellMs: 620 },
        rockets:   { label: 'HEAVY ROCKETS',   intervalMs: 1250, damage: 4.5, speed: 430, blast: 52 }
      },
      moduleOrder: ['missiles', 'sidelaser', 'plasma', 'chain', 'drones', 'rockets', 'pierce']
    },

    /* ---- enemy archetypes -----------------------------------------------
     * `drop` is the chance a kill leaves a pickup. They are deliberately
     * generous: the reference clip shows collectibles arriving constantly
     * inside combat, and a shooter whose upgrades never arrive is just a
     * shooter. A pity timer in game.js covers the unlucky streaks. */
    enemies: {
      scout:    { sprite: 'scout_red',    hp: 2,  r: 12, score: 60,  fireMs: 0,    pattern: null,          drop: 0.055 },
      scoutB:   { sprite: 'scout_blue',   hp: 3,  r: 12, score: 70,  fireMs: 1500, pattern: 'straight',    drop: 0.065 },
      twin:     { sprite: 'twin_wing',    hp: 5,  r: 14, score: 110, fireMs: 1250, pattern: 'spread2',     drop: 0.085 },
      dart:     { sprite: 'dart',         hp: 4,  r: 11, score: 95,  fireMs: 1700, pattern: 'aimed',       drop: 0.075, trail: true },
      turret:   { sprite: 'turret_drone', hp: 11, r: 16, score: 200, fireMs: 1450, pattern: 'spread5',     drop: 0.160, hover: true },
      missiler: { sprite: 'missile_craft', hp: 10, r: 16, score: 210, fireMs: 1900, pattern: 'curvepair',  drop: 0.170 },
      spinner:  { sprite: 'spinner',      hp: 12, r: 15, score: 230, fireMs: 900,  pattern: 'radial',      drop: 0.180, spin: 2.2 },
      heavy:    { sprite: 'heavy',        hp: 30, r: 22, score: 420, fireMs: 1100, pattern: 'columns',     drop: 0.360, heavy: true, hover: true },
      carrier:  { sprite: 'elite_carrier', hp: 70, r: 30, score: 900, fireMs: 1250, pattern: 'fanalt',     drop: 1.000, elite: true, hover: true, adds: 'scout' }
    },

    /* ---- projectiles ----------------------------------------------------- */
    bullets: {
      enemySpeed: 300,
      enemySpeedFast: 430,
      telegraphMs: 220,       /* charge glow before a dense attack */
      radius: 4.5,
      maxPlayer: 220,
      maxEnemy: 260
    },

    /* ---- pickups --------------------------------------------------------- */
    pickups: {
      fallSpeed: 92,
      driftAmp: 22,
      magnetRadius: 78,
      magnetRadiusBoosted: 300,
      magnetSpeed: 620,
      lifeMs: 9000,
      bannerMs: 780,
      rapidMs: 7000,
      multiplierMs: 9000,
      magnetMs: 9000,
      /* A run of bad luck must not flatten the whole stage, so this many kills
       * without a pickup forces one. Invisible to the player; the only thing
       * they notice is that upgrades keep arriving. */
      pityKills: 16,
      /* relative weights used when an enemy drops something */
      weights: { weapon: 26, missile: 14, shield: 14, rapid: 12, multi: 10, magnet: 8, bomb: 8 }
    },

    /* ---- stage pacing ---------------------------------------------------- */
    stage: {
      lengthMs: 78000,        /* one continuous intensity curve */
      maxQuietMs: 700,        /* never leave the player with nothing to shoot */
      bossWarnMs: 2200,
      difficultyPerStage: 0.22,
      maxEnemies: 60
    },

    /* ---- feel ------------------------------------------------------------ */
    feel: {
      hitStop: { normal: 0, heavy: 14, elite: 28, playerHit: 42, bossPhase: 75 },
      shake: { kill: 0, heavy: 2.2, elite: 3.4, playerHit: 5, bomb: 7, boss: 6 },
      shakeMs: 240,
      scoreCountUpMs: 160
    },

    /* ---- performance budget ---------------------------------------------- */
    quality: {
      high:   { particles: 250, trailSamples: 14, sparks: 10, dprCap: 2.5, stars: 150, additive: true },
      medium: { particles: 150, trailSamples: 9,  sparks: 6,  dprCap: 2.0, stars: 100, additive: true },
      low:    { particles: 70,  trailSamples: 5,  sparks: 3,  dprCap: 1.25, stars: 60, additive: false }
    },

    audio: {
      masterGain: 0.5,
      musicGain: 0.22,
      maxVoices: 14,
      unlockOnFirstGesture: true,
      /* Every cue is synthesised at unlock by src/synth.js - no sample files,
       * nothing borrowed from any commercial title. */
      cues: ['shot', 'shot_big', 'laser', 'missile', 'missile_hit', 'boom_s',
             'boom_l', 'shield_hit', 'player_hit', 'pickup', 'upgrade',
             'bomb', 'warn', 'ui', 'pause', 'gameover']
    },

    debug: { hitboxes: false },

    storageKey: 'galaxy-gunner.v1'
  };

  /* Deep-merge plain objects; arrays and scalars are replaced wholesale. */
  function merge(target, source) {
    if (!source || typeof source !== 'object') return target;
    Object.keys(source).forEach(function (key) {
      var value = source[key];
      if (value && typeof value === 'object' && !Array.isArray(value) &&
          target[key] && typeof target[key] === 'object' && !Array.isArray(target[key])) {
        merge(target[key], value);
      } else if (value !== undefined) {
        target[key] = value;
      }
    });
    return target;
  }

  var api = { CONFIG: CONFIG, merge: merge };
  global.GG = global.GG || {};
  global.GG.CONFIG = CONFIG;
  global.GG.mergeConfig = merge;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
