/* Enemy entities and the group spawner.
 *
 * The key change from the previous Chicken-Invaders-style build, called out in
 * the kit's implementation notes: there are no stationary formation grids.
 * Enemies are spawned as GROUPS bound to a spline from the path library, they
 * keep firing while they travel, and groups overlap in time so the screen is
 * never empty.
 *
 * A group is described by:
 *   type       archetype key in config.enemies
 *   count      members
 *   path       template name
 *   mirror     flip the template horizontally
 *   staggerMs  delay between members along the same path
 *   durationMs how long one member takes to walk the whole path
 *   offsetX/Y  normalised nudge, for converging / diverging / V shapes
 *   firePhase  ms before the group's first attack
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Pool = global.GG.Pool;
  var Paths = global.GG.paths;
  var Patterns = global.GG.patterns;

  var sample = { x: 0, y: 0, angle: 0 };

  function newEnemy() {
    return {
      type: '', def: null, sprite: '',
      x: 0, y: 0, angle: Math.PI, r: 12,
      hp: 1, maxHp: 1, score: 0,
      path: new Paths.Path('lane', null), pathT: 0, pathDur: 4000,
      delayMs: 0, holdMs: 0, holdAt: 1,
      fireTimer: 0, volleysLeft: 0, volleyTimer: 0, volleyIndex: 0,
      pattern: null, telegraphMs: 0,
      spin: 0, spinPhase: 0,
      flashMs: 0, trailTimer: 0, addsTimer: 0,
      elite: false, heavy: false, dead: false, scale: 1
    };
  }

  function Enemies(config, world) {
    this.config = config;
    this.world = world;
    this.pool = new Pool(newEnemy, null, config.stage.maxEnemies);
    this.hpScale = 1;
    this.speedScale = 1;
    /* Group sizes grow with the stage. A player who has climbed the weapon
     * ladder clears an early-stage group in about a second, so scaling health
     * alone leaves the screen looking empty however hard it actually is. */
    this.countScale = 1;
  }

  Enemies.prototype.clear = function () { this.pool.clear(); };

  Object.defineProperty(Enemies.prototype, 'count', {
    get: function () { return this.pool.live; }
  });

  /* ---- spawning ------------------------------------------------------------ */

  Enemies.prototype.spawnGroup = function (desc) {
    var def = this.config.enemies[desc.type];
    if (!def) return 0;
    var spawned = 0;
    var base = desc.count || 1;
    /* Elites and heavies are already a handful; only the light traffic
     * multiplies, or a late stage would be a wall of miniboss. */
    var count = def.elite || def.heavy
      ? base
      : Math.max(base, Math.round(base * this.countScale));

    for (var i = 0; i < count; i++) {
      var e = this.pool.obtain();
      if (!e) break;                        /* at the 60-enemy ceiling */

      var spread = count > 1 ? (i / (count - 1) - 0.5) : 0;
      e.path.configure(desc.path, {
        mirror: desc.mirrorAlternate ? (i % 2 === 1) !== !!desc.mirror : !!desc.mirror,
        offsetX: (desc.offsetX || 0) + spread * (desc.fanX || 0),
        offsetY: (desc.offsetY || 0) + spread * (desc.fanY || 0),
        phase: (desc.phase || 0) + i * (desc.phaseStep || 0.7),
        amp: desc.amp || 1
      });

      e.type = desc.type;
      e.def = def;
      e.sprite = def.sprite;
      e.r = def.r;
      e.maxHp = e.hp = Math.max(1, Math.round(def.hp * this.hpScale));
      e.score = def.score;
      e.elite = !!def.elite;
      e.heavy = !!def.heavy || !!def.elite;
      e.scale = 1;
      e.dead = false;
      e.flashMs = 0;
      e.trailTimer = 0;
      e.addsTimer = def.adds ? 1400 : 0;

      e.pathDur = (desc.durationMs || 5200) / this.speedScale;
      e.pathT = 0;
      e.delayMs = i * (desc.staggerMs === undefined ? 180 : desc.staggerMs);

      /* Hovering archetypes stall mid-screen, which is what turns them from
       * traffic into a threat the player has to deal with. */
      e.holdAt = def.hover ? (desc.holdAt || 0.45) : 2;
      e.holdMs = def.hover ? (desc.holdMs || 2200) : 0;

      e.pattern = Patterns.get(def.pattern);
      e.fireTimer = (desc.firePhase || 500) + i * 140 + (def.fireMs || 1200) * 0.35;
      e.volleysLeft = 0;
      e.volleyTimer = 0;
      e.volleyIndex = 0;
      e.telegraphMs = 0;
      e.spin = def.spin || 0;
      e.spinPhase = 0;

      /* Place it immediately so the first frame it becomes visible is correct. */
      e.path.sample(0, this.world.worldW, this.world.worldH, sample);
      e.x = sample.x;
      e.y = sample.y;
      e.angle = sample.angle;
      spawned++;
    }
    return spawned;
  };

  /* An elite carrier releases escorts from its bays. */
  Enemies.prototype.spawnAdd = function (parent) {
    var e = this.pool.obtain();
    if (!e) return;
    var def = this.config.enemies[parent.def.adds];
    e.path.configure('lane', { offsetX: (parent.x / this.world.worldW) - 0.5 });
    e.type = parent.def.adds;
    e.def = def;
    e.sprite = def.sprite;
    e.r = def.r;
    e.maxHp = e.hp = Math.max(1, Math.round(def.hp * this.hpScale));
    e.score = def.score;
    e.elite = false; e.heavy = false; e.dead = false;
    e.scale = 1; e.flashMs = 0; e.trailTimer = 0; e.addsTimer = 0;
    e.pathDur = 3600 / this.speedScale;
    /* start the add at the carrier's own height rather than off-screen */
    e.pathT = M.clamp01(parent.y / this.world.worldH);
    e.delayMs = 0;
    e.holdAt = 2; e.holdMs = 0;
    e.pattern = Patterns.get(def.pattern);
    e.fireTimer = 900;
    e.volleysLeft = 0; e.volleyTimer = 0; e.volleyIndex = 0; e.telegraphMs = 0;
    e.spin = 0; e.spinPhase = 0;
    e.x = parent.x;
    e.y = parent.y;
    e.angle = Math.PI;
  };

  /* ---- update --------------------------------------------------------------- */

  Enemies.prototype.update = function (dt) {
    var world = this.world;
    var W = world.worldW, H = world.worldH;
    var s = dt / 1000;

    for (var i = this.pool.live - 1; i >= 0; i--) {
      var e = this.pool.at(i);

      if (e.delayMs > 0) { e.delayMs -= dt; continue; }

      e.flashMs = Math.max(0, e.flashMs - dt);
      if (e.spin) e.spinPhase += e.spin * s;

      /* path progression, with the mid-screen hold for hovering craft */
      if (e.holdMs > 0 && e.pathT >= e.holdAt) {
        e.holdMs -= dt;
      } else {
        e.pathT += dt / e.pathDur;
      }

      if (e.pathT > 1.25) { this.pool.releaseAt(i); continue; }

      var prevX = e.x, prevY = e.y;
      e.path.sample(Math.min(e.pathT, 1.18), W, H, sample);
      e.x = sample.x;
      e.y = sample.y;
      /* Spinners are radially symmetric and read better spinning than banking. */
      e.angle = e.spin ? e.spinPhase : sample.angle;

      /* a few archetypes leave a short trail so their pass reads as speed */
      if (e.def.trail) {
        e.trailTimer -= dt;
        if (e.trailTimer <= 0) {
          e.trailTimer = 26;
          world.fx.trail('spark', prevX, prevY, {
            life: 220, s0: 0.5, s1: 0.05, color: '#c86bff', a0: 0.5
          });
        }
      }

      /* Off the bottom or far off the sides: retire it. */
      if (e.y > H + 90 || e.x < -140 || e.x > W + 140) {
        if (e.pathT > 0.6) { this.pool.releaseAt(i); continue; }
      }

      /* escorts */
      if (e.def.adds && e.addsTimer > 0) {
        e.addsTimer -= dt;
        if (e.addsTimer <= 0 && e.y > 40 && e.y < H * 0.6) {
          e.addsTimer = 2600;
          this.spawnAdd(e);
          this.spawnAdd(e);
        }
      }

      this.updateFiring(e, dt);
    }
  };

  /* Firing is a three-stage machine: wait -> telegraph -> volleys. Splitting
   * it this way is what lets a dense pattern warn before it lands without any
   * pattern needing a timer of its own. */
  Enemies.prototype.updateFiring = function (e, dt) {
    var world = this.world;
    if (!e.pattern || !e.def.fireMs) return;
    /* Nothing fires while still above the top edge; being shot by something
     * you cannot see is the one unfair death this genre has to avoid. */
    if (e.y < 10 || e.y > world.worldH) return;

    if (e.telegraphMs > 0) {
      e.telegraphMs -= dt;
      if (e.telegraphMs <= 0) {
        e.volleysLeft = e.pattern.volleys || 1;
        e.volleyIndex = 0;
        e.volleyTimer = 0;
      }
      return;
    }

    if (e.volleysLeft > 0) {
      e.volleyTimer -= dt;
      if (e.volleyTimer <= 0) {
        e.pattern.fire(world, e, e.volleyIndex);
        e.volleyIndex++;
        e.volleysLeft--;
        e.volleyTimer = e.pattern.gapMs || 0;
        if (e.volleysLeft <= 0) {
          e.fireTimer = e.def.fireMs / Math.max(0.6, this.speedScale * 0.8);
        }
      }
      return;
    }

    e.fireTimer -= dt;
    if (e.fireTimer <= 0) {
      if (e.pattern.telegraph) {
        e.telegraphMs = this.config.bullets.telegraphMs;
        world.fx.telegraph(e.x, e.y, e.telegraphMs, this.config.palette.danger);
      } else {
        e.volleysLeft = e.pattern.volleys || 1;
        e.volleyIndex = 0;
        e.volleyTimer = 0;
      }
    }
  };

  /* ---- damage ---------------------------------------------------------------
   * Returns true when the hit killed it. The caller owns the score, the drop
   * and the explosion, because those need the run's multiplier state. */
  Enemies.prototype.hit = function (e, damage) {
    e.hp -= damage;
    e.flashMs = 70;
    if (e.hp > 0) return false;
    e.dead = true;
    return true;
  };

  Enemies.prototype.remove = function (enemy) {
    for (var i = this.pool.live - 1; i >= 0; i--) {
      if (this.pool.at(i) === enemy) { this.pool.releaseAt(i); return; }
    }
  };

  /* Nearest live enemy to a point, used by homing missiles and chain
   * lightning. Squared distance only - no square roots in the hot path. */
  Enemies.prototype.nearest = function (x, y, maxDist, exclude) {
    var best = null, bestD = maxDist * maxDist;
    for (var i = 0; i < this.pool.live; i++) {
      var e = this.pool.at(i);
      if (e.delayMs > 0 || e === exclude || e.y < 0) continue;
      var d = M.dist2(x, y, e.x, e.y);
      if (d < bestD) { bestD = d; best = e; }
    }
    return best;
  };

  global.GG = global.GG || {};
  global.GG.Enemies = Enemies;
})(window);
