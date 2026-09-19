/* Colour parsing and mixing, shared by the effects layer and both renderers.
 * Kept in one place because the WebGL renderer needs 0..1 floats while the
 * Canvas 2D fallback needs CSS strings, and both mix the same values. */
(function (global) {
  'use strict';

  var cache = {};

  /* Accepts "#RGB", "#RRGGBB", "rgb(r,g,b)" and an [r,g,b] array. */
  function parse(color) {
    if (Array.isArray(color)) return color;
    var hit = cache[color];
    if (hit) return hit;

    var out;
    if (color.charAt(0) === '#') {
      var h = color.slice(1);
      if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
      out = [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
    } else {
      var nums = color.match(/-?\d+(\.\d+)?/g) || [];
      out = [Number(nums[0]) || 0, Number(nums[1]) || 0, Number(nums[2]) || 0];
    }
    cache[color] = out;
    return out;
  }

  function mix(a, b, t) {
    var x = parse(a), y = parse(b);
    return [
      x[0] + (y[0] - x[0]) * t,
      x[1] + (y[1] - x[1]) * t,
      x[2] + (y[2] - x[2]) * t
    ];
  }

  function css(color) {
    var c = parse(color);
    return 'rgb(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ')';
  }

  /* 0..255 -> 0..1, for shader uniforms. */
  function unit(color) {
    var c = parse(color);
    return [c[0] / 255, c[1] / 255, c[2] / 255];
  }

  global.GG = global.GG || {};
  global.GG.color = { parse: parse, mix: mix, css: css, unit: unit };
})(window);
