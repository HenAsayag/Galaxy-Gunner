/* MobileInput - one drag, no joystick.
 *
 * Registered exactly once at boot, so repeated restarts can never multiply
 * listeners. Pointer Events only: no parallel touchstart + click pair, which
 * is the usual source of a phone registering one gesture twice.
 *
 * Rules the brief is specific about, and how they are met here:
 *   - drag anywhere on the playfield moves the ship                    -> DRAG_ZONE
 *   - the ship sits above the finger so it stays visible               -> config.player.fingerOffsetY
 *   - multi-touch must not interrupt movement                          -> activeId, extra fingers ignored
 *   - touchcancel must be handled                                      -> pointercancel releases cleanly
 *   - the page must not scroll during play                             -> touch-action:none + preventDefault
 *
 * Releasing the finger does NOT recentre the ship: it holds station, because
 * yanking the ship on release is how a player loses a run they had already
 * dodged.
 */
(function (global) {
  'use strict';

  var M = global.GG.math;
  var Layout = global.GG.layout;

  var DRAG_ZONE = 0;              /* the whole playfield accepts steering */
  var KEY_SPEED = 620;            /* world units / sec for keyboard steering */

  var MOVE_KEYS = {
    ArrowLeft: [-1, 0], KeyA: [-1, 0],
    ArrowRight: [1, 0], KeyD: [1, 0],
    ArrowUp: [0, -1], KeyW: [0, -1],
    ArrowDown: [0, 1], KeyS: [0, 1]
  };
  var PAUSE_KEYS = { Escape: 1, KeyP: 1 };
  var SKILL_KEYS = { Space: 1, Enter: 1 };

  function InputController(root, canvas, handlers) {
    this.root = root;
    this.canvas = canvas;
    this.handlers = handlers;
    this.enabled = false;
    this.activeId = null;
    this.keys = {};
    this.pointer = null;          /* { x, y } in world units */
    this.pointerIsMouse = false;
    this.sample = { x: 0, y: 0, offsetY: 0 };
    this.kb = null;               /* keyboard-steered point, world units */
    this.lastSource = null;       /* 'pointer' | 'key' */
    this.bound = {};
    this.attach();
  }

  /* Is this event meant for the playfield, or for a button sitting over it? */
  InputController.prototype.isPlayfieldEvent = function (event) {
    var target = event.target;
    if (!target || !target.closest) return true;
    if (target.closest('.no-drag')) return false;
    if (target.closest('.screen')) return false;
    return true;
  };

  InputController.prototype.toWorld = function (event, layout) {
    var rect = this.canvas.getBoundingClientRect();
    return Layout.toWorld(layout, event.clientX - rect.left, event.clientY - rect.top);
  };

  InputController.prototype.attach = function () {
    var self = this;

    this.bound.pointerdown = function (event) {
      /* the first gesture anywhere unlocks audio, menu buttons included */
      self.handlers.onGesture(event);
      if (!self.enabled) return;
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      if (!self.isPlayfieldEvent(event)) return;

      var layout = self.handlers.getLayout();
      if (!layout) return;
      var p = self.toWorld(event, layout);
      /* Buttons are excluded above; the remaining playfield accepts drags. */
      if (p.y < layout.worldH * DRAG_ZONE) return;

      /* A second finger never steals control from the one already steering. */
      if (self.activeId !== null) return;
      self.activeId = event.pointerId;
      self.pointer = p;
      self.pointerIsMouse = event.pointerType === 'mouse';
      self.lastSource = 'pointer';
      event.preventDefault();
      if (self.canvas.setPointerCapture) {
        try { self.canvas.setPointerCapture(event.pointerId); } catch (e) {}
      }
    };

    this.bound.pointermove = function (event) {
      if (!self.enabled) return;
      /* On desktop the ship follows the cursor whether or not a button is
       * held - "mouse move OR click-drag" from the brief. On touch only the
       * finger that started the drag steers. */
      var isMouse = event.pointerType === 'mouse';
      if (!isMouse && event.pointerId !== self.activeId) return;
      if (isMouse && self.activeId === null && !self.isPlayfieldEvent(event)) return;

      var layout = self.handlers.getLayout();
      if (!layout) return;
      var p = self.toWorld(event, layout);
      if (isMouse && self.activeId === null && p.y < layout.worldH * DRAG_ZONE) return;

      self.pointer = p;
      self.pointerIsMouse = isMouse;
      self.lastSource = 'pointer';
      if (!isMouse) event.preventDefault();
    };

    /* pointerup, pointercancel and a lost capture all land here. */
    this.bound.pointerend = function (event) {
      if (event.pointerId !== self.activeId) return;
      self.activeId = null;
      /* self.pointer is deliberately kept: the ship holds its last position */
    };

    this.bound.keydown = function (event) {
      if (event.ctrlKey || event.metaKey || event.altKey) return;

      if (PAUSE_KEYS[event.code]) {
        event.preventDefault();
        self.handlers.onPauseKey();
        return;
      }

      var active = document.activeElement;
      var inWidget = active && (active.tagName === 'BUTTON' || active.tagName === 'INPUT' ||
                                active.tagName === 'A' || active.isContentEditable);

      if (SKILL_KEYS[event.code]) {
        self.handlers.onGesture(event);
        if (inWidget || !self.enabled) return;   /* let Space activate a button */
        event.preventDefault();
        if (!event.repeat) self.handlers.onSkill();
        return;
      }

      if (!MOVE_KEYS[event.code]) return;
      self.handlers.onGesture(event);
      if (!self.enabled || inWidget) return;
      event.preventDefault();
      self.keys[event.code] = true;
      self.lastSource = 'key';
    };

    this.bound.keyup = function (event) {
      if (MOVE_KEYS[event.code]) delete self.keys[event.code];
    };

    this.bound.contextmenu = function (event) {
      if (self.isPlayfieldEvent(event)) event.preventDefault();
    };

    /* A dropped focus must not leave a key stuck down. */
    this.bound.blur = function () {
      self.keys = {};
      self.activeId = null;
    };

    this.root.addEventListener('pointerdown', this.bound.pointerdown, { passive: false });
    this.root.addEventListener('pointermove', this.bound.pointermove, { passive: false });
    this.root.addEventListener('pointerup', this.bound.pointerend);
    this.root.addEventListener('pointercancel', this.bound.pointerend);
    this.root.addEventListener('lostpointercapture', this.bound.pointerend);
    this.root.addEventListener('contextmenu', this.bound.contextmenu);
    global.addEventListener('keydown', this.bound.keydown);
    global.addEventListener('keyup', this.bound.keyup);
    global.addEventListener('blur', this.bound.blur);
  };

  InputController.prototype.setEnabled = function (enabled) {
    this.enabled = !!enabled;
    if (!enabled) {
      this.activeId = null;
      this.keys = {};
    }
  };

  /* Forget where the finger was, so a new run does not inherit the last one's
   * steering target. */
  InputController.prototype.reset = function () {
    this.pointer = null;
    this.pointerIsMouse = false;
    this.sample = { x: 0, y: 0, offsetY: 0 };
    this.kb = null;
    this.activeId = null;
    this.keys = {};
    this.lastSource = null;
  };

  /* Called once per frame by the main loop. Returns the desired ship position
   * in world units, plus how far above the contact point it should sit, or
   * null when the player is not steering at all. */
  InputController.prototype.read = function (player, layout, dt, fingerOffsetY) {
    var dx = 0, dy = 0;
    for (var code in this.keys) {
      if (!this.keys[code]) continue;
      var v = MOVE_KEYS[code];
      dx += v[0];
      dy += v[1];
    }

    /* One scratch object, reused every frame. This runs sixty times a second
     * for the whole run, so returning a fresh literal would be the largest
     * remaining source of steady garbage. */
    var out = this.sample;

    if (dx || dy) {
      var len = Math.sqrt(dx * dx + dy * dy) || 1;
      if (!this.kb) this.kb = { x: player.x, y: player.y };
      var step = KEY_SPEED * (dt / 1000);
      this.kb.x = M.clamp(this.kb.x + dx / len * step, 0, layout.worldW);
      this.kb.y = M.clamp(this.kb.y + dy / len * step, 0, layout.worldH);
      this.lastSource = 'key';
      out.x = this.kb.x; out.y = this.kb.y; out.offsetY = 0;
      return out;
    }

    /* Keyboard steering that has stopped still holds its last point, exactly
     * like a lifted finger does. */
    if (this.lastSource === 'key' && this.kb) {
      out.x = this.kb.x; out.y = this.kb.y; out.offsetY = 0;
      return out;
    }

    if (this.pointer) {
      this.kb = null;
      out.x = this.pointer.x;
      out.y = this.pointer.y;
      /* A cursor is not a fingertip: it does not cover the ship, so it gets no
       * vertical offset. */
      out.offsetY = this.pointerIsMouse ? 0 : fingerOffsetY;
      return out;
    }
    return null;
  };

  global.GG = global.GG || {};
  global.GG.InputController = InputController;
  global.GG.DRAG_ZONE = DRAG_ZONE;
})(window);
