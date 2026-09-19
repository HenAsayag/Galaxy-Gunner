/* WeaponController - the auto-fire ladder and the secondary modules.
 *
 * The brief is explicit that an upgrade must never be an invisible damage
 * multiplier. Every tier in config.weapons.tiers changes the PORT LIST - the
 * number of muzzles, where they sit and which way they point - plus the bolt
 * sprite, the cadence and the muzzle-flash scale. Tier 6 additionally adds a
 * periodic high-damage centre lance.
 *
 * Auto-fire is always on while the run is live. There is no fire button.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  function Weapons(config) {
    this.config = config;
    this.reset();
  }

  Weapons.prototype.reset = function () {
    this.tier = 1;
    this.moduleLevel = 0;                 /* 0 = no secondary yet */
    this.moduleIndex = 0;
    this.mainTimer = 0;
    this.moduleTimer = 0;
    this.lanceTimer = 0;
    this.rapidMs = 0;
    this.dwell = null;                    /* active beam, if any */
    this.droneAngle = 0;
  };

  Weapons.prototype.spec = function () {
    return this.config.weapons.tiers[M.clamp(this.tier, 1, this.config.weapons.maxTier) - 1];
  };

  Weapons.prototype.moduleName = function () {
    var order = this.config.weapons.moduleOrder;
    return order[Math.min(this.moduleIndex, order.length - 1)];
  };

  Weapons.prototype.moduleSpec = function () {
    return this.config.weapons.modules[this.moduleName()];
  };

  /* ---- upgrades ----------------------------------------------------------- */

  /* Returns the banner text, or null when the pickup only tops something up. */
  Weapons.prototype.upgradeMain = function () {
    if (this.tier >= this.config.weapons.maxTier) return null;
    this.tier++;
    return 'WEAPON UPGRADE';
  };

  /* The missile pickup both unlocks a secondary and, once unlocked, rotates to
   * the next module - which is how the reference clip's weapon variety shows
   * up inside a single run. */
  Weapons.prototype.upgradeModule = function () {
    var order = this.config.weapons.moduleOrder;
    if (this.moduleLevel === 0) {
      this.moduleLevel = 1;
      this.moduleIndex = 0;
    } else if (this.moduleLevel < 3) {
      this.moduleLevel++;
    } else if (this.moduleIndex < order.length - 1) {
      this.moduleIndex++;
      this.moduleLevel = 1;
    } else {
      return null;
    }
    this.moduleTimer = 0;
    return this.moduleSpec().label;
  };

  Weapons.prototype.setRapid = function (ms) { this.rapidMs = Math.max(this.rapidMs, ms); };

  /* ---- firing --------------------------------------------------------------
   * `world` supplies spawnPlayerBullet / spawnMissile / beam and the VFX hooks.
   * Timers are driven by the simulation clock, so pause freezes them. */

  Weapons.prototype.update = function (dt, world, player) {
    this.rapidMs = Math.max(0, this.rapidMs - dt);
    if (!player.active() || player.spawnInMs > 0) return;

    var spec = this.spec();
    var rapid = this.rapidMs > 0 ? this.config.weapons.rapidFactor : 1;

    this.mainTimer -= dt;
    if (this.mainTimer <= 0) {
      this.mainTimer += spec.intervalMs * rapid;
      if (this.mainTimer < -spec.intervalMs) this.mainTimer = 0;  /* after a stall */
      this.fireMain(world, player, spec);
    }

    if (spec.lanceEveryMs) {
      this.lanceTimer -= dt;
      if (this.lanceTimer <= 0) {
        this.lanceTimer += spec.lanceEveryMs;
        this.fireLance(world, player, spec);
      }
    }

    if (this.moduleLevel > 0) {
      var mod = this.moduleSpec();
      this.moduleTimer -= dt;
      if (this.moduleTimer <= 0) {
        this.moduleTimer += mod.intervalMs;
        this.fireModule(world, player, mod);
      }
    }

    if (this.dwell) {
      this.dwell.age += dt;
      if (this.dwell.age >= this.dwell.life) this.dwell = null;
    }

    this.droneAngle += dt / 1000 * 3.4;
  };

  Weapons.prototype.fireMain = function (world, player, spec) {
    var damage = spec.damage * (1 + (this.tier - 1) * 0.05);
    for (var i = 0; i < spec.ports.length; i++) {
      var port = spec.ports[i];
      /* Ports ride the bank, so the whole spread rolls with the ship. */
      var co = Math.cos(player.bank), si = Math.sin(player.bank);
      var px = player.x + port.x * co - port.y * si;
      var py = player.y + port.x * si + port.y * co;
      var a = port.a + player.bank * 0.35;
      world.spawnPlayerBullet(px, py,
        Math.sin(a) * spec.speed, -Math.cos(a) * spec.speed,
        spec.bolt, damage);
      world.fx.muzzle(px, py, spec.muzzle, this.config.palette.playerBoltHot);
    }
    world.audio.play(this.tier >= 4 ? 'shot_big' : 'shot');
  };

  /* Tier 6 only: a wide, brief, high-damage centre beam. */
  Weapons.prototype.fireLance = function (world, player, spec) {
    this.dwell = {
      kind: 'lance', age: 0, life: 170,
      x: player.x, y: player.y, width: 26, color: this.config.palette.playerBolt
    };
    world.beamDamage(player.x, 26, spec.lanceDamage, this.config.palette.playerBoltHot);
    world.fx.muzzle(player.x, player.y - 22, 2.0, this.config.palette.playerBoltHot);
    world.audio.play('laser');
  };

  Weapons.prototype.fireModule = function (world, player, mod) {
    var level = this.moduleLevel;
    var name = this.moduleName();
    var P = this.config.palette;

    switch (name) {
      case 'missiles': {
        var n = mod.count + (level - 1);
        for (var i = 0; i < n; i++) {
          var side = i % 2 === 0 ? -1 : 1;
          var lane = Math.floor(i / 2);
          world.spawnMissile(player.x + side * (14 + lane * 8), player.y - 4,
            side * 150, -220, mod.damage * level, mod);
        }
        world.audio.play('missile');
        break;
      }
      case 'sidelaser': {
        this.dwell = { kind: 'side', age: 0, life: mod.dwellMs, x: player.x, y: player.y,
                       width: 10, color: P.laser };
        world.beamDamage(player.x - 20, 10, mod.damage * level, P.laser);
        world.beamDamage(player.x + 20, 10, mod.damage * level, P.laser);
        world.audio.play('laser');
        break;
      }
      case 'pierce': {
        this.dwell = { kind: 'pierce', age: 0, life: mod.dwellMs, x: player.x, y: player.y,
                       width: 18 + level * 4, color: P.laser };
        world.beamDamage(player.x, 18 + level * 4, mod.damage * level, P.laser);
        world.audio.play('laser');
        break;
      }
      case 'plasma': {
        var count = mod.count + (level - 1) * 2;
        for (var k = 0; k < count; k++) {
          var a = (k - (count - 1) / 2) * 0.24;
          world.spawnPlayerBullet(player.x, player.y - 12,
            Math.sin(a) * mod.speed, -Math.cos(a) * mod.speed,
            'orb_green', mod.damage * level, { blast: mod.blast, color: P.plasma });
        }
        world.audio.play('shot_big');
        break;
      }
      case 'chain': {
        world.chainLightning(player.x, player.y - 16, mod.jumps + level - 1,
                             mod.range, mod.damage * level);
        world.audio.play('laser');
        break;
      }
      case 'drones': {
        for (var d = 0; d < 2; d++) {
          var ang = this.droneAngle + d * Math.PI;
          var dx = player.x + Math.cos(ang) * mod.orbit;
          var dy = player.y + Math.sin(ang) * mod.orbit * 0.5 - 4;
          world.spawnPlayerBullet(dx, dy, 0, -mod.speed, 'bolt_s', mod.damage * level);
          world.fx.muzzle(dx, dy, 0.6, P.playerBolt);
        }
        world.audio.play('shot');
        break;
      }
      case 'rockets': {
        var rockets = 1 + Math.floor(level / 2);
        for (var r = 0; r < rockets; r++) {
          var off = (r - (rockets - 1) / 2) * 20;
          world.spawnMissile(player.x + off, player.y - 10, off * 6, -mod.speed,
            mod.damage * level, { turnRate: 2.2, acquireMs: 260, speed: mod.speed,
                                  blast: mod.blast, sprite: 'rocket' });
        }
        world.audio.play('missile');
        break;
      }
    }
  };

  /* Drone escorts are drawn even between shots, so the module is visible. */
  Weapons.prototype.dronePositions = function (player, out) {
    out.length = 0;
    if (this.moduleLevel === 0 || this.moduleName() !== 'drones') return out;
    var mod = this.moduleSpec();
    for (var d = 0; d < 2; d++) {
      var ang = this.droneAngle + d * Math.PI;
      out.push({
        x: player.x + Math.cos(ang) * mod.orbit,
        y: player.y + Math.sin(ang) * mod.orbit * 0.5 - 4
      });
    }
    return out;
  };

  global.GG = global.GG || {};
  global.GG.Weapons = Weapons;
})(window);
