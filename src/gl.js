/* Minimal WebGL plumbing: context creation, program compilation, quad and
 * streaming buffers, textures and a glyph atlas. No dependencies, WebGL 1
 * only, so it runs anywhere the game does.
 *
 * Carried over from the previous build. The only changes for GALAXY GUNNER are
 * a wider glyph set and the dynamic/index buffer helpers that the sprite
 * batcher needs. */
(function (global) {
  'use strict';

  function createContext(canvas) {
    var options = {
      alpha: false,
      antialias: false,      /* the shaders anti-alias their own edges */
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance'
    };
    var gl = null;
    try {
      gl = canvas.getContext('webgl', options) || canvas.getContext('experimental-webgl', options);
    } catch (e) {
      gl = null;
    }
    return gl;
  }

  function compile(gl, type, source) {
    var shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      var log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compile failed: ' + log);
    }
    return shader;
  }

  /* Builds a program and caches every uniform and attribute location on it. */
  function createProgram(gl, vertexSource, fragmentSource) {
    var vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
    var fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
    var program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      var log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error('Program link failed: ' + log);
    }

    var wrapper = { program: program, u: {}, a: {} };
    var uniforms = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (var i = 0; i < uniforms; i++) {
      var info = gl.getActiveUniform(program, i);
      /* array uniforms report as "name[0]" */
      var name = info.name.replace(/\[0\]$/, '');
      wrapper.u[name] = gl.getUniformLocation(program, info.name);
    }
    var attribs = gl.getProgramParameter(program, gl.ACTIVE_ATTRIBUTES);
    for (var j = 0; j < attribs; j++) {
      var ainfo = gl.getActiveAttrib(program, j);
      wrapper.a[ainfo.name] = gl.getAttribLocation(program, ainfo.name);
    }
    return wrapper;
  }

  /* A unit quad, used by every pass. */
  function createQuad(gl) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      0, 0, 1, 0, 0, 1,
      0, 1, 1, 0, 1, 1
    ]), gl.STATIC_DRAW);
    return buffer;
  }

  /* NPOT-safe texture setup: clamped, linear, no mipmaps. */
  function createTexture(gl, source) {
    var texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    return texture;
  }

  /* ---- glyph atlas ------------------------------------------------------
   * Text in WebGL needs glyphs as pixels. We rasterise the handful of
   * characters the game actually shows ("0123456789+") onto an offscreen 2D
   * canvas at the exact device-pixel sizes in use, then upload it once. It is
   * rebuilt on resize, so digits stay crisp at any DPR instead of being scaled
   * up from one baked size.
   */
  var GLYPHS = "0123456789+-x.,:!?/%'" +
               'ABCDEFGHIJKLMNOPQRSTUVWXYZ' +
               'abcdefghijklmnopqrstuvwxyz ';

  function TextAtlas(gl, fontFamily) {
    this.gl = gl;
    this.fontFamily = fontFamily;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.texture = null;
    this.sets = {};
  }

  /* `sizes` is [{ key, px }] in DEVICE pixels. */
  TextAtlas.prototype.build = function (sizes) {
    var ctx = this.ctx;
    var pad = 2;
    var rows = [];
    var width = 0;
    var height = pad;
    var self = this;

    sizes.forEach(function (size) {
      ctx.font = '700 ' + size.px + 'px ' + self.fontFamily;
      var glyphs = {};
      var x = pad;
      /* Tabular advance: every digit occupies the widest digit's width. */
      var digitAdvance = 0;
      for (var i = 0; i < 10; i++) {
        digitAdvance = Math.max(digitAdvance, ctx.measureText(String(i)).width);
      }
      var rowHeight = Math.ceil(size.px * 1.45);   /* room for descenders */
      for (var g = 0; g < GLYPHS.length; g++) {
        var ch = GLYPHS[g];
        var w = Math.ceil(ctx.measureText(ch).width) + pad * 2;
        glyphs[ch] = { x: x, w: w, advance: ch >= '0' && ch <= '9' ? digitAdvance : ctx.measureText(ch).width };
        x += w + pad;
      }
      rows.push({ key: size.key, px: size.px, y: height, rowHeight: rowHeight, glyphs: glyphs, width: x });
      width = Math.max(width, x);
      height += rowHeight + pad;
    });

    this.canvas.width = Math.max(1, width);
    this.canvas.height = Math.max(1, height);

    /* Re-measure after the resize, which resets the 2D context state. */
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#ffffff';       /* white, tinted per draw in the shader */

    this.sets = {};
    rows.forEach(function (row) {
      ctx.font = '700 ' + row.px + 'px ' + self.fontFamily;
      var set = { px: row.px, height: row.rowHeight, glyphs: {} };
      Object.keys(row.glyphs).forEach(function (ch) {
        var g = row.glyphs[ch];
        ctx.fillText(ch, g.x + pad, row.y + row.rowHeight / 2);
        set.glyphs[ch] = {
          u0: g.x / self.canvas.width,
          v0: row.y / self.canvas.height,
          u1: (g.x + g.w) / self.canvas.width,
          v1: (row.y + row.rowHeight) / self.canvas.height,
          w: g.w,
          h: row.rowHeight,
          advance: g.advance,
          pad: pad
        };
      });
      self.sets[row.key] = set;
    });

    var gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    this.texture = createTexture(gl, this.canvas);
    return this.sets;
  };

  /* Total width of `text` in device pixels, using tabular advances. */
  TextAtlas.prototype.measure = function (key, text) {
    var set = this.sets[key];
    if (!set) return 0;
    var total = 0;
    for (var i = 0; i < text.length; i++) {
      var g = set.glyphs[text[i]];
      if (g) total += g.advance;
    }
    return total;
  };

  /* ---- streaming geometry -----------------------------------------------
   * The sprite batcher fills one interleaved vertex buffer per frame and
   * indexes it with a static quad index list, so a whole frame of bullets,
   * enemies and particles costs a handful of draw calls rather than one per
   * sprite. */

  function createDynamicBuffer(gl, byteLength) {
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, byteLength, gl.DYNAMIC_DRAW);
    return buffer;
  }

  /* 0,1,2, 0,2,3 per quad. Uploaded once and never touched again. */
  function createQuadIndices(gl, quadCount) {
    var data = new Uint16Array(quadCount * 6);
    for (var i = 0; i < quadCount; i++) {
      var v = i * 4, o = i * 6;
      data[o] = v; data[o + 1] = v + 1; data[o + 2] = v + 2;
      data[o + 3] = v; data[o + 4] = v + 2; data[o + 5] = v + 3;
    }
    var buffer = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, data, gl.STATIC_DRAW);
    return buffer;
  }

  global.GG = global.GG || {};
  global.GG.gl = {
    createContext: createContext,
    createProgram: createProgram,
    createQuad: createQuad,
    createTexture: createTexture,
    createDynamicBuffer: createDynamicBuffer,
    createQuadIndices: createQuadIndices,
    TextAtlas: TextAtlas,
    GLYPHS: GLYPHS
  };
})(window);
