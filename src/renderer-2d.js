/* Canvas 2D fallback.
 *
 * Implements exactly the interface renderer-gl.js exposes - begin, end,
 * sprite, spriteScaled, rect, drawText, measureText, resize - so src/scene.js
 * is written once and neither path can drift from the other visually.
 *
 * It draws from the same generated atlas canvas, so the artwork is identical.
 * Two concessions to the slower backend:
 *   - tinting is done by caching a tinted copy of each (sprite, colour) pair
 *     rather than per draw, because compositing a tint every frame is what
 *     makes 2D fallbacks crawl;
 *   - additive blending uses globalCompositeOperation 'lighter', which is the
 *     closest 2D equivalent and is disabled entirely on the Low quality level.
 */
(function (global) {
  'use strict';

  var Layout = global.GG.layout;
  var Color = global.GG.color;
  var TINT_CACHE_LIMIT = 160;

  function Renderer2D(canvas, config, atlas) {
    this.canvas = canvas;
    this.config = config;
    this.atlas = atlas;
    this.frames = atlas.frames;
    this.sheet = atlas.canvas;
    this.backend = 'canvas2d';
    this.ctx = canvas.getContext('2d');
    if (!this.ctx) throw new Error('Canvas 2D is not available');
    this.layout = null;
    this.dpr = 1;
    this.tints = {};
    this.tintKeys = [];
    this.blend = 'normal';
    this.drawCalls = 0;
  }

  Renderer2D.prototype.resize = function (cssW, cssH, dprCap) {
    var cap = Math.min(dprCap || this.config.view.maxDpr, this.config.view.maxDpr);
    var dpr = Math.min(global.devicePixelRatio || 1, cap);
    var pw = Math.max(1, Math.round(cssW * dpr));
    var ph = Math.max(1, Math.round(cssH * dpr));
    if (this.canvas.width !== pw || this.canvas.height !== ph) {
      this.canvas.width = pw;
      this.canvas.height = ph;
    }
    this.dpr = dpr;
    this.layout = Layout.compute(this.config, cssW, cssH);
    return this.layout;
  };

  Renderer2D.prototype.begin = function (clearColor) {
    var ctx = this.ctx;
    var l = this.layout;
    if (!l) return false;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.blend = 'normal';
    ctx.fillStyle = Color.css(clearColor);
    ctx.fillRect(0, 0, l.W, l.H);
    this.drawCalls = 0;
    return true;
  };

  Renderer2D.prototype.end = function () {
    this.ctx.globalCompositeOperation = 'source-over';
    this.ctx.globalAlpha = 1;
  };

  Renderer2D.prototype.setBlend = function (mode) {
    if (mode === this.blend) return;
    this.blend = mode;
    this.ctx.globalCompositeOperation = mode === 'add' ? 'lighter' : 'source-over';
  };

  /* ---- tint cache ---------------------------------------------------------
   * 'source-in' over a solid fill gives the same result the GL shader gets
   * from multiplying rgb by the tint. Cached per (sprite, colour) because the
   * game only uses a handful of tints. */
  Renderer2D.prototype.tinted = function (name, tint) {
    var key = name + '|' + tint;
    var hit = this.tints[key];
    if (hit) return hit;

    var f = this.frames[name];
    if (!f) return null;
    var c = document.createElement('canvas');
    c.width = f.w;
    c.height = f.h;
    var g = c.getContext('2d');
    g.drawImage(this.sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);
    g.globalCompositeOperation = 'multiply';
    g.fillStyle = Color.css(tint);
    g.fillRect(0, 0, f.w, f.h);
    /* multiply also darkens the transparent border, so punch the alpha back */
    g.globalCompositeOperation = 'destination-in';
    g.drawImage(this.sheet, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h);

    if (this.tintKeys.length >= TINT_CACHE_LIMIT) {
      delete this.tints[this.tintKeys.shift()];
    }
    this.tintKeys.push(key);
    this.tints[key] = c;
    return c;
  };

  Renderer2D.prototype.blit = function (name, x, y, sx, sy, rotation, tint, alpha, blend) {
    var f = this.frames[name];
    if (!f) return;
    var ctx = this.ctx;
    var l = this.layout;
    this.setBlend(blend || 'normal');
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;

    var w = f.dw * sx * l.scale;
    var h = f.dh * sy * l.scale;
    var cx = (x + l.offsetX) * l.scale;
    var cy = y * l.scale;

    var source = this.sheet, srcX = f.x, srcY = f.y;
    if (tint) {
      var t = this.tinted(name, tint);
      if (t) { source = t; srcX = 0; srcY = 0; }
    }

    if (rotation) {
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(rotation);
      ctx.drawImage(source, srcX, srcY, f.w, f.h, -w / 2, -h / 2, w, h);
      ctx.restore();
    } else {
      ctx.drawImage(source, srcX, srcY, f.w, f.h, cx - w / 2, cy - h / 2, w, h);
    }
    this.drawCalls++;
  };

  Renderer2D.prototype.sprite = function (name, x, y, scale, rotation, tint, alpha, blend) {
    var s = scale === undefined ? 1 : scale;
    this.blit(name, x, y, s, s, rotation, tint, alpha, blend);
  };

  Renderer2D.prototype.spriteScaled = function (name, x, y, sx, sy, rotation, tint, alpha, blend) {
    this.blit(name, x, y, sx, sy, rotation, tint, alpha, blend);
  };

  Renderer2D.prototype.rect = function (x, y, w, h, tint, alpha, blend) {
    var ctx = this.ctx;
    var l = this.layout;
    this.setBlend(blend || 'normal');
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = Color.css(tint || '#ffffff');
    ctx.fillRect((x + l.offsetX) * l.scale, y * l.scale, w * l.scale, h * l.scale);
    this.drawCalls++;
  };

  var SIZES = { score: 'scoreSize', label: 'labelSize', banner: 'bannerSize' };

  Renderer2D.prototype.font = function (size) {
    var l = this.layout;
    return '700 ' + (l[SIZES[size] || 'labelSize'] * l.scale) + 'px ' + Layout.FONT;
  };

  Renderer2D.prototype.drawText = function (text, size, x, y, tint, alpha, align, scale) {
    var ctx = this.ctx;
    var l = this.layout;
    this.setBlend('normal');
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = Color.css(tint || '#ffffff');
    ctx.textAlign = align === 1 ? 'right' : align === -1 ? 'left' : 'center';
    ctx.textBaseline = 'middle';
    var px = (x + l.offsetX) * l.scale;
    var py = y * l.scale;
    if (scale && scale !== 1) {
      ctx.save();
      ctx.translate(px, py);
      ctx.scale(scale, scale);
      ctx.font = this.font(size);
      ctx.fillText(text, 0, 0);
      ctx.restore();
    } else {
      ctx.font = this.font(size);
      ctx.fillText(text, px, py);
    }
    this.drawCalls++;
  };

  Renderer2D.prototype.measureText = function (text, size) {
    this.ctx.font = this.font(size);
    return this.ctx.measureText(text).width / this.layout.scale;
  };

  global.GG = global.GG || {};
  global.GG.Renderer2D = Renderer2D;
})(window);
