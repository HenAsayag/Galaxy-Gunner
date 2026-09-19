/* Boot and orchestration: one animation loop, one simulation clock, one set
 * of event listeners for the lifetime of the page.
 *
 * The shape of this file is carried over from the previous build - the boot
 * promise chain, the resize handling, the visibility/blur auto-pause, the
 * full-screen negotiation and the WebGL-with-Canvas-fallback selection were
 * all working and none of them are gameplay-specific. What changed is what
 * gets constructed and what the loop drives.
 */
(function (global) {
  'use strict';

  var GG = global.GG;
  var CONFIG = GG.CONFIG;

  var ui, world, renderer, scene, fx, audio, input, quality, atlas;
  var lastFrame = 0;
  var gameOverAt = 0;
  var gameOverStats = null;
  var GAME_OVER_SETTLE_MS = 900;
  var booted = false;
  var suppressBlurUntil = 0;
  var fullscreenBlocked = false;
  var gateMode = null;          /* null when the gate is not on screen */
  var gateWaitTimer = null;

  /* iOS Safari on iPhone has no element full-screen API. Detected rather than
   * assumed, because the advice the gate gives there is different. */
  var IS_IOS = (function () {
    var ua = global.navigator.userAgent || '';
    if (/iPad|iPhone|iPod/.test(ua)) return true;
    /* iPadOS 13+ reports itself as a Mac, but a Mac has no touch screen. */
    return global.navigator.platform === 'MacIntel' && global.navigator.maxTouchPoints > 1;
  })();

  /* ---- config -------------------------------------------------------------- */

  /* Tuning can live in config/game-config.json when the game is served over
   * http(s). Opened from file:// the fetch fails and the built-in defaults
   * (identical values) are used instead. */
  function loadConfigOverrides() {
    if (typeof fetch !== 'function') return Promise.resolve();
    return fetch('config/game-config.json')
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (json) { if (json) GG.mergeConfig(CONFIG, json); })
      .catch(function () { /* defaults already loaded */ });
  }

  /* ---- settings ------------------------------------------------------------- */

  function applySettings() {
    var s = ui.settings;
    audio.setMuted(!s.sound);
    if (s.music) audio.startMusic(); else audio.stopMusic();
    fx.reducedMotion = s.reducedMotion;
    fx.reducedFlash = s.reducedFlash || s.reducedMotion;
    if (s.quality === 'auto') quality.setAuto();
    else quality.set(s.quality, true);
    ui.syncMuteButton();
  }

  function onQualityChange(level) {
    fx.applyQuality(level);
    scene.setQuality(level);
    resize();
  }

  /* ---- game events ----------------------------------------------------------- */

  function onWorldEvent(type, payload) {
    switch (type) {
      case 'pickup':
        if (payload.label) ui.announce(payload.label);
        break;

      case 'hurt':
        ui.announce(payload.lives + ' lives left.');
        break;

      case 'bomb':
        ui.setBombCount(payload.bombs);
        break;

      case 'gameover':
        gameOverStats = payload;
        gameOverAt = performance.now();
        input.setEnabled(false);
        audio.play('gameover');
        audio.duckMusic(true);
        break;
    }
  }

  /* ---- run control ------------------------------------------------------------ */

  /* ---- the full-screen gate -------------------------------------------------
   * Nothing starts a run directly any more; everything goes through here. A
   * phone's address bar eats roughly a third of a portrait viewport, and this
   * game is sized to what is actually visible, so playing windowed on a phone
   * is a materially worse game. */

  function requestPlay() {
    if (!fullscreenSupported()) {
      /* Cannot be done here at all. Say so plainly and let them play. */
      openGate('unsupported');
      return;
    }
    if (fullscreenActive()) { startRun(); return; }
    openGate('enter');
  }

  function openGate(mode) {
    gateMode = mode;
    clearGateWait();
    input.setEnabled(false);
    ui.setGameplayChromeVisible(false);
    ui.showGate(mode, IS_IOS);
  }

  function closeGate() {
    gateMode = null;
    clearGateWait();
  }

  function clearGateWait() {
    if (gateWaitTimer) { clearTimeout(gateWaitTimer); gateWaitTimer = null; }
  }

  /* The gate's main button. Must call requestFullscreen synchronously inside
   * this handler or every browser will refuse it. */
  function onGateEnter() {
    if (gateMode === 'unsupported') {
      closeGate();
      startRun();
      return;
    }
    toggleFullscreen();
    /* If the switch has not happened shortly, offer the way out rather than
     * leaving a dead button. The fullscreenchange handler cancels this. */
    clearGateWait();
    gateWaitTimer = setTimeout(function () {
      gateWaitTimer = null;
      if (gateMode && !fullscreenActive()) openGate(gateMode === 'resume' ? 'resume' : 'retry');
    }, 1400);
  }

  function onGateSkip() {
    var wasResume = gateMode === 'resume';
    closeGate();
    if (wasResume) resumeGame(); else startRun();
  }

  function onGateBack() {
    closeGate();
    toMenu();
  }

  /* Android Chrome allows an orientation lock once full screen is active.
   * Portrait is the primary presentation, so take it when it is offered and
   * ignore the refusal everywhere else. */
  function lockPortrait() {
    try {
      var orientation = global.screen && global.screen.orientation;
      if (!orientation || !orientation.lock) return;
      var result = orientation.lock('portrait');
      if (result && result.catch) result.catch(function () {});
    } catch (e) { /* not supported, or not allowed here */ }
  }

  function startRun() {
    closeGate();
    fx.clear();
    gameOverStats = null;
    gameOverAt = 0;
    input.reset();
    input.setEnabled(true);
    ui.showScreen(null);
    ui.setGameplayChromeVisible(true);

    resize();                       /* the world needs live dimensions first */
    world.start(performance.now(), {});
    scene.displayScore = 0;
    ui.setBombCount(world.player.bombs);
    audio.duckMusic(false);
    if (ui.settings.music) audio.startMusic();
  }

  function toMenu() {
    input.setEnabled(false);
    fx.clear();
    ui.setGameplayChromeVisible(false);
    /* A full reset, not just a state flip: otherwise the last run's enemies
     * and bullets sit frozen behind the menu panel. */
    world.reset(performance.now());
    audio.suspendGameplay();
    audio.duckMusic(true);
    ui.showScreen('menu');
  }

  function pauseGame(reason) {
    if (!world.isLive()) return;
    if (!world.pause(performance.now(), reason)) return;
    input.setEnabled(false);
    audio.suspendGameplay();
    audio.duckMusic(true);
    audio.play('pause');
    ui.showScreen('paused');
  }

  function resumeGame() {
    if (world.state !== 'paused') return;
    ui.showScreen(null);
    input.setEnabled(true);
    audio.resumeContext();
    audio.duckMusic(false);
    audio.play('ui');
    world.resume(performance.now());
  }

  function togglePause() {
    if (world.state === 'paused') resumeGame();
    else if (world.isLive()) pauseGame('manual');
  }

  function useBomb() {
    if (!world.isLive()) return;
    if (world.useBomb()) ui.setBombCount(world.player.bombs);
  }

  /* ---- loop --------------------------------------------------------------------- */

  function frame(now) {
    global.requestAnimationFrame(frame);

    var rawDelta = lastFrame ? now - lastFrame : 0;
    var realDelta = Math.min(120, rawDelta);
    lastFrame = now;

    if (world.isLive()) {
      /* The watchdog gets the RAW delta. Handing it the clamped one would feed
       * it a run of exactly-120 ms frames after every tab stall or GC pause,
       * which reads as a slow device and would quietly demote a machine that
       * is in fact running at 60. */
      quality.sample(rawDelta);
      /* One read per frame, shared by every simulation slice inside it. */
      world.input = input.read(world.player, renderer.layout, realDelta,
                               CONFIG.player.fingerOffsetY);
    }

    world.advanceTo(now);

    /* Effects run on the simulation: they stop dead while paused, and keep
     * settling for a moment after the final explosion. */
    var fxDelta = world.state === 'paused' ? 0 : realDelta;
    fx.update(fxDelta);
    if (world.state !== 'paused') {
      scene.background.update(fxDelta, renderer.layout.worldW, renderer.layout.worldH);
    }

    /* Score count-up. The authoritative score already changed; this only
     * chases it, and always converges, so no award can be lost. */
    if (scene.displayScore !== world.score) {
      var tau = Math.max(1, CONFIG.feel.scoreCountUpMs / 3);
      scene.displayScore += (world.score - scene.displayScore) *
                            (1 - Math.exp(-fxDelta / tau));
      if (Math.abs(world.score - scene.displayScore) < 0.6) scene.displayScore = world.score;
    }

    scene.draw(renderer, world, fx, ui);

    /* Reveal the game-over screen only once the last explosion has settled. */
    if (gameOverStats && now - gameOverAt >= GAME_OVER_SETTLE_MS) {
      var stats = gameOverStats;
      gameOverStats = null;
      scene.displayScore = stats.score;
      ui.setGameplayChromeVisible(false);
      ui.showGameOver(stats, ui.recordBest(stats.score, stats.stage));
    }
  }

  /* ---- sizing --------------------------------------------------------------------- */

  function resize() {
    var app = ui.el.app;
    var rect = app.getBoundingClientRect();
    var styles = global.getComputedStyle(app);
    var w = rect.width - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    var h = rect.height - parseFloat(styles.paddingTop) - parseFloat(styles.paddingBottom);
    var layout = renderer.resize(Math.max(1, w), Math.max(1, h), quality.dprCap());
    world.setViewport(layout.worldW, layout.worldH);

    /* In landscape the playfield is a centred column with background painted
     * into the margins. The DOM chrome has to follow that column, or the pause
     * and bomb buttons end up stranded half a screen away from the action. */
    app.style.setProperty('--field-inset',
      Math.round(layout.offsetX * layout.scale) + 'px');
  }

  /* ---- wiring ---------------------------------------------------------------------- */

  function wireControls() {
    var el = ui.el;

    var click = function (node, handler, silent) {
      if (!node) return;
      node.addEventListener('click', function (event) {
        event.preventDefault();
        if (!silent) audio.play('ui');
        handler(event);
      });
    };

    /* Every entry point into a run goes through the gate. */
    click(el['btn-play'], requestPlay);
    click(el['btn-restart-paused'], requestPlay);
    click(el['btn-restart'], requestPlay);

    click(el['btn-howto'], function () { ui.showScreen('howto'); });
    click(el['btn-howto-back'], function () { ui.showScreen('menu'); });

    click(el['btn-gate-enter'], onGateEnter, true);
    click(el['btn-gate-skip'], onGateSkip);
    click(el['btn-gate-back'], onGateBack);

    click(el['btn-pause'], function () { pauseGame('manual'); }, true);
    click(el['btn-resume'], resumeGame, true);
    click(el['btn-menu-paused'], toMenu);
    click(el['btn-menu'], toMenu);
    click(el['btn-bomb'], useBomb, true);

    var toggleMute = function () {
      ui.settings.sound = !ui.settings.sound;
      ui.saveSettings();
      applySettings();
    };
    click(el['btn-fullscreen'], toggleFullscreen, true);
    click(el['btn-mute'], toggleMute, true);
    click(el['btn-mute-paused'], toggleMute, true);

    var bindToggle = function (id, key) {
      el[id].addEventListener('change', function (e) {
        ui.settings[key] = e.target.checked;
        ui.saveSettings();
        applySettings();
      });
    };
    bindToggle('opt-sound', 'sound');
    bindToggle('opt-music', 'music');
    bindToggle('opt-reduced-motion', 'reducedMotion');
    bindToggle('opt-reduced-flash', 'reducedFlash');

    el['opt-quality'].addEventListener('change', function (e) {
      ui.settings.quality = e.target.value;
      ui.saveSettings();
      applySettings();
    });
  }

  /* ---- full screen ------------------------------------------------------------------
   * Mostly for phones: a browser's address bar eats a good part of a portrait
   * viewport, and the playfield is sized to what is actually visible. iOS
   * Safari on iPhone has no element full-screen API, so the button stays
   * hidden there rather than offering something that cannot work. */

  function fullscreenSupported() {
    if (fullscreenBlocked) return false;
    var el = document.documentElement;
    if (!(el.requestFullscreen || el.webkitRequestFullscreen)) return false;
    var enabled = document.fullscreenEnabled;
    if (enabled === undefined) enabled = document.webkitFullscreenEnabled;
    return enabled !== false;
  }

  function fullscreenActive() {
    return !!(document.fullscreenElement || document.webkitFullscreenElement);
  }

  function fullscreenRelevant() {
    if (!fullscreenSupported()) return false;
    var coarse = false;
    try { coarse = global.matchMedia('(pointer: coarse)').matches; } catch (e) {}
    return coarse || global.innerWidth < 900;
  }

  function syncFullscreen() {
    ui.syncFullscreenButton(fullscreenRelevant(), fullscreenActive());
    var inGate = gateMode !== null;
    ui.setGameplayChromeVisible(!inGate && (world.isLive() || world.state === 'paused'));
  }

  /* Everything that reacts to the browser entering or leaving full screen,
   * including the gate opening and closing itself. */
  function onFullscreenChange() {
    var active = fullscreenActive();

    if (active && gateMode) {
      clearGateWait();
      var wasResume = gateMode === 'resume';
      closeGate();
      lockPortrait();
      if (wasResume) resumeGame(); else startRun();
    } else if (!active && !gateMode && fullscreenSupported() &&
               (world.isLive() || world.state === 'paused')) {
      /* Left full screen mid-run: pause behind the gate rather than letting
       * the run continue in a viewport that just changed height. */
      if (world.isLive()) pauseGame('fullscreen');
      openGate('resume');
    }

    syncFullscreen();
    resize();
  }

  function onFullscreenRefused() {
    fullscreenBlocked = true;
    clearGateWait();
    /* The button cannot work here, so stop pretending it can. */
    if (gateMode) openGate('unsupported');
    syncFullscreen();
  }

  function toggleFullscreen() {
    /* Some browsers fire blur when the fullscreen element changes; do not let
     * that auto-pause a live run. */
    suppressBlurUntil = performance.now() + 700;
    try {
      if (fullscreenActive()) {
        var exit = document.exitFullscreen || document.webkitExitFullscreen;
        if (exit) exit.call(document);
        return;
      }
      var el = document.documentElement;
      var request = el.requestFullscreen || el.webkitRequestFullscreen;
      if (!request) { onFullscreenRefused(); return; }
      var result = request.call(el);
      if (result && result.catch) result.catch(onFullscreenRefused);
    } catch (e) {
      onFullscreenRefused();
    }
  }

  function wireLifecycle() {
    /* A hidden tab or a lost focus pauses instead of quietly eating lives. */
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) pauseGame('hidden');
      else audio.resumeContext();
    });
    global.addEventListener('blur', function () {
      if (performance.now() < suppressBlurUntil) return;
      pauseGame('blur');
    });

    ['fullscreenchange', 'webkitfullscreenchange'].forEach(function (name) {
      document.addEventListener(name, onFullscreenChange);
    });
    global.addEventListener('pagehide', function () { pauseGame('hidden'); });

    var onResize = function () { resize(); syncFullscreen(); };
    global.addEventListener('resize', onResize);
    global.addEventListener('orientationchange', onResize);
    if (global.ResizeObserver) new ResizeObserver(onResize).observe(ui.el.app);
  }

  /* Prefer WebGL; fall back to Canvas 2D if a context cannot be created. Both
   * backends implement the same drawing interface and share src/scene.js, so
   * the two paths cannot drift apart visually. */
  function createRenderer() {
    /* ?renderer=2d forces the fallback, which makes it testable and gives a
     * way out if a device's WebGL driver misbehaves. */
    var forced = /[?&]renderer=2d\b/.test(global.location.search);
    try {
      if (forced) throw new Error('forced by ?renderer=2d');
      return new GG.RendererGL(ui.el.playfield, CONFIG, atlas);
    } catch (err) {
      console.warn('GALAXY GUNNER: WebGL unavailable, falling back to Canvas 2D.',
                   err && err.message);
      /* A canvas is bound to the first context type it hands out, and the
       * attempt above may already have taken a WebGL one - in which case
       * getContext('2d') would return null. Swap in a clean element first.
       * Input listeners live on #app, not the canvas, so this is safe. */
      var stale = ui.el.playfield;
      var fresh = stale.cloneNode(false);
      stale.parentNode.replaceChild(fresh, stale);
      ui.el.playfield = fresh;
      return new GG.Renderer2D(fresh, CONFIG, atlas);
    }
  }

  /* ---- start ---------------------------------------------------------------------- */

  function boot() {
    if (booted) return;
    booted = true;

    ui = new GG.UI(CONFIG);
    fx = new GG.Effects(CONFIG);
    audio = new GG.AudioEngine(CONFIG);
    quality = new GG.Quality(CONFIG);
    scene = new GG.Scene(CONFIG);

    world = new GG.World(CONFIG, { onEvent: onWorldEvent, fx: fx, audio: audio });

    input = new GG.InputController(ui.el.app, ui.el.playfield, {
      onPauseKey: togglePause,
      onSkill: useBomb,
      getLayout: function () { return renderer && renderer.layout; },
      onGesture: function () {
        if (!audio.unlocked) {
          audio.unlock().then(function () { applySettings(); });
        }
      }
    });

    Promise.resolve()
      .then(loadConfigOverrides)
      .then(function () {
        if (CONFIG.debug.hitboxes === undefined) CONFIG.debug.hitboxes = false;
        if (/[?&]debug\b/.test(global.location.search)) CONFIG.debug.hitboxes = true;
        /* The atlas is painted here, once, before the first frame. */
        atlas = GG.assets.build(CONFIG);
        renderer = createRenderer();
        /* Input listens on #app, but pointer coordinates are measured against
         * the canvas, which createRenderer may have replaced. */
        input.canvas = ui.el.playfield;
      })
      .then(function () {
        quality.onChange(onQualityChange);
        fx.applyQuality(quality.level);
        scene.setQuality(quality.level);
        ui.syncSettingInputs();
        applySettings();
        wireControls();
        wireLifecycle();
        resize();
        ui.setGameplayChromeVisible(false);
        syncFullscreen();
        ui.showScreen('menu');
        global.requestAnimationFrame(frame);
      })
      .catch(function (err) {
        console.error('GALAXY GUNNER failed to start', err);
        var text = document.getElementById('loading-text');
        if (text) text.textContent = 'Failed to load.';
      });
  }

  /* Exposed for the browser test hooks in tests/. */
  global.GALAXY_GUNNER = {
    get world() { return world; },
    get ui() { return ui; },
    get fx() { return fx; },
    get audio() { return audio; },
    get renderer() { return renderer; },
    get scene() { return scene; },
    get quality() { return quality; },
    get atlas() { return atlas; },
    get input() { return input; },
    startRun: startRun,
    pause: pauseGame,
    resume: resumeGame,
    bomb: useBomb,
    get backend() { return renderer && renderer.backend; },
    get drawCalls() { return renderer && renderer.drawCalls; },
    toggleFullscreen: toggleFullscreen,
    config: CONFIG
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window);
