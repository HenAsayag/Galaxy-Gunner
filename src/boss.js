/* Boss encounters.
 *
 * A boss occupies roughly a third of the screen width and stays in the upper
 * half, sliding on a slow lateral track so the player always has room to
 * dodge downward. It runs a script of telegraphed attacks that tightens as its
 * health falls, and every phase break opens the core for a punish window.
 *
 * Destruction is a sequence, not an event: internal detonations for two to
 * four seconds, then a final flash and shockwave.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Patterns = global.GG.patterns;

  /* Three encounters, cycled by stage. Each phase lists the attacks it may use
   * and how hard it leans on them. */
  var ENCOUNTERS = [
    {
      sprite: 'boss1', accent: '#ff7a1a', hp: 620, width: 150,
      phases: [
        { at: 1.00, attacks: ['bossFan', 'bossAimedRake'], gapMs: 1500, sway: 0.38 },
        { at: 0.62, attacks: ['bossFan', 'bossMissiles', 'columns'], gapMs: 1250, sway: 0.55 },
        { at: 0.28, attacks: ['bossRadial', 'bossAimedRake', 'bossMissiles'], gapMs: 950, sway: 0.75, adds: true }
      ]
    },
    {
      sprite: 'boss2', accent: '#49b6ff', hp: 900, width: 160,
      phases: [
        { at: 1.00, attacks: ['bossAimedRake', 'blueArc'], gapMs: 1400, sway: 0.45 },
        { at: 0.66, attacks: ['bossRadial', 'greenWall'], gapMs: 1150, sway: 0.6, lasers: true },
        { at: 0.30, attacks: ['bossFan', 'bossMissiles', 'bossRadial'], gapMs: 880, sway: 0.85, adds: true, lasers: true }
      ]
    },
    {
      sprite: 'boss3', accent: '#c86bff', hp: 1180, width: 168,
      phases: [
        { at: 1.00, attacks: ['bossRadial', 'bossFan'], gapMs: 1300, sway: 0.5 },
        { at: 0.68, attacks: ['bossAimedRake', 'greenWall', 'bossMissiles'], gapMs: 1050, sway: 0.7, lasers: true },
        { at: 0.32, attacks: ['bossRadial', 'bossFan', 'bossAimedRake'], gapMs: 780, sway: 0.95, adds: true, lasers: true }
      ]
    }
  ];

  function Boss(config, world) {
    this.config = config;
    this.world = world;
    this.state = 'gone';
    this.enc = null;
  }

  Boss.prototype.active = function () {
    return this.state === 'entering' || this.state === 'fighting';
  };

  Boss.prototype.spawn = function (stageIndex, hpScale) {
    var enc = ENCOUNTERS[stageIndex % ENCOUNTERS.length];
    this.enc = enc;
    this.sprite = enc.sprite;
    this.accent = enc.accent;
    this.width = enc.width;
    this.r = enc.width * 0.30;
    this.coreR = enc.width * 0.16;
    this.maxHp = Math.round(enc.hp * (hpScale || 1));
    this.hp = this.maxHp;
    this.x = this.world.worldW / 2;
    this.y = -enc.width * 0.5;
    this.targetY = this.world.worldH * 0.22;
    this.swayT = 0;
    this.phaseIndex = 0;
    this.phase = enc.phases[0];
    this.attackTimer = 2000;
    this.attackIndex = 0;
    this.pattern = null;
    this.volleysLeft = 0;
    this.volleyTimer = 0;
    this.volleyIndex = 0;
    this.telegraphMs = 0;
    this.flashMs = 0;
    this.coreOpenMs = 0;
    this.laserTimer = 3000;
    this.lasers = [];
    this.addsTimer = 4000;
    this.dieMs = 0;
    this.dieBurstMs = 0;
    this.state = 'entering';
  };

  Boss.prototype.update = function (dt) {
    if (this.state === 'gone') return;
    var world = this.world;
    var s = dt / 1000;
    this.flashMs = Math.max(0, this.flashMs - dt);

    if (this.state === 'dying') {
      this.updateDeath(dt);
      return;
    }

    if (this.state === 'entering') {
      this.y = M.approach(this.y, this.targetY, 0.55, s);
      if (Math.abs(this.y - this.targetY) < 2) this.state = 'fighting';
      return;
    }

    /* lateral track: a slow figure-of-eight so it is never predictable but
     * never leaves the upper half either */
    this.swayT += s * this.phase.sway;
    var span = (world.worldW - this.width) * 0.42;
    this.x = world.worldW / 2 + Math.sin(this.swayT) * span;
    this.y = this.targetY + Math.sin(this.swayT * 2) * 18;

    this.coreOpenMs = Math.max(0, this.coreOpenMs - dt);

    /* moving laser columns, phase 2 onward */
    if (this.phase.lasers) {
      this.laserTimer -= dt;
      if (this.laserTimer <= 0) {
        this.laserTimer = 3400;
        this.lasers.push({ x: this.x, age: 0, charge: 520, life: 1500, width: 26 });
      }
    }
    for (var i = this.lasers.length - 1; i >= 0; i--) {
      var L = this.lasers[i];
      L.age += dt;
      if (L.age > L.charge) {
        L.x = M.approach(L.x, world.player.x, 0.85, s);
        world.bossLaser(L.x, L.width, 1, this.accent, this.y);
      }
      if (L.age >= L.life) this.lasers.splice(i, 1);
    }

    if (this.phase.adds) {
      this.addsTimer -= dt;
      if (this.addsTimer <= 0) {
        this.addsTimer = 5200;
        world.spawnBossAdds(this.x);
      }
    }

    this.updateAttacks(dt);
  };

  Boss.prototype.updateAttacks = function (dt) {
    var world = this.world;

    if (this.telegraphMs > 0) {
      this.telegraphMs -= dt;
      if (this.telegraphMs <= 0) {
        this.volleysLeft = this.pattern.volleys || 1;
        this.volleyIndex = 0;
        this.volleyTimer = 0;
      }
      return;
    }

    if (this.volleysLeft > 0) {
      this.volleyTimer -= dt;
      if (this.volleyTimer <= 0) {
        this.pattern.fire(world, this, this.volleyIndex);
        this.volleyIndex++;
        this.volleysLeft--;
        this.volleyTimer = this.pattern.gapMs || 0;
        if (this.volleysLeft <= 0) this.attackTimer = this.phase.gapMs;
      }
      return;
    }

    this.attackTimer -= dt;
    if (this.attackTimer <= 0) {
      var list = this.phase.attacks;
      this.pattern = Patterns.get(list[this.attackIndex % list.length]);
      this.attackIndex++;
      /* Every large boss attack is telegraphed, without exception. */
      this.telegraphMs = 300;
      world.fx.telegraph(this.x, this.y + this.width * 0.3, 300, this.accent);
      world.audio.play('warn');
    }
  };

  /* Firing anchor: the muzzle row along the leading edge, not the centre. */
  Object.defineProperty(Boss.prototype, 'muzzleY', {
    get: function () { return this.y + this.width * 0.30; }
  });

  Boss.prototype.hit = function (damage) {
    if (this.state !== 'fighting') return false;
    /* The open core takes double: the punish window has to be worth taking. */
    this.hp -= this.coreOpenMs > 0 ? damage * 2 : damage;
    this.flashMs = 60;

    var frac = this.hp / this.maxHp;
    var next = this.enc.phases[this.phaseIndex + 1];
    if (next && frac <= next.at) {
      this.phaseIndex++;
      this.phase = next;
      this.coreOpenMs = 2600;
      this.attackTimer = 900;
      this.lasers.length = 0;
      this.world.onBossPhase(this);
    }

    if (this.hp <= 0) {
      this.state = 'dying';
      this.dieMs = 2800;
      this.dieBurstMs = 0;
      this.lasers.length = 0;
      return true;
    }
    return false;
  };

  Boss.prototype.updateDeath = function (dt) {
    var world = this.world;
    this.dieMs -= dt;
    this.dieBurstMs -= dt;
    this.y += dt / 1000 * 14;

    if (this.dieBurstMs <= 0) {
      this.dieBurstMs = 130 + Math.random() * 110;
      var rx = this.x + (Math.random() - 0.5) * this.width * 0.8;
      var ry = this.y + (Math.random() - 0.5) * this.width * 0.5;
      world.fx.explosion(rx, ry, 0.9 + Math.random() * 0.6, 'heavy');
      world.fx.shake(2.2);
      world.audio.play('boom_s');
    }

    if (this.dieMs <= 0) {
      world.fx.explosion(this.x, this.y, 3.2, 'elite');
      world.fx.shockwave(this.x, this.y, 4.5);
      world.fx.flash('#ffffff', 0.7);
      world.fx.shake(this.config.feel.shake.bomb);
      world.fx.hitStop(this.config.feel.hitStop.bossPhase);
      world.audio.play('boom_l');
      this.state = 'gone';
      world.onBossDestroyed(this);
    }
  };

  /* Core pulse, read by the renderer so an open core is unmistakable. */
  Boss.prototype.corePulse = function () {
    if (this.coreOpenMs <= 0) return 0;
    return 0.5 + 0.5 * Math.sin(this.coreOpenMs / 90);
  };

  global.GG = global.GG || {};
  global.GG.Boss = Boss;
  global.GG.BOSS_ENCOUNTERS = ENCOUNTERS;
})(window);
