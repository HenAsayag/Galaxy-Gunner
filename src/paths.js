/* PathLibrary - the curved entries that give the game its shape.
 *
 * Every template is authored in NORMALISED space: x and y run 0..1 across the
 * live playfield, and values outside that range are off-screen staging room.
 * A template is either a cubic Bezier chain (flat [x,y, c1, c2, p, c1, c2, p,
 * ...]) or a procedural function, for the shapes a Bezier describes badly -
 * orbits and corkscrews.
 *
 * Nothing here knows the size of the screen. The spawner binds a template to
 * the live playfield when a group appears, which is what lets the same wave
 * read identically on a 360-wide phone and a 430-wide one.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;

  /* ---- templates ---------------------------------------------------------
   * Authored left-biased where a mirror exists; the spawner flips them with
   * `mirror` rather than storing two copies. */

  var TEMPLATES = {
    /* sweeps in from above the left corner, curls through mid-screen, exits right */
    hookLeft: { pts: [-0.15, -0.12, 0.25, 0.10, 0.55, 0.20, 0.50, 0.42,
                                   0.45, 0.62, 0.90, 0.70, 1.15, 0.95] },

    hookRight: { pts: [1.15, -0.12, 0.75, 0.10, 0.45, 0.20, 0.50, 0.42,
                                    0.55, 0.62, 0.10, 0.70, -0.15, 0.95] },

    /* mirrored S: two opposing bends down the middle third */
    esse: { pts: [0.20, -0.15, 0.20, 0.18, 0.80, 0.28, 0.80, 0.48,
                              0.80, 0.68, 0.20, 0.78, 0.20, 1.15] },

    shallowU: { pts: [-0.12, 0.12, 0.20, 0.52, 0.80, 0.52, 1.12, 0.12] },

    deepU: { pts: [-0.12, -0.05, 0.05, 0.85, 0.95, 0.85, 1.12, -0.05] },

    /* dives in, loops back on itself, leaves the way it came */
    loopExit: { pts: [0.50, -0.15, 0.50, 0.30, 0.95, 0.30, 0.90, 0.50,
                                   0.85, 0.70, 0.15, 0.62, 0.20, 0.38,
                                   0.24, 0.20, 0.55, 0.20, 0.55, -0.18] },

    diagonalSweep: { pts: [-0.15, 0.05, 0.25, 0.25, 0.70, 0.45, 1.15, 0.70] },

    /* one half of a crossing X; the spawner mirrors alternate members */
    crossX: { pts: [-0.12, -0.10, 0.30, 0.25, 0.70, 0.55, 1.12, 0.95] },

    /* enters at the side, flattens, then drops straight down the screen */
    sideDive: { pts: [-0.15, 0.18, 0.25, 0.20, 0.45, 0.22, 0.52, 0.34,
                                   0.58, 0.46, 0.55, 0.80, 0.55, 1.15] },

    converge: { pts: [-0.10, -0.10, 0.20, 0.30, 0.42, 0.45, 0.50, 0.60,
                                    0.56, 0.72, 0.58, 0.95, 0.58, 1.15] },

    diverge: { pts: [0.50, -0.12, 0.50, 0.22, 0.30, 0.38, 0.12, 0.55,
                                  -0.04, 0.72, -0.10, 0.95, -0.15, 1.15] },

    /* straight-ish column, used to keep the low-pressure opening readable */
    lane: { pts: [0.50, -0.15, 0.50, 0.25, 0.50, 0.70, 0.50, 1.15] },

    /* ---- procedural ------------------------------------------------------ */

    /* descends while weaving; `amp` widens with the group index so a chain of
     * them fans out instead of stacking */
    snake: {
      fn: function (t, out, p) {
        var amp = 0.26 * (p.amp || 1);
        out.x = 0.5 + Math.sin(t * Math.PI * 2.4 + p.phase) * amp;
        out.y = -0.14 + t * 1.3;
        out.dx = Math.cos(t * Math.PI * 2.4 + p.phase) * amp * Math.PI * 2.4;
        out.dy = 1.3;
      }
    },

    /* long shallow wave across the upper half, then out of the side */
    wave: {
      fn: function (t, out, p) {
        out.x = -0.15 + t * 1.3;
        out.y = 0.22 + Math.sin(t * Math.PI * 2 + p.phase) * 0.16;
        out.dx = 1.3;
        out.dy = Math.cos(t * Math.PI * 2 + p.phase) * 0.16 * Math.PI * 2;
      }
    },

    /* descends while rotating around a drifting centre */
    corkscrew: {
      fn: function (t, out, p) {
        var a = t * Math.PI * 3.2 + p.phase;
        var r = 0.22 * (1 - t * 0.35);
        out.x = 0.5 + Math.cos(a) * r;
        out.y = -0.12 + t * 1.25;
        out.dx = -Math.sin(a) * r * Math.PI * 3.2;
        out.dy = 1.25;
      }
    },

    /* comes in, circles a point in the upper third, then leaves downward */
    orbit: {
      fn: function (t, out, p) {
        var enter = 0.22, leave = 0.80;
        if (t < enter) {
          var k = t / enter;
          out.x = M.lerp(-0.15, 0.5 - 0.26, k);
          out.y = M.lerp(-0.10, 0.34, k);
          out.dx = 1; out.dy = 0.8;
          return;
        }
        if (t > leave) {
          var j = (t - leave) / (1 - leave);
          out.x = 0.5 - 0.26;
          out.y = 0.34 + j * 0.95;
          out.dx = 0; out.dy = 1;
          return;
        }
        var a = ((t - enter) / (leave - enter)) * Math.PI * 2 + p.phase;
        out.x = 0.5 + Math.cos(a + Math.PI) * 0.26;
        out.y = 0.34 + Math.sin(a + Math.PI) * 0.17;
        out.dx = -Math.sin(a + Math.PI) * 0.26;
        out.dy = Math.cos(a + Math.PI) * 0.17;
      }
    },

    /* staggered V: members share the path, the spawner staggers their start */
    vee: { pts: [0.50, -0.20, 0.50, 0.18, 0.50, 0.46, 0.50, 0.72] }
  };

  var NAMES = Object.keys(TEMPLATES);

  /* ---- a bound path ------------------------------------------------------
   * `bind` produces a lightweight follower. The scratch object is reused, so
   * sampling a path during the frame allocates nothing. */

  var scratch = { x: 0, y: 0, dx: 0, dy: 0 };

  /* A Path is a value object that is CONFIGURED, never rebuilt: every pooled
   * enemy owns one for its whole lifetime and the spawner rewrites its fields
   * in place. Constructing one per spawn was the last recurring allocation in
   * the run loop, and recurring allocation is exactly what the brief's
   * no-GC-stutter requirement rules out. */
  function Path(name, options) {
    this.params = { phase: 0, amp: 1 };
    this.configure(name, options);
  }

  Path.prototype.configure = function (name, options) {
    options = options || {};
    this.template = TEMPLATES[name] || TEMPLATES.lane;
    this.name = TEMPLATES[name] ? name : 'lane';
    this.mirror = !!options.mirror;
    this.reverse = !!options.reverse;
    this.offsetX = options.offsetX || 0;   /* normalised lateral nudge */
    this.offsetY = options.offsetY || 0;
    this.params.phase = options.phase || 0;
    this.params.amp = options.amp || 1;
    return this;
  };

  /* Samples at normalised progress `t` into world units.
   * `out` receives x, y (world) and angle (radians, 0 = nose up). */
  Path.prototype.sample = function (t, worldW, worldH, out) {
    var u = this.reverse ? 1 - t : t;
    if (this.template.fn) this.template.fn(M.clamp(u, -0.2, 1.2), scratch, this.params);
    else M.chainAt(this.template.pts, M.clamp01(u), scratch);

    var nx = scratch.x + this.offsetX;
    var ny = scratch.y + this.offsetY;
    var dx = scratch.dx;
    var dy = scratch.dy;
    if (this.mirror) { nx = 1 - nx; dx = -dx; }
    if (this.reverse) { dx = -dx; dy = -dy; }

    out.x = nx * worldW;
    out.y = ny * worldH;
    /* Heading, in the sprite convention where 0 points up: an angle t rotates
     * the nose vector (0,-1) to (sin t, -cos t), so inverting that is a plain
     * atan2. A craft flying straight down comes out at PI, which is what makes
     * curved entries read as banking rather than sliding. */
    out.angle = Math.atan2(dx * worldW, -dy * worldH);
    return out;
  };

  /* A path is "spent" once it has left the field for good. */
  Path.prototype.exitsDownward = function () {
    return this.name !== 'shallowU' && this.name !== 'deepU' && this.name !== 'wave';
  };

  function pick(rng) { return NAMES[Math.floor(rng() * NAMES.length)]; }

  global.GG = global.GG || {};
  global.GG.paths = {
    Path: Path,
    TEMPLATES: TEMPLATES,
    NAMES: NAMES,
    pick: pick
  };
})(window);
