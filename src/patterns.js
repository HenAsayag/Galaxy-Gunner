/* BulletPatternLibrary.
 *
 * A pattern is a descriptor, not a loop: `volleys` and `gapMs` let the enemy
 * spread an attack over time without any pattern needing its own timer, and
 * `telegraph` asks the enemy for a charge glow before the first shot. The
 * enemy state machine in enemies.js drives all of it.
 *
 * Readability rules from the brief, enforced here rather than left to taste:
 *   - projectile FAMILIES have distinct colours (warm = fast lanes, green =
 *     slow walls, blue = arcs, violet = radial);
 *   - anything dense is telegraphed;
 *   - the wall patterns compute their gap from the live field width, so a
 *     full-width unavoidable curtain is not expressible.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  /* Minimum dodgeable opening, in world units. A ship is ~44 wide with a ~11
   * hitbox, so this is comfortably more than one body width. */
  var MIN_GAP = 74;

  function aimAt(e, world, speed) {
    var p = world.player;
    var dx = p.x - e.x, dy = p.y - e.y;
    var len = Math.sqrt(dx * dx + dy * dy) || 1;
    return { vx: dx / len * speed, vy: dy / len * speed };
  }

  function shootAngle(world, e, angle, speed, kind) {
    world.spawnEnemyBullet(e.x, e.y, Math.sin(angle) * speed, Math.cos(angle) * speed, kind);
  }

  var PATTERNS = {

    /* ---- opening-difficulty patterns: generous gaps --------------------- */

    straight: {
      volleys: 1,
      fire: function (world, e) {
        shootAngle(world, e, 0, world.config.bullets.enemySpeed, 'orange');
      }
    },

    spread2: {
      volleys: 1,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed;
        shootAngle(world, e, -0.22, s, 'orange');
        shootAngle(world, e, 0.22, s, 'orange');
      }
    },

    aimed: {
      volleys: 1,
      fire: function (world, e) {
        var v = aimAt(e, world, world.config.bullets.enemySpeedFast);
        world.spawnEnemyBullet(e.x, e.y, v.vx, v.vy, 'red');
      }
    },

    /* three shots on a short fuse, so the player reads the first and moves */
    aimedBurst: {
      volleys: 3, gapMs: 130, telegraph: true,
      fire: function (world, e) {
        var v = aimAt(e, world, world.config.bullets.enemySpeedFast);
        world.spawnEnemyBullet(e.x, e.y, v.vx, v.vy, 'red');
      }
    },

    /* ---- mid-stage density ---------------------------------------------- */

    spread3: {
      volleys: 1,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed;
        for (var i = -1; i <= 1; i++) shootAngle(world, e, i * 0.26, s, 'orange');
      }
    },

    spread5: {
      volleys: 1, telegraph: true,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed;
        for (var i = -2; i <= 2; i++) shootAngle(world, e, i * 0.22, s, 'orange');
      }
    },

    /* parallel warm columns, dropped straight down with lanes between them */
    columns: {
      volleys: 3, gapMs: 110, telegraph: true,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed * 1.05;
        var spacing = Math.max(MIN_GAP, world.worldW / 6);
        for (var i = -1; i <= 1; i++) {
          world.spawnEnemyBullet(e.x + i * spacing, e.y, 0, s, 'orange');
        }
      }
    },

    /* fans left then right on alternate volleys: the sweep is the tell */
    fanAlt: {
      volleys: 4, gapMs: 150, telegraph: true,
      fire: function (world, e, volley) {
        var s = world.config.bullets.enemySpeed;
        var dir = volley % 2 === 0 ? 1 : -1;
        for (var i = 0; i < 4; i++) {
          shootAngle(world, e, dir * (0.10 + i * 0.17), s, 'orange');
        }
      }
    },

    /* rotating radial burst: the spinner's signature */
    radial: {
      volleys: 1,
      fire: function (world, e) {
        var n = 8;
        var s = world.config.bullets.enemySpeed * 0.82;
        for (var i = 0; i < n; i++) {
          shootAngle(world, e, e.spinPhase + (i / n) * M.TAU, s, 'violet');
        }
      }
    },

    /* two missiles that curve outward before turning down */
    curvePair: {
      volleys: 1, telegraph: true,
      fire: function (world, e) {
        [-1, 1].forEach(function (side) {
          var b = world.spawnEnemyBullet(e.x + side * 12, e.y, side * 190, -60, 'missile');
          if (b) { b.curve = side * 2.6; b.curveMs = 700; }
        });
      }
    },

    /* a slow green wall with a guaranteed opening wider than the ship */
    greenWall: {
      volleys: 1, telegraph: true,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed * 0.55;
        var step = 34;
        var lanes = Math.floor(world.worldW / step);
        /* gap centre is re-rolled per wall, never locked onto the player */
        var gapLanes = Math.ceil(MIN_GAP / step) + 1;
        var gapStart = 1 + Math.floor(world.rng() * Math.max(1, lanes - gapLanes - 2));
        for (var i = 0; i <= lanes; i++) {
          if (i >= gapStart && i < gapStart + gapLanes) continue;
          world.spawnEnemyBullet(i * step + step / 2, e.y, 0, s, 'green');
        }
      }
    },

    /* a dotted blue arc: readable, sparse, and it drifts sideways */
    blueArc: {
      volleys: 1,
      fire: function (world, e) {
        var s = world.config.bullets.enemySpeed * 0.9;
        for (var i = -3; i <= 3; i++) {
          var a = i * 0.16;
          world.spawnEnemyBullet(e.x + i * 16, e.y + Math.abs(i) * 5,
                                 Math.sin(a) * s, Math.cos(a) * s * 0.92, 'blue');
        }
      }
    },

    /* ---- boss patterns ---------------------------------------------------- */

    bossFan: {
      volleys: 5, gapMs: 170, telegraph: true,
      fire: function (world, e, volley) {
        var s = world.config.bullets.enemySpeed;
        var drift = (volley - 2) * 0.09;
        for (var i = -4; i <= 4; i++) shootAngle(world, e, drift + i * 0.16, s, 'orange');
      }
    },

    bossAimedRake: {
      volleys: 6, gapMs: 110, telegraph: true,
      fire: function (world, e, volley) {
        var v = aimAt(e, world, world.config.bullets.enemySpeedFast);
        var spread = (volley - 2.5) * 0.10;
        var a = Math.atan2(v.vx, v.vy) + spread;
        var s = world.config.bullets.enemySpeedFast;
        shootAngle(world, e, a, s, 'red');
      }
    },

    bossRadial: {
      volleys: 3, gapMs: 220, telegraph: true,
      fire: function (world, e, volley) {
        var n = 14;
        var s = world.config.bullets.enemySpeed * 0.8;
        var off = volley * 0.14;
        for (var i = 0; i < n; i++) shootAngle(world, e, off + (i / n) * M.TAU, s, 'violet');
      }
    },

    bossMissiles: {
      volleys: 2, gapMs: 300, telegraph: true,
      fire: function (world, e) {
        for (var i = -1; i <= 1; i += 2) {
          var b = world.spawnEnemyBullet(e.x + i * 46, e.y + 20, i * 150, 40, 'missile');
          if (b) { b.homing = true; b.turnRate = 1.5; b.speed = 250; }
        }
      }
    }
  };

  /* Name aliases used by the enemy table, so archetypes read naturally. */
  var ALIAS = {
    spread2: 'spread2', spread5: 'spread5', columns: 'columns',
    curvepair: 'curvePair', fanalt: 'fanAlt', radial: 'radial',
    aimed: 'aimed', straight: 'straight'
  };

  function get(name) {
    if (!name) return null;
    return PATTERNS[ALIAS[name] || name] || null;
  }

  global.GG = global.GG || {};
  global.GG.patterns = { PATTERNS: PATTERNS, get: get, MIN_GAP: MIN_GAP };
})(window);
