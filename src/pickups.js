/* PickupManager.
 *
 * Pickups drift down through live combat rather than appearing between waves.
 * Staying findable in a screen full of bullets is their whole design problem,
 * so each one carries three redundant cues: a saturated colour unique to its
 * family, a pulsing glow behind the coin, and a slow bob that makes it the
 * only thing on screen moving that way.
 *
 * Close to the ship they magnetise, which removes the "chased it into a
 * bullet" failure the genre is prone to.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Pool = global.GG.Pool;

  var KINDS = {
    weapon:  { sprite: 'pu_weapon',  color: '#5dff7a', label: 'WEAPON UPGRADE' },
    missile: { sprite: 'pu_missile', color: '#ff9a2a', label: null },
    shield:  { sprite: 'pu_shield',  color: '#49d8ff', label: 'SHIELD UP' },
    rapid:   { sprite: 'pu_rapid',   color: '#ffe14a', label: 'RAPID FIRE' },
    multi:   { sprite: 'pu_multi',   color: '#ffc23c', label: 'SCORE x2' },
    magnet:  { sprite: 'pu_magnet',  color: '#ff5c7a', label: 'MAGNET' },
    bomb:    { sprite: 'pu_bomb',    color: '#c86bff', label: 'BOMB +1' }
  };

  function newPickup() {
    return {
      kind: 'weapon', sprite: '', color: '#ffffff',
      x: 0, y: 0, vx: 0, vy: 0,
      age: 0, life: 9000, phase: 0, magnet: false, r: 16
    };
  }

  function Pickups(config, world) {
    this.config = config;
    this.world = world;
    this.pool = new Pool(newPickup, null, 24);
  }

  Pickups.prototype.clear = function () { this.pool.clear(); };

  Object.defineProperty(Pickups.prototype, 'count', {
    get: function () { return this.pool.live; }
  });

  /* Weighted roll over config.pickups.weights, biased by what the run needs:
   * a player still on tier 1 sees more weapon upgrades, a player at maximum
   * tier sees none at all. */
  Pickups.prototype.roll = function (state) {
    var weights = this.config.pickups.weights;
    var keys = Object.keys(weights);
    var total = 0;
    var adjusted = [];
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var w = weights[k];
      if (k === 'weapon') {
        if (state.tier >= this.config.weapons.maxTier) w = 0;
        else w *= 1 + (this.config.weapons.maxTier - state.tier) * 0.22;
      }
      if (k === 'shield' && state.shield > 1) w *= 0.4;
      if (k === 'bomb' && state.bombs >= this.config.player.maxBombs) w = 0;
      total += w;
      adjusted.push(w);
    }
    var pick = this.world.rng() * total;
    for (var j = 0; j < keys.length; j++) {
      pick -= adjusted[j];
      if (pick <= 0) return keys[j];
    }
    return 'weapon';
  };

  Pickups.prototype.spawn = function (x, y, kind) {
    var def = KINDS[kind];
    if (!def) return null;
    var p = this.pool.obtain();
    if (!p) return null;
    p.kind = kind;
    p.sprite = def.sprite;
    p.color = def.color;
    p.x = x;
    p.y = y;
    p.vx = (this.world.rng() - 0.5) * 40;
    p.vy = this.config.pickups.fallSpeed;
    p.age = 0;
    p.life = this.config.pickups.lifeMs;
    p.phase = this.world.rng() * Math.PI * 2;
    p.magnet = false;
    p.r = 15;
    return p;
  };

  Pickups.prototype.update = function (dt, player, magnetActive) {
    var cfg = this.config.pickups;
    var s = dt / 1000;
    var H = this.world.worldH;
    var W = this.world.worldW;
    var radius = magnetActive ? cfg.magnetRadiusBoosted : cfg.magnetRadius;

    for (var i = this.pool.live - 1; i >= 0; i--) {
      var p = this.pool.at(i);
      p.age += dt;
      p.phase += s * 3.2;

      var canCollect = player.active() && player.spawnInMs <= 0;

      if (canCollect && M.dist2(p.x, p.y, player.x, player.y) < radius * radius) {
        p.magnet = true;
      }

      if (p.magnet && canCollect) {
        /* accelerate into the ship, which is the whole "it pulls in" read */
        var dx = player.x - p.x, dy = player.y - p.y;
        var len = Math.sqrt(dx * dx + dy * dy) || 1;
        var speed = cfg.magnetSpeed;
        p.x += dx / len * speed * s;
        p.y += dy / len * speed * s;
      } else {
        p.magnet = false;
        p.x += p.vx * s + Math.sin(p.phase) * cfg.driftAmp * s;
        p.y += p.vy * s;
        if (p.x < 16) { p.x = 16; p.vx = Math.abs(p.vx); }
        if (p.x > W - 16) { p.x = W - 16; p.vx = -Math.abs(p.vx); }
      }

      if (canCollect && M.circlesHit(p.x, p.y, p.r, player.x, player.y, 18)) {
        this.world.collect(p);
        this.pool.releaseAt(i);
        continue;
      }

      if (p.y > H + 40 || p.age > p.life) this.pool.releaseAt(i);
    }
  };

  /* Bobbing scale and glow strength, read by the renderer. */
  Pickups.prototype.pulse = function (p) {
    return 1 + Math.sin(p.phase * 1.6) * 0.09;
  };

  /* Fade out over the last second rather than vanishing mid-screen. */
  Pickups.prototype.alpha = function (p) {
    var left = p.life - p.age;
    return left < 1000 ? M.clamp01(left / 1000) : 1;
  };

  global.GG = global.GG || {};
  global.GG.Pickups = Pickups;
  global.GG.PICKUP_KINDS = KINDS;
})(window);
