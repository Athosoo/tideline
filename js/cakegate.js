/* 开屏 · 潮汐台布 (Cake Gate)
   一张亚麻台布铺满封面：场上唯一的光源是蛋糕上的十九支蜡烛，光从蛋糕向四周衰减；
   台布上印着一张潮汐海图，蛋糕就是海图上那座岛；刀是罗盘指针 ——
   所以刀尖永远指着圆心，这是罗盘的规矩，不是动画的随手设定。

   滚动（--gate）和这一刀（--cut）谁先到算谁的：--open = max(--gate, --cut)。
   切开时台布裂成互补的两半，露出来的是底下一只活着的海 —— 不画假的「里面」。

   ?cake=aim|cut 冻结/预演某个相位（截图对照用）。
   两扇门已于 2026-10-22 删除，这一层就是封面本身，没有退路可退。 */
(function () {
  "use strict";

  var gateEl = document.getElementById("cakeGate");
  if (!gateEl) return;
  var params = new URLSearchParams(location.search);
  var FREEZE = params.get("cake") || "";

  var TAU = Math.PI * 2;
  var DEG = 180 / Math.PI;
  var CY_RATIO = 0.62;          // 蛋糕圆心：偏下。上面那条带子留给封面标题，下面留给页脚
  var FLY = 1.4;                // 刀入场 1400ms
  var FLY_A = 0.28;             // 加速段结束
  var FLY_B = 0.74;             // 匀速段结束
  var FLY_V = 2 / (1 + (FLY_B - FLY_A));   // 峰值 1.3699：由「三段位移和 = 1」解出
  var CUT = 0.9;
  var STITCH = 0.7;             // 回封面缝合 700ms

  var clothWrap = document.getElementById("clothWrap");
  var chartLines = document.getElementById("chartLines");
  var chartStars = document.getElementById("chartStars");
  var scallop = document.getElementById("scallop");
  var beads = document.getElementById("beads");
  var candles = document.getElementById("candles");
  var knife = document.getElementById("knife");
  var bearingEl = document.getElementById("bearing");
  var crumbsEl = document.getElementById("crumbs");
  var surface = document.getElementById("cutSurface");
  var seamEl = document.getElementById("cutSeam");

  var hooks = { openArchive: null, reduced: null };

  var S = {
    phase: "idle",      // idle → fly → aim → cut → open → (缝合) aim
    t: 0,
    cut: 0,             // --cut 0..1
    cutTarget: 0,
    cutHold: 0,
    opened: false,
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
    var box = document.querySelector(".cake");
    S.geom.cx = window.innerWidth * 0.5;
    S.geom.cy = window.innerHeight * CY_RATIO;
    S.geom.cake = box ? box.getBoundingClientRect().width : 336;
    S.geom.tipMin = Math.max(150, S.geom.cake * 0.58);
  }

  // 刀尖不许进到岛里，也不许出画：沿半径推到最小距离、再夹进视口
  function clampTip(x, y) {
    var g = S.geom;
    var dx = x - g.cx;
    var dy = y - g.cy;
    var d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.001) { dx = 0; dy = 1; d = 1; }
    var want = Math.max(d, g.tipMin);
    return {
      x: clamp(g.cx + (dx / d) * want, 80, window.innerWidth - 80),
      y: clamp(g.cy + (dy / d) * want, 80, window.innerHeight - 80),
    };
  }

  function bearingTo(tx, ty) { return Math.atan2(S.geom.cy - ty, S.geom.cx - tx); }

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

  /* ---------- 蛋糕：十九个瓣、十九颗糖珠、十九支蜡烛 ---------- */
  function buildCake() {
    for (var i = 0; i < 19; i++) {
      var a = (i / 19) * TAU - Math.PI / 2;
      scallop.appendChild(svgEl("circle", {
        cx: (240 + Math.cos(a) * 162).toFixed(1),
        cy: (240 + Math.sin(a) * 162).toFixed(1),
        r: 13,
      }));
      beads.appendChild(svgEl("circle", {
        cx: (240 + Math.cos(a) * 124).toFixed(1),
        cy: (240 + Math.sin(a) * 124).toFixed(1),
        r: 2.6,
      }));
    }

    var rnd = mulberry32(5);
    for (var c = 0; c < 19; c++) {
      var ang = (c / 19) * TAU - Math.PI / 2;
      var cd = document.createElement("span");
      cd.className = "candle";
      cd.style.left = (50 + Math.cos(ang) * 31.25).toFixed(2) + "%";
      cd.style.top = (50 + Math.sin(ang) * 31.25).toFixed(2) + "%";
      cd.style.setProperty("--dur", (1.7 + rnd() * 1.2).toFixed(2) + "s");
      cd.style.setProperty("--delay", (-rnd() * 2.6).toFixed(2) + "s");
      candles.appendChild(cd);
    }
  }

  /* ---------- 两半：互补多边形，切口带撕的噪声 ---------- */
  var CUT_N = 26;
  var CUT_R = 8000;

  function halfPolygon(dx, dy, sign, seed) {
    // 过圆心、沿刀轴 (dx,dy) 的直线；sign 决定取哪半。两半共用同一条噪声边，
    // 所以拼起来严丝合缝 —— 撕的痕迹必须是同一条。
    // 法线不随手性翻转：两半用的是**同一条**带噪声的切口边，
    // 否则一边往里、一边往外，拼起来就有一道 ±3px 的缝。
    var nx = -dy;
    var ny = dx;
    var rnd = mulberry32(seed);
    var ph = [rnd() * TAU, rnd() * TAU, rnd() * TAU];
    var edge = [];
    for (var i = 0; i <= CUT_N; i++) {
      var t = -CUT_R + (2 * CUT_R * i) / CUT_N;
      var j = Math.sin(t * 0.004 + ph[0]) * 1.5 + Math.sin(t * 0.0013 + ph[1]) * 1.2 + Math.sin(t * 0.021 + ph[2]) * 0.6;
      edge.push([dx * t + nx * j, dy * t + ny * j]);
    }
    var far = 40000;
    var list = edge.slice();
    var last = edge[edge.length - 1];
    var first = edge[0];
    list.push([last[0] + nx * far * sign, last[1] + ny * far * sign]);
    list.push([first[0] + nx * far * sign, first[1] + ny * far * sign]);
    var pts = [];
    for (var k = 0; k < list.length; k++) {
      pts.push((list[k][0] + S.geom.cx).toFixed(1) + "px " + (list[k][1] + S.geom.cy).toFixed(1) + "px");
    }
    return "polygon(" + pts.join(",") + ")";
  }

  function buildHalves() {
    if (!clothWrap) return;
    ["a", "b"].forEach(function (side) {
      var half = document.createElement("div");
      half.className = "cloth-half cloth-half--" + side;
      half.id = "half" + side.toUpperCase();
      var copy = clothWrap.cloneNode(true);
      copy.removeAttribute("id");
      var all = copy.querySelectorAll("[id]");
      for (var i = 0; i < all.length; i++) all[i].removeAttribute("id");
      half.appendChild(copy);
      gateEl.insertBefore(half, clothWrap);
    });
    clothWrap.classList.add("is-source");
    applyCutGeometry(S.cutAngle);
  }

  function applyCutGeometry(angle) {
    var dx = Math.cos(angle);
    var dy = Math.sin(angle);
    gateEl.style.setProperty("--cdx", dx.toFixed(5));
    gateEl.style.setProperty("--cdy", dy.toFixed(5));
    gateEl.style.setProperty("--cnx", (-dy).toFixed(5));
    gateEl.style.setProperty("--cny", dx.toFixed(5));
    var a = document.getElementById("halfA");
    var b = document.getElementById("halfB");
    if (a) a.style.clipPath = halfPolygon(dx, dy, 1, 17);
    if (b) b.style.clipPath = halfPolygon(dx, dy, -1, 17);
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
    bearingEl.style.transform = tf + " scaleX(" + (dist / 100).toFixed(3) + ")";
    bearingEl.style.opacity = clamp(1 - S.cut * 4, 0, 1).toFixed(2);
  }

  function startFly() {
    var t = clampTip(S.pointer.seen ? S.pointer.x : S.geom.cx, S.pointer.seen ? S.pointer.y : window.innerHeight * 0.97);
    var p0 = { x: t.x + (S.geom.cx - t.x) * 0.45, y: window.innerHeight + 150 };
    var vx = t.x - p0.x;
    var vy = t.y - p0.y;
    var len = Math.max(1, Math.sqrt(vx * vx + vy * vy));
    var p1 = { x: (p0.x + t.x) * 0.5 - (vy / len) * 140, y: (p0.y + t.y) * 0.5 + (vx / len) * 140 };
    S.fly = { p0: p0, p1: p1, p2: t, t: 0 };
    S.phase = "fly";
    S.tip.x = p0.x;
    S.tip.y = p0.y;
    S.bearing = bearingTo(p0.x, p0.y);
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
      S.tip.x = f.p2.x;
      S.tip.y = f.p2.y;
    }
    placeKnife();
  }

  function stepAim(dt) {
    var target = clampTip(S.pointer.x, S.pointer.y);
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

  function cut() {
    if (S.phase !== "aim" && S.phase !== "fly") return;
    S.cutAngle = S.bearing;
    S.phase = "cut";
    S.cutHold = 0;
    S.cutTarget = 1;
    applyCutGeometry(S.cutAngle);
    gateEl.classList.add("is-cut");
    if (seamEl) {
      seamEl.style.transform = "translate3d(" + S.geom.cx.toFixed(0) + "px," + S.geom.cy.toFixed(0) + "px,0) rotate(" + (S.bearing * DEG).toFixed(2) + "deg)";
      seamEl.classList.add("is-live");
    }
    spawnCrumbs();
    document.body.classList.remove("is-cake-cursor");
    // 切口先亮一会儿，再让整张幕布跟着开 —— 一刀是一件事，不是两件
    setTimeout(function () {
      if (hooks.openArchive && !S.opened) {
        S.opened = true;
        hooks.openArchive();
      }
    }, 240);
    setTimeout(function () { S.phase = "open"; }, 640);
  }

  /* ---------- 缝合：回封面时台布从切口缝回去 ---------- */
  function stitch() {
    S.cutTarget = 0;
    S.opened = false;
    gateEl.classList.remove("is-cut");
    if (seamEl) seamEl.classList.remove("is-live");
  }

  /* ---------- 事件 ---------- */
  var drag = { down: false, x: 0, y: 0, moved: 0 };

  function initEvents() {
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
        // 划一刀：划的方向就是切口方向；轻点则沿眼下这条刀轴下去
        if (drag.moved > 26) {
          S.bearing = Math.atan2(e.clientY - drag.y, e.clientX - drag.x) + Math.PI;
        }
        cut();
      }, { passive: true });

      surface.addEventListener("pointercancel", function () { drag.down = false; }, { passive: true });
    }

    window.addEventListener("resize", function () {
      measure();
      applyCutGeometry(S.cutAngle);
    }, { passive: true });

    window.addEventListener("keydown", function (e) {
      if (e.key === "Enter" && (S.phase === "aim" || S.phase === "fly") && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        cut();
      }
    });
  }

  /* ---------- 主循环 ---------- */
  function update(dt, gate) {
    if (!S.geom.cx) measure();
    var reduced = hooks.reduced && hooks.reduced.matches;

    if (S.phase === "idle") startFly();
    if (S.phase === "fly") stepFly(dt);
    else if (S.phase === "aim") stepAim(dt);

    if (S.cut < S.cutTarget) {
      S.cutHold += dt;
      if (S.cutHold > 0.09) S.cut = clamp(S.cut + dt / (reduced ? 0.001 : CUT), 0, 1);
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
    var eff = S.phase === "cut" || S.phase === "open" ? easeOut(S.cut) : S.cut;
    if (g > eff) eff = g;
    gateEl.style.setProperty("--cut", eff.toFixed(4));
    gateEl.classList.toggle("is-out", eff > 0.55);
    return eff;
  }

  /* ---------- 启动 ---------- */
  function init(h) {
    if (h) {
      hooks.openArchive = h.openArchive || null;
      hooks.reduced = h.reducedMotion || null;
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
    buildHalves();
    S.tip.x = S.geom.cx;
    S.tip.y = window.innerHeight + 150;
    S.bearing = bearingTo(S.tip.x, S.tip.y);
    placeKnife();
    initEvents();
    document.body.classList.add("is-cake-cursor");

    if (FREEZE === "aim" || FREEZE === "cut") {
      S.pointer.seen = true;
      S.pointer.x = S.geom.cx + window.innerWidth * 0.22;
      S.pointer.y = S.geom.cy + window.innerHeight * 0.3;
      var t = clampTip(S.pointer.x, S.pointer.y);
      S.tip.x = t.x;
      S.tip.y = t.y;
      S.bearing = bearingTo(t.x, t.y);
      S.phase = "aim";
      placeKnife();
      if (FREEZE === "cut") {
        setTimeout(function () {
          S.cutAngle = S.bearing;
          applyCutGeometry(S.cutAngle);
          gateEl.classList.add("is-cut");
          S.cut = 1;
          S.cutTarget = 1;
          gateEl.style.setProperty("--cut", "1");
          document.body.classList.remove("is-cake-cursor");
        }, 400);
      }
    }
  }

  window.CakeGate = {
    init: init,
    update: update,
    cut: cut,
    stitch: stitch,
    debug: function () {
      return {
        phase: S.phase,
        cut: +S.cut.toFixed(3),
        tip: { x: +S.tip.x.toFixed(1), y: +S.tip.y.toFixed(1) },
        bearing: +(S.bearing * DEG).toFixed(2),
        axisError: +Math.abs(shortest(S.bearing, bearingTo(S.tip.x, S.tip.y)) * DEG).toFixed(3),
        geom: S.geom,
      };
    },
  };
})();
