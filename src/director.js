/* DifficultyDirector - stage flow as one continuous intensity curve.
 *
 * The reference clip never stops for a wave title, and neither does this. A
 * stage is a timeline of overlapping group spawns; groups are scheduled to
 * arrive while the previous groups' bullets are still in the air, and a filler
 * rule guarantees the player is never left with nothing to shoot for longer
 * than config.stage.maxQuietMs.
 *
 * Shape of a stage, following the brief's suggested curve:
 *   0-13%   low-pressure entries, generous gaps
 *   13-32%  overlapping curved formations
 *   32-52%  first dense bullet patterns
 *   52-70%  heavies, and the guaranteed weapon drop
 *   70-88%  elite wave
 *   88-100% climax, then the boss
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  /* Each beat: when it fires (0..1 of the stage) and the group it releases.
   * `mirrorAlternate` flips every other member, which is what produces the
   * crossing-X and converging/diverging reads from a single template. */
  var BEATS = [
    /* --- opening: readable, well spaced ------------------------------ */
    { at: 0.000, group: { type: 'scout', count: 4, path: 'hookLeft', durationMs: 5200, staggerMs: 210 } },
    { at: 0.045, group: { type: 'scout', count: 4, path: 'hookRight', durationMs: 5200, staggerMs: 210 } },
    { at: 0.090, group: { type: 'scoutB', count: 5, path: 'snake', durationMs: 6200, staggerMs: 190, phaseStep: 0.5 } },

    /* --- overlapping curves ------------------------------------------ */
    { at: 0.135, group: { type: 'twin', count: 4, path: 'esse', durationMs: 6400, staggerMs: 240 } },
    { at: 0.165, group: { type: 'dart', count: 5, path: 'diagonalSweep', durationMs: 3600, staggerMs: 130 } },
    { at: 0.200, group: { type: 'dart', count: 5, path: 'diagonalSweep', durationMs: 3600, staggerMs: 130, mirror: true } },
    { at: 0.230, group: { type: 'scoutB', count: 6, path: 'crossX', durationMs: 4400, staggerMs: 150, mirrorAlternate: true } },
    { at: 0.265, group: { type: 'twin', count: 4, path: 'shallowU', durationMs: 5600, staggerMs: 260 } },
    { at: 0.300, group: { type: 'scout', count: 6, path: 'wave', durationMs: 5200, staggerMs: 170, phaseStep: 0.45 } },

    /* --- first dense patterns ---------------------------------------- */
    { at: 0.330, group: { type: 'turret', count: 2, path: 'lane', durationMs: 8000, staggerMs: 500, fanX: 0.42, holdMs: 2600 } },
    { at: 0.370, group: { type: 'dart', count: 6, path: 'corkscrew', durationMs: 4600, staggerMs: 150, phaseStep: 1.1 } },
    { at: 0.410, group: { type: 'spinner', count: 2, path: 'orbit', durationMs: 8500, staggerMs: 900, phaseStep: 2.1 } },
    { at: 0.450, group: { type: 'missiler', count: 3, path: 'converge', durationMs: 6800, staggerMs: 300, fanX: 0.30 } },
    { at: 0.480, group: { type: 'scoutB', count: 6, path: 'vee', durationMs: 5200, staggerMs: 120, fanX: 0.50, fanY: 0.14 } },

    /* --- heavies, and the promised upgrade ---------------------------- */
    { at: 0.520, group: { type: 'heavy', count: 1, path: 'lane', durationMs: 9500, holdMs: 3400 }, drop: 'weapon' },
    { at: 0.555, group: { type: 'twin', count: 6, path: 'diverge', durationMs: 5800, staggerMs: 170, fanX: 0.26 } },
    { at: 0.595, group: { type: 'turret', count: 3, path: 'sideDive', durationMs: 7600, staggerMs: 420, fanX: 0.36, holdMs: 2200 } },
    { at: 0.630, group: { type: 'spinner', count: 3, path: 'snake', durationMs: 6000, staggerMs: 260, phaseStep: 1.6 } },
    { at: 0.665, group: { type: 'missiler', count: 2, path: 'hookLeft', durationMs: 6400, staggerMs: 400 }, drop: 'missile' },

    /* --- elite wave ---------------------------------------------------- */
    { at: 0.700, group: { type: 'carrier', count: 1, path: 'lane', durationMs: 12000, holdMs: 6000, holdAt: 0.32 } },
    { at: 0.730, group: { type: 'dart', count: 6, path: 'crossX', durationMs: 3800, staggerMs: 110, mirrorAlternate: true } },
    { at: 0.770, group: { type: 'heavy', count: 2, path: 'lane', durationMs: 9000, staggerMs: 700, fanX: 0.44, holdMs: 3000 } },
    { at: 0.810, group: { type: 'spinner', count: 2, path: 'corkscrew', durationMs: 5600, staggerMs: 500, phaseStep: 3.1 } },
    { at: 0.840, group: { type: 'scoutB', count: 8, path: 'wave', durationMs: 4600, staggerMs: 110, phaseStep: 0.35 } },

    /* --- climax --------------------------------------------------------- */
    { at: 0.880, group: { type: 'carrier', count: 1, path: 'lane', durationMs: 11000, holdMs: 5200, holdAt: 0.30, offsetX: -0.18 } },
    { at: 0.900, group: { type: 'turret', count: 4, path: 'lane', durationMs: 8000, staggerMs: 260, fanX: 0.62, holdMs: 2600 } },
    { at: 0.935, group: { type: 'dart', count: 8, path: 'diagonalSweep', durationMs: 3200, staggerMs: 90, mirrorAlternate: true } },
    { at: 0.960, group: { type: 'heavy', count: 2, path: 'sideDive', durationMs: 8000, staggerMs: 500, mirrorAlternate: true, holdMs: 2400 } }
  ];

  /* Fillers keep the guarantee that there is always something to shoot. They
   * are cheap, fast-moving groups that never overstay. */
  var FILLERS = [
    { type: 'scout', count: 4, path: 'hookLeft', durationMs: 4600, staggerMs: 170 },
    { type: 'scout', count: 4, path: 'hookRight', durationMs: 4600, staggerMs: 170 },
    { type: 'scoutB', count: 5, path: 'snake', durationMs: 5200, staggerMs: 160, phaseStep: 0.6 },
    { type: 'dart', count: 4, path: 'diagonalSweep', durationMs: 3400, staggerMs: 120 },
    { type: 'scout', count: 5, path: 'wave', durationMs: 4600, staggerMs: 150, phaseStep: 0.5 }
  ];

  function Director(config, world) {
    this.config = config;
    this.world = world;
    this.reset();
  }

  Director.prototype.reset = function () {
    this.stage = 0;
    this.phase = 'idle';       /* idle | stage | bosswarn | boss | clear */
    this.elapsed = 0;
    this.beat = 0;
    this.quietMs = 0;
    this.fillerIndex = 0;
    this.pendingDrop = null;
    this.bossWarnMs = 0;
    this.clearMs = 0;
  };

  Director.prototype.startStage = function (index) {
    this.stage = index;
    this.phase = 'stage';
    this.elapsed = 0;
    this.beat = 0;
    this.quietMs = 0;
    this.pendingDrop = null;

    /* Difficulty rides on the stage number, applied to enemy health and how
     * fast groups walk their paths - never to bullet speed, because a bullet
     * that outruns the player's reaction is not difficulty, it is noise. */
    var d = 1 + index * this.config.stage.difficultyPerStage;
    this.world.enemies.hpScale = d;
    this.world.enemies.speedScale = Math.min(1.55, 1 + index * 0.09);
    this.world.enemies.countScale = Math.min(1.9, 1 + index * 0.18);
    this.world.stageLabel = 'STAGE ' + (index + 1);
  };

  Director.prototype.update = function (dt) {
    switch (this.phase) {
      case 'stage': this.updateStage(dt); break;
      case 'bosswarn': this.updateWarn(dt); break;
      case 'boss': this.updateBoss(dt); break;
      case 'clear': this.updateClear(dt); break;
    }
    this.keepBusy(dt);
  };

  /* The no-dead-air rule, applied in EVERY phase.
   *
   * It used to live inside updateStage, which meant the boss warning and the
   * stage-clear window - about four seconds between them - left the player
   * with nothing on screen to shoot at. That is exactly the "traditional pause
   * before every wave" the brief rules out, so the check is hoisted here and
   * the warning and the victory lap now have traffic flying through them. */
  Director.prototype.keepBusy = function (dt) {
    if (this.phase === 'idle') return;
    var world = this.world;

    /* A boss actually on screen IS the thing to shoot at. */
    if (world.enemies.count > 0 || world.boss.active()) {
      this.quietMs = 0;
      return;
    }

    this.quietMs += dt;
    if (this.quietMs < this.config.stage.maxQuietMs) return;
    this.quietMs = 0;
    world.enemies.spawnGroup(FILLERS[this.fillerIndex++ % FILLERS.length]);
  };

  Director.prototype.updateStage = function (dt) {
    var world = this.world;
    var length = this.config.stage.lengthMs;
    this.elapsed += dt;
    var t = this.elapsed / length;

    while (this.beat < BEATS.length && BEATS[this.beat].at <= t) {
      var b = BEATS[this.beat++];
      var spawned = world.enemies.spawnGroup(b.group);
      if (spawned) this.quietMs = 0;
      /* A promised drop is attached to the next kill rather than dropped from
       * nowhere, so the upgrade still feels earned. */
      if (b.drop) world.forceDrop = b.drop;
    }

    if (t >= 1) {
      this.phase = 'bosswarn';
      this.bossWarnMs = this.config.stage.bossWarnMs;
      world.fx.banner('WARNING', this.config.palette.danger, this.bossWarnMs);
      world.audio.play('warn');
    }
  };

  Director.prototype.updateWarn = function (dt) {
    this.bossWarnMs -= dt;
    if (this.bossWarnMs <= 0) {
      this.phase = 'boss';
      this.world.boss.spawn(this.stage, 1 + this.stage * this.config.stage.difficultyPerStage);
    }
  };

  Director.prototype.updateBoss = function (dt) {
    /* The boss owns the screen, but the filler rule still applies if the fight
     * somehow empties out. */
    if (this.world.boss.state === 'gone') {
      this.phase = 'clear';
      this.clearMs = 1800;
      this.world.fx.banner('STAGE CLEAR', this.config.palette.gold, 1600);
    }
  };

  Director.prototype.updateClear = function (dt) {
    this.clearMs -= dt;
    if (this.clearMs <= 0) {
      this.world.enemies.clear();
      this.startStage(this.stage + 1);
    }
  };

  /* 0..1, used by the HUD progress bar and by the audio layer to lift the
   * music as the stage tightens. */
  Director.prototype.intensity = function () {
    if (this.phase === 'boss' || this.phase === 'bosswarn') return 1;
    if (this.phase !== 'stage') return 0.2;
    return M.clamp01(this.elapsed / this.config.stage.lengthMs);
  };

  global.GG = global.GG || {};
  global.GG.Director = Director;
  global.GG.STAGE_BEATS = BEATS;
})(window);
