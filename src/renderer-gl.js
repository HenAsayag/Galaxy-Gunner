/* WebGL sprite batcher.
 *
 * The previous build drew the whole playfield as one analytic ring in a
 * fragment shader. A bullet hell needs the opposite: thousands of small
 * textured quads. This replaces the ring pass with a streaming batcher.
 *
 * Everything the game draws - ships, bullets, particles, pickups, the
 * starfield, the HUD glyphs - comes out of ONE atlas texture plus one glyph
 * atlas, so a full frame at maximum density costs roughly:
 *
 *   1 draw call for the normal-blend pass
 *   1 draw call for the additive pass
 *   1 draw call for the text pass
 *
 * A batch flushes only when the texture or the blend mode changes, so the
 * scene draws in ordered passes (background -> entities -> additive VFX ->
 * HUD) rather than sorting per sprite.
 *
 * Vertex layout, 8 floats: x, y, u, v, r, g, b, a. Positions are CSS pixels
 * with y growing downward; the vertex shader maps them to clip space.
 */
(function (global) {
  'use strict';

  var GL = global.GG.gl;
  var Layout = global.GG.layout;
  var Color = global.GG.color;

  var MAX_QUADS = 4000;
  var FLOATS_PER_VERTEX = 8;
  var FLOATS_PER_QUAD = FLOATS_PER_VERTEX * 4;

  var VS = [
    'attribute vec2 a_pos;',
    'attribute vec2 a_uv;',
    'attribute vec4 a_color;',
    'uniform vec2 u_res;',
    'varying vec2 v_uv;',
    'varying vec4 v_color;',
    'void main() {',
    '  vec2 clip = vec2(a_pos.x / u_res.x, 1.0 - a_pos.y / u_res.y) * 2.0 - 1.0;',
    '  v_uv = a_uv;',
    '  v_color = a_color;',
    '  gl_Position = vec4(clip, 0.0, 1.0);',
    '}'
  ].join('\n');

  /* The atlas is uploaded premultiplied, so a tint multiplies rgb by the tint
   * colour and the whole texel by the vertex alpha. Additive draws use the
   * same shader with a different blend func - no second program needed. */
  var FS = [
    'precision mediump float;',
    'varying vec2 v_uv;',
    'varying vec4 v_color;',
    'uniform sampler2D u_tex;',
    'void main() {',
    '  vec4 c = texture2D(u_tex, v_uv);',
    '  gl_FragColor = vec4(c.rgb * v_color.rgb, c.a) * v_color.a;',
    '}'
  ].join('\n');

  function RendererGL(canvas, config, atlas) {
    this.canvas = canvas;
    this.config = config;
    this.atlas = atlas;
    this.frames = atlas.frames;
    this.backend = 'webgl';
    this.layout = null;
    this.dpr = 1;
    this.lost = false;

    var gl = GL.createContext(canvas);
    if (!gl) throw new Error('WebGL is not available');
    this.gl = gl;

    this.program = GL.createProgram(gl, VS, FS);
    this.vertices = new Float32Array(MAX_QUADS * FLOATS_PER_QUAD);
    this.vbo = GL.createDynamicBuffer(gl, this.vertices.byteLength);
    this.ibo = GL.createQuadIndices(gl, MAX_QUADS);

    this.sheet = GL.createTexture(gl, atlas.canvas);
    this.text = new GL.TextAtlas(gl, Layout.FONT);
    this.textSizes = null;
    this.textKeys = [];

    this.quads = 0;
    this.currentTexture = null;
    this.currentBlend = 'normal';
    this.drawCalls = 0;

    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);

    this.handleContextLost = this.handleContextLost.bind(this);
    canvas.addEventListener('webglcontextlost', this.handleContextLost);
  }

  RendererGL.prototype.handleContextLost = function (event) {
    event.preventDefault();
    this.lost = true;
    console.warn('GALAXY GUNNER: WebGL context lost');
  };

  /* ---- sizing ------------------------------------------------------------ */

  RendererGL.prototype.resize = function (cssW, cssH, dprCap) {
    var gl = this.gl;
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
    gl.viewport(0, 0, pw, ph);
    this.rebuildText();
    return this.layout;
  };

  /* Glyphs are rasterised at the exact device-pixel sizes in use, so the score
   * stays crisp at any DPR instead of being scaled from one baked size. */
  RendererGL.prototype.rebuildText = function () {
    var l = this.layout;
    var s = l.scale * this.dpr;
    var sizes = [
      { key: 'score', px: Math.max(8, Math.round(l.scoreSize * s)) },
      { key: 'label', px: Math.max(8, Math.round(l.labelSize * s)) },
      { key: 'banner', px: Math.max(8, Math.round(l.bannerSize * s)) }
    ];
    var signature = sizes.map(function (x) { return x.px; }).join(':');
    if (this.textSizes === signature) return;
    this.textSizes = signature;
    this.text.build(sizes);
    this.textKeys = ['score', 'label', 'banner'];
  };

  /* ---- frame ------------------------------------------------------------- */

  RendererGL.prototype.begin = function (clearColor) {
    if (this.lost) return false;
    var gl = this.gl;
    var c = Color.unit(clearColor);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(c[0], c[1], c[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.program.program);
    gl.uniform2f(this.program.u.u_res, this.layout.W, this.layout.H);
    gl.activeTexture(gl.TEXTURE0);
    gl.uniform1i(this.program.u.u_tex, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);
    var stride = FLOATS_PER_VERTEX * 4;
    var a = this.program.a;
    gl.enableVertexAttribArray(a.a_pos);
    gl.vertexAttribPointer(a.a_pos, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(a.a_uv);
    gl.vertexAttribPointer(a.a_uv, 2, gl.FLOAT, false, stride, 8);
    gl.enableVertexAttribArray(a.a_color);
    gl.vertexAttribPointer(a.a_color, 4, gl.FLOAT, false, stride, 16);

    this.quads = 0;
    this.currentTexture = null;
    this.drawCalls = 0;
    this.currentBlend = null;      /* force the first setBlend to take effect */
    this.setBlend('normal');
    return true;
  };

  RendererGL.prototype.setBlend = function (mode) {
    if (mode === this.currentBlend) return;
    if (this.quads) this.flush();
    var gl = this.gl;
    /* Both paths assume premultiplied source. Additive simply skips the
     * destination attenuation, which is what makes overlapping muzzle flashes
     * and explosions bloom instead of flatten. */
    if (mode === 'add') gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    this.currentBlend = mode;
  };

  RendererGL.prototype.flush = function () {
    if (!this.quads || !this.currentTexture) { this.quads = 0; return; }
    var gl = this.gl;
    gl.bindTexture(gl.TEXTURE_2D, this.currentTexture);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0,
      this.vertices.subarray(0, this.quads * FLOATS_PER_QUAD));
    gl.drawElements(gl.TRIANGLES, this.quads * 6, gl.UNSIGNED_SHORT, 0);
    this.drawCalls++;
    this.quads = 0;
  };

  RendererGL.prototype.end = function () {
    this.flush();
  };

  /* ---- quad emission ------------------------------------------------------
   * `push` takes four already-transformed corners so rotation, scaling and
   * the world->CSS mapping all happen once, on the caller's side. */

  RendererGL.prototype.use = function (texture) {
    if (texture === this.currentTexture) return;
    if (this.quads) this.flush();
    this.currentTexture = texture;
  };

  RendererGL.prototype.push = function (x0, y0, x1, y1, x2, y2, x3, y3,
                                        u0, v0, u1, v1, r, g, b, a) {
    if (this.quads >= MAX_QUADS) this.flush();
    var v = this.vertices;
    var o = this.quads * FLOATS_PER_QUAD;
    v[o] = x0; v[o + 1] = y0; v[o + 2] = u0; v[o + 3] = v0;
    v[o + 4] = r; v[o + 5] = g; v[o + 6] = b; v[o + 7] = a;
    v[o + 8] = x1; v[o + 9] = y1; v[o + 10] = u1; v[o + 11] = v0;
    v[o + 12] = r; v[o + 13] = g; v[o + 14] = b; v[o + 15] = a;
    v[o + 16] = x2; v[o + 17] = y2; v[o + 18] = u1; v[o + 19] = v1;
    v[o + 20] = r; v[o + 21] = g; v[o + 22] = b; v[o + 23] = a;
    v[o + 24] = x3; v[o + 25] = y3; v[o + 26] = u0; v[o + 27] = v1;
    v[o + 28] = r; v[o + 29] = g; v[o + 30] = b; v[o + 31] = a;
    this.quads++;
  };

  /* ---- the public drawing interface --------------------------------------
   * renderer-2d.js implements exactly these five methods, so src/scene.js is
   * written once and runs on either backend. */

  var WHITE = [1, 1, 1];

  /* x, y are the sprite CENTRE in world units. */
  RendererGL.prototype.sprite = function (name, x, y, scale, rotation, tint, alpha, blend) {
    var f = this.frames[name];
    if (!f) return;
    this.setBlend(blend || 'normal');
    this.use(this.sheet);

    var l = this.layout;
    var s = l.scale * (scale === undefined ? 1 : scale);
    var hw = f.dw * 0.5 * s;
    var hh = f.dh * 0.5 * s;
    var cx = (x + l.offsetX) * l.scale;
    var cy = y * l.scale;
    var c = tint ? Color.unit(tint) : WHITE;
    var a = alpha === undefined ? 1 : alpha;

    if (!rotation) {
      this.push(cx - hw, cy - hh, cx + hw, cy - hh, cx + hw, cy + hh, cx - hw, cy + hh,
                f.u0, f.v0, f.u1, f.v1, c[0], c[1], c[2], a);
      return;
    }
    var co = Math.cos(rotation), si = Math.sin(rotation);
    var xw = hw * co, yw = hw * si;
    var xh = hh * si, yh = hh * co;
    this.push(cx - xw + xh, cy - yw - yh,
              cx + xw + xh, cy + yw - yh,
              cx + xw - xh, cy + yw + yh,
              cx - xw - xh, cy - yw + yh,
              f.u0, f.v0, f.u1, f.v1, c[0], c[1], c[2], a);
  };

  /* Independent axis scaling, for beams and stretched trails. */
  RendererGL.prototype.spriteScaled = function (name, x, y, sx, sy, rotation, tint, alpha, blend) {
    var f = this.frames[name];
    if (!f) return;
    this.setBlend(blend || 'normal');
    this.use(this.sheet);

    var l = this.layout;
    var hw = f.dw * 0.5 * sx * l.scale;
    var hh = f.dh * 0.5 * sy * l.scale;
    var cx = (x + l.offsetX) * l.scale;
    var cy = y * l.scale;
    var c = tint ? Color.unit(tint) : WHITE;
    var a = alpha === undefined ? 1 : alpha;
    var co = Math.cos(rotation || 0), si = Math.sin(rotation || 0);
    var xw = hw * co, yw = hw * si;
    var xh = hh * si, yh = hh * co;
    this.push(cx - xw + xh, cy - yw - yh,
              cx + xw + xh, cy + yw - yh,
              cx + xw - xh, cy + yw + yh,
              cx - xw - xh, cy - yw + yh,
              f.u0, f.v0, f.u1, f.v1, c[0], c[1], c[2], a);
  };

  /* Axis-aligned solid rectangle in world units (HUD bars, letterbox fill). */
  RendererGL.prototype.rect = function (x, y, w, h, tint, alpha, blend) {
    var f = this.frames.px;
    this.setBlend(blend || 'normal');
    this.use(this.sheet);
    var l = this.layout;
    var x0 = (x + l.offsetX) * l.scale, y0 = y * l.scale;
    var x1 = x0 + w * l.scale, y1 = y0 + h * l.scale;
    var c = tint ? Color.unit(tint) : WHITE;
    /* Inset by a texel so the sampler cannot bleed a neighbour into the fill. */
    var du = (f.u1 - f.u0) * 0.25, dv = (f.v1 - f.v0) * 0.25;
    this.push(x0, y0, x1, y0, x1, y1, x0, y1,
              f.u0 + du, f.v0 + dv, f.u1 - du, f.v1 - dv,
              c[0], c[1], c[2], alpha === undefined ? 1 : alpha);
  };

  /* align: -1 left, 0 centre, 1 right. `size` selects a baked glyph row. */
  RendererGL.prototype.drawText = function (text, size, x, y, tint, alpha, align, scale) {
    var set = this.text.sets[size];
    if (!set) return;
    this.setBlend('normal');
    this.use(this.text.texture);

    var l = this.layout;
    scale = scale === undefined ? 1 : scale;
    var toCss = scale / this.dpr;
    var total = this.text.measure(size, text) * toCss;
    var px = (x + l.offsetX) * l.scale;
    var py = y * l.scale;
    var cursor = align === 1 ? px - total : align === -1 ? px : px - total / 2;
    var c = tint ? Color.unit(tint) : WHITE;
    var a = alpha === undefined ? 1 : alpha;

    for (var i = 0; i < text.length; i++) {
      var g = set.glyphs[text[i]];
      if (!g) continue;
      var w = g.w * toCss, h = g.h * toCss;
      var gx = cursor - g.pad * toCss, gy = py - h / 2;
      this.push(gx, gy, gx + w, gy, gx + w, gy + h, gx, gy + h,
                g.u0, g.v0, g.u1, g.v1, c[0], c[1], c[2], a);
      cursor += g.advance * toCss;
    }
  };

  RendererGL.prototype.measureText = function (text, size) {
    return this.text.measure(size, text) / this.dpr / this.layout.scale;
  };

  global.GG = global.GG || {};
  global.GG.RendererGL = RendererGL;
})(window);
