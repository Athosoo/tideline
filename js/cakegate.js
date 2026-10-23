/* 开屏 · 潮汐台布 (Cake Gate)
   一张亚麻台布铺满封面：场上唯一的光源是蛋糕上的十九支蜡烛，光从蛋糕向四周衰减；
   台布上印着一张潮汐海图，蛋糕就是海图上那座岛；刀是罗盘指针 ——
   所以刀尖永远指着圆心，这是罗盘的规矩，不是动画的随手设定。

   2026-10-23 开场改成两步：一开始只有蛋糕（没有刀）。点一下，镜头压到正上方
   俯视 —— 圆盘、圆蛋糕、蜡烛压成一圈火光；刀在镜头快到位时从画面下方飞进来。
   再点一下才切。这样那一刀是「在蛋糕面上划过去」，不是斜着从旁边戳。
   提前渲染：按下的那一刻就把长廊瞬移到布后面（布整块不透明），
   等真正切的时候后面已经是热的，不会在缝开的第一帧卡一下。

   ?cake=aim|cut 冻结/预演某个相位；?top=0..1 冻结镜头俯视进度（截图对照用）。
   两扇门已于 2026-10-22 删除，这一层就是封面本身，没有退路可退。 */
(function () {
  "use strict";

  var gateEl = document.getElementById("cakeGate");
  if (!gateEl) return;
  var params = new URLSearchParams(location.search);
  var FREEZE = params.get("cake") || "";

  var TAU = Math.PI * 2;
  var DEG = 180 / Math.PI;
  var CY_RATIO = 0.5;           // 蛋糕圆心 = 画面中心
  var APPROACH = 1.05;          // 第一次点击：镜头压到正上方 1050ms
  var CAM_ADD = 0.55;           // 俯视到位时蛋糕整体再放大到 1.55
  var CLOTH_ADD = 0.06;         // 台布同时推近一点，纹理往外走
  var CAM_FINAL = 1 + CAM_ADD;
  var FLY = 1.0;                // 刀入场 1000ms（从俯视镜头里飞进来）
  var FLY_A = 0.28;             // 加速段结束
  var FLY_B = 0.74;             // 匀速段结束
  var FLY_V = 2 / (1 + (FLY_B - FLY_A));   // 峰值 1.3699：由「三段位移和 = 1」解出
  var CUT = 2.6;                // 切开：布慢慢裂开，2.6s 走完
  var HOLD = 0.28;              // 先亮一道缝 280ms，布纹丝不动
  var SLICE = 0.16;             // 划过：占 CUT 的前 16%（≈0.42s），刀尖从入口划出盘沿
  var SEAM_W = 1000;            // .cut-seam 的基准长度（CSS 里 width: 1000px）
  var STITCH = 1.6;             // 回封面：镜头从裂口里退出来 1600ms
  // 俯视几何：斜看时顶面 cy=190/ry=60，正上方是 cy=240/ry=164（正圆）
  var TOP0 = { cy: 190, ry: 60 };
  var TOP1 = { cy: 240, ry: 164 };
  var CANDLE_R = 104;           // 斜看时的蜡烛圈
  var CANDLE_R_TOP = 96;        // 俯视时往内收，给糖珠让位
  var BEAD_R = 108;
  var BEAD_R_TOP = 124;
  var SWIRL_R = [34, 62, 90, 118];
  var DEFAULT_BEARING = -0.60;  // 第一次点在蛋糕中心时，刀从右上方入场

  var clothWrap = document.getElementById("clothWrap");
  var cakeStage = document.getElementById("cakeStage");
  var cakeEl = cakeStage ? cakeStage.querySelector(".cake") : null;
  var slitPath = document.getElementById("clothSlitPath");
  var chartLines = document.getElementById("chartLines");
  var chartStars = document.getElementById("chartStars");
  var scallop = document.getElementById("scallop");
  var beads = document.getElementById("beads");
  var swirls = document.getElementById("swirls");
  var drips = document.getElementById("drips");
  var sideGrain = document.getElementById("sideGrain");
  var candles = document.getElementById("candles");
  var knife = document.getElementById("knife");
  var bearingEl = document.getElementById("bearing");
  var crumbsEl = document.getElementById("crumbs");
  var surface = document.getElementById("cutSurface");
  var seamEl = document.getElementById("cutSeam");

  // 截图用：?cutat=0.55 把切开进度钉在这个值（仍然走真实的 cut() 路径）
  var CUTAT = params.has("cutat") ? clamp(parseFloat(params.get("cutat")) || 0, 0, 1) : null;
  // 沙箱里页面一滚动，position:fixed 的整层就会被画偏（见 TODO 抓图教训），
  // 所以验下潜构图时可以拿 ?nojump=1 把那次瞬移关掉。
  var NOJUMP = params.get("nojump") === "1";
  // 截图用：?top=0.5 把镜头俯视进度钉住，看中间态
  var TOPAT = params.has("top") ? clamp(parseFloat(params.get("top")) || 0, 0, 1) : null;

  var hooks = { openArchive: null, reduced: null };

  var S = {
    mounted: false,     // 层是否真的装上了（reduced motion 会把它摘掉）
    phase: "idle",      // idle（无刀）→ 点击推进 → fly → aim → cut → open →（缝合）aim
    approachRaw: 0,     // 镜头推进的原始进度 0..1
    morph: 0,           // 缓动后的俯视进度，几何都按它算
    zooming: false,
    cam: 1,
    clothCam: 1,
    warm: false,        // 长廊是否已经在布后面预热好
    knifeStarted: false,
    cutQueued: false,
    candleAngles: [],
    trees: [],
    t: 0,
    cut: 0,             // --cut 0..1
    cutTarget: 0,
    cutHold: 0,
    opened: false,
    archiveJump: false,
    finished: false,
    sawGate: false,
    tip: { x: 0, y: 0 },
    bearing: Math.PI * 0.5,
    fly: null,
    pointer: { x: 0, y: 0, seen: false },
    cutAngle: Math.PI * 0.5,
    geom: { cx: 0, cy: 0, cake: 336, tipMin: 195 },
  };

  /* ---------- 小工具 ---------- */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
  function ease3(u) {
    if (u <= 0) return 0;
    if (u >= 1) return 1;
    if (u < FLY_A) return (0.5 * FLY_V * u * u) / FLY_A;
    if (u < FLY_B) return 0.5 * FLY_V * FLY_A + FLY_V * (u - FLY_A);
    var w = 1 - u;
    return 1 - (0.5 * FLY_V * w * w) / (1 - FLY_B);
  }
  // 布被慢慢撕开：两头慢，中段快。匀速或纯 easeOut 都会显得轻。
  function easeInOut(u) {
    u = clamp(u, 0, 1);
    return u < 0.5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
  }

  function easeOut(u) { return 1 - Math.pow(1 - u, 3); }
  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6d2b79f5) >>> 0;
      var t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function svgEl(name, attrs) {
    var el = document.createElementNS("http://www.w3.org/2000/svg", name);
    for (var k in attrs) if (attrs.hasOwnProperty(k)) el.setAttribute(k, attrs[k]);
    return el;
  }

  /* ---------- 几何 ---------- */
  function measure() {
    S.geom.cx = window.innerWidth * 0.5;
    S.geom.cy = window.innerHeight * CY_RATIO;
    // offsetWidth 是布局尺寸，不会被 .cake-stage 的镜头缩放算进去；
    // 缩放单独记在 S.cam 里，不然每次 resize 都会把蛋糕量成两倍大。
    S.geom.cake = cakeEl ? (cakeEl.offsetWidth || 336) : 336;
    S.geom.tipMin = tipMinFor(S.cam);
  }

  function tipMinFor(cam) {
    return Math.max(150, S.geom.cake * (cam || 1) * 0.58);
  }

  // 刀尖不许进到岛里，也不许出画：沿半径推到最小距离、再夹进视口。
  // cam 可以指定「按哪个镜头量」：刀飞进来时要按最终镜头量，否则落点会在
  // 镜头继续推近时被 tipMin 突然往外顶一下。
  function clampTip(x, y, cam) {
    var g = S.geom;
    var dx = x - g.cx;
    var dy = y - g.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) { dx = 0; dy = 1; d = 1; }
    var want = Math.max(d, tipMinFor(cam || S.cam));
    return {
      x: clamp(g.cx + (dx / d) * want, 80, window.innerWidth - 80),
      y: clamp(g.cy + (dy / d) * want, 80, window.innerHeight - 80),
    };
  }

  function bearingTo(tx, ty) { return Math.atan2(S.geom.cy - ty, S.geom.cx - tx); }

  /* ---------- 台布上那道缝 ----------
     不是往缝里放东西：缝是台布自己身上开的一个洞。clipPath 用 evenodd 挖，
     外圈是整块布、内圈是一条沿切口方向的带子，宽度 = 两半让开的距离。
     **宽度为 0 时一律不挖**：没动刀之前布上不能有缝 —— 这条带子曾经带一个
     固定的 +12 余量，于是封面还没切就先裂了一条蓝缝，站在那儿自己出戏。
     坐标是视口 CSS 像素（clipPathUnits=userSpaceOnUse），中心就是布的圆心
     —— 也就是 transform-origin，布放大时缝跟着一起放大，两条边才对得上。 */
  var slitKey = "";
  function setSlit(halfLocal) {
    var W = window.innerWidth;
    var H = window.innerHeight;
    var key = W + "x" + H + "|" + S.cutAngle.toFixed(4) + "|" + halfLocal.toFixed(1);
    if (key === slitKey) return;
    slitKey = key;
    if (!slitPath) return;
    var outer = "M0 0H" + W + "V" + H + "H0Z";
    if (!(halfLocal > 0.5)) { slitPath.setAttribute("d", outer); return; }
    var a = S.cutAngle;
    var ux = Math.cos(a), uy = Math.sin(a);      // 长轴 = 切口方向
    var nx = -uy, ny = ux;                       // 短轴 = 法线（两半让开的方向）
    var L = W + H;                               // 半长：斜着也够伸出屏幕
    var cx = W * 0.5, cy = H * 0.5;
    var ax = cx - ux * L, ay = cy - uy * L;
    var bx = cx + ux * L, by = cy + uy * L;
    var d = "M" +
      (ax + nx * halfLocal).toFixed(1) + " " + (ay + ny * halfLocal).toFixed(1) + "L" +
      (bx + nx * halfLocal).toFixed(1) + " " + (by + ny * halfLocal).toFixed(1) + "L" +
      (bx - nx * halfLocal).toFixed(1) + " " + (by - ny * halfLocal).toFixed(1) + "L" +
      (ax - nx * halfLocal).toFixed(1) + " " + (ay - ny * halfLocal).toFixed(1) + "Z";
    slitPath.setAttribute("d", outer + d);
  }

  function shortest(from, to) {
    var d = (to - from) % TAU;
    if (d > Math.PI) d -= TAU;
    if (d < -Math.PI) d += TAU;
    return d;
  }

  /* ---------- 海图：等深线 / 恒向线 / 水深 / 星 ---------- */
  function catmull(points, closed) {
    var n = points.length;
    var d = "M" + points[0][0].toFixed(1) + " " + points[0][1].toFixed(1);
    var last = closed ? n : n - 1;
    for (var i = 0; i < last; i++) {
      var p0 = points[(i - 1 + n) % n];
      var p1 = points[i % n];
      var p2 = points[(i + 1) % n];
      var p3 = points[(i + 2) % n];
      var c1x = p1[0] + (p2[0] - p0[0]) / 6;
      var c1y = p1[1] + (p2[1] - p0[1]) / 6;
      var c2x = p2[0] - (p3[0] - p1[0]) / 6;
      var c2y = p2[1] - (p3[1] - p1[1]) / 6;
      d += "C" + c1x.toFixed(1) + " " + c1y.toFixed(1) + " " + c2x.toFixed(1) + " " + c2y.toFixed(1) + " " + p2[0].toFixed(1) + " " + p2[1].toFixed(1);
    }
    return d + (closed ? "Z" : "");
  }

  function buildChart() {
    var cx = 720;
    var cy = 900 * CY_RATIO;
    var rings = [
      { r: 300, seed: 7, wob: 0.045, op: 0.26, w: 1.1 },
      { r: 380, seed: 21, wob: 0.05, op: 0.2, w: 0.9 },
      { r: 470, seed: 33, wob: 0.055, op: 0.15, w: 0.8, dash: "2 9" },
      { r: 560, seed: 44, wob: 0.06, op: 0.11, w: 0.8 },
    ];
    rings.forEach(function (ring) {
      var rnd = mulberry32(ring.seed);
      var pts = [];
      var N = 13;
      for (var i = 0; i < N; i++) {
        var a = (i / N) * TAU;
        var r = ring.r * (1 + (rnd() - 0.5) * 2 * ring.wob);
        pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * 0.86]);
      }
      var p = svgEl("path", {
        d: catmull(pts, true),
        "stroke-width": ring.w,
        opacity: ring.op,
        "stroke-linecap": "round",
      });
      if (ring.dash) p.setAttribute("stroke-dasharray", ring.dash);
      chartLines.appendChild(p);
    });

    // 恒向线：从岛心放射，只画在光里（遮罩交给 CSS）
    var rnd2 = mulberry32(66);
    for (var k = 0; k < 8; k++) {
      var ang = (k / 8) * TAU + rnd2() * 0.22;
      chartLines.appendChild(svgEl("path", {
        d: "M" + (cx + Math.cos(ang) * 190).toFixed(1) + " " + (cy + Math.sin(ang) * 190).toFixed(1) +
           "L" + (cx + Math.cos(ang) * 700).toFixed(1) + " " + (cy + Math.sin(ang) * 700).toFixed(1),
        "stroke-width": 0.7,
        opacity: 0.1,
        "stroke-dasharray": "1 12",
      }));
    }

    // 水深数字：只落在有光的环带里
    var depths = ["06", "12", "18", "24", "30", "36", "42", "58"];
    var rnd3 = mulberry32(88);
    for (var s = 0; s < 18; s++) {
      var a2 = rnd3() * TAU;
      var r3 = 246 + rnd3() * 340;
      var tx = cx + Math.cos(a2) * r3;
      var ty = cy + Math.sin(a2) * r3 * 0.88;
      if (tx < 90 || tx > 1350 || ty < 60 || ty > 848) continue;
      var t = svgEl("text", {
        x: tx.toFixed(1),
        y: ty.toFixed(1),
        "text-anchor": "middle",
        "font-size": 9,
        opacity: (0.1 + rnd3() * 0.12).toFixed(3),
        fill: "currentColor",
        stroke: "none",
        "letter-spacing": "1.2",
      });
      t.textContent = depths[Math.floor(rnd3() * depths.length)];
      chartLines.appendChild(t);
    }

    // 星：二十六颗，只落在三个角，第四个角留空（留空是设计，不是没做完）
    var clusters = [
      { x: 0.17, y: 0.23, n: 11 },
      { x: 0.83, y: 0.27, n: 9 },
      { x: 0.15, y: 0.75, n: 4 },
      { x: 0.86, y: 0.71, n: 2 },
    ];
    var rnd4 = mulberry32(101);
    clusters.forEach(function (c) {
      for (var i = 0; i < c.n; i++) {
        chartStars.appendChild(svgEl("circle", {
          cx: ((c.x + (rnd4() - 0.5) * 0.13) * 1440).toFixed(1),
          cy: ((c.y + (rnd4() - 0.5) * 0.16) * 900).toFixed(1),
          r: (0.7 + rnd4() * 1.3).toFixed(2),
          opacity: (0.18 + rnd4() * 0.3).toFixed(2),
        }));
      }
    });
    // 一颗四角星芒：复用门上的母题（index.html:231）
    chartStars.appendChild(svgEl("path", {
      d: "M205 133h26M218 120v26",
      "stroke-width": 0.9,
      "stroke-linecap": "round",
      fill: "none",
      opacity: 0.3,
      stroke: "currentColor",
    }));
  }

  /* ---------- 蛋糕：俯视改成 3/4 —— 盘子有厚度，蛋糕有侧壁，奶油会流 ----------
     顶面是椭圆（cx 240 / cy 190 / rx 164 / ry 60），所有环、瓣、蜡烛都按
     K = ry/rx 压扁，才「躺」在这张斜着的桌面上，而不是浮在正圆里。 */
  var TOP = { cx: 240, cy: 190, rx: 164, ry: 60 };
  var K = TOP.ry / TOP.rx;

  function ringPoint(r, a, extra) {
    return svgEl("circle", extra || {
      cx: (TOP.cx + Math.cos(a) * r).toFixed(1),
      cy: (TOP.cy + Math.sin(a) * r * K).toFixed(1),
      r: 12,
    });
  }

  function buildCake() {
    // 十九瓣奶油花边，压着顶面的边
    // 画成「一条波浪线 + 粗描边」：描边本身就是挤出来的那条奶油，
    // 比十九个圆点更像裱花，也不会在侧壁上浮成一串珍珠。
    var d = "";
    for (var i = 0; i < 19; i++) {
      var a0 = (i / 19) * TAU - Math.PI / 2;
      var a1 = ((i + 1) / 19) * TAU - Math.PI / 2;
      var am = (a0 + a1) / 2;
      var p0 = { x: TOP.cx + Math.cos(a0) * 156, y: TOP.cy + Math.sin(a0) * 156 * K };
      var pm = { x: TOP.cx + Math.cos(am) * 172, y: TOP.cy + Math.sin(am) * 172 * K };
      var p1 = { x: TOP.cx + Math.cos(a1) * 156, y: TOP.cy + Math.sin(a1) * 156 * K };
      d += (i === 0 ? "M" + p0.x.toFixed(1) + " " + p0.y.toFixed(1) : "") +
        " Q" + pm.x.toFixed(1) + " " + pm.y.toFixed(1) +
        " " + p1.x.toFixed(1) + " " + p1.y.toFixed(1);
    }
    scallop.appendChild(svgEl("path", { d: d + " Z" }));

    // 糖珠：小一号，是点缀不是主角
    for (var b = 0; b < 19; b++) {
      var ab = (b / 19) * TAU - Math.PI / 2;
      beads.appendChild(ringPoint(112, ab, {
        cx: (TOP.cx + Math.cos(ab) * BEAD_R).toFixed(1),
        cy: (TOP.cy + Math.sin(ab) * BEAD_R * K).toFixed(1),
        r: 2.2,
      }));
    }

    // 顶面抹刀留下的同心圈
    SWIRL_R.forEach(function (r) {
      swirls.appendChild(svgEl("ellipse", {
        cx: TOP.cx, cy: TOP.cy,
        rx: r, ry: (r * K).toFixed(1),
      }));
    });

    // 奶油从顶边流下来：前缘一段才看得见，长短不齐才像真的在流
    var rnd = mulberry32(91);
    for (var d = 0; d < 15; d++) {
      var t = Math.PI * (0.08 + (d / 14) * 0.84);
      var px = TOP.cx + Math.cos(t) * (TOP.rx - 2);
      var py = TOP.cy + Math.sin(t) * (TOP.ry - 2);
      var w = 9 + rnd() * 6;
      var h = 7 + rnd() * 14 + Math.sin(t) * 5;
      drips.appendChild(svgEl("rect", {
        x: (px - w / 2).toFixed(1),
        y: (py - 5).toFixed(1),
        width: w.toFixed(1),
        height: h.toFixed(1),
        rx: (w / 2).toFixed(1),
      }));
    }

    // 侧壁的抹面竖纹：有它，圆柱才不是一块平的色
    for (var g = 0; g < 34; g++) {
      var gx = 84 + rnd() * 312;
      var gy = 196 + rnd() * 24;
      var gl = 16 + rnd() * 46;
      sideGrain.appendChild(svgEl("path", {
        d: "M" + gx.toFixed(1) + " " + gy.toFixed(1) + "v" + gl.toFixed(1),
        stroke: "#C9AE84",
        "stroke-width": 0.7,
        opacity: (0.12 + rnd() * 0.22).toFixed(2),
      }));
    }

    // 十九支蜡烛，站在顶面这一圈上；后面的略小、先画，前面的略大、后画
    var rc = mulberry32(5);
    var ring = [];
    for (var c = 0; c < 19; c++) {
      var ang = (c / 19) * TAU - Math.PI / 2;
      ring.push({
        ang: ang,
        x: TOP.cx + Math.cos(ang) * CANDLE_R,
        y: TOP.cy + Math.sin(ang) * CANDLE_R * K,
        dur: (1.7 + rc() * 1.2).toFixed(2),
        delay: (-rc() * 2.6).toFixed(2),
      });
    }
    ring.sort(function (p, q) { return p.y - q.y; });
    // 克隆出来的两半按同一顺序排蜡烛；俯视时按这个角度表重新摆位置
    S.candleAngles = ring.map(function (p) { return p.ang; });
    ring.forEach(function (p) {
      var cd = document.createElement("span");
      cd.className = "candle";
      cd.style.left = ((p.x / 480) * 100).toFixed(2) + "%";
      cd.style.top = ((p.y / 480) * 100).toFixed(2) + "%";
      cd.style.setProperty("--dur", p.dur + "s");
      cd.style.setProperty("--delay", p.delay + "s");
      // 靠后的蜡烛缩一点，纵深感就是这么来的
      cd.style.setProperty("--s", (0.82 + ((p.y - TOP.cy + 60) / 120) * 0.18).toFixed(3));
      candles.appendChild(cd);
    });
  }

  /* ---------- 劈开：沿刀线把蛋糕分成两半，缝里只有一道阴影 ----------
     台布不再撕 —— 撕出来的那两条数学直边，正是上一版被挑出的瑕疵。
     两半之间那一条**不放任何东西**：布自己身上也开着同一条缝（.cloth 的
     clip-path: url(#clothSlit)，缝宽每帧按两半让开的距离写进 #clothSlitPath），
     缝后面就是已经瞬移就位的长廊 —— 切开直接看见海。
     镜头正是从这道缝钻进去的，台布在那之后才被那个洞吃掉（CSS 的 --hole）。 */
  var CUT_N = 26;
  var halfA = null;
  var halfB = null;

  // 克隆体里的 id 会和外层撞（渐变靠 url(#…) 取），所以整套改名并重写引用
  function uniqIds(root, suffix) {
    var list = root.querySelectorAll("[id]");
    var map = {};
    var i;
    for (i = 0; i < list.length; i++) {
      var old = list[i].id;
      map[old] = old + suffix;
      list[i].id = old + suffix;
    }
    var all = root.querySelectorAll("*");
    for (i = 0; i < all.length; i++) {
      var at = all[i].attributes;
      for (var k = 0; k < at.length; k++) {
        if (at[k].value && at[k].value.indexOf("url(#") !== -1) {
          at[k].value = at[k].value.replace(/url\(#([\w-]+)\)/g, function (m, id) {
            return "url(#" + (map[id] || id) + ")";
          });
        }
      }
    }
  }

  // 半平面多边形，坐标是蛋糕自己的盒子（圆心在 size/2）。
  // 噪声只有零点几像素：刀切出来的口子是一条干净的线，不是撕纸。
  function localPolygon(dx, dy, sign, cx, cy, R, far, amp, ov) {
    var nx = -dy;
    var ny = dx;
    var ph = [0.9, 2.4, 5.1];
    var edge = [];
    for (var i = 0; i <= CUT_N; i++) {
      var t = -R + (2 * R * i) / CUT_N;
      var j = amp * (Math.sin(t * 0.071 + ph[0]) * 0.62 + Math.sin(t * 0.019 + ph[1]) * 0.38);
      // 沿法线朝对方那侧多压 ov 像素，两半才会重叠而不是刚好贴边
      var o = j - sign * (ov || 0);
      edge.push([cx + dx * t + nx * o, cy + dy * t + ny * o]);
    }
    var list = edge.slice();
    var last = edge[edge.length - 1];
    var first = edge[0];
    list.push([last[0] + nx * far * sign, last[1] + ny * far * sign]);
    list.push([first[0] + nx * far * sign, first[1] + ny * far * sign]);
    var pts = [];
    for (var n = 0; n < list.length; n++) {
      pts.push(list[n][0].toFixed(1) + "px " + list[n][1].toFixed(1) + "px");
    }
    return "polygon(" + pts.join(",") + ")";
  }

  function buildCakeHalves() {
    if (!cakeEl || !cakeStage) return;
    ["a", "b"].forEach(function (side) {
      var half = cakeEl.cloneNode(true);
      half.removeAttribute("id");
      half.classList.add("cake--half", "cake--" + side);
      uniqIds(half, "-" + side);
      cakeStage.appendChild(half);
      if (side === "a") halfA = half; else halfB = half;
    });
    cakeEl.classList.add("is-source");
    S.cakeSize = cakeEl.offsetWidth || 360;
    S.trees = [makeTree(halfA), makeTree(halfB)];
    applyCutGeometry(S.cutAngle);
    applyTilt(S.morph || 0);
  }

  /* ---------- 镜头：3/4 斜看 → 正上方俯视 ----------
     不是两张图交叉淡入：顶面/盘子/糖珠/抹刀圈/蜡烛圈全部按同一个 u 重新
     投到桌面上，K 从 0.366 连续走到 1。侧壁高度同时收到 0，奶油流和竖纹
     留在原地被顶面盖住。走完时蛋糕是一张正圆，切口才是「在面上划过去」。 */
  function setEllipse(el, cx, cy, rx, ry) {
    if (!el) return;
    el.setAttribute("cx", cx.toFixed(1));
    el.setAttribute("cy", cy.toFixed(1));
    el.setAttribute("rx", rx.toFixed(1));
    el.setAttribute("ry", ry.toFixed(1));
  }

  function scallopPath(cy, k) {
    var d = "";
    for (var i = 0; i < 19; i++) {
      var a0 = (i / 19) * TAU - Math.PI / 2;
      var a1 = ((i + 1) / 19) * TAU - Math.PI / 2;
      var am = (a0 + a1) / 2;
      var p0x = TOP.cx + Math.cos(a0) * 156, p0y = cy + Math.sin(a0) * 156 * k;
      var pmx = TOP.cx + Math.cos(am) * 172, pmy = cy + Math.sin(am) * 172 * k;
      var p1x = TOP.cx + Math.cos(a1) * 156, p1y = cy + Math.sin(a1) * 156 * k;
      d += (i === 0 ? "M" + p0x.toFixed(1) + " " + p0y.toFixed(1) : "") +
        " Q" + pmx.toFixed(1) + " " + pmy.toFixed(1) +
        " " + p1x.toFixed(1) + " " + p1y.toFixed(1);
    }
    return d + " Z";
  }

  function makeTree(root) {
    if (!root) return null;
    return {
      root: root,
      shadow: root.querySelector(".cake-plate-shadow"),
      rim: root.querySelector(".cake-plate-rim"),
      plate: root.querySelector(".cake-plate-top"),
      plateShade: root.querySelector(".cake-plate-shade"),
      plateEdge: root.querySelector(".cake-plate-edge"),
      plateDash: root.querySelector(".cake-plate-dash"),
      plateGold: root.querySelector(".cake-plate-gold"),
      foot: root.querySelector(".cake-foot"),
      wall: root.querySelector(".cake-wall"),
      wallShade: root.querySelector(".cake-wall-shade"),
      wallEdge: root.querySelector(".cake-wall-edge"),
      top: root.querySelector(".cake-top"),
      topEdge: root.querySelector(".cake-top-edge"),
      number: root.querySelector(".cake-number-group"),
      scallop: root.querySelector(".cake-scallop path"),
      swirls: [].slice.call(root.querySelectorAll(".cake-swirls ellipse")),
      beads: [].slice.call(root.querySelectorAll(".cake-beads circle")),
      candles: [].slice.call(root.querySelectorAll(".candle")),
    };
  }

  function applyTilt(u) {
    u = clamp(u, 0, 1);
    var k = K + (1 - K) * u;
    var topY = TOP0.cy + (TOP1.cy - TOP0.cy) * u;
    var topRy = TOP0.ry + (TOP1.ry - TOP0.ry) * u;
    var wallH = 78 * (1 - u);
    var wallD = "M76 " + topY.toFixed(1) + " v" + wallH.toFixed(1) +
      " a164 " + topRy.toFixed(1) + " 0 0 0 328 0 v-" + wallH.toFixed(1) + " z";
    var wallEdgeD = "M76 " + (topY + wallH).toFixed(1) +
      " a164 " + topRy.toFixed(1) + " 0 0 0 328 0";
    var numY = 30.2 - 74.2 * u;
    var numS = 0.9 + 0.1 * u;
    for (var t = 0; t < S.trees.length; t++) {
      var tr = S.trees[t];
      if (!tr) continue;
      setEllipse(tr.shadow, 244, 330 - 90 * u, 228, 60 + 168 * u);
      setEllipse(tr.rim, 240, 291 - 51 * u, 196, 66 + 130 * u);
      setEllipse(tr.plate, 240, 283 - 43 * u, 196, 66 + 130 * u);
      setEllipse(tr.plateShade, 240, 283 - 43 * u, 196, 66 + 130 * u);
      setEllipse(tr.plateEdge, 240, 283 - 43 * u, 196, 66 + 130 * u);
      setEllipse(tr.plateDash, 240, 283 - 43 * u, 182, 60 + 122 * u);
      setEllipse(tr.plateGold, 240, 283 - 43 * u, 190, 63 + 127 * u);
      setEllipse(tr.foot, 240, 292 - 52 * u, 178, 50 + 128 * u);
      if (tr.wall) tr.wall.setAttribute("d", wallD);
      if (tr.wallShade) tr.wallShade.setAttribute("d", wallD);
      if (tr.wallEdge) tr.wallEdge.setAttribute("d", wallEdgeD);
      setEllipse(tr.top, 240, topY, 164, topRy);
      setEllipse(tr.topEdge, 240, topY, 164, topRy);
      if (tr.number) {
        tr.number.setAttribute("transform", "translate(0 " + numY.toFixed(2) +
          ") scale(1 " + numS.toFixed(3) + ")");
      }
      if (tr.scallop) tr.scallop.setAttribute("d", scallopPath(topY, k));
      var i;
      for (i = 0; i < tr.swirls.length; i++) {
        setEllipse(tr.swirls[i], 240, topY, SWIRL_R[i], SWIRL_R[i] * k);
      }
      for (i = 0; i < tr.beads.length; i++) {
        var ab = (i / 19) * TAU - Math.PI / 2;
        var rb = BEAD_R + (BEAD_R_TOP - BEAD_R) * u;
        tr.beads[i].setAttribute("cx", (TOP.cx + Math.cos(ab) * rb).toFixed(1));
        tr.beads[i].setAttribute("cy", (topY + Math.sin(ab) * rb * k).toFixed(1));
      }
      for (i = 0; i < tr.candles.length && i < S.candleAngles.length; i++) {
        var ac = S.candleAngles[i];
        var rc = CANDLE_R + (CANDLE_R_TOP - CANDLE_R) * u;
        tr.candles[i].style.left = (((TOP.cx + Math.cos(ac) * rc) / 480) * 100).toFixed(2) + "%";
        tr.candles[i].style.top = (((topY + Math.sin(ac) * rc * k) / 480) * 100).toFixed(2) + "%";
      }
    }
    S.morph = u;
  }

  function applyApproach(u) {
    u = clamp(u, 0, 1);
    S.cam = 1 + CAM_ADD * u;
    S.clothCam = 1 + CLOTH_ADD * u;
    S.geom.tipMin = tipMinFor(S.cam);
    gateEl.style.setProperty("--top", u.toFixed(4));
    gateEl.style.setProperty("--cam", S.cam.toFixed(4));
    gateEl.style.setProperty("--clothcam", S.clothCam.toFixed(4));
    gateEl.style.setProperty("--ch", (30 * (1 - 0.88 * u)).toFixed(2) + "px");
    gateEl.style.setProperty("--flame-w", (9 + 3 * u).toFixed(2) + "px");
    gateEl.style.setProperty("--flame-h", (19 * (1 - 0.55 * u)).toFixed(2) + "px");
    applyTilt(u);
  }

  /* 提前渲染：第一次按下就把长廊瞬移到布后面。布整块不透明、缝宽还是 0，
     这一下滚动 + 相机 + 海的重活都花在指头下面，等真正切时后面已经是热的。 */
  function prewarm() {
    if (S.warm || NOJUMP) return;
    S.warm = true;
    if (hooks.openArchive) hooks.openArchive(true);
    if (gateEl) void gateEl.offsetWidth;
  }

  function beginApproach() {
    if (TOPAT !== null) return;
    if (S.phase !== "idle" || S.zooming || S.approachRaw > 0) return;
    S.zooming = true;
    prewarm();
    // 镜头推进时刀还没出来，用站点自己的指针；刀飞进来时再藏指针
    document.body.classList.remove("is-cake-cursor");
  }

  function requestCut() {
    if (S.phase === "aim") { cut(); return; }
    if (S.phase === "fly") { S.cutQueued = true; return; }
    // 镜头还在推的时候再点一下：算「落刀」，等刀落稳就切，别把这一下吞掉
    if (S.phase === "idle" && S.zooming) { S.cutQueued = true; return; }
    if (S.phase === "idle") beginApproach();
  }

  function defaultTip() {
    var d = tipMinFor(CAM_FINAL);
    return {
      x: S.geom.cx + Math.cos(DEFAULT_BEARING) * d,
      y: S.geom.cy + Math.sin(DEFAULT_BEARING) * d,
    };
  }

  function applyCutGeometry(angle) {
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    gateEl.style.setProperty("--cdx", dx.toFixed(5));
    gateEl.style.setProperty("--cdy", dy.toFixed(5));
    gateEl.style.setProperty("--cnx", (-dy).toFixed(5));
    gateEl.style.setProperty("--cny", dx.toFixed(5));
    gateEl.style.setProperty("--cda", (angle * DEG).toFixed(2) + "deg");
    // 窗口尺寸可能在 init 之后变过：切口必须重新量，否则那条线不落在蛋糕圆心上
    measure();
    var size = S.cakeSize || (cakeEl ? cakeEl.offsetWidth : 0) || 360;
    S.cakeSize = size;
    var c = size / 2;
    var R = size * 1.6;
    var far = size * 3;
    if (halfA) halfA.style.clipPath = localPolygon(dx, dy, 1, c, c, R, far, 0.9, 1.2);
    if (halfB) halfB.style.clipPath = localPolygon(dx, dy, -1, c, c, R, far, 0.9, 1.2);
  }

  /* ---------- 刀 ---------- */
  function placeKnife() {
    var b = S.bearing * DEG;
    var tf = "translate3d(" + S.tip.x.toFixed(1) + "px," + S.tip.y.toFixed(1) + "px,0) rotate(" + b.toFixed(2) + "deg)";
    knife.style.transform = tf;
    var g = S.geom;
    var dx = g.cx - S.tip.x;
    var dy = g.cy - S.tip.y;
    var dist = Math.sqrt(dx * dx + dy * dy);
    // 虚线只画到盘沿：越过盘沿就是在蛋糕身上划一道
    var r0 = (S.cakeSize || 360) * S.cam * 0.42;
    bearingEl.style.transform = tf + " scaleX(" + (Math.max(0, dist - r0) / 100).toFixed(3) + ")";
    // 封面第一帧连罗盘虚线都不能有；它由 placeKnife 每帧写 inline，单靠 CSS 盖不住
    bearingEl.style.opacity = (S.phase === "idle" ? 0 : clamp(1 - S.cut * 4, 0, 1)).toFixed(2);
  }

  function startFly() {
    if (S.fly || S.knifeStarted) return;
    // 第一次点在蛋糕正中时，刀从正下方飞上来会贴着蜡烛；改从右上角来。
    var px = S.pointer.x - S.geom.cx;
    var py = S.pointer.y - S.geom.cy;
    if (!S.pointer.seen || Math.sqrt(px * px + py * py) < 40) {
      var r0 = tipMinFor(CAM_FINAL);
      S.pointer.x = S.geom.cx + Math.cos(DEFAULT_BEARING) * r0;
      S.pointer.y = S.geom.cy + Math.sin(DEFAULT_BEARING) * r0;
      S.pointer.seen = true;
    }
    // 落点按**最终**镜头量：镜头还在推，刀先站到它最后该在的位置，
    // 否则落地那一帧会被 tipMin 往外顶七十像素。
    var t = clampTip(S.pointer.x, S.pointer.y, CAM_FINAL);
    var p0 = { x: t.x + (S.geom.cx - t.x) * 0.45, y: window.innerHeight + 150 };
    var vx = t.x - p0.x;
    var vy = t.y - p0.y;
    var len = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    var p1 = { x: (p0.x + t.x) * 0.5 - (vy / len) * 140, y: (p0.y + t.y) * 0.5 + (vx / len) * 140 };
    S.fly = { p0: p0, p1: p1, p2: t, t: 0 };
    S.phase = "fly";
    S.knifeStarted = true;
    S.tip.x = p0.x;
    S.tip.y = p0.y;
    S.bearing = bearingTo(p0.x, p0.y);
    gateEl.classList.remove("is-idle");
    document.body.classList.add("is-cake-cursor");
    placeKnife();
  }

  function stepFly(dt) {
    var f = S.fly;
    f.t += dt;
    var u = clamp(f.t / FLY, 0, 1);
    var s = ease3(u);
    var m = 1 - s;
    S.tip.x = m * m * f.p0.x + 2 * m * s * f.p1.x + s * s * f.p2.x;
    S.tip.y = m * m * f.p0.y + 2 * m * s * f.p1.y + s * s * f.p2.y;
    // 方位角不做阻尼：刀尖"始终"指着圆心是命题本身，不是手感选项。
    // 那点重量交给位置的阻尼 —— 尖端追手慢半拍，但刀身永远躺在半径上。
    S.bearing = bearingTo(S.tip.x, S.tip.y);
    if (u >= 1) {
      S.phase = "aim";
      S.fly = null;
      S.tip.x = f.p2.x;
      S.tip.y = f.p2.y;
      placeKnife();
      // 刀还在飞的时候点的：等它落稳再切，免得从半空划出去
      if (S.cutQueued) { S.cutQueued = false; cut(); }
      return;
    }
    placeKnife();
  }

  function stepAim(dt) {
    var target = clampTip(S.pointer.x, S.pointer.y, S.cam);
    S.tip.x = damp(S.tip.x, target.x, 20, dt);
    S.tip.y = damp(S.tip.y, target.y, 20, dt);
    var held = clampTip(S.tip.x, S.tip.y);
    S.tip.x = held.x;
    S.tip.y = held.y;
    S.bearing = bearingTo(S.tip.x, S.tip.y);
    placeKnife();
  }

  /* ---------- 切开 ---------- */
  function spawnCrumbs() {
    for (var i = 0; i < 7; i++) {
      var c = document.createElement("span");
      c.className = "crumb";
      var a = Math.random() * TAU;
      var d = 90 + Math.random() * 170;
      c.style.setProperty("--dx", (Math.cos(a) * d).toFixed(0) + "px");
      c.style.setProperty("--dy", (Math.sin(a) * d).toFixed(0) + "px");
      c.style.setProperty("--r", (Math.random() * 220 - 110).toFixed(0) + "deg");
      c.style.left = S.geom.cx.toFixed(0) + "px";
      c.style.top = S.geom.cy.toFixed(0) + "px";
      crumbsEl.appendChild(c);
      setTimeout(function () { if (c.parentNode) c.parentNode.removeChild(c); }, 640);
    }
  }

  /* ---------- 揭开：布裂开的那一瞬，长廊必须已经在后面 ---------- */
  function revealCover() {
    if (S.opened) return;
    S.opened = true;
    if (hooks.setCutting) hooks.setCutting(true);
    // 注意：这里**不解锁** --gate。--gate 一升上去，.intro 整层就淡出
    // （styles.css:160 opacity: calc(1 - var(--gate) * 1.4)），
    // 布会在揭开的那一帧连题字一起消失 —— 那就还是「开门太快」。
    // 也**不**在这里瞬移进长廊：布还在裂的时候页面已经滚走，那一帧就是
    // 「切完还剩一张画」。先让布自己裂开（裂口后面就是活着的海），
    // 布彻底离场了再瞬移，用户看不到任何跳变。
  }

  function cut() {
    if (S.phase !== "aim" && S.phase !== "fly") return;
    S.cutAngle = S.bearing;
    S.phase = "cut";
    S.cutHold = 0;
    S.cutTarget = 1;
    S.sliced = false;
    S.crumbed = false;
    applyCutGeometry(S.cutAngle);
    // 刀真的从蛋糕上划过去：从眼下的刀尖出发，穿过圆心，一直划出盘沿。
    // 方向和长度都按真实位置算（dx/dy 除以模长），不靠 sign 猜正负。
    var dx = S.geom.cx - S.tip.x;
    var dy = S.geom.cy - S.tip.y;
    var dist = Math.sqrt(dx * dx + dy * dy) || 1;
    S.sliceFrom = { x: S.tip.x, y: S.tip.y };
    S.sliceDir = { x: dx / dist, y: dy / dist };
    S.sliceLen = dist * 2 + (S.cakeSize || 360) * S.cam * 0.16;
    gateEl.classList.add("is-cut");
    // 一刀的力：画面抖 170ms，烛焰跟着顿一下。没有这一下，刀像是贴上去的。
    gateEl.classList.add("is-impact");
    setTimeout(function () { gateEl.classList.remove("is-impact"); }, 180);
    if (seamEl) {
      seamEl.classList.add("is-live");
      seamEl.style.opacity = "0.95";
    }
    // 长廊必须**现在**就在缝后面：这一版缝里什么都不放，缝一开后面直接是海。
    // 此刻布整块不动、缝宽还是 0，跳转本身看不见任何跳变；等分开了再跳，
    // 就会在缝里闪一帧空背景 —— 那正是「乱的帧」。
    // 长廊在指头按下的那一刻就预热好了；这里是兜底（调试直接 ?cake=cut 的路径）。
    if (!S.warm) prewarm();
    S.archiveJump = true;
    document.body.classList.remove("is-cake-cursor");
    // 布上的字和那道框跟着布一起走：它们印在布上，不是浮在海面上。
    document.body.classList.add("is-cutting");
    // 往后全交给 update()：HOLD 里只有一道亮缝（布纹丝不动），
    // 然后 SLICE 让刀真的划过去，划完才让两半让开，CUT 走完才算 open。
  }

  /* ---------- 缝合：回封面时台布从切口缝回去 ---------- */
  function stitch() {
    document.body.classList.remove("is-cutting");
    if (hooks.setCutting) hooks.setCutting(false);
    if (hooks.setCoverLocked) hooks.setCoverLocked(true);
    S.cutTarget = 0;
    S.opened = false;
    S.finished = false;
    S.archiveJump = false;
    // 回到封面后，下一次点按要重新把长廊预热到布后面（那时页面已经滚回顶了）
    S.warm = false;
    S.cutQueued = false;
    S.fly = null;
    S.zooming = false;
    document.body.classList.add("is-cake-cursor");
    gateEl.classList.remove("is-cut");
    gateEl.classList.remove("is-sliced");
    S.sliceFrom = null;
    S.sliced = false;
    S.crumbed = false;
    setSlit(0);
    if (seamEl) {
      seamEl.classList.remove("is-live");
      seamEl.style.opacity = "0";
    }
  }

  /* ---------- 事件 ---------- */
  var drag = { down: false, x: 0, y: 0, moved: 0 };

  function initEvents() {
    // 门只剩刀这一条路：布没裂开之前，滚轮、指头、翻页键都不许把封面顶开。
    function holdCover() { return S.phase !== "open"; }
    window.addEventListener("wheel", function (e) { if (holdCover()) e.preventDefault(); }, { passive: false });
    window.addEventListener("touchmove", function (e) { if (holdCover()) e.preventDefault(); }, { passive: false });
    window.addEventListener("keydown", function (e) {
      if (!holdCover()) return;
      if (e.key === " " || e.key === "Spacebar" || e.key === "PageDown" || e.key === "PageUp" || e.key === "ArrowDown" || e.key === "ArrowUp") e.preventDefault();
    }, { passive: false });
    window.addEventListener("pointermove", function (e) {
      S.pointer.x = e.clientX;
      S.pointer.y = e.clientY;
      S.pointer.seen = true;
    }, { passive: true });

    if (surface) {
      surface.addEventListener("pointerdown", function (e) {
        drag.down = true;
        drag.x = e.clientX;
        drag.y = e.clientY;
        drag.moved = 0;
        S.pointer.x = e.clientX;
        S.pointer.y = e.clientY;
        S.pointer.seen = true;
        // 指头按下到抬起之间通常有 50-150ms：把长廊、相机、海的那一帧藏在这里
        if (S.phase === "idle" && !S.zooming) prewarm();
      }, { passive: true });

      surface.addEventListener("pointermove", function (e) {
        if (!drag.down) return;
        drag.moved = Math.max(drag.moved, Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y));
      }, { passive: true });

      surface.addEventListener("pointerup", function (e) {
        if (!drag.down) return;
        drag.down = false;
        S.pointer.x = e.clientX;
        S.pointer.y = e.clientY;
        S.pointer.seen = true;
        // 划一刀：划的方向就是切口方向；轻点则沿眼下这条刀轴下去。
        // idle 的第一次点按只负责把镜头推下去，不设切口方向。
        if (S.phase === "aim" && drag.moved > 26) {
          S.bearing = Math.atan2(e.clientY - drag.y, e.clientX - drag.x) + Math.PI;
        }
        requestCut();
      }, { passive: true });

      surface.addEventListener("pointercancel", function () { drag.down = false; }, { passive: true });
    }

    window.addEventListener("resize", function () {
      measure();
      applyCutGeometry(S.cutAngle);
      applyTilt(S.morph || 0);
    }, { passive: true });

    window.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && S.phase !== "open" && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        requestCut();
      }
    });
  }

  /* ---------- 主循环 ---------- */
  function update(dt, gate) {
    S.__ticks = (S.__ticks || 0) + 1;
    S.__lastGate = gate;
    if (!S.geom.cx) measure();
    var reduced = hooks.reduced && hooks.reduced.matches;

    // 第一次点按不是切，是把镜头压到正上方；刀在后半段才飞进来。
    if (TOPAT === null && S.zooming && S.approachRaw < 1) {
      S.approachRaw = clamp(S.approachRaw + dt / APPROACH, 0, 1);
      var ma = easeInOut(S.approachRaw);
      applyApproach(ma);
      if (!S.knifeStarted && ma >= 0.5) startFly();
      if (S.approachRaw >= 1) S.zooming = false;
    }
    if (S.phase === "fly") stepFly(dt);
    else if (S.phase === "aim") stepAim(dt);

    if (S.cut < S.cutTarget) {
      S.cutHold += dt;
      // 先亮缝，再裂布：HOLD 这一段布一动不动，只有切口一道光
      if (S.cutHold > HOLD) {
        revealCover();
        S.cut = clamp(S.cut + dt / (reduced ? 0.001 : CUT), 0, 1);
        if (CUTAT !== null) S.cut = CUTAT;
        if (S.cut >= 1 && S.phase === "cut") {
          // 布全裂开了才算这一刀走完：这时候才把 --gate 交还给滚动，
          // 整层随之淡出，长廊满屏。此前一直锁在 0。
          S.phase = "open";
          // 长廊在指头按下时就预热好了；这里只把 --gate 交还给滚动
          if (hooks.setCoverLocked) hooks.setCoverLocked(false);
        }
      }
    } else if (S.cut > S.cutTarget) {
      S.cut = clamp(S.cut - dt / STITCH, 0, 1);
      if (S.cut === 0) {
        S.phase = "aim";
        S.cutHold = 0;
        document.body.classList.add("is-cake-cursor");
      }
    } else {
      S.cutHold = 0;
    }
    // 滚动与这一刀谁先到算谁的：滚动是门口那条老路，不能因为多了一把刀就断掉
    var g = gate || 0;
    if (g > 0.5) S.sawGate = true;
    // 缝回去只发生在「确实开过、而且已经回到封面」的时候。
    // 少了 sawGate 这一关，点下去的那一瞬间 gate 还是 0，布会当场缝上。
    if (g < 0.005 && S.sawGate && S.phase === "open" && S.opened) {
      stitch();
      S.sawGate = false;
    }
    // 只认这一刀。滚动早就不是开门的路了（app.js 的 coverLocked），
    // 再把 --gate 算进来，揭开那一帧 gate 就是 1，布会当场飞到底 —— 又成了「太快」。
    var eff = S.phase === "cut" || S.phase === "open" ? easeInOut(S.cut) : S.cut;
    gateEl.style.setProperty("--cut", eff.toFixed(4));
    // 一刀是三件事：刀先真的划过（SLICE 那一段），两半才让开（缝里直接是海），
    // 镜头随后钻进这道缝。划过用 smoothstep：两头轻、中段快，像一刀划过去。
    var p = S.cut;
    var sliceU = clamp(p / SLICE, 0, 1);
    if (S.phase === "cut" && S.sliceFrom) {
      var stroke = easeInOut(sliceU);
      S.tip.x = S.sliceFrom.x + S.sliceDir.x * S.sliceLen * stroke;
      S.tip.y = S.sliceFrom.y + S.sliceDir.y * S.sliceLen * stroke;
      placeKnife();
      if (seamEl) {
        // 亮缝跟着刀尖长：元素左端钉在入口，scaleX = 已经划过的长度
        seamEl.style.transform = "translate3d(" + S.sliceFrom.x.toFixed(1) + "px," +
          S.sliceFrom.y.toFixed(1) + "px,0) rotate(" + (S.cutAngle * DEG).toFixed(2) + "deg)" +
          " scaleX(" + Math.max(0.001, (stroke * S.sliceLen) / SEAM_W).toFixed(4) + ")";
        seamEl.style.opacity = (sliceU < 1 ? 0.95 : clamp(1 - (p - SLICE) / 0.05, 0, 1)).toFixed(2);
      }
      // 碎屑在刀尖穿过圆心那一刻才崩：早了就成了「一落刀就炸」
      if (!S.crumbed && stroke >= 0.5) { S.crumbed = true; spawnCrumbs(); }
      if (sliceU >= 1 && !S.sliced) { S.sliced = true; gateEl.classList.add("is-sliced"); }
    }
    // 劈开要让刀先划完再起 —— 划到一半布就自己让开，那是「没切就开了」。
    // 劈开用 easeInOut（两头慢中间快，像被掰开的），下潜是纯加速。
    S.split = easeInOut(clamp((p - SLICE) / 0.42, 0, 1));
    var splitB = easeInOut(clamp((p - SLICE - 0.03) / 0.42, 0, 1));   // 另一半晚 80ms 起步
    var dz = clamp((p - 0.34) / 0.66, 0, 1);
    S.dive = clamp(dz * dz * (1.15 - 0.15 * dz), 0, 1);
    // 缝宽不是猜的：半块在 .cake-stage 里沿法线位移 (gap + dive*220)，而 .cake-stage
    // 自己放大 (1 + dive*2.25)，屏幕上就是 (gap + dive*220)*(1 + dive*2.25)；
    // 布只放大 (1 + dive*0.5)，折回布自己的坐标再挖洞，两条边才对得上。
    // --gap 是 .cake-stage 里的本地像素；屏幕上的位移要再乘镜头和 dive 的缩放
    var gapMax = Math.min((S.cakeSize || 360) * S.cam * 0.12, 64) / S.cam;
    gateEl.style.setProperty("--split", S.split.toFixed(4));
    gateEl.style.setProperty("--gap", (S.split * gapMax).toFixed(1));
    gateEl.style.setProperty("--gapb", (splitB * gapMax).toFixed(1));
    gateEl.style.setProperty("--dive", S.dive.toFixed(4));
    var gapNow = Math.max(S.split, splitB) * gapMax;
    // 只有真让开了才有缝：base 为 0 就给 0，布上不多一条缝。
    var slitBase = (gapNow + S.dive * 220) * S.cam * (1 + S.dive * 2.25) / (S.clothCam * (1 + S.dive * 0.5));
    // +12：缝的边要压在蛋糕身下面 —— 两半各自还有 1.3°/1.8° 的歪，在盘沿能错开
    // 十来像素，正正好等宽会露出布丝。这个余量只在缝已经开了之后才加。
    setSlit(slitBase > 0.5 ? slitBase + 12 * S.cam : 0);
    // 洞不能跟着下潜线性开：dive 才 0.18 洞就已经 600px，那是「舷窗」，
    // 一张明信片摊在洞里的构图正是要避开的瑕疵。让它憋到镜头快贴上去才开。
    var hz = clamp((S.dive - 0.5) / 0.5, 0, 1);
    gateEl.style.setProperty("--hole", (hz * hz).toFixed(4));
    gateEl.classList.toggle("is-diving", S.dive > 0.002);
    gateEl.style.setProperty("--fade", clamp((S.dive - 0.5) / 0.5, 0, 1).toFixed(4));
    // 门开完了、--gate 也爬上来了，这时候封面那套字才允许回来（否则会闪一下）
    if (S.phase === "open" && !S.finished && g > 0.6) {
      S.finished = true;
      if (hooks.setCutting) hooks.setCutting(false);
    }
    // 淡出只负责「最后一点尾帧」，不能在半路把布抹掉：0.92 之后才退场
    gateEl.classList.toggle("is-out", eff > 0.92);
    // 切开到位了就把整层从绘制里撤掉：布已经飞出去，留着它等于在长廊上
    // 压着一层看不见却还在屏幕上的东西 —— 那正是「切完还剩一帧」的来历。
    gateEl.classList.toggle("is-gone", eff > 0.995 && S.phase === "open");
    return eff;
  }

  /* ---------- 启动 ---------- */
  function init(h) {
    if (h) {
      hooks.openArchive = h.openArchive || null;
      hooks.reduced = h.reducedMotion || null;
      hooks.setCutting = h.setCutting || null;
      hooks.setCoverLocked = h.setCoverLocked || null;
    }
    if (hooks.reduced && hooks.reduced.matches) {
      // 不飞刀、不切：让原来的封面照常开门，320ms 淡出交给 .intro
      gateEl.remove();
      return;
    }
    var introEl = document.getElementById("intro");
    if (introEl) introEl.classList.add("has-cake");
    measure();
    buildChart();
    buildCake();
    buildCakeHalves();
    // 初始就是斜看的那块蛋糕；第一次点按才往正上方推。
    applyApproach(TOPAT !== null ? TOPAT : 0);
    S.tip.x = S.geom.cx;
    S.tip.y = window.innerHeight + 150;
    S.bearing = bearingTo(S.tip.x, S.tip.y);
    placeKnife();
    initEvents();
    S.mounted = true;
    if (hooks.setCoverLocked) hooks.setCoverLocked(true);
    // 封面一开始只有蛋糕：刀和那条虚线都还没进场，站点自己的指针也还在
    document.body.classList.remove("is-cake-cursor");
    gateEl.classList.add("is-idle");

    if (FREEZE === "aim" || FREEZE === "cut") {
      S.pointer.seen = true;
      applyApproach(1);
      gateEl.classList.remove("is-idle");
      document.body.classList.add("is-cake-cursor");
      S.pointer.x = S.geom.cx + window.innerWidth * 0.22;
      S.pointer.y = S.geom.cy + window.innerHeight * 0.3;
      var t = clampTip(S.pointer.x, S.pointer.y, CAM_FINAL);
      S.tip.x = t.x;
      S.tip.y = t.y;
      S.bearing = bearingTo(t.x, t.y);
      S.phase = "aim";
      placeKnife();
      // 调试：把关键状态写进 DOM，--dump-dom 才看得到（沙箱里没有 CDP eval）
      var DBG = params.get("dbg") === "1";
      var dbg = document.createElement("div");
      dbg.id = "cakeDebug";
      dbg.style.cssText = "position:fixed;left:0;top:0;z-index:9999;font:13px/1.35 monospace;color:#000;background:rgba(255,255,255,.92);padding:4px 6px;max-width:100vw;white-space:pre-wrap";
      if (!DBG) dbg.style.display = "none";
      document.body.appendChild(dbg);
      if (DBG) setInterval(function () {
        dbg.textContent = "phase=" + S.phase + " cut=" + S.cut.toFixed(2) +
          " top=" + S.morph.toFixed(2) + " cam=" + S.cam.toFixed(2) +
          " gate=[" + gateEl.className + "]" +
          " body=[" + document.body.className + "]" +
          " sawGate=" + S.sawGate + " opened=" + S.opened +
          " eff=" + (gateEl.style.getPropertyValue("--cut") || "-") +
          " split=" + (S.split || 0).toFixed(2) + " dive=" + (S.dive || 0).toFixed(2) +
          " halves=" + gateEl.querySelectorAll(".cake--half").length +
          " clip=" + [].map.call(gateEl.querySelectorAll(".cake--half"), function (h) {
            return (h.style.clipPath || "-").length;
          }).join("/") +
          " scrollY=" + Math.round(window.scrollY);
      }, 120);

      if (FREEZE === "archive") {
        // A/B 对照：完全不参与开屏，只像「切完」那样瞬移进长廊
        gateEl.remove();
        document.body.classList.add("is-cutting");
        setTimeout(function () { if (hooks.openArchive) hooks.openArchive(true); }, 120);
        return;
      }

      if (FREEZE === "cut") {
        // 调试截图必须走真路径：绕过去等于没验证那一刀
        setTimeout(function () { cut(); }, 400);
      }
    }
  }

  window.CakeGate = {
    init: init,
    update: update,
    cut: cut,
    stitch: stitch,
    isActive: function () { return S.mounted === true && S.phase !== "open"; },
    /* 布是否还严丝合缝地盖着整块屏幕：没有缝、没在裂开、也没在下潜。
       app.js 拿它判断「布后面那些根本看不见的东西这一帧还要不要算」。 */
    isSealed: function () {
      return S.mounted === true && S.cut <= 0.001 && S.cutTarget <= 0.001 &&
        S.dive <= 0.001 && S.split <= 0.001;
    },
    debug: function () {
      return {
        phase: S.phase,
        cut: +S.cut.toFixed(3),
        tip: { x: +S.tip.x.toFixed(1), y: +S.tip.y.toFixed(1) },
        bearing: +(S.bearing * DEG).toFixed(2),
        axisError: +Math.abs(shortest(S.bearing, bearingTo(S.tip.x, S.tip.y)) * DEG).toFixed(3),
        geom: S.geom,
        top: +(S.morph || 0).toFixed(3),
        cam: +S.cam.toFixed(3),
        approachRaw: +S.approachRaw.toFixed(3),
        warm: S.warm,
      };
    },
  };
})();
