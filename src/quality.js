/* Quality levels and the automatic default.
 *
 * Three levels, as the brief specifies: High keeps full trails and additive
 * bloom, Medium thins the particle and trail budgets, Low simplifies
 * explosions, shortens trails and caps the render resolution.
 *
 * The initial guess comes from what the device will actually tell us - core
 * count, memory, pointer type, screen size. That guess is then CORRECTED by
 * measured frame time, because the only honest capability test is the game
 * itself: a phone that reports eight cores can still be thermally throttled.
 * Degrading is automatic; upgrading is not, because oscillating between
 * levels is worse than sitting one level low.
 */
(function (global) {
  'use strict';

  var LEVELS = ['low', 'medium', 'high'];

  /* Sustained frame time over this many ms before the level drops. */
  var SAMPLE_MS = 2500;
  var DROP_THRESHOLD_MS = 22;       /* ~45 fps */
  var OUTLIER_MS = 90;              /* anything slower is a stall, not a frame */

  function detect() {
    var cores = global.navigator.hardwareConcurrency || 4;
    var memory = global.navigator.deviceMemory || 4;
    var coarse = false;
    try { coarse = global.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    var pixels = (global.screen ? global.screen.width * global.screen.height : 400000) *
                 Math.min(global.devicePixelRatio || 1, 3);

    /* A desktop with a real GPU gets the benefit of the doubt. */
    if (!coarse && cores >= 4) return 'high';
    if (cores <= 3 || memory <= 2) return 'low';
    /* A high-core phone driving a very large framebuffer is the classic case
     * where the CPU looks fine and the fill rate is not. */
    if (cores >= 6 && pixels < 4200000) return 'high';
    return 'medium';
  }

  function Quality(config) {
    this.config = config;
    this.auto = true;
    this.level = detect();
    this.accum = 0;
    this.frames = 0;
    this.locked = false;
    this.listeners = [];
  }

  Quality.prototype.onChange = function (fn) { this.listeners.push(fn); };

  Quality.prototype.emit = function () {
    for (var i = 0; i < this.listeners.length; i++) this.listeners[i](this.level);
  };

  Quality.prototype.settings = function () {
    return this.config.quality[this.level] || this.config.quality.high;
  };

  Quality.prototype.dprCap = function () { return this.settings().dprCap; };

  /* Manual override from the settings panel: stops the watchdog entirely, so a
   * player who chose High keeps High. */
  Quality.prototype.set = function (level, manual) {
    if (LEVELS.indexOf(level) < 0) return;
    if (manual) { this.auto = false; this.locked = true; }
    if (this.level === level) return;
    this.level = level;
    this.accum = 0;
    this.frames = 0;
    this.emit();
  };

  Quality.prototype.setAuto = function () {
    this.auto = true;
    this.locked = false;
    this.set(detect(), false);
  };

  /* Fed the real frame delta every frame while a run is live. */
  Quality.prototype.sample = function (deltaMs) {
    if (!this.auto || this.locked) return;
    /* Ignore obvious outliers: a tab switch, a compositor stall or a GC pause
     * is not a capability signal, and reacting to one would drop everyone to
     * Low once. The main loop passes the raw delta precisely so this filter
     * can see - and discard - those spikes. */
    if (deltaMs > OUTLIER_MS || deltaMs <= 0) return;

    this.accum += deltaMs;
    this.frames++;
    if (this.accum < SAMPLE_MS) return;

    var average = this.accum / this.frames;
    this.accum = 0;
    this.frames = 0;

    if (average > DROP_THRESHOLD_MS) {
      var index = LEVELS.indexOf(this.level);
      if (index > 0) {
        this.level = LEVELS[index - 1];
        this.emit();
      } else {
        this.locked = true;    /* already at the floor; stop measuring */
      }
    }
  };

  global.GG = global.GG || {};
  global.GG.Quality = Quality;
  global.GG.QUALITY_LEVELS = LEVELS;
  global.GG.detectQuality = detect;
})(window);
