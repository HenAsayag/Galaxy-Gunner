/* Original arcade SFX and music, synthesised at unlock.
 *
 * The previous build shipped ten WAVs. Those were COLOR PULSE's cues and none
 * of them fit a shooter, so every sound here is generated from scratch into an
 * AudioBuffer the first time the audio context opens. Nothing is sampled,
 * recorded or borrowed - the brief requires original audio, and generating it
 * also means there is no second network round trip before the first shot.
 *
 * Generation cost is a few milliseconds for the cues plus roughly twenty for
 * the music loop, paid once, inside the unlock gesture.
 */
(function (global) {
  'use strict';

  /* ---- DSP primitives ------------------------------------------------------ */

  function env(t, dur, attack, curve) {
    if (t < attack) return t / attack;
    var k = (t - attack) / Math.max(0.0001, dur - attack);
    return Math.pow(Math.max(0, 1 - k), curve === undefined ? 2 : curve);
  }

  function noise() { return Math.random() * 2 - 1; }

  /* A one-pole low pass, enough to take the fizz off white noise. */
  function LP(cut) {
    this.a = Math.exp(-2 * Math.PI * cut);
    this.z = 0;
  }
  LP.prototype.run = function (x) {
    this.z = x * (1 - this.a) + this.z * this.a;
    return this.z;
  };

  function saw(phase) { return 2 * (phase - Math.floor(phase + 0.5)); }
  function square(phase) { return phase - Math.floor(phase) < 0.5 ? 1 : -1; }
  function tri(phase) { return 1 - 4 * Math.abs(Math.round(phase) - phase); }

  /* ---- cue definitions ------------------------------------------------------
   * Each returns a sample value in -1..1 for time `t` within `dur`. Keeping
   * them as pure functions of t makes them trivially re-tunable. */

  var CUES = {
    /* rapid player shot: a short bright blip with a noise transient */
    shot: { dur: 0.085, gain: 0.30, fn: function (t, d, s) {
      var f = 900 - 520 * (t / d);
      s.p += f / 44100;
      return (square(s.p) * 0.35 + noise() * 0.25 * env(t, 0.02, 0.001, 4)) * env(t, d, 0.002, 3);
    } },

    shot_big: { dur: 0.115, gain: 0.34, fn: function (t, d, s) {
      var f = 620 - 320 * (t / d);
      s.p += f / 44100;
      s.q += (f * 1.5) / 44100;
      return (saw(s.p) * 0.30 + square(s.q) * 0.18 + noise() * 0.2 * env(t, 0.03, 0.001, 4))
             * env(t, d, 0.003, 3);
    } },

    laser: { dur: 0.26, gain: 0.30, fn: function (t, d, s) {
      var k = t / d;
      var f = 1400 - 900 * k;
      s.p += f / 44100;
      s.q += (f * 0.501) / 44100;
      return (saw(s.p) * 0.5 + saw(s.q) * 0.3) * env(t, d, 0.006, 2.2);
    } },

    missile: { dur: 0.34, gain: 0.26, fn: function (t, d, s) {
      var k = t / d;
      if (!s.lp) s.lp = new LP(0.06);
      var n = s.lp.run(noise());
      s.p += (240 + 700 * k) / 44100;
      return (n * 0.75 + tri(s.p) * 0.2) * env(t, d, 0.02, 1.7);
    } },

    missile_hit: { dur: 0.30, gain: 0.42, fn: function (t, d, s) {
      if (!s.lp) s.lp = new LP(0.09);
      s.p += (150 - 90 * (t / d)) / 44100;
      return (s.lp.run(noise()) * 0.7 + Math.sin(s.p * Math.PI * 2) * 0.5) * env(t, d, 0.003, 2.4);
    } },

    /* small kill: the sound the player hears hundreds of times a run, so it is
     * short, dry and sits low enough not to fatigue */
    boom_s: { dur: 0.26, gain: 0.40, fn: function (t, d, s) {
      if (!s.lp) s.lp = new LP(0.10);
      s.p += (190 - 120 * (t / d)) / 44100;
      return (s.lp.run(noise()) * 0.65 + Math.sin(s.p * Math.PI * 2) * 0.55)
             * env(t, d, 0.002, 2.6);
    } },

    boom_l: { dur: 0.62, gain: 0.52, fn: function (t, d, s) {
      if (!s.lp) s.lp = new LP(0.045);
      s.p += (120 - 82 * (t / d)) / 44100;
      s.q += (58 - 34 * (t / d)) / 44100;
      return (s.lp.run(noise()) * 0.6 +
              Math.sin(s.p * Math.PI * 2) * 0.5 +
              Math.sin(s.q * Math.PI * 2) * 0.45) * env(t, d, 0.004, 1.9);
    } },

    shield_hit: { dur: 0.30, gain: 0.34, fn: function (t, d, s) {
      s.p += 1180 / 44100;
      s.q += 1770 / 44100;
      return (Math.sin(s.p * Math.PI * 2) * 0.5 + Math.sin(s.q * Math.PI * 2) * 0.3)
             * env(t, d, 0.002, 3.2);
    } },

    player_hit: { dur: 0.55, gain: 0.50, fn: function (t, d, s) {
      var k = t / d;
      if (!s.lp) s.lp = new LP(0.07);
      s.p += (420 - 340 * k) / 44100;
      return (square(s.p) * 0.35 + s.lp.run(noise()) * 0.55) * env(t, d, 0.004, 1.6);
    } },

    pickup: { dur: 0.16, gain: 0.30, fn: function (t, d, s) {
      var step = Math.floor(t / d * 3);
      s.p += (660 * Math.pow(1.26, step)) / 44100;
      return tri(s.p) * env(t, d, 0.003, 2.2);
    } },

    /* the bright ascending cue the spec asks for on a weapon upgrade */
    upgrade: { dur: 0.46, gain: 0.38, fn: function (t, d, s) {
      var steps = [0, 4, 7, 12, 16];
      var i = Math.min(steps.length - 1, Math.floor(t / d * steps.length));
      var f = 523.25 * Math.pow(2, steps[i] / 12);
      s.p += f / 44100;
      s.q += (f * 2.002) / 44100;
      var local = (t / d * steps.length) % 1;
      return (tri(s.p) * 0.55 + Math.sin(s.q * Math.PI * 2) * 0.25)
             * Math.pow(1 - local, 1.3) * env(t, d, 0.004, 0.7);
    } },

    bomb: { dur: 1.05, gain: 0.58, fn: function (t, d, s) {
      var k = t / d;
      if (!s.lp) s.lp = new LP(0.035);
      s.p += (300 - 270 * k) / 44100;
      s.q += (74 - 46 * k) / 44100;
      return (s.lp.run(noise()) * 0.55 + saw(s.p) * 0.25 +
              Math.sin(s.q * Math.PI * 2) * 0.6) * env(t, d, 0.01, 1.4);
    } },

    /* boss warning: a two-tone alarm, deliberately unpleasant */
    warn: { dur: 0.52, gain: 0.34, fn: function (t, d, s) {
      var hi = (t % 0.26) < 0.13;
      s.p += (hi ? 740 : 494) / 44100;
      return square(s.p) * 0.4 * env(t, d, 0.01, 0.8);
    } },

    ui: { dur: 0.07, gain: 0.22, fn: function (t, d, s) {
      s.p += 1240 / 44100;
      return tri(s.p) * env(t, d, 0.002, 3);
    } },

    pause: { dur: 0.20, gain: 0.26, fn: function (t, d, s) {
      s.p += (700 - 300 * (t / d)) / 44100;
      return tri(s.p) * env(t, d, 0.004, 2.2);
    } },

    gameover: { dur: 1.30, gain: 0.46, fn: function (t, d, s) {
      var steps = [0, -3, -5, -8];
      var i = Math.min(steps.length - 1, Math.floor(t / d * steps.length));
      var f = 392 * Math.pow(2, steps[i] / 12);
      s.p += f / 44100;
      s.q += (f * 0.5) / 44100;
      return (saw(s.p) * 0.28 + Math.sin(s.q * Math.PI * 2) * 0.4) * env(t, d, 0.02, 1.1);
    } }
  };

  function renderCue(ctx, name) {
    var cue = CUES[name];
    if (!cue) return null;
    var rate = ctx.sampleRate;
    var length = Math.max(1, Math.ceil(cue.dur * rate));
    var buffer = ctx.createBuffer(1, length, rate);
    var data = buffer.getChannelData(0);
    var state = { p: 0, q: 0, lp: null };
    for (var i = 0; i < length; i++) {
      var t = i / rate;
      data[i] = Math.max(-1, Math.min(1, cue.fn(t, cue.dur, state) * cue.gain));
    }
    /* 2 ms fade out, so a retrigger can never click */
    var fade = Math.min(length, Math.round(rate * 0.002));
    for (var f = 0; f < fade; f++) data[length - 1 - f] *= f / fade;
    return buffer;
  }

  /* ---- music ---------------------------------------------------------------
   * One eight-bar loop at 146 BPM: a driving root-note bass, an offbeat arp
   * and a closed-hat pattern. Written in scale degrees so the whole thing can
   * be transposed by changing ROOT. */

  var ROOT = 55;                                   /* A1 */
  var PROG = [0, 0, 5, 5, 3, 3, 7, 7];             /* semitone offsets per bar */
  var ARP = [0, 7, 12, 7, 15, 12, 7, 3];

  function renderMusic(ctx) {
    var rate = ctx.sampleRate;
    var bpm = 146;
    var beat = 60 / bpm;
    var bars = PROG.length;
    var length = Math.ceil(beat * 4 * bars * rate);
    var buffer = ctx.createBuffer(2, length, rate);
    var L = buffer.getChannelData(0);
    var R = buffer.getChannelData(1);

    var bassPhase = 0, arpPhase = 0, padPhase = 0;
    var hatLp = new LP(0.42);
    var sixteenth = beat / 4;

    for (var i = 0; i < length; i++) {
      var t = i / rate;
      var bar = Math.floor(t / (beat * 4)) % bars;
      var inBar = t - Math.floor(t / (beat * 4)) * beat * 4;
      var step = Math.floor(t / sixteenth);
      var stepT = t - step * sixteenth;

      var key = PROG[bar];

      /* bass: eighth notes, short and punchy */
      var bassF = ROOT * Math.pow(2, key / 12);
      bassPhase += bassF / rate;
      var bassEnv = Math.pow(Math.max(0, 1 - (t % (beat / 2)) / (beat / 2)), 1.6);
      var bass = (saw(bassPhase) * 0.5 + square(bassPhase * 0.5) * 0.3) * bassEnv * 0.30;

      /* arp: sixteenths two octaves up */
      var arpNote = ARP[step % ARP.length];
      var arpF = ROOT * 4 * Math.pow(2, (key + arpNote) / 12);
      arpPhase += arpF / rate;
      var arpEnv = Math.pow(Math.max(0, 1 - stepT / sixteenth), 2.4);
      var arp = tri(arpPhase) * arpEnv * 0.16;

      /* pad: a slow fifth, low in the mix, just to fill the gaps */
      padPhase += (ROOT * 2 * Math.pow(2, (key + 7) / 12)) / rate;
      var pad = Math.sin(padPhase * Math.PI * 2) * 0.05 *
                (0.6 + 0.4 * Math.sin(t * 0.7));

      /* hats on the offbeat */
      var hatPos = inBar % (beat / 2);
      var hat = hatPos < 0.02
        ? hatLp.run(noise()) * Math.pow(1 - hatPos / 0.02, 3) * 0.10
        : hatLp.run(0) * 0;

      var mono = bass + pad;
      var wide = arp + hat;
      L[i] = Math.max(-1, Math.min(1, mono + wide * 1.15));
      R[i] = Math.max(-1, Math.min(1, mono + wide * 0.85));
    }

    /* the loop point has to be seamless, so cross-fade the seam */
    var xf = Math.round(rate * 0.02);
    for (var f = 0; f < xf; f++) {
      var k = f / xf;
      L[f] = L[f] * k + L[length - xf + f] * (1 - k);
      R[f] = R[f] * k + R[length - xf + f] * (1 - k);
    }
    return buffer;
  }

  global.GG = global.GG || {};
  global.GG.synth = {
    renderCue: renderCue,
    renderMusic: renderMusic,
    CUE_NAMES: Object.keys(CUES)
  };
})(window);
