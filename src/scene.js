/* Scene composition and HUD.
 *
 * Written once against the renderer interface that renderer-gl.js and
 * renderer-2d.js both implement, so the WebGL path and the Canvas fallback
 * cannot drift apart.
 *
 * Draw order is a readability decision, not an implementation detail:
 *
 *   background -> pickups -> enemies -> boss -> player -> trails ->
 *   PROJECTILES -> particles -> full-screen flash -> HUD
 *
 * Projectiles sit ABOVE every ship. In a screen this dense the one thing that
 * must never be occluded is the thing that kills you.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  /* ---- background ---------------------------------------------------------
   * Three star layers, a drifting rock layer and two soft nebula bands. Kept
   * deliberately low-contrast: the brief is explicit that the background must
   * never compete with the projectiles. */

  function Background(config) {
    this.config = config;
    this.stars = [];
    this.rocks = [];
    this.scroll = 0;
    this.count = 0;
  }

  Background.prototype.build = function (count, worldW, worldH) {
    if (this.count === count && this.stars.length) return;
    this.count = count;
    this.stars.length = 0;
    for (var i = 0; i < count; i++) {
      var depth = i % 3;
      this.stars.push({
        x: Math.random() * worldW,
        y: Math.random() * worldH,
        depth: depth,
        size: 0.18 + depth * 0.13 + Math.random() * 0.12,
        alpha: 0.22 + depth * 0.20
      });
    }
    this.rocks.length = 0;
    for (var r = 0; r < 7; r++) {
      this.rocks.push({
        x: Math.random() * worldW,
        y: Math.random() * worldH,
        size: 0.5 + Math.random() * 1.5,
        spin: (Math.random() - 0.5) * 0.25,
        rot: Math.random() * M.TAU,
        depth: Math.random()
      });
    }
  };

  /* Scroll implies forward flight; it is the only thing telling the player the
   * ship is moving, because the camera itself never does. */
  Background.prototype.update = function (dt, worldW, worldH) {
    var s = dt / 1000;
    this.scroll += s * 26;
    var i, o;
    for (i = 0; i < this.stars.length; i++) {
      o = this.stars[i];
      o.y += (14 + o.depth * 34) * s;
      if (o.y > worldH + 6) { o.y = -6; o.x = Math.random() * worldW; }
    }
    for (i = 0; i < this.rocks.length; i++) {
      o = this.rocks[i];
      o.y += (8 + o.depth * 20) * s;
      o.rot += o.spin * s;
      if (o.y > worldH + 70) {
        o.y = -70;
        o.x = Math.random() * worldW;
        o.size = 0.5 + Math.random() * 1.5;
      }
    }
  };

  Background.prototype.draw = function (r, layout) {
    var P = this.config.palette;
    var l = layout;
    var left = -l.offsetX;
    var right = l.worldW + l.offsetX;
    var width = right - left;

    /* two slow nebula bands, drawn additively at very low alpha */
    var band = (this.scroll * 0.18) % (l.worldH + 400) - 200;
    r.spriteScaled('glow', l.worldW * 0.28, band, width / 64 * 0.9, l.worldH / 64 * 0.7,
                   0, P.nebulaA, 0.30, 'add');
    r.spriteScaled('glow', l.worldW * 0.75, band - l.worldH * 0.65,
                   width / 64 * 0.8, l.worldH / 64 * 0.6, 0, P.nebulaB, 0.26, 'add');

    var i, o;
    for (i = 0; i < this.rocks.length; i++) {
      o = this.rocks[i];
      r.sprite('rock', o.x, o.y, o.size, o.rot, null, 0.12 + o.depth * 0.14, 'normal');
    }
    for (i = 0; i < this.stars.length; i++) {
      o = this.stars[i];
      r.sprite('star', o.x, o.y, o.size, 0, P.star, o.alpha, 'add');
    }

    /* haze: pulls the whole backdrop down a stop so neon reads on top of it */
    r.rect(left, 0, width, l.worldH, P.space, 0.28, 'normal');
  };

  /* ---- scene ---------------------------------------------------------------- */

  function Scene(config) {
    this.config = config;
    this.background = new Background(config);
    this.shake = { x: 0, y: 0 };
    this.drones = [];
    this.displayScore = 0;
  }

  Scene.prototype.setQuality = function (level) {
    var q = this.config.quality[level] || this.config.quality.high;
    this.background.build(q.stars, this.config.view.baseWidth, this.config.view.designHeight);
  };

  Scene.prototype.draw = function (r, world, fx, ui) {
    var l = r.layout;
    if (!l) return;
    var P = this.config.palette;

    this.background.build(this.background.count || this.config.quality.high.stars, l.worldW, l.worldH);
    if (!r.begin(P.space)) return;

    this.background.draw(r, l);

    fx.offset(this.shake);
    var ox = this.shake.x, oy = this.shake.y;

    this.drawPickups(r, world, ox, oy);
    this.drawEnemies(r, world, ox, oy);
    this.drawBoss(r, world, ox, oy);
    this.drawPlayer(r, world, ox, oy);
    this.drawParticles(r, fx.trails, ox, oy);
    this.drawBullets(r, world, ox, oy);
    this.drawParticles(r, fx.particles, ox, oy);

    if (fx.flashAlpha > 0.003) {
      r.rect(-l.offsetX, 0, l.worldW + l.offsetX * 2, l.worldH,
             fx.flashColor, fx.flashAlpha, 'add');
    }

    /* The canvas HUD belongs to a run. On the menus the DOM panel is the
     * interface, and a score sitting behind it just looks like a bug. */
    if (world.state !== 'idle') this.drawHud(r, world, fx, ui);
    r.end();
  };

  /* ---- entities --------------------------------------------------------------- */

  /* Two passes rather than glow-then-coin per pickup: every blend-mode change
   * flushes the batch, so interleaving them would cost two draw calls per
   * pickup instead of two for all of them. */
  Scene.prototype.drawPickups = function (r, world, ox, oy) {
    var pool = world.pickups.pool;
    var i, p;
    /* the glow is what makes them findable; it breathes out of phase with the
     * coin so the two never cancel */
    for (i = 0; i < pool.live; i++) {
      p = pool.at(i);
      r.sprite('glow', p.x + ox, p.y + oy, 0.72 * world.pickups.pulse(p), 0,
               p.color, 0.55 * world.pickups.alpha(p), 'add');
    }
    for (i = 0; i < pool.live; i++) {
      p = pool.at(i);
      r.sprite(p.sprite, p.x + ox, p.y + oy, world.pickups.pulse(p), 0,
               null, world.pickups.alpha(p), 'normal');
    }
  };

  /* Four passes for the same reason the particles get two: grouping by blend
   * mode keeps a screen of sixty enemies at four flushes instead of up to
   * three per enemy. */
  Scene.prototype.drawEnemies = function (r, world, ox, oy) {
    var pool = world.enemies.pool;
    var P = this.config.palette;
    var i, e, x, y;

    /* charge glow while telegraphing a dense attack */
    for (i = 0; i < pool.live; i++) {
      e = pool.at(i);
      if (e.delayMs > 0 || e.telegraphMs <= 0) continue;
      var t = 1 - e.telegraphMs / this.config.bullets.telegraphMs;
      r.sprite('glow', e.x + ox, e.y + oy, 0.9 + t * 0.7, 0,
               P.danger, 0.35 + t * 0.45, 'add');
    }

    for (i = 0; i < pool.live; i++) {
      e = pool.at(i);
      if (e.delayMs > 0) continue;
      r.sprite(e.sprite, e.x + ox, e.y + oy, e.scale, e.angle, null, 1, 'normal');
    }

    /* 50-80 ms emissive flash on every hit, so a shot that connects is never
     * ambiguous even when twelve of them land in the same second */
    for (i = 0; i < pool.live; i++) {
      e = pool.at(i);
      if (e.delayMs > 0 || e.flashMs <= 0) continue;
      r.sprite(e.sprite, e.x + ox, e.y + oy, e.scale, e.angle,
               '#ffffff', (e.flashMs / 70) * 0.9, 'add');
    }

    /* health bar only where it matters: heavies and elites */
    for (i = 0; i < pool.live; i++) {
      e = pool.at(i);
      if (e.delayMs > 0 || !e.heavy || e.hp >= e.maxHp) continue;
      x = e.x + ox; y = e.y + oy;
      var w = e.r * 2.2;
      var frac = M.clamp01(e.hp / e.maxHp);
      r.rect(x - w / 2, y - e.r - 9, w, 3, '#000000', 0.55, 'normal');
      r.rect(x - w / 2, y - e.r - 9, w * frac, 3,
             frac > 0.4 ? P.enemyBolt : P.danger, 0.95, 'normal');
    }
  };

  Scene.prototype.drawBoss = function (r, world, ox, oy) {
    var boss = world.boss;
    if (boss.state === 'gone') return;
    var x = boss.x + ox, y = boss.y + oy;
    var scale = boss.width / 190;

    /* laser columns: charge line first, then the live beam */
    for (var i = 0; i < boss.lasers.length; i++) {
      var L = boss.lasers[i];
      var charging = L.age < L.charge;
      var w = charging ? 0.18 : 1;
      var alpha = charging ? 0.35 + 0.35 * Math.sin(L.age / 40) : 0.95;
      var h = r.layout.worldH;
      r.spriteScaled('beam', L.x + ox, h / 2,
                     (L.width / 16) * w, h / 64, 0, boss.accent, alpha, 'add');
    }

    r.sprite(boss.sprite, x, y, scale, 0, null, 1, 'normal');

    if (boss.flashMs > 0) {
      r.sprite(boss.sprite, x, y, scale, 0, '#ffffff', (boss.flashMs / 60) * 0.7, 'add');
    }

    /* The open-core window is signalled by a ring, not by a bigger bloom: a
     * bloom just hides the target the player is meant to be aiming at. */
    var pulse = boss.corePulse();
    if (pulse > 0) {
      var coreY = y - boss.width * 0.03;
      r.sprite('glow', x, coreY, 0.55 + pulse * 0.25, 0,
               '#ffffff', 0.30 + pulse * 0.28, 'add');
      r.sprite('ring', x, coreY, 0.55 + pulse * 0.55, 0, boss.accent, 0.85, 'add');
      r.sprite('ring', x, coreY, 0.40, 0, '#ffffff', 0.35 + pulse * 0.3, 'add');
    }
  };

  Scene.prototype.drawPlayer = function (r, world, ox, oy) {
    var p = world.player;
    var w = world.weapons;
    var P = this.config.palette;
    if (!p.alive && p.respawnMs <= 0 && world.state === 'gameover') return;
    var alpha = p.alpha();
    if (alpha <= 0.01) return;

    var x = p.x + ox, y = p.y + oy;

    /* active beams sit under the ship so the hull stays readable */
    if (w.dwell) {
      var d = w.dwell;
      var k = 1 - d.age / d.life;
      var h = y;
      if (d.kind === 'side') {
        [-20, 20].forEach(function (off) {
          r.spriteScaled('beam', x + off, h / 2, (d.width / 16) * k, h / 64, 0,
                         d.color, 0.85 * k, 'add');
        });
      } else {
        r.spriteScaled(d.kind === 'lance' ? 'beam_blue' : 'beam', x, h / 2,
                       (d.width / 16) * k, h / 64, 0, d.color, 0.9 * k, 'add');
      }
    }

    /* orbiting drones, drawn even between shots so the module is visible */
    w.dronePositions(p, this.drones);
    for (var i = 0; i < this.drones.length; i++) {
      var dp = this.drones[i];
      r.sprite('glow', dp.x + ox, dp.y + oy, 0.35, 0, P.playerBolt, 0.6 * alpha, 'add');
      r.sprite('bolt_s', dp.x + ox, dp.y + oy, 1.1, 0, null, alpha, 'normal');
    }

    /* engine bloom scales with the weapon tier - the max-weapon energy trail */
    var bloom = 0.42 + w.tier * 0.06;
    r.sprite('glow', x, y + 20, bloom, 0, P.engine, 0.55 * alpha, 'add');
    if (w.tier >= 5) {
      r.sprite('glow', x, y + 34, bloom * 1.3, 0, P.playerBolt, 0.22 * alpha, 'add');
    }

    r.sprite('player' + M.clamp(w.tier, 1, 6), x, y, 1, p.bank, null, alpha, 'normal');

    if (p.damageFlashMs > 0) {
      r.sprite('player' + M.clamp(w.tier, 1, 6), x, y, 1, p.bank, '#ffffff',
               p.damageFlashMs / this.config.player.damageFlashMs, 'add');
    }

    if (p.shield > 0) {
      var breathe = 1 + Math.sin(world.simTime / 260) * 0.05;
      r.sprite('shield_ring', x, y, 0.62 * breathe, 0, null,
               (0.35 + 0.18 * p.shield) * alpha, 'add');
    }

    if (this.config.debug.hitboxes) {
      r.sprite('ring', x, y, (p.hitRadius * 2) / 96, 0, '#ff0000', 0.9, 'normal');
    }
  };

  Scene.prototype.drawBullets = function (r, world, ox, oy) {
    var i, b, pool;

    pool = world.enemyBullets;
    for (i = 0; i < pool.live; i++) {
      b = pool.at(i);
      r.sprite(b.sprite, b.x + ox, b.y + oy, 1, b.angle, b.color, 1, 'normal');
    }

    pool = world.playerBullets;
    for (i = 0; i < pool.live; i++) {
      b = pool.at(i);
      r.sprite(b.sprite, b.x + ox, b.y + oy, 1, b.angle, b.color, 1, 'add');
    }
  };

  /* Smoke and debris blend normally, everything else additively. Drawing them
   * in one interleaved loop would flip the blend mode - and so flush the whole
   * batch - several times per explosion, which is exactly the kind of cost
   * that shows up only once the screen is full. Two passes keep it at two
   * flushes no matter how many particles are live, and the order is the one
   * the look wants anyway: soot behind fire. */
  Scene.prototype.drawParticles = function (r, pool, ox, oy) {
    this.drawParticlePass(r, pool, ox, oy, 'normal');
    this.drawParticlePass(r, pool, ox, oy, 'add');
  };

  Scene.prototype.drawParticlePass = function (r, pool, ox, oy, blend) {
    for (var i = 0; i < pool.live; i++) {
      var p = pool.at(i);
      if (p.blend !== blend) continue;
      var t = p.age / p.life;
      var scale = M.lerp(p.s0, p.s1, t);
      if (scale <= 0.001) continue;
      var alpha = M.lerp(p.a0, p.a1, t);
      if (alpha <= 0.004) continue;
      r.sprite(p.sprite, p.x + ox, p.y + oy, scale, p.rot, p.color, alpha, blend);
    }
  };

  /* ---- HUD -------------------------------------------------------------------
   * Compact, per the reference: a large white score near the upper centre, a
   * small icon row, and nothing boxed. Everything else stays out of the way. */

  Scene.prototype.drawHud = function (r, world, fx, ui) {
    var l = r.layout;
    var P = this.config.palette;
    var top = l.hudTop;

    /* pickup tint across the HUD strip */
    if (fx.hudFlash > 0.01) {
      r.rect(-l.offsetX, 0, l.worldW + l.offsetX * 2, top + 80,
             fx.hudFlashColor, fx.hudFlash * 0.16, 'add');
    }

    /* score: the count-up chases the authoritative value and always converges */
    r.drawText(String(Math.round(this.displayScore)), 'score',
               l.worldW / 2, top + 24, P.white, 1, 0);

    /* stage / wave label, small and to the right */
    r.drawText(world.stageLabel, 'label', l.worldW - 14, top + 52, P.hullLight, 0.75, 1);

    /* lives, capped at the configured maximum so the row can never run under
     * the score or off the edge */
    var lives = Math.min(world.player.lives, this.config.player.maxLives);
    for (var i = 0; i < lives; i++) {
      r.sprite('ui_life', 18 + i * 22, top + 6, 0.85, 0, null, 1, 'normal');
    }
    if (world.player.lives > lives) {
      r.drawText('+' + (world.player.lives - lives), 'label',
                 18 + lives * 22, top + 6, P.white, 0.9, -1);
    }

    /* shield pips under the lives */
    for (var s = 0; s < world.player.shield; s++) {
      r.sprite('pu_shield', 18 + s * 17, top + 26, 0.48, 0, null, 0.95, 'normal');
    }

    /* Weapon tier pips, bottom-left. The bomb count is NOT drawn here: the
     * on-screen bomb button carries its own badge, and the right-hand corner
     * belongs to that button - pips drawn there ended up underneath it. */
    var pipY = l.worldH - 26 - l.bottomInset;
    for (var t = 0; t < this.config.weapons.maxTier; t++) {
      var on = t < world.weapons.tier;
      r.rect(18 + t * 9, pipY, 6, 10,
             on ? P.playerBolt : P.hullDark, on ? 0.95 : 0.5, 'normal');
    }

    /* multiplier, only while it is running */
    if (world.multiplierMs > 0) {
      r.drawText('x' + world.multiplier, 'label', 14, top + 52, P.gold, 0.95, -1);
    }

    /* stage progress, a single hairline under the score */
    var progress = world.director.intensity();
    var barW = l.worldW * 0.42;
    r.rect(l.worldW / 2 - barW / 2, top + 62, barW, 2, P.hullDark, 0.6, 'normal');
    r.rect(l.worldW / 2 - barW / 2, top + 62, barW * progress, 2,
           world.boss.active() ? P.danger : P.cockpit, 0.9, 'normal');

    /* boss health, full width just under the HUD */
    if (world.boss.active()) {
      var frac = M.clamp01(world.boss.hp / world.boss.maxHp);
      r.rect(20, top + 72, l.worldW - 40, 5, '#000000', 0.6, 'normal');
      r.rect(20, top + 72, (l.worldW - 40) * frac, 5, P.danger, 0.95, 'normal');
      r.drawText('BOSS', 'label', l.worldW - 20, top + 88, P.danger, 0.9, 1);
    }

    this.drawFloatingText(r, world, fx);
  };

  Scene.prototype.drawFloatingText = function (r, world, fx) {
    var l = r.layout;
    var i;

    /* score popups, in world space so they read as belonging to the kill */
    for (i = 0; i < fx.popups.live; i++) {
      var p = fx.popups.at(i);
      var t = p.age / p.life;
      var alpha = t < 0.12 ? t / 0.12 : 1 - Math.max(0, (t - 0.55) / 0.45);
      r.drawText(p.text, 'label',
                 M.clamp(p.x, 24, l.worldW - 24), p.y - p.rise,
                 p.color, M.clamp01(alpha), 0);
    }

    /* the big upgrade message: upper-middle, scaled, never pauses anything */
    for (i = 0; i < fx.banners.live; i++) {
      var b = fx.banners.at(i);
      var st = fx.bannerState(b);
      var y = l.worldH * 0.34;
      r.drawText(b.text, 'banner', l.worldW / 2, y, b.color, st.alpha, 0, st.scale);
    }
  };

  global.GG = global.GG || {};
  global.GG.Scene = Scene;
  global.GG.Background = Background;
})(window);
