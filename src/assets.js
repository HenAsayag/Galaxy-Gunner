/* Procedural sprite atlas.
 *
 * The conversion kit ships three composite concept boards and nine EMPTY asset
 * folders, so there are no production sprites to load. Rather than ship a game
 * with missing textures, every sprite is painted here - once, at boot - into a
 * single transparent atlas canvas which is uploaded as one GL texture.
 *
 * That buys three things the spec asks for directly:
 *   - "atlas textures whenever possible": one texture means the whole frame
 *     batches into one or two draw calls (see renderer-gl.js).
 *   - originality: nothing is traced from any commercial title; the shapes are
 *     parametric, and the palette is sampled from the supplied boards.
 *   - crispness at any DPR, because the art is vector-drawn at SUPERSAMPLE
 *     times its design size and minified by the sampler.
 *
 * Every sprite is authored NOSE UP. An entity with angle 0 draws unrotated; an
 * enemy diving downward draws at PI. One convention, no per-sprite exceptions.
 *
 * Frames are { x, y, w, h, u0, v0, u1, v1, dw, dh } where dw/dh are the design
 * size in world units and u/v are normalised atlas coordinates.
 */
(function (global) {
  'use strict';

  var SUPERSAMPLE = 2;
  var ATLAS_WIDTH = 1024;
  var PAD = 2;

  /* ---- tiny drawing helpers --------------------------------------------- */

  function radial(ctx, x, y, r, stops) {
    var g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.01, r));
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }

  function vertical(ctx, y0, y1, stops) {
    var g = ctx.createLinearGradient(0, y0, 0, y1);
    for (var i = 0; i < stops.length; i++) g.addColorStop(stops[i][0], stops[i][1]);
    return g;
  }

  function rgba(hex, a) {
    var h = hex.charAt(0) === '#' ? hex.slice(1) : hex;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    return 'rgba(' + parseInt(h.slice(0, 2), 16) + ',' + parseInt(h.slice(2, 4), 16) +
           ',' + parseInt(h.slice(4, 6), 16) + ',' + a + ')';
  }

  /* A soft additive bloom, used under engines, cores and muzzle flashes. */
  function glow(ctx, x, y, r, color, alpha) {
    ctx.fillStyle = radial(ctx, x, y, r, [
      [0, rgba(color, alpha)], [0.45, rgba(color, alpha * 0.35)], [1, rgba(color, 0)]
    ]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  function poly(ctx, points) {
    ctx.beginPath();
    ctx.moveTo(points[0], points[1]);
    for (var i = 2; i < points.length; i += 2) ctx.lineTo(points[i], points[i + 1]);
    ctx.closePath();
  }

  /* Mirrors a half-silhouette given as [dx, y] pairs measured from the centre
   * line: the nose, then down the right side. Keeps every hull symmetric for
   * free and halves the amount of hand-tuned geometry. */
  function mirrored(ctx, cx, half) {
    ctx.beginPath();
    ctx.moveTo(cx, half[1]);
    var i;
    for (i = 0; i < half.length; i += 2) ctx.lineTo(cx + half[i], half[i + 1]);
    for (i = half.length - 2; i >= 0; i -= 2) ctx.lineTo(cx - half[i], half[i + 1]);
    ctx.closePath();
  }

  /* ---- hull shading ------------------------------------------------------
   * One routine paints every ship: gradient fill, rim light, panel seam. Only
   * the silhouette and the colours change per archetype, which is what keeps
   * the fleet looking like one fleet. */
  function shadeHull(ctx, w, h, colors) {
    ctx.fillStyle = vertical(ctx, 0, h, [
      [0, colors.light], [0.42, colors.mid], [1, colors.dark]
    ]);
    ctx.fill();
    ctx.lineWidth = Math.max(1, w * 0.035);
    ctx.strokeStyle = rgba(colors.rim, 0.85);
    ctx.stroke();
  }

  function cockpit(ctx, cx, cy, rw, rh, color) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, rh / rw);
    ctx.fillStyle = radial(ctx, 0, 0, rw, [
      [0, rgba('#ffffff', 0.95)], [0.35, rgba(color, 0.95)], [1, rgba(color, 0.1)]
    ]);
    ctx.beginPath();
    ctx.arc(0, 0, rw, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /* ---- ship silhouettes --------------------------------------------------
   * p.body  half-width at the shoulder
   * p.span  half-width at the wingtip
   * p.tail  half-width at the transom
   * p.sweep how far back the wingtip sits, 0..1 of height   */
  function fighterPath(ctx, cx, h, p) {
    mirrored(ctx, cx, [
      0, 0,
      p.body * 0.45, h * 0.20,
      p.body, h * 0.44,
      p.span, h * (0.52 + p.sweep * 0.3),
      p.span * 0.82, h * 0.88,
      p.body * 1.15, h * 0.76,
      p.tail, h
    ]);
  }

  function deltaPath(ctx, cx, h, p) {
    mirrored(ctx, cx, [
      0, 0,
      p.body, h * 0.46,
      p.span, h * 0.92,
      p.tail, h * 0.80,
      p.tail * 0.9, h
    ]);
  }

  /* ---- sprite catalogue --------------------------------------------------
   * Each entry: name, design width/height in WORLD units, and a painter that
   * receives a context already scaled so (0,0)..(w,h) is the sprite box. */

  var SPRITES = [];

  function sprite(name, dw, dh, paint) { SPRITES.push({ name: name, dw: dw, dh: dh, paint: paint }); }

  function buildCatalogue(P) {

    /* ---- player, six visible upgrade tiers ------------------------------ */
    var PLAYER_TIERS = [
      { body: 0.17, span: 0.40, tail: 0.11, sweep: 0.25, pods: 0, fins: 0 },
      { body: 0.18, span: 0.44, tail: 0.12, sweep: 0.28, pods: 0, fins: 1 },
      { body: 0.19, span: 0.48, tail: 0.13, sweep: 0.32, pods: 1, fins: 1 },
      { body: 0.20, span: 0.52, tail: 0.14, sweep: 0.36, pods: 2, fins: 1 },
      { body: 0.21, span: 0.56, tail: 0.15, sweep: 0.40, pods: 2, fins: 2 },
      { body: 0.22, span: 0.60, tail: 0.16, sweep: 0.44, pods: 3, fins: 2 }
    ];

    PLAYER_TIERS.forEach(function (t, i) {
      sprite('player' + (i + 1), 48, 48, function (ctx, w, h) {
        var cx = w / 2;
        var p = { body: t.body * w, span: t.span * w, tail: t.tail * w, sweep: t.sweep };

        /* outer wing plates first, so the fuselage reads on top of them */
        if (t.fins) {
          ctx.save();
          mirrored(ctx, cx, [
            p.span * 0.75, h * 0.50,
            p.span * 1.32, h * 0.66,
            p.span * 1.20, h * 0.86,
            p.span * 0.70, h * 0.78
          ]);
          ctx.fillStyle = vertical(ctx, h * 0.5, h, [[0, P.hull], [1, P.hullDark]]);
          ctx.fill();
          ctx.lineWidth = w * 0.022;
          ctx.strokeStyle = rgba(P.hullLight, 0.7);
          ctx.stroke();
          ctx.restore();
        }

        fighterPath(ctx, cx, h, p);
        shadeHull(ctx, w, h, {
          light: P.hullLight, mid: P.hull, dark: P.hullDark, rim: P.cockpit
        });

        /* warm accent stripes, matching the boards' orange-on-steel trim */
        ctx.save();
        ctx.clip();
        ctx.fillStyle = rgba(P.blast, 0.75);
        ctx.fillRect(cx - p.body * 0.9, h * 0.52, p.body * 0.3, h * 0.30);
        ctx.fillRect(cx + p.body * 0.6, h * 0.52, p.body * 0.3, h * 0.30);
        ctx.restore();

        cockpit(ctx, cx, h * 0.36, w * 0.072, w * 0.13, P.cockpit);

        /* weapon pods: the visible proof that a tier changed */
        for (var k = 0; k < t.pods; k++) {
          var px = cx + (k % 2 === 0 ? -1 : 1) * p.span * (0.62 + Math.floor(k / 2) * 0.28);
          ctx.fillStyle = P.hullDark;
          ctx.fillRect(px - w * 0.026, h * 0.44, w * 0.052, h * 0.26);
          ctx.fillStyle = rgba(P.playerBolt, 0.9);
          ctx.fillRect(px - w * 0.016, h * 0.42, w * 0.032, h * 0.06);
        }

        /* engines */
        var eN = 1 + Math.min(2, Math.floor(i / 2));
        for (var e = 0; e < eN; e++) {
          var ex = cx + (e === 0 ? 0 : (e === 1 ? -p.body * 0.95 : p.body * 0.95));
          glow(ctx, ex, h * 0.99, w * (0.14 + i * 0.012), P.engine, 0.95);
          ctx.fillStyle = rgba(P.playerBoltHot, 0.95);
          ctx.fillRect(ex - w * 0.018, h * 0.93, w * 0.036, h * 0.07);
        }
      });
    });

    /* ---- enemies --------------------------------------------------------- */

    function enemyShip(name, dw, dh, shape, colors, extra) {
      sprite(name, dw, dh, function (ctx, w, h) {
        var cx = w / 2;
        shape(ctx, cx, w, h);
        shadeHull(ctx, w, h, colors);
        if (extra) extra(ctx, cx, w, h);
        /* every enemy carries an engine mark so a group reads as "incoming" */
        glow(ctx, cx, h * 0.98, w * 0.16, colors.flame, 0.8);
      });
    }

    var RED   = { light: '#ff9aa6', mid: '#d8324b', dark: '#5c0f1f', rim: '#ffd3d8', flame: '#ff7a1a' };
    var BLUE  = { light: '#a8d8ff', mid: '#2f74c8', dark: '#102a52', rim: '#cfeaff', flame: '#49b6ff' };
    var AMBER = { light: '#ffd9a0', mid: '#e0842a', dark: '#5a2d08', rim: '#ffeccb', flame: '#ff7a1a' };
    var VIOLET= { light: '#e3b6ff', mid: '#8b3ed6', dark: '#2f0f55', rim: '#f3e0ff', flame: '#c86bff' };
    var STEEL = { light: '#b9c9e2', mid: '#4a5f82', dark: '#151f33', rim: '#dceaff', flame: '#ff9a2a' };

    enemyShip('scout_red', 26, 26, function (ctx, cx, w, h) {
      deltaPath(ctx, cx, h, { body: w * 0.30, span: w * 0.46, tail: w * 0.14 });
    }, RED);

    enemyShip('scout_blue', 26, 26, function (ctx, cx, w, h) {
      deltaPath(ctx, cx, h, { body: w * 0.30, span: w * 0.46, tail: w * 0.14 });
    }, BLUE);

    enemyShip('twin_wing', 34, 28, function (ctx, cx, w, h) {
      mirrored(ctx, cx, [
        0, h * 0.06,
        w * 0.14, h * 0.30,
        w * 0.48, h * 0.44,
        w * 0.44, h * 0.76,
        w * 0.20, h * 0.68,
        w * 0.13, h
      ]);
    }, AMBER, function (ctx, cx, w, h) {
      ctx.fillStyle = rgba('#ffe08a', 0.9);
      ctx.fillRect(cx - w * 0.40, h * 0.50, w * 0.10, h * 0.18);
      ctx.fillRect(cx + w * 0.30, h * 0.50, w * 0.10, h * 0.18);
    });

    enemyShip('dart', 22, 34, function (ctx, cx, w, h) {
      mirrored(ctx, cx, [
        0, 0,
        w * 0.16, h * 0.42,
        w * 0.34, h * 0.74,
        w * 0.14, h * 0.70,
        w * 0.10, h
      ]);
    }, VIOLET);

    enemyShip('turret_drone', 32, 30, function (ctx, cx, w, h) {
      /* hexagonal hull: reads as a hovering weapons platform, not a fighter */
      poly(ctx, [
        cx, h * 0.02,
        cx + w * 0.44, h * 0.26,
        cx + w * 0.44, h * 0.74,
        cx, h * 0.98,
        cx - w * 0.44, h * 0.74,
        cx - w * 0.44, h * 0.26
      ]);
    }, BLUE, function (ctx, cx, w, h) {
      ctx.fillStyle = rgba('#0a1424', 0.9);
      ctx.beginPath();
      ctx.arc(cx, h * 0.5, w * 0.24, 0, Math.PI * 2);
      ctx.fill();
      glow(ctx, cx, h * 0.5, w * 0.22, '#ff7a1a', 1);
    });

    enemyShip('missile_craft', 36, 32, function (ctx, cx, w, h) {
      mirrored(ctx, cx, [
        0, h * 0.04,
        w * 0.18, h * 0.32,
        w * 0.46, h * 0.52,
        w * 0.40, h * 0.84,
        w * 0.16, h
      ]);
    }, AMBER, function (ctx, cx, w, h) {
      /* visible launch tubes, so its threat is legible before it fires */
      ctx.fillStyle = '#1b1006';
      ctx.fillRect(cx - w * 0.42, h * 0.58, w * 0.14, h * 0.30);
      ctx.fillRect(cx + w * 0.28, h * 0.58, w * 0.14, h * 0.30);
      ctx.fillStyle = rgba('#ff7a1a', 0.9);
      ctx.fillRect(cx - w * 0.40, h * 0.84, w * 0.10, h * 0.06);
      ctx.fillRect(cx + w * 0.30, h * 0.84, w * 0.10, h * 0.06);
    });

    enemyShip('spinner', 32, 32, function (ctx, cx, w, h) {
      /* six-armed rotor; it is always drawn spinning, so it must be radially
       * symmetric or the rotation would look like a wobble */
      ctx.beginPath();
      var cy = h / 2, R = w * 0.46, r = w * 0.20;
      for (var i = 0; i < 12; i++) {
        var a = (i / 12) * Math.PI * 2 - Math.PI / 2;
        var rad = i % 2 === 0 ? R : r;
        var x = cx + Math.cos(a) * rad, y = cy + Math.sin(a) * rad;
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.closePath();
    }, VIOLET, function (ctx, cx, w, h) {
      glow(ctx, cx, h * 0.5, w * 0.26, '#c86bff', 1);
      ctx.fillStyle = rgba('#ffffff', 0.9);
      ctx.beginPath();
      ctx.arc(cx, h * 0.5, w * 0.09, 0, Math.PI * 2);
      ctx.fill();
    });

    enemyShip('heavy', 52, 44, function (ctx, cx, w, h) {
      mirrored(ctx, cx, [
        0, h * 0.02,
        w * 0.20, h * 0.22,
        w * 0.30, h * 0.46,
        w * 0.48, h * 0.58,
        w * 0.44, h * 0.88,
        w * 0.22, h * 0.80,
        w * 0.15, h
      ]);
    }, RED, function (ctx, cx, w, h) {
      ctx.save();
      ctx.clip();
      ctx.fillStyle = rgba('#20060d', 0.6);
      for (var i = 0; i < 3; i++) ctx.fillRect(0, h * (0.30 + i * 0.20), w, h * 0.045);
      ctx.restore();
      glow(ctx, cx, h * 0.42, w * 0.20, '#ff7a1a', 1);
      ctx.fillStyle = rgba('#ffe08a', 0.95);
      ctx.beginPath();
      ctx.arc(cx, h * 0.42, w * 0.07, 0, Math.PI * 2);
      ctx.fill();
    });

    enemyShip('elite_carrier', 76, 58, function (ctx, cx, w, h) {
      mirrored(ctx, cx, [
        0, h * 0.04,
        w * 0.16, h * 0.20,
        w * 0.24, h * 0.42,
        w * 0.50, h * 0.50,
        w * 0.48, h * 0.86,
        w * 0.26, h * 0.76,
        w * 0.14, h
      ]);
    }, STEEL, function (ctx, cx, w, h) {
      /* launch bays down each flank; adds emerge from these */
      ctx.fillStyle = '#080d16';
      ctx.fillRect(cx - w * 0.46, h * 0.58, w * 0.16, h * 0.24);
      ctx.fillRect(cx + w * 0.30, h * 0.58, w * 0.16, h * 0.24);
      ctx.strokeStyle = rgba('#ff9a2a', 0.8);
      ctx.lineWidth = w * 0.012;
      ctx.strokeRect(cx - w * 0.46, h * 0.58, w * 0.16, h * 0.24);
      ctx.strokeRect(cx + w * 0.30, h * 0.58, w * 0.16, h * 0.24);
      glow(ctx, cx, h * 0.36, w * 0.20, '#ff7a1a', 1);
      ctx.fillStyle = '#fff6d0';
      ctx.beginPath();
      ctx.arc(cx, h * 0.36, w * 0.055, 0, Math.PI * 2);
      ctx.fill();
    });

    /* ---- bosses ---------------------------------------------------------- */

    function bossSprite(name, accent, armColor) {
      sprite(name, 190, 150, function (ctx, w, h) {
        var cx = w / 2;

        /* swept side arms */
        [-1, 1].forEach(function (s) {
          ctx.beginPath();
          ctx.moveTo(cx + s * w * 0.10, h * 0.28);
          ctx.lineTo(cx + s * w * 0.48, h * 0.34);
          ctx.lineTo(cx + s * w * 0.50, h * 0.72);
          ctx.lineTo(cx + s * w * 0.24, h * 0.62);
          ctx.closePath();
          ctx.fillStyle = vertical(ctx, h * 0.28, h * 0.72, [[0, armColor], [1, '#101827']]);
          ctx.fill();
          ctx.lineWidth = w * 0.008;
          ctx.strokeStyle = rgba(accent, 0.7);
          ctx.stroke();
        });

        /* central hull - broad enough to read as a warship underneath the
         * core, which is the whole point of drawing one */
        mirrored(ctx, cx, [
          0, h * 0.02,
          w * 0.17, h * 0.16,
          w * 0.27, h * 0.44,
          w * 0.30, h * 0.66,
          w * 0.21, h * 0.90,
          w * 0.09, h
        ]);
        shadeHull(ctx, w, h, { light: '#cbd9ee', mid: '#3d5175', dark: '#0d1524', rim: accent });

        /* armour seams, so the hull does not read as one flat plate */
        ctx.save();
        ctx.clip();
        ctx.fillStyle = 'rgba(8,14,26,0.45)';
        ctx.fillRect(0, h * 0.24, w, h * 0.030);
        ctx.fillRect(0, h * 0.60, w, h * 0.030);
        ctx.fillRect(0, h * 0.78, w, h * 0.030);
        ctx.restore();

        /* The vulnerable core: the brightest thing on the sprite, but kept
         * small and tight. Painted large it swallowed the hull and the boss
         * rendered as a featureless blob. */
        glow(ctx, cx, h * 0.46, w * 0.115, accent, 0.85);
        ctx.fillStyle = radial(ctx, cx, h * 0.46, w * 0.062, [
          [0, '#ffffff'], [0.45, accent], [1, rgba(accent, 0.15)]
        ]);
        ctx.beginPath();
        ctx.arc(cx, h * 0.46, w * 0.062, 0, Math.PI * 2);
        ctx.fill();
        /* a dark iris ring so the core has an edge to sit against */
        ctx.lineWidth = w * 0.014;
        ctx.strokeStyle = 'rgba(10,16,30,0.85)';
        ctx.beginPath();
        ctx.arc(cx, h * 0.46, w * 0.075, 0, Math.PI * 2);
        ctx.stroke();

        /* muzzle ports along the leading edge */
        for (var i = -2; i <= 2; i++) {
          if (!i) continue;
          var px = cx + i * w * 0.115;
          ctx.fillStyle = '#080d16';
          ctx.fillRect(px - w * 0.016, h * 0.74, w * 0.032, h * 0.14);
          glow(ctx, px, h * 0.86, w * 0.035, accent, 0.8);
        }
      });
    }

    bossSprite('boss1', '#ff7a1a', '#3a1d10');
    bossSprite('boss2', '#49b6ff', '#12263f');
    bossSprite('boss3', '#c86bff', '#2a1140');

    /* ---- projectiles ------------------------------------------------------
     * Colour is the family; shape is the threat. Player fire is a cyan lance
     * with a white-hot core, enemy fire is a warm teardrop, orbs are slow and
     * round. The three read apart instantly even at maximum density. */

    function boltSprite(name, dw, dh, color, hot) {
      sprite(name, dw, dh, function (ctx, w, h) {
        glow(ctx, w / 2, h / 2, w * 0.48, color, 0.85);
        ctx.fillStyle = vertical(ctx, 0, h, [
          [0, rgba(hot, 0.2)], [0.25, hot], [0.55, color], [1, rgba(color, 0)]
        ]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.quadraticCurveTo(w * 0.94, h * 0.38, w / 2, h);
        ctx.quadraticCurveTo(w * 0.06, h * 0.38, w / 2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = rgba('#ffffff', 0.95);
        ctx.fillRect(w * 0.44, h * 0.14, w * 0.12, h * 0.5);
      });
    }

    boltSprite('bolt_s', 7, 20, P.playerBolt, P.playerBoltHot);
    boltSprite('bolt_m', 9, 26, P.playerBolt, P.playerBoltHot);
    boltSprite('bolt_l', 12, 32, P.playerBolt, P.playerBoltHot);

    function teardrop(name, dw, dh, color, hot) {
      sprite(name, dw, dh, function (ctx, w, h) {
        glow(ctx, w / 2, h * 0.55, w * 0.55, color, 0.8);
        ctx.fillStyle = radial(ctx, w / 2, h * 0.55, w * 0.42, [
          [0, hot], [0.55, color], [1, rgba(color, 0.15)]
        ]);
        ctx.beginPath();
        ctx.moveTo(w / 2, 0);
        ctx.quadraticCurveTo(w * 0.98, h * 0.55, w / 2, h);
        ctx.quadraticCurveTo(w * 0.02, h * 0.55, w / 2, 0);
        ctx.closePath();
        ctx.fill();
      });
    }

    teardrop('bullet_orange', 11, 17, P.enemyBolt, P.enemyBoltHot);
    teardrop('bullet_red', 11, 17, P.enemyRed, '#ffd0d8');

    function orb(name, d, color) {
      sprite(name, d, d, function (ctx, w, h) {
        glow(ctx, w / 2, h / 2, w * 0.5, color, 0.9);
        ctx.fillStyle = radial(ctx, w * 0.42, h * 0.40, w * 0.36, [
          [0, '#ffffff'], [0.4, color], [1, rgba(color, 0.25)]
        ]);
        ctx.beginPath();
        ctx.arc(w / 2, h / 2, w * 0.33, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = w * 0.05;
        ctx.strokeStyle = rgba('#ffffff', 0.7);
        ctx.stroke();
      });
    }

    orb('orb_green', 15, P.enemyGreen);
    orb('orb_blue', 13, P.enemyBlue);
    orb('orb_violet', 15, '#c86bff');

    sprite('missile', 10, 22, function (ctx, w, h) {
      glow(ctx, w / 2, h * 0.9, w * 0.6, P.enemyBolt, 0.9);
      poly(ctx, [w / 2, 0, w * 0.82, h * 0.34, w * 0.82, h * 0.78, w * 0.18, h * 0.78, w * 0.18, h * 0.34]);
      ctx.fillStyle = vertical(ctx, 0, h, [[0, '#f4f7ff'], [0.5, '#c2cee2'], [1, '#5a6880']]);
      ctx.fill();
      ctx.fillStyle = P.enemyBolt;
      ctx.fillRect(w * 0.18, h * 0.40, w * 0.64, h * 0.10);
      poly(ctx, [w * 0.18, h * 0.60, w * 0.02, h * 0.86, w * 0.18, h * 0.80]);
      ctx.fillStyle = '#8fa2bd';
      ctx.fill();
      poly(ctx, [w * 0.82, h * 0.60, w * 0.98, h * 0.86, w * 0.82, h * 0.80]);
      ctx.fill();
      ctx.fillStyle = rgba(P.blastHot, 0.95);
      ctx.fillRect(w * 0.34, h * 0.78, w * 0.32, h * 0.16);
    });

    sprite('rocket', 13, 26, function (ctx, w, h) {
      glow(ctx, w / 2, h * 0.92, w * 0.62, P.blast, 0.95);
      poly(ctx, [w / 2, 0, w * 0.86, h * 0.30, w * 0.86, h * 0.82, w * 0.14, h * 0.82, w * 0.14, h * 0.30]);
      ctx.fillStyle = vertical(ctx, 0, h, [[0, '#ffe5c2'], [0.5, '#e07f2a'], [1, '#5c2c06']]);
      ctx.fill();
      ctx.lineWidth = w * 0.05;
      ctx.strokeStyle = rgba('#ffd9a0', 0.8);
      ctx.stroke();
    });

    /* A one-unit-wide vertical beam, stretched by the renderer. */
    sprite('beam', 16, 64, function (ctx, w, h) {
      ctx.fillStyle = (function () {
        var g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, rgba('#b46bff', 0));
        g.addColorStop(0.35, rgba('#b46bff', 0.55));
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(0.65, rgba('#b46bff', 0.55));
        g.addColorStop(1, rgba('#b46bff', 0));
        return g;
      })();
      ctx.fillRect(0, 0, w, h);
    });

    sprite('beam_blue', 16, 64, function (ctx, w, h) {
      ctx.fillStyle = (function () {
        var g = ctx.createLinearGradient(0, 0, w, 0);
        g.addColorStop(0, rgba('#5ad8ff', 0));
        g.addColorStop(0.35, rgba('#5ad8ff', 0.6));
        g.addColorStop(0.5, '#ffffff');
        g.addColorStop(0.65, rgba('#5ad8ff', 0.6));
        g.addColorStop(1, rgba('#5ad8ff', 0));
        return g;
      })();
      ctx.fillRect(0, 0, w, h);
    });

    /* ---- VFX -------------------------------------------------------------- */

    sprite('glow', 64, 64, function (ctx, w, h) {
      ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
        [0, 'rgba(255,255,255,1)'], [0.28, 'rgba(255,255,255,0.55)'],
        [0.62, 'rgba(255,255,255,0.14)'], [1, 'rgba(255,255,255,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
    });

    sprite('spark', 12, 12, function (ctx, w, h) {
      ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
        [0, '#ffffff'], [0.4, 'rgba(255,255,255,0.65)'], [1, 'rgba(255,255,255,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
    });

    /* Four-point star flare: the signature shape of a kill flash. */
    sprite('flare', 64, 64, function (ctx, w, h) {
      var cx = w / 2, cy = h / 2;
      ctx.fillStyle = radial(ctx, cx, cy, w * 0.22, [
        [0, '#ffffff'], [0.5, 'rgba(255,255,255,0.4)'], [1, 'rgba(255,255,255,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      [0, Math.PI / 2].forEach(function (a) {
        ctx.save();
        ctx.translate(cx, cy);
        ctx.rotate(a);
        ctx.beginPath();
        ctx.moveTo(0, -cy);
        ctx.quadraticCurveTo(w * 0.045, 0, 0, cy);
        ctx.quadraticCurveTo(-w * 0.045, 0, 0, -cy);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });
    });

    sprite('ring', 96, 96, function (ctx, w, h) {
      var cx = w / 2;
      ctx.lineWidth = w * 0.055;
      ctx.strokeStyle = (function () {
        var g = radial(ctx, cx, cx, cx, [
          [0.70, 'rgba(255,255,255,0)'], [0.86, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']
        ]);
        return g;
      })();
      ctx.beginPath();
      ctx.arc(cx, cx, cx * 0.86, 0, Math.PI * 2);
      ctx.stroke();
    });

    sprite('smoke', 48, 48, function (ctx, w, h) {
      var cx = w / 2;
      ctx.fillStyle = radial(ctx, cx, cx, cx, [
        [0, 'rgba(210,214,224,0.55)'], [0.5, 'rgba(150,156,172,0.28)'], [1, 'rgba(120,126,142,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
    });

    sprite('debris', 10, 10, function (ctx, w, h) {
      poly(ctx, [w * 0.1, h * 0.3, w * 0.6, 0, w, h * 0.45, w * 0.7, h, w * 0.2, h * 0.85]);
      ctx.fillStyle = vertical(ctx, 0, h, [[0, '#9fb2cc'], [1, '#2a3852']]);
      ctx.fill();
    });

    sprite('px', 2, 2, function (ctx, w, h) {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, w, h);
    });

    sprite('star', 8, 8, function (ctx, w, h) {
      ctx.fillStyle = radial(ctx, w / 2, h / 2, w / 2, [
        [0, '#ffffff'], [0.35, 'rgba(255,255,255,0.5)'], [1, 'rgba(255,255,255,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
    });

    /* Distant rock, scattered through the parallax layers. */
    sprite('rock', 64, 64, function (ctx, w, h) {
      var cx = w / 2, pts = [];
      for (var i = 0; i < 9; i++) {
        var a = (i / 9) * Math.PI * 2;
        var r = cx * (0.62 + ((i * 37) % 11) / 34);
        pts.push(cx + Math.cos(a) * r, cx + Math.sin(a) * r);
      }
      poly(ctx, pts);
      ctx.fillStyle = radial(ctx, w * 0.36, h * 0.32, w * 0.7, [
        [0, '#5b6577'], [0.6, '#333c4d'], [1, '#161c28']
      ]);
      ctx.fill();
      ctx.lineWidth = w * 0.02;
      ctx.strokeStyle = 'rgba(150,165,190,0.35)';
      ctx.stroke();
    });

    /* ---- power-ups ---------------------------------------------------------
     * A bevelled hex coin with a glyph. Strong colour coding plus the ring
     * glow is what keeps them findable in a screen full of bullets. */

    function coin(name, color, glyph) {
      sprite(name, 30, 30, function (ctx, w, h) {
        var cx = w / 2, cy = h / 2, r = w * 0.42;
        glow(ctx, cx, cy, w * 0.5, color, 0.75);

        ctx.beginPath();
        for (var i = 0; i < 6; i++) {
          var a = (i / 6) * Math.PI * 2 - Math.PI / 2;
          var x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
          if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.fillStyle = vertical(ctx, cy - r, cy + r, [
          [0, '#ffffff'], [0.3, color], [1, '#101a2c']
        ]);
        ctx.fill();
        ctx.lineWidth = w * 0.055;
        ctx.strokeStyle = rgba('#ffffff', 0.9);
        ctx.stroke();

        ctx.save();
        ctx.translate(cx, cy);
        glyph(ctx, w * 0.5);
        ctx.restore();
      });
    }

    function chevrons(ctx, s, color, n) {
      ctx.strokeStyle = color;
      ctx.lineWidth = s * 0.16;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (var i = 0; i < n; i++) {
        var y = (i - (n - 1) / 2) * s * 0.42 + s * 0.12;
        ctx.beginPath();
        ctx.moveTo(-s * 0.36, y);
        ctx.lineTo(0, y - s * 0.30);
        ctx.lineTo(s * 0.36, y);
        ctx.stroke();
      }
    }

    coin('pu_weapon', '#5dff7a', function (ctx, s) { chevrons(ctx, s, '#04210c', 2); });
    coin('pu_missile', '#ff9a2a', function (ctx, s) {
      ctx.fillStyle = '#2a1000';
      poly(ctx, [0, -s * 0.44, s * 0.20, -s * 0.06, s * 0.20, s * 0.30, -s * 0.20, s * 0.30, -s * 0.20, -s * 0.06]);
      ctx.fill();
      ctx.fillRect(-s * 0.30, s * 0.16, s * 0.60, s * 0.10);
    });
    coin('pu_shield', '#49d8ff', function (ctx, s) {
      ctx.fillStyle = '#04202c';
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.44);
      ctx.lineTo(s * 0.34, -s * 0.22);
      ctx.quadraticCurveTo(s * 0.34, s * 0.30, 0, s * 0.46);
      ctx.quadraticCurveTo(-s * 0.34, s * 0.30, -s * 0.34, -s * 0.22);
      ctx.closePath();
      ctx.fill();
    });
    coin('pu_rapid', '#ffe14a', function (ctx, s) {
      ctx.fillStyle = '#2a2100';
      poly(ctx, [s * 0.10, -s * 0.46, -s * 0.30, s * 0.06, -s * 0.02, s * 0.06,
                 -s * 0.12, s * 0.46, s * 0.30, -s * 0.10, s * 0.02, -s * 0.10]);
      ctx.fill();
    });
    coin('pu_multi', '#ffc23c', function (ctx, s) {
      ctx.fillStyle = '#2a1c00';
      ctx.font = '700 ' + (s * 0.78) + 'px ' + global.GG.layout.FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('2', 0, s * 0.02);
    });
    coin('pu_magnet', '#ff5c7a', function (ctx, s) {
      ctx.strokeStyle = '#2a0008';
      ctx.lineWidth = s * 0.20;
      ctx.beginPath();
      ctx.arc(0, s * 0.02, s * 0.28, Math.PI, 0);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(-s * 0.28, s * 0.02);
      ctx.lineTo(-s * 0.28, s * 0.32);
      ctx.moveTo(s * 0.28, s * 0.02);
      ctx.lineTo(s * 0.28, s * 0.32);
      ctx.stroke();
    });
    coin('pu_bomb', '#c86bff', function (ctx, s) {
      ctx.fillStyle = '#1a0530';
      ctx.beginPath();
      ctx.arc(0, s * 0.08, s * 0.30, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#1a0530';
      ctx.lineWidth = s * 0.12;
      ctx.beginPath();
      ctx.moveTo(s * 0.10, -s * 0.20);
      ctx.quadraticCurveTo(s * 0.34, -s * 0.44, s * 0.30, -s * 0.10);
      ctx.stroke();
    });

    coin('pu_broadside', '#49d8ff', function (ctx, s) {
      ctx.strokeStyle = '#052139';
      ctx.lineWidth = s * 0.10;
      for (var side = -1; side <= 1; side += 2) {
        ctx.beginPath();
        ctx.moveTo(side * s * 0.36, -s * 0.23);
        ctx.lineTo(side * s * 0.12, 0);
        ctx.lineTo(side * s * 0.36, s * 0.23);
        ctx.stroke();
      }
    });
    coin('pu_nova', '#ff673c', function (ctx, s) {
      ctx.strokeStyle = '#391005';
      ctx.lineWidth = s * 0.08;
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.16, 0, Math.PI * 2);
      for (var ray = 0; ray < 8; ray++) {
        var a = ray * Math.PI / 4;
        ctx.moveTo(Math.cos(a) * s * 0.23, Math.sin(a) * s * 0.23);
        ctx.lineTo(Math.cos(a) * s * 0.37, Math.sin(a) * s * 0.37);
      }
      ctx.stroke();
    });

    /* ---- UI ---------------------------------------------------------------- */

    sprite('ui_pause', 26, 26, function (ctx, w, h) {
      ctx.fillStyle = 'rgba(255,255,255,0.92)';
      ctx.fillRect(w * 0.26, h * 0.20, w * 0.16, h * 0.60);
      ctx.fillRect(w * 0.58, h * 0.20, w * 0.16, h * 0.60);
    });

    sprite('ui_life', 22, 20, function (ctx, w, h) {
      ctx.beginPath();
      ctx.moveTo(w / 2, h * 0.95);
      ctx.bezierCurveTo(-w * 0.22, h * 0.48, w * 0.16, -h * 0.14, w / 2, h * 0.28);
      ctx.bezierCurveTo(w * 0.84, -h * 0.14, w * 1.22, h * 0.48, w / 2, h * 0.95);
      ctx.closePath();
      ctx.fillStyle = vertical(ctx, 0, h, [[0, '#ff8ba0'], [1, '#e11d3c']]);
      ctx.fill();
    });

    sprite('shield_ring', 92, 92, function (ctx, w, h) {
      var cx = w / 2;
      ctx.lineWidth = w * 0.035;
      ctx.strokeStyle = rgba('#49d8ff', 0.85);
      ctx.beginPath();
      ctx.arc(cx, cx, cx * 0.88, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = radial(ctx, cx, cx, cx, [
        [0.55, 'rgba(73,216,255,0)'], [0.86, 'rgba(73,216,255,0.28)'], [1, 'rgba(73,216,255,0)']
      ]);
      ctx.fillRect(0, 0, w, h);
      /* hex facets, so a shield hit reads as a surface and not a blur */
      ctx.strokeStyle = rgba('#a9ecff', 0.35);
      ctx.lineWidth = w * 0.012;
      for (var i = 0; i < 6; i++) {
        var a = (i / 6) * Math.PI * 2;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(a) * cx * 0.35, cx + Math.sin(a) * cx * 0.35);
        ctx.lineTo(cx + Math.cos(a) * cx * 0.86, cx + Math.sin(a) * cx * 0.86);
        ctx.stroke();
      }
    });
  }

  /* ---- packing ------------------------------------------------------------ */

  function build(config) {
    SPRITES.length = 0;
    buildCatalogue(config.palette);

    var canvas = document.createElement('canvas');
    var ctx = canvas.getContext('2d');

    /* Shelf pack: sort tall-first, then fill rows left to right. */
    var boxes = SPRITES.map(function (s, i) {
      return {
        index: i,
        w: Math.ceil(s.dw * SUPERSAMPLE) + PAD * 2,
        h: Math.ceil(s.dh * SUPERSAMPLE) + PAD * 2
      };
    }).sort(function (a, b) { return b.h - a.h; });

    var x = 0, y = 0, rowH = 0;
    boxes.forEach(function (b) {
      if (x + b.w > ATLAS_WIDTH) { x = 0; y += rowH; rowH = 0; }
      b.x = x; b.y = y;
      x += b.w;
      if (b.h > rowH) rowH = b.h;
    });
    var height = y + rowH;

    canvas.width = ATLAS_WIDTH;
    canvas.height = Math.max(1, height);

    var frames = {};
    boxes.forEach(function (b) {
      var s = SPRITES[b.index];
      var w = b.w - PAD * 2, h = b.h - PAD * 2;
      ctx.save();
      ctx.translate(b.x + PAD, b.y + PAD);
      ctx.beginPath();
      ctx.rect(0, 0, w, h);
      ctx.clip();
      s.paint(ctx, w, h);
      ctx.restore();

      frames[s.name] = {
        x: b.x + PAD, y: b.y + PAD, w: w, h: h,
        u0: (b.x + PAD) / canvas.width,
        v0: (b.y + PAD) / canvas.height,
        u1: (b.x + PAD + w) / canvas.width,
        v1: (b.y + PAD + h) / canvas.height,
        dw: s.dw, dh: s.dh
      };
    });

    return { canvas: canvas, frames: frames, names: Object.keys(frames) };
  }

  global.GG = global.GG || {};
  global.GG.assets = { build: build, SUPERSAMPLE: SUPERSAMPLE };
})(window);
