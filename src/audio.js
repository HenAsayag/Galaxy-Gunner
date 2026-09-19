/* Sound playback.
 *
 * Carried over from the previous build with its structure intact - the
 * autoplay-policy unlock, the master gain, the mute behaviour, the voice cap
 * that drops the oldest voice instead of clipping, and the attack/release
 * ramps that stop rapid retriggers from clicking. All of that was working and
 * none of it is gameplay-specific.
 *
 * What changed: there are no sample files any more. The previous build's WAVs
 * were COLOR PULSE's cues, so the fetch-and-decode path has been replaced by
 * src/synth.js, which renders every cue and the music loop into AudioBuffers
 * inside the unlock gesture. That removes the prefetch entirely and with it
 * the file:// fallback that existed only because fetch cannot read local
 * files.
 *
 * The voice cap matters more here than it did before: a bomb can kill thirty
 * enemies in one frame, and thirty overlapping explosions is noise, not
 * impact. `play` collapses repeats of the same cue inside a short window.
 */
(function (global) {
  'use strict';

  var ATTACK = 0.004;
  var RELEASE = 0.03;
  var DEDUPE_MS = 28;          /* same cue twice inside this window plays once */

  function AudioEngine(config) {
    this.config = config;
    this.unlocked = false;
    this.muted = false;
    this.available = true;
    this.volume = config.audio.masterGain;
    this.musicVolume = config.audio.musicGain;
    this.buffers = {};
    this.voices = [];
    this.lastPlayed = {};
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.musicSource = null;
    this.musicBuffer = null;
    this.musicWanted = false;
  }

  /* Must be called from inside a real user gesture. */
  AudioEngine.prototype.unlock = function () {
    if (this.unlocked) return Promise.resolve(true);
    this.unlocked = true;

    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) { this.available = false; return Promise.resolve(false); }

    try {
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 1;
      this.master.connect(this.ctx.destination);

      /* Two buses so the music can duck without touching the cues. */
      this.sfxBus = this.ctx.createGain();
      this.sfxBus.gain.value = this.volume;
      this.sfxBus.connect(this.master);

      this.musicBus = this.ctx.createGain();
      this.musicBus.gain.value = this.musicVolume;
      this.musicBus.connect(this.master);
    } catch (e) {
      this.available = false;
      return Promise.resolve(false);
    }

    if (this.ctx.state === 'suspended') this.ctx.resume().catch(function () {});

    var Synth = global.GG.synth;
    var names = this.config.audio.cues;
    for (var i = 0; i < names.length; i++) {
      try {
        var buffer = Synth.renderCue(this.ctx, names[i]);
        if (buffer) this.buffers[names[i]] = buffer;
      } catch (e) { /* one bad cue must not silence the rest */ }
    }

    /* The music loop is the expensive one; build it after the cues so the
     * first shot of the run is already audible if generation is slow. */
    var self = this;
    var build = function () {
      try {
        self.musicBuffer = Synth.renderMusic(self.ctx);
        if (self.musicWanted) self.startMusic();
      } catch (e) { self.musicBuffer = null; }
    };
    if (global.requestIdleCallback) global.requestIdleCallback(build, { timeout: 400 });
    else global.setTimeout(build, 0);

    return Promise.resolve(true);
  };

  /* Browsers suspend the context when the tab is hidden; resuming has to
   * happen explicitly or the first sound after a resume is swallowed. */
  AudioEngine.prototype.resumeContext = function () {
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(function () {});
    }
  };

  AudioEngine.prototype.setMuted = function (muted) {
    this.muted = !!muted;
    if (this.master && this.ctx) {
      var now = this.ctx.currentTime;
      this.master.gain.cancelScheduledValues(now);
      this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.015);
    }
    if (this.muted) this.stopAll();
  };

  AudioEngine.prototype.setVolume = function (volume) {
    this.volume = Math.max(0, Math.min(1, volume));
    if (this.sfxBus) this.sfxBus.gain.value = this.volume;
  };

  AudioEngine.prototype.stopAll = function () {
    for (var i = 0; i < this.voices.length; i++) {
      try { this.voices[i].source.stop(); } catch (e) {}
    }
    this.voices.length = 0;
  };

  AudioEngine.prototype.play = function (name, rate) {
    if (this.muted || !this.unlocked || !this.available || !this.ctx) return false;
    var buffer = this.buffers[name];
    if (!buffer) return false;

    var wall = performance.now();
    /* One frame can kill a dozen enemies. Collapsing the duplicates is what
     * keeps that reading as one big impact rather than as mud. */
    if (wall - (this.lastPlayed[name] || -1e9) < DEDUPE_MS) return false;
    this.lastPlayed[name] = wall;

    /* Cap simultaneous voices; drop the oldest rather than clipping. */
    var live = [];
    for (var i = 0; i < this.voices.length; i++) {
      if (this.voices[i].endsAt > wall) live.push(this.voices[i]);
    }
    this.voices = live;
    while (this.voices.length >= this.config.audio.maxVoices) {
      var oldest = this.voices.shift();
      try { oldest.source.stop(); } catch (e) {}
    }

    var now = this.ctx.currentTime;
    var source = this.ctx.createBufferSource();
    var gain = this.ctx.createGain();
    source.buffer = buffer;
    if (rate) source.playbackRate.value = rate;
    var duration = buffer.duration / (rate || 1);
    gain.gain.setValueAtTime(0, now);
    gain.gain.linearRampToValueAtTime(1, now + ATTACK);
    gain.gain.setValueAtTime(1, now + Math.max(ATTACK, duration - RELEASE));
    gain.gain.linearRampToValueAtTime(0, now + duration);
    source.connect(gain);
    gain.connect(this.sfxBus);
    source.start(now);
    this.voices.push({ source: source, endsAt: wall + duration * 1000 });
    return true;
  };

  /* ---- music ---------------------------------------------------------------- */

  AudioEngine.prototype.startMusic = function () {
    this.musicWanted = true;
    if (!this.ctx || !this.musicBuffer || this.musicSource) return;
    try {
      var source = this.ctx.createBufferSource();
      source.buffer = this.musicBuffer;
      source.loop = true;
      source.connect(this.musicBus);
      source.start(0);
      this.musicSource = source;
    } catch (e) { this.musicSource = null; }
  };

  AudioEngine.prototype.stopMusic = function () {
    this.musicWanted = false;
    if (!this.musicSource) return;
    try { this.musicSource.stop(); } catch (e) {}
    this.musicSource = null;
  };

  /* Menus and pause keep the loop running but pull it right down, so the
   * transition back into play is instant rather than a hard cut. */
  AudioEngine.prototype.duckMusic = function (ducked) {
    if (!this.musicBus || !this.ctx) return;
    var now = this.ctx.currentTime;
    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setTargetAtTime(
      ducked ? this.musicVolume * 0.28 : this.musicVolume, now, 0.25);
  };

  AudioEngine.prototype.suspendGameplay = function () { this.stopAll(); };

  global.GG = global.GG || {};
  global.GG.AudioEngine = AudioEngine;
})(window);
