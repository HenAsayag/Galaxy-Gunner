/* PlayerController.
 *
 * The ship chases a target point rather than being set to it, with an
 * exponential approach tuned to the 0.10-0.16 s window from the brief. That is
 * what makes it feel direct but not twitchy, and because the approach is
 * frame-rate independent it feels the same at 60 and at 120 Hz.
 *
 * The collision radius is a fraction of the art. A bullet-hell only feels fair
 * when the hitbox is the cockpit, not the wingspan.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  function Player(config) {
    this.config = config;
    this.reset(config.view.baseWidth / 2, 0);
  }

  Player.prototype.reset = function (x, y) {
    var p = this.config.player;
    this.x = x;
    this.y = y;
    this.targetX = x;
    this.targetY = y;
    this.prevX = x;
    this.vx = 0;
    this.bank = 0;
    this.alive = true;
    this.lives = p.startLives;
    this.bombs = p.startBombs;
    this.shield = 0;              /* absorbs one hit per charge */
    this.invulnMs = 0;
    this.respawnMs = 0;
    this.damageFlashMs = 0;
    this.spawnInMs = 0;
    this.hitRadius = p.hitRadius;
  };

  Player.prototype.bounds = function (worldW, worldH) {
    var p = this.config.player;
    return {
      minX: p.hitRadius,
      maxX: worldW - p.hitRadius,
      minY: p.hitRadius,
      maxY: worldH - p.hitRadius
    };
  };

  /* Places the ship for the start of a run: off the bottom, flying in. */
  Player.prototype.enter = function (worldW, worldH) {
    var b = this.bounds(worldW, worldH);
    this.x = this.targetX = worldW / 2;
    this.y = worldH + 70;
    this.targetY = b.maxY - 40;
    this.respawnMs = 0;
    this.spawnInMs = this.config.player.respawnMs;
    this.invulnMs = this.config.player.invulnMs;
    this.alive = true;
    this.bank = 0;
  };

  /* `input` supplies a desired position in world units, or null when the
   * player is not touching anything - in which case the ship holds station. */
  Player.prototype.update = function (dt, input, worldW, worldH) {
    var p = this.config.player;
    var s = dt / 1000;
    if (s <= 0) return;

    this.invulnMs = Math.max(0, this.invulnMs - dt);
    this.damageFlashMs = Math.max(0, this.damageFlashMs - dt);

    if (this.respawnMs > 0) {
      this.respawnMs -= dt;
      if (this.respawnMs <= 0) this.enter(worldW, worldH);
      return;
    }

    var b = this.bounds(worldW, worldH);

    if (this.spawnInMs > 0) {
      /* fly-in: ignore input so a finger already on the glass cannot yank the
       * ship across the screen during the respawn animation */
      this.spawnInMs -= dt;
      this.y = M.approach(this.y, this.targetY, 0.18, s);
      this.x = M.approach(this.x, this.targetX, 0.18, s);
    } else {
      if (input) {
        this.targetX = M.clamp(input.x, b.minX, b.maxX);
        /* Fade the finger offset near the bottom so touch can reach that edge. */
        var offset = input.offsetY || 0;
        var edgeFade = M.clamp((b.maxY - input.y) / Math.max(1, offset * 2), 0, 1);
        this.targetY = M.clamp(input.y - offset * edgeFade, b.minY, b.maxY);
      }
      /* Cap the per-frame step so a teleporting pointer (a second finger, a
       * resume after a long pause) cannot slingshot the ship through bullets. */
      var nx = M.approach(this.x, this.targetX, p.followTau, s);
      var ny = M.approach(this.y, this.targetY, p.followTau, s);
      var maxStep = p.maxSpeed * s;
      var dx = nx - this.x, dy = ny - this.y;
      var len = Math.sqrt(dx * dx + dy * dy);
      if (len > maxStep) {
        dx = dx / len * maxStep;
        dy = dy / len * maxStep;
      }
      this.x += dx;
      this.y += dy;
    }

    this.x = M.clamp(this.x, b.minX, b.maxX);
    this.y = M.clamp(this.y, b.minY, b.maxY);

    /* Bank from actual travel, not from the input, so the roll matches what
     * the eye sees the ship doing. */
    this.vx = (this.x - this.prevX) / Math.max(0.0001, s);
    this.prevX = this.x;
    var wanted = M.clamp(this.vx / p.maxSpeed, -1, 1) * p.bankMax;
    this.bank = M.approach(this.bank, wanted, p.bankTau, s);
  };

  /* Returns 'none' | 'shield' | 'hit' | 'dead'. */
  Player.prototype.damage = function () {
    var p = this.config.player;
    if (!this.alive || this.invulnMs > 0 || this.respawnMs > 0 || this.spawnInMs > 0) return 'none';
    if (this.shield > 0) {
      this.shield--;
      this.invulnMs = 620;
      this.damageFlashMs = p.damageFlashMs;
      return 'shield';
    }
    this.lives--;
    this.damageFlashMs = p.damageFlashMs;
    if (this.lives <= 0) {
      this.alive = false;
      return 'dead';
    }
    this.respawnMs = p.respawnMs;
    this.invulnMs = p.invulnMs + p.respawnMs;
    return 'hit';
  };

  Player.prototype.vulnerable = function () {
    return this.alive && this.respawnMs <= 0 && this.invulnMs <= 0;
  };

  /* Only a live, fully arrived ship shoots and collects. */
  Player.prototype.active = function () {
    return this.alive && this.respawnMs <= 0;
  };

  /* Blink during invulnerability. Returns the alpha the renderer should use. */
  Player.prototype.alpha = function () {
    if (this.respawnMs > 0) return 0;
    if (this.invulnMs <= 0) return 1;
    var hz = this.config.player.blinkHz;
    return 0.35 + 0.55 * (Math.sin(this.invulnMs / 1000 * hz * Math.PI * 2) * 0.5 + 0.5);
  };

  Player.prototype.addLife = function () {
    this.lives = Math.min(this.config.player.maxLives, this.lives + 1);
  };

  Player.prototype.addBomb = function () {
    this.bombs = Math.min(this.config.player.maxBombs, this.bombs + 1);
  };

  global.GG = global.GG || {};
  global.GG.Player = Player;
})(window);
