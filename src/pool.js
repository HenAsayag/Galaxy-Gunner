/* Object pools.
 *
 * Every transient in the game - bullets, enemies, particles, pickups, trail
 * samples, floating labels - comes from one of these. Nothing is allocated
 * during a frame once the pool has warmed up, which is what keeps the garbage
 * collector from stuttering during a long run (polish item 10).
 *
 * A pool holds ONE dense array. Live items occupy [0, live); dead items sit
 * past it and are recycled in place. Iteration is therefore cache-friendly and
 * `release` is O(1) via a swap with the last live item.
 */
(function (global) {
  'use strict';

  function Pool(factory, reset, capacity) {
    this.factory = factory;
    this.resetFn = reset || null;
    this.capacity = capacity || 256;
    this.items = [];
    this.live = 0;
    for (var i = 0; i < Math.min(32, this.capacity); i++) this.items.push(factory());
  }

  Object.defineProperty(Pool.prototype, 'length', {
    get: function () { return this.live; }
  });

  /* Returns a recycled item, or null when the budget is already spent. The
   * caller must treat null as "skip this effect" - dropping a spark is always
   * better than blowing the frame budget. */
  Pool.prototype.obtain = function () {
    if (this.live >= this.capacity) return null;
    if (this.live >= this.items.length) this.items.push(this.factory());
    var item = this.items[this.live++];
    if (this.resetFn) this.resetFn(item);
    return item;
  };

  Pool.prototype.at = function (index) { return this.items[index]; };

  /* Swap-remove. Safe to call from a reverse loop over [live-1 .. 0]. */
  Pool.prototype.releaseAt = function (index) {
    var last = --this.live;
    if (index !== last) {
      var tmp = this.items[index];
      this.items[index] = this.items[last];
      this.items[last] = tmp;
    }
  };

  Pool.prototype.clear = function () { this.live = 0; };

  /* Walks live items in reverse and releases any for which `fn` returns true.
   * Reverse order is what makes the swap-remove safe mid-iteration. */
  Pool.prototype.sweep = function (fn, arg) {
    for (var i = this.live - 1; i >= 0; i--) {
      if (fn(this.items[i], arg, i)) this.releaseAt(i);
    }
  };

  /* Raise or lower the ceiling at runtime (the quality settings do this).
   * Shrinking trims live items from the tail rather than reallocating. */
  Pool.prototype.setCapacity = function (capacity) {
    this.capacity = Math.max(1, capacity | 0);
    if (this.live > this.capacity) this.live = this.capacity;
  };

  var api = { Pool: Pool };
  global.GG = global.GG || {};
  global.GG.Pool = Pool;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
