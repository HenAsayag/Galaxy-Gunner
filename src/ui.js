/* Screens, settings and persistence.
 *
 * Everything here is DOM: the canvas layer knows nothing about it. The
 * Storage wrapper, the screen router and the throttled live region are
 * carried over unchanged from the previous build - they were working, they are
 * not gameplay-specific, and the private-mode fallback in particular is worth
 * keeping.
 *
 * What changed: the option list, the game-over panel and the coach, which all
 * described a ring game.
 */
(function (global) {
  'use strict';

  var FADE_MS = 200;

  /* localStorage with a safe in-memory fallback (private mode, blocked
   * storage, file:// quirks). */
  function Storage(key) {
    this.key = key;
    this.memory = {};
    this.available = false;
    try {
      var probe = '__gg__';
      global.localStorage.setItem(probe, '1');
      global.localStorage.removeItem(probe);
      this.available = true;
    } catch (e) {
      this.available = false;
    }
  }

  Storage.prototype.read = function () {
    if (!this.available) return Object.assign({}, this.memory);
    try {
      return JSON.parse(global.localStorage.getItem(this.key) || '{}') || {};
    } catch (e) {
      return {};
    }
  };

  Storage.prototype.write = function (data) {
    this.memory = Object.assign({}, this.memory, data);
    if (!this.available) return false;
    try {
      global.localStorage.setItem(this.key, JSON.stringify(this.memory));
      return true;
    } catch (e) {
      return false;
    }
  };

  function UI(config) {
    this.config = config;
    this.storage = new Storage(config.storageKey);
    this.el = {};
    this.currentScreen = null;
    this.hideTimer = null;
    this.liveTimer = null;

    var ids = [
      'app', 'playfield', 'hud-controls', 'btn-pause', 'btn-mute', 'mute-icon',
      'btn-fullscreen', 'fullscreen-icon', 'btn-bomb',
      'screen-loading', 'loading-text', 'screen-menu', 'screen-howto',
      'screen-paused', 'screen-gameover', 'screen-fullscreen',
      'gate-title', 'gate-text', 'gate-note',
      'btn-gate-enter', 'btn-gate-skip', 'btn-gate-back',
      'menu-best', 'btn-play', 'btn-howto', 'btn-howto-back',
      'opt-sound', 'opt-music', 'opt-reduced-motion', 'opt-reduced-flash', 'opt-quality',
      'btn-resume', 'btn-restart-paused', 'btn-mute-paused', 'btn-menu-paused',
      'final-score', 'gameover-best', 'new-best', 'btn-restart', 'btn-menu',
      'stat-stage', 'stat-kills', 'stat-combo', 'stat-tier', 'stat-time',
      'live-region'
    ];
    var self = this;
    ids.forEach(function (id) { self.el[id] = document.getElementById(id); });

    this.currentScreen = this.el['screen-loading'];
    this.settings = this.loadSettings();
  }

  /* ---- settings ----------------------------------------------------------- */

  UI.prototype.loadSettings = function () {
    var saved = this.storage.read();
    var prefersReduced = false;
    try {
      prefersReduced = global.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) {}

    return {
      sound: saved.sound !== undefined ? !!saved.sound : true,
      music: saved.music !== undefined ? !!saved.music : true,
      /* Honour the OS preference unless the player has chosen for themselves. */
      reducedMotion: saved.reducedMotion !== undefined ? !!saved.reducedMotion : prefersReduced,
      reducedFlash: saved.reducedFlash !== undefined ? !!saved.reducedFlash : prefersReduced,
      quality: saved.quality || 'auto',
      best: Number(saved.best) || 0,
      bestStage: Number(saved.bestStage) || 0
    };
  };

  UI.prototype.saveSettings = function () {
    this.storage.write({
      sound: this.settings.sound,
      music: this.settings.music,
      reducedMotion: this.settings.reducedMotion,
      reducedFlash: this.settings.reducedFlash,
      quality: this.settings.quality,
      best: this.settings.best,
      bestStage: this.settings.bestStage
    });
  };

  UI.prototype.syncSettingInputs = function () {
    this.el['opt-sound'].checked = this.settings.sound;
    this.el['opt-music'].checked = this.settings.music;
    this.el['opt-reduced-motion'].checked = this.settings.reducedMotion;
    this.el['opt-reduced-flash'].checked = this.settings.reducedFlash;
    this.el['opt-quality'].value = this.settings.quality;
    this.updateBest();
  };

  UI.prototype.updateBest = function () {
    var text = this.settings.best.toLocaleString
      ? this.settings.best.toLocaleString('en-US')
      : String(this.settings.best);
    this.el['menu-best'].textContent = text;
    this.el['gameover-best'].textContent = text;
  };

  UI.prototype.recordBest = function (score, stage) {
    var isBest = score > this.settings.best;
    if (isBest) this.settings.best = score;
    if (stage > this.settings.bestStage) this.settings.bestStage = stage;
    if (isBest || stage > this.settings.bestStage) {
      this.saveSettings();
      this.updateBest();
    }
    return isBest;
  };

  /* ---- screens ------------------------------------------------------------- */

  UI.prototype.showScreen = function (name) {
    var target = name ? this.el['screen-' + name] : null;
    if (this.currentScreen === target) return;

    /* Cancel any pending hide so rapid transitions cannot strand a screen. */
    if (this.hideTimer) { clearTimeout(this.hideTimer); this.hideTimer = null; }

    var previous = this.currentScreen;
    if (previous) {
      previous.classList.remove('is-visible');
      this.hideTimer = setTimeout(function () { previous.hidden = true; }, FADE_MS);
    }

    if (target) {
      target.hidden = false;
      void target.offsetWidth;          /* force layout so the fade runs */
      target.classList.add('is-visible');
      var focusable = target.querySelector('button, select, input');
      if (focusable && previous) {
        try { focusable.focus({ preventScroll: true }); } catch (e) { focusable.focus(); }
      }
    }
    this.currentScreen = target;
  };

  /* Pause, mute and the bomb button belong to a live run. The full-screen
   * button does not: it stays reachable from the menus so a phone can be set
   * up before play starts. */
  UI.prototype.setGameplayChromeVisible = function (visible) {
    this.el['btn-pause'].hidden = !visible;
    this.el['btn-mute'].hidden = !visible;
    this.el['btn-bomb'].hidden = !visible;
    var fullscreenShown = !this.el['btn-fullscreen'].hidden;
    this.el['hud-controls'].style.display = (visible || fullscreenShown) ? 'flex' : 'none';
  };

  UI.prototype.setBombCount = function (count) {
    var button = this.el['btn-bomb'];
    button.disabled = count <= 0;
    button.setAttribute('aria-label', 'Use bomb, ' + count + ' remaining');
    button.dataset.count = String(count);
  };

  UI.prototype.syncFullscreenButton = function (supported, active) {
    var button = this.el['btn-fullscreen'];
    button.hidden = !supported;
    this.el['fullscreen-icon'].textContent = active ? '✕' : '⛶';
    button.setAttribute('aria-label', active ? 'Exit full screen' : 'Enter full screen');
    button.setAttribute('aria-pressed', active ? 'true' : 'false');
  };

  /* ---- full-screen gate -------------------------------------------------
   * Four states, because "go full screen" is not the same request on every
   * device:
   *   enter       the normal case - one tap and the run starts
   *   retry       the request was made but the browser has not switched yet
   *   resume      full screen was left mid-run; the run is paused behind this
   *   unsupported the browser cannot do it at all (iOS Safari on iPhone), so
   *               the gate explains the alternative and lets play continue
   */
  var GATE = {
    enter: {
      title: 'Full screen',
      text: 'Voidflare is played full screen, so the whole phone is playfield.',
      button: 'Tap to play full screen',
      skip: false,
      note: ''
    },
    retry: {
      title: 'Full screen',
      text: 'Your browser did not switch to full screen. Tap again, or play in the window.',
      button: 'Try again',
      skip: true,
      note: ''
    },
    resume: {
      title: 'Paused',
      text: 'You left full screen, so the run is paused. Go back in to carry on.',
      button: 'Return to full screen',
      skip: true,
      note: ''
    },
    unsupported: {
      title: 'Ready',
      text: 'This browser has no full-screen mode, so the game fits itself to the window instead.',
      button: 'Play',
      skip: false,
      note: ''
    }
  };

  var IOS_NOTE = 'On iPhone: scroll up once to hide the address bar, or use ' +
                 'Share → Add to Home Screen for a proper full-screen game.';

  UI.prototype.showGate = function (mode, isIos) {
    var state = GATE[mode] || GATE.enter;
    this.el['gate-title'].textContent = state.title;
    this.el['gate-text'].textContent = state.text;
    this.el['btn-gate-enter'].textContent = state.button;
    this.el['btn-gate-skip'].hidden = !state.skip;

    var note = mode === 'unsupported' && isIos ? IOS_NOTE : state.note;
    this.el['gate-note'].textContent = note;
    this.el['gate-note'].hidden = !note;

    /* "Back" means the menu during a fresh start, but abandoning a live run
     * when it is shown mid-game, so it is labelled honestly. */
    this.el['btn-gate-back'].textContent = mode === 'resume' ? 'Quit to menu' : 'Back';

    this.showScreen('fullscreen');
    this.announce(state.title + '. ' + state.text);
  };

  UI.prototype.syncMuteButton = function () {
    var on = this.settings.sound;
    this.el['mute-icon'].textContent = on ? '♪' : '✕';
    this.el['btn-mute'].setAttribute('aria-label', on ? 'Mute sound' : 'Unmute sound');
    this.el['btn-mute'].setAttribute('aria-pressed', on ? 'false' : 'true');
    this.el['btn-mute-paused'].textContent = 'Sound: ' + (on ? 'on' : 'off');
    this.el['opt-sound'].checked = on;
  };

  /* ---- game over ------------------------------------------------------------ */

  UI.prototype.showGameOver = function (stats, isNewBest) {
    var fmt = function (n) {
      return n.toLocaleString ? n.toLocaleString('en-US') : String(n);
    };
    this.el['final-score'].textContent = fmt(stats.score);
    this.el['stat-stage'].textContent = String(stats.stage);
    this.el['stat-kills'].textContent = fmt(stats.kills);
    this.el['stat-combo'].textContent = String(stats.combo);
    this.el['stat-tier'].textContent = String(stats.tier);
    this.el['stat-time'].textContent = formatTime(stats.timeMs);
    this.el['new-best'].hidden = !isNewBest;
    this.updateBest();
    this.showScreen('gameover');
    this.announce('Run over. Score ' + stats.score + '.' + (isNewBest ? ' New best.' : ''));
  };

  function formatTime(ms) {
    var total = Math.round(ms / 1000);
    var m = Math.floor(total / 60);
    var s = total % 60;
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  /* ---- accessibility --------------------------------------------------------- */

  /* Throttled so a fast run does not flood a screen reader. */
  UI.prototype.announce = function (text) {
    var el = this.el['live-region'];
    if (!el) return;
    if (this.liveTimer) clearTimeout(this.liveTimer);
    var self = this;
    this.liveTimer = setTimeout(function () {
      el.textContent = text;
      self.liveTimer = null;
    }, 240);
  };

  global.GG = global.GG || {};
  global.GG.UI = UI;
  global.GG.Storage = Storage;
  global.GG.formatTime = formatTime;
})(window);
