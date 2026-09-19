/* VFXPool, TrailPool, hit-stop, camera impulse and the floating text layer.
 *
 * This module owns TIMING AND STATE ONLY. It holds no drawing code and no
 * reference to a canvas, so both renderer backends read the same pools and
 * present them the same way - the arrangement the previous build used, kept
 * because it is what stopped the two paths from drifting apart.
 *
 * It is driven by the SIMULATION clock, so it freezes with pause and it
 * honours the reduced-motion / reduced-flash settings.
 *
 * Every particle comes from a pool. The only allocation during a run is the
 * one-off growth of a pool towards its ceiling.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Pool = global.GG.Pool;

  function newParticle() {
    return {
      x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1,
      s0: 1, s1: 1, rot: 0, spin: 0, drag: 0,
      sprite: 'spark', color: '#ffffff', blend: 'add', a0: 1, a1: 0
    };
  }

  function newBanner() {
    return { text: '', color: '#ffffff', age: 0, life: 800, y: 0, size: 'banner' };
  }

  function newPopup() {
    return { text: '', color: '#ffffff', age: 0, life: 620, x: 0, y: 0, rise: 0 };
  }

  function Effects(config) {
    this.config = config;
    this.reducedMotion = false;
    this.reducedFlash = false;

    var q = config.quality.high;
    this.particles = new Pool(newParticle, null, q.particles);
    this.trails = new Pool(newParticle, null, q.particles);
    this.banners = new Pool(newBanner, null, 4);
    this.popups = new Pool(newPopup, null, 24);

    this.clear();
  }

  Effects.prototype.clear = function () {
    this.clock = 0;
    this.particles.clear();
    this.trails.clear();
    this.banners.clear();
    this.popups.clear();
    this.shakeAmount = 0;
    this.shakeAge = 0;
    this.shakeSeed = 0;
    this.hitStopMs = 0;
    this.flashAlpha = 0;
    this.flashColor = '#ffffff';
    this.hudFlash = 0;
    this.hudFlashColor = '#5dff7a';
  };

  /* The quality level resizes the ceilings at runtime; no reallocation. */
  Effects.prototype.applyQuality = function (level) {
    var q = this.config.quality[level] || this.config.quality.high;
    this.particles.setCapacity(q.particles);
    this.trails.setCapacity(Math.round(q.particles * 0.8));
    this.additive = q.additive;
    this.sparkBudget = q.sparks;
    this.trailSamples = q.trailSamples;
  };

  /* ---- primitives --------------------------------------------------------- */

  Effects.prototype.particle = function (sprite, x, y, opts) {
    var p = this.particles.obtain();
    if (!p) return null;                 /* budget spent: drop it, never stall */
    p.sprite = sprite;
    p.x = x; p.y = y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.age = 0; p.life = opts.life || 400;
    p.s0 = opts.s0 === undefined ? 1 : opts.s0;
    p.s1 = opts.s1 === undefined ? p.s0 : opts.s1;
    p.a0 = opts.a0 === undefined ? 1 : opts.a0;
    p.a1 = opts.a1 === undefined ? 0 : opts.a1;
    p.rot = opts.rot || 0;
    p.spin = opts.spin || 0;
    p.drag = opts.drag === undefined ? 0.9 : opts.drag;
    p.color = opts.color || '#ffffff';
    p.blend = opts.blend || (this.additive === false ? 'normal' : 'add');
    return p;
  };

  /* Trail samples live in their own pool so a burst of explosions can never
   * starve the missile trails, which are what make homing shots readable. */
  Effects.prototype.trail = function (sprite, x, y, opts) {
    var p = this.trails.obtain();
    if (!p) return null;
    p.sprite = sprite;
    p.x = x; p.y = y;
    p.vx = opts.vx || 0; p.vy = opts.vy || 0;
    p.age = 0; p.life = opts.life || 260;
    p.s0 = opts.s0 || 0.5; p.s1 = opts.s1 === undefined ? 0 : opts.s1;
    p.a0 = opts.a0 === undefined ? 0.85 : opts.a0;
    p.a1 = 0;
    p.rot = opts.rot || 0; p.spin = 0;
    p.drag = 0.86;
    p.color = opts.color || '#ffffff';
    p.blend = this.additive === false ? 'normal' : 'add';
    return p;
  };

  /* ---- composite effects --------------------------------------------------
   * The VFX language from the brief, one method per entry so the gameplay code
   * never has to assemble a look by hand. */

  /* Standard kill: emissive flash, warm burst, a few sparks, a fragment. */
  Effects.prototype.explosion = function (x, y, scale, kind) {
    var P = this.config.palette;
    scale = scale || 1;
    var heavy = kind === 'heavy' || kind === 'elite';

    /* 50-80 ms flash */
    this.particle('flare', x, y, {
      life: heavy ? 90 : 70, s0: 0.32 * scale, s1: 0.95 * scale,
      color: P.blastHot, a0: 1, a1: 0, drag: 1
    });
    /* core blast */
    this.particle('glow', x, y, {
      life: heavy ? 340 : 240, s0: 0.30 * scale, s1: 1.25 * scale,
      color: P.blast, a0: 1, a1: 0, drag: 1
    });
    if (heavy) {
      /* two-stage: the second bloom lands a beat later and reads as a
       * secondary detonation rather than one bigger puff */
      this.particle('glow', x, y, {
        life: 460, s0: 0.15 * scale, s1: 1.7 * scale,
        color: P.enemyBolt, a0: 0.85, a1: 0, drag: 1
      });
      this.shockwave(x, y, scale * (kind === 'elite' ? 1.5 : 1.1));
      this.smoke(x, y, scale);
    }

    var sparks = Math.round((this.sparkBudget || 8) * (heavy ? 1.4 : 1));
    for (var i = 0; i < sparks; i++) {
      var a = Math.random() * M.TAU;
      var sp = (120 + Math.random() * 260) * scale;
      this.particle('spark', x, y, {
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
        life: 240 + Math.random() * 220,
        s0: 0.45 * scale, s1: 0.06,
        color: Math.random() < 0.4 ? P.blastHot : P.blast,
        drag: 0.86
      });
    }

    var frags = heavy ? 5 : 2;
    for (var f = 0; f < frags; f++) {
      var fa = Math.random() * M.TAU;
      var fs = (80 + Math.random() * 170) * scale;
      this.particle('debris', x, y, {
        vx: Math.cos(fa) * fs, vy: Math.sin(fa) * fs,
        life: 420 + Math.random() * 320,
        s0: 0.7 * scale, s1: 0.35 * scale,
        rot: Math.random() * M.TAU, spin: (Math.random() - 0.5) * 9,
        color: '#ffffff', blend: 'normal', drag: 0.9
      });
    }
  };

  Effects.prototype.shockwave = function (x, y, scale) {
    this.particle('ring', x, y, {
      life: 340, s0: 0.12 * scale, s1: 1.5 * scale,
      color: this.config.palette.blastHot, a0: 0.8, a1: 0, drag: 1
    });
  };

  Effects.prototype.smoke = function (x, y, scale) {
    for (var i = 0; i < 3; i++) {
      this.particle('smoke', x + (Math.random() - 0.5) * 16 * scale,
                             y + (Math.random() - 0.5) * 16 * scale, {
        vx: (Math.random() - 0.5) * 40, vy: -20 - Math.random() * 30,
        life: 620 + Math.random() * 320,
        s0: 0.4 * scale, s1: 1.1 * scale,
        color: '#ffffff', blend: 'normal', a0: 0.5, drag: 0.95
      });
    }
  };

  /* Small bright contact flare where a bullet lands - the difference between
   * "shots pass through" and "shots connect". */
  Effects.prototype.hitFlash = function (x, y, color, scale) {
    this.particle('glow', x, y, {
      life: 130, s0: 0.10 * (scale || 1), s1: 0.42 * (scale || 1),
      color: color || this.config.palette.playerBoltHot, a0: 0.95, a1: 0, drag: 1
    });
    var sparks = Math.min(3, this.sparkBudget || 3);
    for (var i = 0; i < sparks; i++) {
      var a = Math.random() * M.TAU;
      this.particle('spark', x, y, {
        vx: Math.cos(a) * 130, vy: Math.sin(a) * 130,
        life: 150, s0: 0.24, s1: 0.02, color: color || '#ffffff', drag: 0.82
      });
    }
  };

  Effects.prototype.muzzle = function (x, y, scale, color) {
    this.particle('flare', x, y, {
      life: 70, s0: 0.10 * scale, s1: 0.34 * scale,
      color: color || this.config.palette.playerBoltHot, a0: 0.9, a1: 0, drag: 1
    });
  };

  Effects.prototype.pickupBurst = function (x, y, color) {
    this.particle('ring', x, y, {
      life: 300, s0: 0.08, s1: 0.65, color: color, a0: 0.9, a1: 0, drag: 1
    });
    for (var i = 0; i < 8; i++) {
      var a = (i / 8) * M.TAU;
      this.particle('spark', x, y, {
        vx: Math.cos(a) * 180, vy: Math.sin(a) * 180,
        life: 300, s0: 0.3, s1: 0.02, color: color, drag: 0.84
      });
    }
  };

  /* A 150-300 ms charge glow that tells the player a dense attack is coming. */
  Effects.prototype.telegraph = function (x, y, ms, color) {
    this.particle('ring', x, y, {
      life: ms, s0: 0.9, s1: 0.18, color: color || this.config.palette.danger,
      a0: 0.15, a1: 0.85, drag: 1
    });
  };

  /* ---- screen-level feedback ---------------------------------------------- */

  Effects.prototype.shake = function (amount) {
    if (this.reducedMotion || !amount) return;
    if (amount <= this.shakeAmount * (1 - M.clamp01(this.shakeAge / this.config.feel.shakeMs))) return;
    this.shakeAmount = amount;
    this.shakeAge = 0;
    this.shakeSeed = Math.random() * 100;
  };

  /* Tiny freeze on a big impact. Never used for a basic kill: the config sets
   * `normal` to 0 so a stream of small kills stays perfectly fluid. */
  Effects.prototype.hitStop = function (ms) {
    if (this.reducedMotion) return;
    if (ms > this.hitStopMs) this.hitStopMs = ms;
  };

  Effects.prototype.flash = function (color, alpha) {
    var peak = this.reducedFlash ? Math.min(alpha, 0.14) : alpha;
    if (peak > this.flashAlpha) {
      this.flashAlpha = peak;
      this.flashColor = color;
    }
  };

  /* Brief tint across the HUD strip, used for pickups. */
  Effects.prototype.hudPulse = function (color) {
    this.hudFlash = this.reducedFlash ? 0.18 : 0.55;
    this.hudFlashColor = color;
  };

  /* ---- text --------------------------------------------------------------- */

  /* Big centred message. Does NOT pause anything. */
  Effects.prototype.banner = function (text, color, ms) {
    var b = this.banners.obtain();
    if (!b) {                              /* replace the oldest instead */
      this.banners.releaseAt(0);
      b = this.banners.obtain();
      if (!b) return;
    }
    b.text = text;
    b.color = color || '#ffffff';
    b.age = 0;
    b.life = ms || this.config.pickups.bannerMs;
  };

  Effects.prototype.popup = function (text, x, y, color) {
    var p = this.popups.obtain();
    if (!p) return;
    p.text = text;
    p.x = x; p.y = y;
    p.color = color || '#ffffff';
    p.age = 0;
    p.life = 620;
  };

  /* ---- update -------------------------------------------------------------- */

  function stepParticles(pool, dt) {
    var s = dt / 1000;
    for (var i = pool.live - 1; i >= 0; i--) {
      var p = pool.at(i);
      p.age += dt;
      if (p.age >= p.life) { pool.releaseAt(i); continue; }
      p.x += p.vx * s;
      p.y += p.vy * s;
      if (p.drag !== 1) {
        var k = Math.pow(p.drag, dt / 16.667);
        p.vx *= k;
        p.vy *= k;
      }
      if (p.spin) p.rot += p.spin * s;
    }
  }

  Effects.prototype.update = function (dt) {
    if (!(dt > 0)) dt = 0;
    this.clock += dt;

    stepParticles(this.particles, dt);
    stepParticles(this.trails, dt);

    var i;
    for (i = this.banners.live - 1; i >= 0; i--) {
      var b = this.banners.at(i);
      b.age += dt;
      if (b.age >= b.life) this.banners.releaseAt(i);
    }
    for (i = this.popups.live - 1; i >= 0; i--) {
      var pu = this.popups.at(i);
      pu.age += dt;
      pu.rise = M.easeOutCubic(M.clamp01(pu.age / pu.life)) * 34;
      if (pu.age >= pu.life) this.popups.releaseAt(i);
    }

    this.shakeAge += dt;
    this.flashAlpha = Math.max(0, this.flashAlpha - dt / 180);
    this.hudFlash = Math.max(0, this.hudFlash - dt / 320);
  };

  /* Hit-stop is consumed by the main loop BEFORE the simulation advances, so
   * it must not be scaled by the simulation's own delta. */
  Effects.prototype.consumeHitStop = function (realDt) {
    if (this.hitStopMs <= 0) return 0;
    var used = Math.min(this.hitStopMs, realDt);
    this.hitStopMs -= used;
    return used;
  };

  /* ---- queries ------------------------------------------------------------- */

  /* Camera impulse in world units. Visual only; collision never sees it. */
  Effects.prototype.offset = function (out) {
    out = out || { x: 0, y: 0 };
    out.x = 0; out.y = 0;
    if (this.reducedMotion || this.shakeAmount <= 0) return out;
    var t = M.clamp01(this.shakeAge / this.config.feel.shakeMs);
    if (t >= 1) { this.shakeAmount = 0; return out; }
    var decay = (1 - t) * (1 - t);
    var a = this.shakeAmount * decay;
    out.x = Math.sin(this.shakeAge * 0.085 + this.shakeSeed) * a;
    out.y = Math.cos(this.shakeAge * 0.071 + this.shakeSeed) * a * 0.7;
    return out;
  };

  Effects.prototype.bannerState = function (b) {
    var t = M.clamp01(b.age / b.life);
    /* 0.8 -> 1.1 -> 1.0, exactly as specified for the upgrade message */
    var scale;
    if (t < 0.25) scale = M.lerp(0.8, 1.1, M.easeOutCubic(t / 0.25));
    else if (t < 0.45) scale = M.lerp(1.1, 1.0, (t - 0.25) / 0.2);
    else scale = 1;
    var alpha = t < 0.08 ? t / 0.08 : t > 0.78 ? 1 - (t - 0.78) / 0.22 : 1;
    return { scale: scale, alpha: M.clamp01(alpha) };
  };

  global.GG = global.GG || {};
  global.GG.Effects = Effects;
})(window);
