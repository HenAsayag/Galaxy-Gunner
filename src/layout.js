/* Viewport fitting, shared by both renderer backends.
 *
 * The simulation runs in a virtual portrait field. Its WIDTH is fixed at
 * config.view.baseWidth so horizontal difficulty - the width of a bullet lane,
 * the reach of a dodge - is identical on every device. Its HEIGHT flexes with
 * the device aspect between minHeight and maxHeight, so a 16:9 and a 19.5:9
 * phone both get a full-bleed playfield instead of black bars.
 *
 * Only when the window is wider than maxWidth (landscape, desktop) does the
 * field stop growing and sit centred, with the starfield painted across the
 * margins so the edges never look cut off.
 *
 * All returned values are CSS pixels except worldW/worldH, which are world
 * units. Device pixel ratio is handled by the renderer, so a DPR change never
 * alters the composition.
 */
(function (global) {
  'use strict';

  function compute(config, cssW, cssH) {
    var V = config.view;

    /* Width-driven first: one world unit == cssW / baseWidth CSS px. */
    var scale = cssW / V.baseWidth;
    var worldH = cssH / scale;

    if (worldH > V.maxHeight) {        /* very tall: grow by height instead */
      scale = cssH / V.maxHeight;
      worldH = V.maxHeight;
    } else if (worldH < V.minHeight) { /* short or landscape */
      scale = cssH / V.minHeight;
      worldH = V.minHeight;
    }

    var worldW = cssW / scale;
    var offsetX = 0;
    if (worldW > V.maxWidth) {         /* wide window: centre the field */
      offsetX = (worldW - V.maxWidth) / 2;
      worldW = V.maxWidth;
    }

    /* Notch / home-indicator insets, read from the CSS environment via the
     * padding the stylesheet puts on #app. Converted to world units so the
     * HUD can be pushed clear of them. */
    var insets = readInsets();

    return {
      W: cssW,
      H: cssH,
      scale: scale,
      worldW: worldW,
      worldH: worldH,
      /* world (0,0) is the top-left of the playfield */
      offsetX: offsetX,
      originX: offsetX * scale,
      /* full canvas expressed in world units, for background painting */
      canvasW: cssW / scale,
      canvasH: cssH / scale,
      topInset: insets.top / scale,
      bottomInset: insets.bottom / scale,
      /* HUD metrics, in world units */
      hudTop: insets.top / scale + 14,
      scoreSize: 40,
      labelSize: 17,
      bannerSize: 30
    };
  }

  var probe = null;

  /* env(safe-area-inset-*) is only readable through a real element. One hidden
   * probe is created once and reused; its computed padding carries the live
   * inset values on every browser that supports them. */
  function readInsets() {
    if (typeof document === 'undefined') return { top: 0, bottom: 0 };
    if (!probe) {
      probe = document.createElement('div');
      probe.style.cssText =
        'position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;' +
        'padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)';
      document.body.appendChild(probe);
    }
    var s = global.getComputedStyle(probe);
    return {
      top: parseFloat(s.paddingTop) || 0,
      bottom: parseFloat(s.paddingBottom) || 0
    };
  }

  /* Pointer position (CSS px, relative to the canvas) -> world units. */
  function toWorld(layout, cssX, cssY) {
    return {
      x: cssX / layout.scale - layout.offsetX,
      y: cssY / layout.scale
    };
  }

  global.GG = global.GG || {};
  global.GG.layout = {
    compute: compute,
    toWorld: toWorld,
    FONT: '"Segoe UI", system-ui, -apple-system, "Helvetica Neue", Arial, sans-serif'
  };
})(window);
