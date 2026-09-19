/* Seeded random generator (mulberry32). Injected everywhere gameplay needs
 * randomness so a run can be reproduced exactly from its seed. */
(function (global) {
  'use strict';

  function hashSeed(value) {
    if (typeof value === 'number' && isFinite(value) && value !== 0) return value >>> 0;
    var text = String(value === undefined || value === null ? Date.now() + ':' + Math.random() : value);
    var h = 2166136261 >>> 0;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }

  function createRng(seed) {
    var state = hashSeed(seed) || 1;
    var rng = function () {
      state |= 0;
      state = (state + 0x6D2B79F5) | 0;
      var t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    rng.seed = hashSeed(seed);
    rng.range = function (min, max) { return min + rng() * (max - min); };
    rng.int = function (min, max) { return Math.floor(rng.range(min, max + 1)); };
    rng.pick = function (list) { return list[Math.floor(rng() * list.length)]; };
    rng.chance = function (p) { return rng() < p; };
    return rng;
  }

  var api = { createRng: createRng, hashSeed: hashSeed };
  global.GG = global.GG || {};
  global.GG.createRng = createRng;
  global.GG.hashSeed = hashSeed;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
