/* The world: rules, entities, collisions and the gameplay state machine.
 *
 * No DOM and no wall clock of its own - every entry point is handed a
 * timestamp, so a run can be driven deterministically from a test.
 *
 * Simulation clock
 *   `simTime` only advances while the run is actually live. Menus, pause,
 *   loading and a hidden tab therefore cannot spawn a wave or cost a life.
 *
 * Hit-stop
 *   Big impacts freeze the simulation for a few milliseconds while the
 *   renderer keeps drawing. It is consumed from the REAL delta before the
 *   simulation delta is computed, so it cannot compound or be swallowed by a
 *   slow frame.
 *
 * Stepping
 *   The simulation advances in slices of at most MAX_STEP_MS. A long stall
 *   (a backgrounded tab, a GC pause) is capped rather than replayed, so the
 *   player never resumes into a screen of bullets that moved while they could
 *   not see them.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Pool = global.GG.Pool;

  var MAX_STEP_MS = 1000 / 60;
  var MAX_CATCHUP_MS = 200;

  /* Enemy projectile families. Colour is the family, so the player learns the
   * threat from the palette rather than from the shape alone. */
  var BULLET_KINDS = {
    orange:  { sprite: 'bullet_orange', r: 5.0, color: null, spin: false },
    red:     { sprite: 'bullet_red',    r: 5.0, color: null, spin: false },
    green:   { sprite: 'orb_green',     r: 6.5, color: null, spin: true },
    blue:    { sprite: 'orb_blue',      r: 5.5, color: null, spin: true },
    violet:  { sprite: 'orb_violet',    r: 6.5, color: null, spin: true },
    missile: { sprite: 'missile',       r: 5.5, color: null, spin: false, trail: true }
  };

  function newBullet() {
    return {
      x: 0, y: 0, vx: 0, vy: 0, r: 4, angle: 0,
      damage: 1, sprite: 'bolt_s', color: null, kind: '',
      life: 4000, age: 0, pierce: 0, blast: 0,
      homing: false, target: null, turnRate: 0, speed: 0, acquireMs: 0,
      curve: 0, curveMs: 0, trail: false, trailTimer: 0, spin: 0
    };
  }

  function World(config, options) {
    options = options || {};
    this.config = config;
    this.onEvent = options.onEvent || function () {};
    this.fx = options.fx;
    this.audio = options.audio;
    this.rng = options.rng || global.GG.createRng(0);

    this.worldW = config.view.baseWidth;
    this.worldH = config.view.designHeight;

    this.player = new global.GG.Player(config);
    this.weapons = new global.GG.Weapons(config);
    this.enemies = new global.GG.Enemies(config, this);
    this.boss = new global.GG.Boss(config, this);
    this.pickups = new global.GG.Pickups(config, this);
    this.director = new global.GG.Director(config, this);

    this.playerBullets = new Pool(newBullet, null, config.bullets.maxPlayer);
    this.enemyBullets = new Pool(newBullet, null, config.bullets.maxEnemy);

    this.state = 'idle';
    this.reset(0);
  }

  /* ---- lifecycle ---------------------------------------------------------- */

  World.prototype.reset = function (now) {
    this.state = 'idle';
    this.simTime = 0;
    this.lastNow = now || 0;
    this.score = 0;
    this.multiplier = 1;
    this.multiplierMs = 0;
    this.magnetMs = 0;
    this.stageLabel = 'STAGE 1';
    this.forceDrop = null;
    this.kills = 0;
    this.sinceDrop = 0;
    this.shotsFired = 0;
    this.bestCombo = 0;
    this.combo = 0;
    this.comboMs = 0;
    this.pauseReason = null;

    this.player.reset(this.worldW / 2, this.worldH * 0.78);
    this.weapons.reset();
    this.enemies.clear();
    this.pickups.clear();
    this.playerBullets.clear();
    this.enemyBullets.clear();
    this.boss.state = 'gone';
    this.director.reset();
  };

  World.prototype.setViewport = function (worldW, worldH) {
    /* Keep the ship proportionally placed when the field resizes under it, so
     * an orientation change or a collapsing address bar never drops the player
     * onto a bullet. */
    var fx = this.worldW ? this.player.x / this.worldW : 0.5;
    var fy = this.worldH ? this.player.y / this.worldH : 0.8;
    this.worldW = worldW;
    this.worldH = worldH;
    this.player.x = this.player.targetX = fx * worldW;
    this.player.y = this.player.targetY = fy * worldH;
    this.player.prevX = this.player.x;
  };

  World.prototype.start = function (now, options) {
    options = options || {};
    this.reset(now);
    this.rng = global.GG.createRng(options.seed === undefined ? Date.now() : options.seed);
    this.state = 'playing';
    this.lastNow = now;
    this.player.enter(this.worldW, this.worldH);
    this.director.startStage(0);
    this.onEvent('start', {});
  };

  World.prototype.isLive = function () { return this.state === 'playing'; };

  World.prototype.pause = function (now, reason) {
    if (this.state !== 'playing') return false;
    this.advanceTo(now);
    this.state = 'paused';
    this.pauseReason = reason || 'manual';
    return true;
  };

  World.prototype.resume = function (now) {
    if (this.state !== 'paused') return false;
    this.state = 'playing';
    this.lastNow = now;
    /* A resume must never cost a life to something that was already on top of
     * the ship while the game was frozen. */
    this.player.invulnMs = Math.max(this.player.invulnMs, 900);
    return true;
  };

  /* ---- clock --------------------------------------------------------------- */

  World.prototype.advanceTo = function (now) {
    if (this.state !== 'playing') { this.lastNow = now; return 0; }
    var elapsed = now - this.lastNow;
    this.lastNow = now;
    if (!(elapsed > 0)) return 0;

    /* hit-stop eats real time before the simulation sees any of it */
    var frozen = this.fx ? this.fx.consumeHitStop(elapsed) : 0;
    elapsed -= frozen;
    if (elapsed <= 0) return 0;

    if (elapsed > MAX_CATCHUP_MS) elapsed = MAX_CATCHUP_MS;

    var remaining = elapsed;
    while (remaining > 0) {
      var step = Math.min(MAX_STEP_MS, remaining);
      this.step(step);
      remaining -= step;
      if (this.state !== 'playing') break;
    }
    return elapsed;
  };

  World.prototype.step = function (dt) {
    this.simTime += dt;

    this.multiplierMs = Math.max(0, this.multiplierMs - dt);
    if (this.multiplierMs <= 0) this.multiplier = 1;
    this.magnetMs = Math.max(0, this.magnetMs - dt);

    this.comboMs = Math.max(0, this.comboMs - dt);
    if (this.comboMs <= 0) this.combo = 0;

    this.director.update(dt);
    this.player.update(dt, this.input, this.worldW, this.worldH);
    this.weapons.update(dt, this, this.player);
    this.enemies.update(dt);
    this.boss.update(dt);
    this.pickups.update(dt, this.player, this.magnetMs > 0);

    this.updateBullets(this.playerBullets, dt, true);
    this.updateBullets(this.enemyBullets, dt, false);

    this.collide();
  };

  /* ---- projectiles ---------------------------------------------------------- */

  World.prototype.spawnPlayerBullet = function (x, y, vx, vy, sprite, damage, opts) {
    var b = this.playerBullets.obtain();
    if (!b) return null;
    opts = opts || {};
    b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    b.angle = Math.atan2(vx, -vy);
    b.damage = damage;
    b.sprite = sprite;
    b.color = opts.color || null;
    b.kind = 'player';
    b.r = opts.r || 6;
    b.life = 2600; b.age = 0;
    b.pierce = opts.pierce || 0;
    b.blast = opts.blast || 0;
    b.homing = false; b.target = null; b.curve = 0; b.curveMs = 0;
    b.trail = false; b.trailTimer = 0; b.spin = 0;
    this.shotsFired++;
    return b;
  };

  World.prototype.spawnMissile = function (x, y, vx, vy, damage, mod) {
    var b = this.playerBullets.obtain();
    if (!b) return null;
    b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    b.angle = Math.atan2(vx, -vy);
    b.damage = damage;
    b.sprite = mod.sprite || 'missile';
    b.color = null;
    b.kind = 'player';
    b.r = 7;
    b.life = 3200; b.age = 0;
    b.pierce = 0;
    b.blast = mod.blast || 30;
    b.homing = true;
    b.target = null;
    /* Delayed acquisition plus a turn-rate cap is what makes a missile trace a
     * long curve instead of snapping onto its target. */
    b.acquireMs = mod.acquireMs || 190;
    b.turnRate = mod.turnRate || 4.4;
    b.speed = mod.speed || 520;
    b.curve = 0; b.curveMs = 0;
    b.trail = true; b.trailTimer = 0; b.spin = 0;
    this.shotsFired++;
    return b;
  };

  World.prototype.spawnEnemyBullet = function (x, y, vx, vy, kind) {
    var def = BULLET_KINDS[kind] || BULLET_KINDS.orange;
    var b = this.enemyBullets.obtain();
    if (!b) return null;
    b.x = x; b.y = y; b.vx = vx; b.vy = vy;
    b.angle = Math.atan2(vx, vy) + Math.PI;
    b.damage = 1;
    b.sprite = def.sprite;
    b.color = null;
    b.kind = kind;
    b.r = def.r;
    b.life = 6000; b.age = 0;
    b.pierce = 0; b.blast = 0;
    b.homing = false; b.target = null; b.turnRate = 0; b.speed = 0;
    b.curve = 0; b.curveMs = 0;
    b.trail = !!def.trail; b.trailTimer = 0;
    b.spin = def.spin ? (this.rng() - 0.5) * 6 : 0;
    return b;
  };

  World.prototype.updateBullets = function (pool, dt, isPlayer) {
    var s = dt / 1000;
    var W = this.worldW, H = this.worldH;
    var pad = 60;

    for (var i = pool.live - 1; i >= 0; i--) {
      var b = pool.at(i);
      b.age += dt;

      if (b.homing) {
        if (b.acquireMs > 0) {
          b.acquireMs -= dt;
        } else {
          /* retarget when the previous target died, which is what keeps a
           * volley useful through a collapsing formation */
          if (!b.target || b.target.dead || b.target.hp <= 0) {
            b.target = isPlayer
              ? (this.boss.active() && this.rng() < 0.35
                  ? this.boss
                  : this.enemies.nearest(b.x, b.y, 460, null))
              : this.player;
          }
          if (b.target) {
            var want = Math.atan2(b.target.x - b.x, -(b.target.y - b.y));
            var cur = Math.atan2(b.vx, -b.vy);
            var next = M.turnToward(cur, want, b.turnRate * s);
            b.vx = Math.sin(next) * b.speed;
            b.vy = -Math.cos(next) * b.speed;
          }
        }
      } else if (b.curveMs > 0) {
        /* a fixed-rate bend for the non-homing curved pairs */
        b.curveMs -= dt;
        var a = Math.atan2(b.vx, b.vy) + b.curve * s;
        var sp = Math.sqrt(b.vx * b.vx + b.vy * b.vy);
        b.vx = Math.sin(a) * sp;
        b.vy = Math.cos(a) * sp;
      }

      b.x += b.vx * s;
      b.y += b.vy * s;
      b.angle = isPlayer ? Math.atan2(b.vx, -b.vy) : Math.atan2(b.vx, b.vy) + Math.PI;
      if (b.spin) b.angle += b.spin * (b.age / 1000);

      /* Trail samples are emitted on a fixed clock and left behind in world
       * space, which is what draws the long curve a homing missile carves.
       * The spacing is tight enough that consecutive samples overlap, so it
       * reads as a ribbon rather than a dotted line. */
      if (b.trail && this.fx) {
        b.trailTimer -= dt;
        if (b.trailTimer <= 0) {
          b.trailTimer = 11;
          var warm = isPlayer ? this.config.palette.missile
                              : this.config.palette.enemyBoltHot;
          this.fx.trail('glow', b.x, b.y, {
            life: 320, s0: 0.38, s1: 0.04, color: warm, a0: 0.55
          });
          this.fx.trail('glow', b.x, b.y, {
            life: 150, s0: 0.16, s1: 0.02, color: '#ffffff', a0: 0.8
          });
        }
      }

      if (b.age > b.life || b.x < -pad || b.x > W + pad || b.y < -pad || b.y > H + pad) {
        pool.releaseAt(i);
      }
    }
  };

  /* ---- instant-hit weapons ---------------------------------------------------
   * A beam is resolved as a vertical slab test rather than drawn as a
   * projectile: it lands on the frame it fires, which is what makes a laser
   * feel like a laser. */
  World.prototype.beamDamage = function (x, width, damage, color) {
    var half = width / 2;
    var top = this.player.y;
    var hitAny = false;

    for (var i = this.enemies.pool.live - 1; i >= 0; i--) {
      var e = this.enemies.pool.at(i);
      if (e.delayMs > 0 || e.y > top) continue;
      if (Math.abs(e.x - x) > half + e.r) continue;
      hitAny = true;
      this.fx.hitFlash(e.x, e.y + e.r * 0.4, color, 1.1);
      if (this.enemies.hit(e, damage)) {
        this.killEnemy(e, i);
      }
    }

    if (this.boss.active() && Math.abs(this.boss.x - x) < half + this.boss.r &&
        this.boss.y < top) {
      hitAny = true;
      this.fx.hitFlash(this.boss.x, this.boss.y + this.boss.r * 0.5, color, 1.4);
      this.damageBoss(damage);
    }
    return hitAny;
  };

  /* The boss's moving laser columns, resolved the same way against the ship. */
  World.prototype.bossLaser = function (x, width, damage, color, fromY) {
    var p = this.player;
    if (!p.vulnerable()) return;
    if (p.y < fromY) return;
    if (Math.abs(p.x - x) > width / 2 + p.hitRadius) return;
    this.hurtPlayer();
  };

  World.prototype.chainLightning = function (x, y, jumps, range, damage) {
    var from = { x: x, y: y };
    var previous = null;
    var P = this.config.palette;
    for (var j = 0; j < jumps; j++) {
      var target = this.enemies.nearest(from.x, from.y, range, previous);
      if (!target) break;
      /* the arc itself is a line of pooled sparks, so it costs no geometry */
      var steps = 6;
      for (var k = 0; k <= steps; k++) {
        var t = k / steps;
        this.fx.trail('spark',
          M.lerp(from.x, target.x, t) + (this.rng() - 0.5) * 14,
          M.lerp(from.y, target.y, t) + (this.rng() - 0.5) * 14,
          { life: 150, s0: 0.34, s1: 0.02, color: P.laser, a0: 0.9 });
      }
      this.fx.hitFlash(target.x, target.y, P.laser, 1.2);
      var index = this.indexOfEnemy(target);
      if (this.enemies.hit(target, damage) && index >= 0) this.killEnemy(target, index);
      previous = target;
      from = target;
      damage *= 0.7;
    }
  };

  World.prototype.indexOfEnemy = function (enemy) {
    for (var i = 0; i < this.enemies.pool.live; i++) {
      if (this.enemies.pool.at(i) === enemy) return i;
    }
    return -1;
  };

  /* ---- collisions -------------------------------------------------------------
   * Everything is a circle. The player's circle is the cockpit, not the
   * wingspan, which is the single most important fairness decision in the
   * genre. */
  World.prototype.collide = function () {
    var i, j, b, e;

    /* player shots -> enemies and boss */
    for (i = this.playerBullets.live - 1; i >= 0; i--) {
      b = this.playerBullets.at(i);
      var consumed = false;

      for (j = this.enemies.pool.live - 1; j >= 0; j--) {
        e = this.enemies.pool.at(j);
        if (e.delayMs > 0) continue;
        if (!M.circlesHit(b.x, b.y, b.r, e.x, e.y, e.r)) continue;

        this.fx.hitFlash(b.x, b.y, this.config.palette.playerBoltHot, 1);
        if (b.blast) this.splash(b.x, b.y, b.blast, b.damage * 0.6, e);
        if (this.enemies.hit(e, b.damage)) this.killEnemy(e, j);

        if (b.blast) {
          this.fx.explosion(b.x, b.y, 0.8, 'normal');
          this.audio.play('missile_hit');
        }
        if (b.pierce > 0) { b.pierce--; } else { consumed = true; }
        break;
      }

      if (!consumed && this.boss.active() &&
          M.circlesHit(b.x, b.y, b.r, this.boss.x, this.boss.y, this.boss.r)) {
        this.fx.hitFlash(b.x, b.y, this.config.palette.playerBoltHot, 1.2);
        if (b.blast) this.fx.explosion(b.x, b.y, 0.9, 'normal');
        this.damageBoss(b.damage);
        if (b.pierce > 0) b.pierce--; else consumed = true;
      }

      if (consumed) this.playerBullets.releaseAt(i);
    }

    /* enemy shots -> player */
    if (this.player.vulnerable()) {
      for (i = this.enemyBullets.live - 1; i >= 0; i--) {
        b = this.enemyBullets.at(i);
        if (!M.circlesHit(b.x, b.y, b.r, this.player.x, this.player.y, this.player.hitRadius)) continue;
        this.enemyBullets.releaseAt(i);
        this.hurtPlayer();
        break;                            /* one hit per frame, never a chain */
      }
    }

    /* ramming */
    if (this.player.vulnerable()) {
      for (j = this.enemies.pool.live - 1; j >= 0; j--) {
        e = this.enemies.pool.at(j);
        if (e.delayMs > 0) continue;
        if (!M.circlesHit(e.x, e.y, e.r * 0.8, this.player.x, this.player.y, this.player.hitRadius)) continue;
        if (!e.elite && !e.heavy) {
          if (this.enemies.hit(e, 999)) this.killEnemy(e, j);
        }
        this.hurtPlayer();
        break;
      }
    }
  };

  /* Area damage around a missile or plasma impact. */
  World.prototype.splash = function (x, y, radius, damage, exclude) {
    for (var i = this.enemies.pool.live - 1; i >= 0; i--) {
      var e = this.enemies.pool.at(i);
      if (e === exclude || e.delayMs > 0) continue;
      if (M.dist2(x, y, e.x, e.y) > radius * radius) continue;
      if (this.enemies.hit(e, damage)) this.killEnemy(e, i);
    }
  };

  /* ---- outcomes ---------------------------------------------------------------- */

  World.prototype.killEnemy = function (e, index) {
    var F = this.config.feel;
    var scale = e.elite ? 2.1 : e.heavy ? 1.5 : 1;
    var kind = e.elite ? 'elite' : e.heavy ? 'heavy' : 'normal';

    this.fx.explosion(e.x, e.y, scale, kind);
    this.fx.shake(e.elite ? F.shake.elite : e.heavy ? F.shake.heavy : F.shake.kill);
    this.fx.hitStop(e.elite ? F.hitStop.elite : e.heavy ? F.hitStop.heavy : F.hitStop.normal);
    this.audio.play(e.heavy ? 'boom_l' : 'boom_s');

    this.combo++;
    this.comboMs = 2200;
    if (this.combo > this.bestCombo) this.bestCombo = this.combo;
    this.kills++;

    var points = Math.round(e.score * this.multiplier * (1 + Math.min(this.combo, 30) * 0.012));
    this.score += points;
    this.fx.popup('+' + points, e.x, e.y, e.elite ? this.config.palette.gold : this.config.palette.white);

    this.maybeDrop(e);
    this.enemies.pool.releaseAt(index);
    this.onEvent('kill', { x: e.x, y: e.y, elite: e.elite, score: points });
  };

  World.prototype.maybeDrop = function (e) {
    if (this.forceDrop) {
      this.pickups.spawn(e.x, e.y, this.forceDrop);
      this.forceDrop = null;
      this.sinceDrop = 0;
      return;
    }
    this.sinceDrop++;
    /* Pity timer: a long unlucky streak would leave the player stuck on tier
     * one through a whole stage, which is the one outcome the pacing cannot
     * afford. */
    var forced = this.sinceDrop >= this.config.pickups.pityKills;
    if (!forced && this.rng() >= e.def.drop) return;
    this.sinceDrop = 0;
    this.pickups.spawn(e.x, e.y, this.pickups.roll({
      tier: this.weapons.tier,
      shield: this.player.shield,
      bombs: this.player.bombs
    }));
  };

  World.prototype.damageBoss = function (damage) {
    if (this.boss.hit(damage)) {
      this.score += Math.round(5000 * this.multiplier);
      this.onEvent('boss-down', {});
    }
  };

  World.prototype.onBossPhase = function (boss) {
    this.fx.hitStop(this.config.feel.hitStop.bossPhase);
    this.fx.shake(this.config.feel.shake.boss);
    this.fx.flash(boss.accent, 0.45);
    this.fx.banner('CORE EXPOSED', boss.accent, 900);
    this.audio.play('boom_l');
  };

  World.prototype.onBossDestroyed = function () {
    this.score += Math.round(10000 * this.multiplier);
    /* A boss always leaves something behind; the run has to keep escalating. */
    this.pickups.spawn(this.worldW / 2 - 40, this.worldH * 0.35, 'weapon');
    this.pickups.spawn(this.worldW / 2 + 40, this.worldH * 0.35, 'missile');
  };

  World.prototype.spawnBossAdds = function (x) {
    this.enemies.spawnGroup({
      type: 'scoutB', count: 4, path: 'snake', durationMs: 5200,
      staggerMs: 170, offsetX: (x / this.worldW) - 0.5, phaseStep: 0.8
    });
  };

  World.prototype.hurtPlayer = function () {
    var F = this.config.feel;
    var result = this.player.damage();
    if (result === 'none') return;

    this.combo = 0;
    this.multiplier = 1;
    this.multiplierMs = 0;

    if (result === 'shield') {
      this.fx.particle('shield_ring', this.player.x, this.player.y, {
        life: 320, s0: 0.5, s1: 1.0, color: this.config.palette.shield, a0: 0.95, a1: 0, drag: 1
      });
      this.fx.shake(2.5);
      this.fx.flash(this.config.palette.shield, 0.3);
      this.audio.play('shield_hit');
      this.onEvent('shield', {});
      return;
    }

    this.fx.flash('#ffffff', 0.55);
    this.fx.shake(F.shake.playerHit);
    this.fx.hitStop(F.hitStop.playerHit);
    this.fx.explosion(this.player.x, this.player.y, 1.6, 'heavy');
    this.audio.play('player_hit');

    /* Every lost life starts the arsenal over, including modules and rapid fire. */
    this.weapons.reset();
    this.playerBullets.clear();
    this.fx.banner('WEAPONS RESET', this.config.palette.playerBolt, 1000);

    if (result === 'dead') {
      this.endRun();
    } else {
      this.onEvent('hurt', { lives: this.player.lives });
    }
  };

  World.prototype.useBomb = function () {
    if (!this.player.active() || this.player.bombs <= 0) return false;
    this.player.bombs--;

    this.detonateBomb();
    this.onEvent('bomb', { bombs: this.player.bombs });
    return true;
  };

  /* Also used by the instant nova pickup, without spending a stored bomb. */
  World.prototype.detonateBomb = function () {

    this.enemyBullets.clear();
    this.fx.flash('#ffffff', 0.85);
    this.fx.shockwave(this.player.x, this.player.y, 6);
    this.fx.shake(this.config.feel.shake.bomb);
    this.fx.hitStop(40);
    this.audio.play('bomb');

    for (var i = this.enemies.pool.live - 1; i >= 0; i--) {
      var e = this.enemies.pool.at(i);
      if (e.delayMs > 0) continue;
      if (this.enemies.hit(e, 14)) this.killEnemy(e, i);
    }
    if (this.boss.active()) this.damageBoss(60);
  };

  /* ---- pickups --------------------------------------------------------------- */

  World.prototype.collect = function (p) {
    var cfg = this.config.pickups;
    var P = this.config.palette;
    var label = null;

    this.fx.pickupBurst(p.x, p.y, p.color);
    this.fx.hudPulse(p.color);
    this.audio.play(p.kind === 'weapon' || p.kind === 'missile' ? 'upgrade' : 'pickup');

    switch (p.kind) {
      case 'weapon':
        label = this.weapons.upgradeMain();
        if (!label) { this.score += 1500; label = 'WEAPON MAX  +1500'; }
        break;
      case 'missile':
        label = this.weapons.upgradeModule();
        if (!label) { this.score += 1200; label = 'MODULES MAX  +1200'; }
        break;
      case 'shield':
        this.player.shield = Math.min(3, this.player.shield + 1);
        label = 'SHIELD UP';
        break;
      case 'rapid':
        this.weapons.setRapid(cfg.rapidMs);
        label = 'RAPID FIRE';
        break;
      case 'multi':
        this.multiplier = 2;
        this.multiplierMs = cfg.multiplierMs;
        label = 'SCORE x2';
        break;
      case 'magnet':
        this.magnetMs = cfg.magnetMs;
        label = 'MAGNET';
        break;
      case 'bomb':
        this.player.addBomb();
        label = 'BOMB +1';
        break;
      case 'broadside':
        this.weapons.fireBroadside(this, this.player);
        label = 'SIDE BARRAGE';
        break;
      case 'nova':
        this.detonateBomb();
        label = 'NOVA BOMB';
        break;
    }

    /* The message appears over live combat and never pauses it. */
    if (label) this.fx.banner(label, p.kind === 'weapon' ? P.plasma : p.color, cfg.bannerMs);
    this.onEvent('pickup', { kind: p.kind, label: label });
  };

  /* ---- end ------------------------------------------------------------------- */

  World.prototype.endRun = function () {
    this.state = 'gameover';
    this.onEvent('gameover', this.stats());
  };

  World.prototype.stats = function () {
    return {
      score: this.score,
      stage: this.director.stage + 1,
      kills: this.kills,
      combo: this.bestCombo,
      tier: this.weapons.tier,
      timeMs: Math.round(this.simTime)
    };
  };

  global.GG = global.GG || {};
  global.GG.World = World;
  global.GG.BULLET_KINDS = BULLET_KINDS;
})(window);
