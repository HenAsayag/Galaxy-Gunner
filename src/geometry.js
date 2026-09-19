/* Shared maths for the shooter: scalars, angles, easing and the Bezier
 * evaluation that the enemy path library is built on.
 *
 * Pure functions only - no DOM, no canvas, no state - so the headless tests
 * can require() this file directly.
 */
(function (global) {
  'use strict';

  var TAU = Math.PI * 2;

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function lerp(a, b, t) { return a + (b - a) * t; }

  /* Frame-rate independent exponential approach. `tau` is the time in seconds
   * to cover ~63% of the remaining distance; dt is in seconds. */
  function approach(current, target, tau, dt) {
    if (tau <= 0) return target;
    return current + (target - current) * (1 - Math.exp(-dt / tau));
  }

  function degToRad(deg) { return deg * Math.PI / 180; }

  /* Shortest signed difference from a to b, in (-PI, PI]. */
  function angleDelta(a, b) {
    var d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  /* Rotate `from` toward `to` by at most `maxStep` radians. */
  function turnToward(from, to, maxStep) {
    var d = angleDelta(from, to);
    if (d > maxStep) d = maxStep;
    if (d < -maxStep) d = -maxStep;
    return from + d;
  }

  function dist2(ax, ay, bx, by) {
    var dx = bx - ax, dy = by - ay;
    return dx * dx + dy * dy;
  }

  /* Circle-circle overlap. Everything in the game collides as a circle: it is
   * cheap, and it is the only shape that feels fair in a bullet hell. */
  function circlesHit(ax, ay, ar, bx, by, br) {
    var r = ar + br;
    return dist2(ax, ay, bx, by) <= r * r;
  }

  /* ---- easing ----------------------------------------------------------- */

  function easeOutCubic(t) { return 1 - Math.pow(1 - t, 3); }
  function easeOutQuad(t) { return 1 - (1 - t) * (1 - t); }
  function easeInQuad(t) { return t * t; }
  function easeInOutSine(t) { return 0.5 - Math.cos(Math.PI * t) * 0.5; }
  function easeOutBack(t) {
    var c = 1.70158;
    return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2);
  }

  /* ---- Bezier ------------------------------------------------------------
   * Enemy paths are cubic Beziers in normalised space (0..1 on both axes),
   * scaled to the live playfield when the group spawns. `out` is reused by the
   * caller so evaluating a path allocates nothing. */

  function cubicAt(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    var a = mt * mt * mt;
    var b = 3 * mt * mt * t;
    var c = 3 * mt * t * t;
    var d = t * t * t;
    return a * p0 + b * p1 + c * p2 + d * p3;
  }

  /* First derivative, used for heading. */
  function cubicSlopeAt(p0, p1, p2, p3, t) {
    var mt = 1 - t;
    return 3 * mt * mt * (p1 - p0) + 6 * mt * t * (p2 - p1) + 3 * t * t * (p3 - p2);
  }

  /* `pts` is a flat [x0,y0, x1,y1, x2,y2, x3,y3, ...] chain where each further
   * group of three points continues the curve. Returns position into `out`. */
  function chainAt(pts, t, out) {
    var segments = Math.max(1, (pts.length / 2 - 1) / 3);
    var scaled = clamp01(t) * segments;
    var index = Math.min(segments - 1, Math.floor(scaled));
    var local = scaled - index;
    var o = index * 6;                 /* 3 points * 2 coords per segment */
    out.x = cubicAt(pts[o], pts[o + 2], pts[o + 4], pts[o + 6], local);
    out.y = cubicAt(pts[o + 1], pts[o + 3], pts[o + 5], pts[o + 7], local);
    out.dx = cubicSlopeAt(pts[o], pts[o + 2], pts[o + 4], pts[o + 6], local);
    out.dy = cubicSlopeAt(pts[o + 1], pts[o + 3], pts[o + 5], pts[o + 7], local);
    return out;
  }

  var api = {
    TAU: TAU,
    clamp: clamp, clamp01: clamp01, lerp: lerp, approach: approach,
    degToRad: degToRad, angleDelta: angleDelta, turnToward: turnToward,
    dist2: dist2, circlesHit: circlesHit,
    easeOutCubic: easeOutCubic, easeOutQuad: easeOutQuad, easeInQuad: easeInQuad,
    easeInOutSine: easeInOutSine, easeOutBack: easeOutBack,
    cubicAt: cubicAt, cubicSlopeAt: cubicSlopeAt, chainAt: chainAt
  };

  global.GG = global.GG || {};
  global.GG.math = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
