/* =========================================================
   TIDELINE · Weather & Time
   站点上只剩「时刻 / 太阳 / 月亮 / 风」：云、雨、雷电已从 GIFT 移除
   （2026-10-21 用户定位：送女友的生日礼物，只有海和云；FULL 暂时无云）。
   风还在，因为它是海面涌浪（seaState）的唯一来源。
   所有量仍是阻尼过的连续标量，没有预设贴图。
   ========================================================= */
(function () {
  "use strict";

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
  const mod = (v, m) => ((v % m) + m) % m;
  const DEG = Math.PI / 180;
  /* 时间流速：5 秒走完 1 小时，一昼夜 24 小时 = 2 分钟。
     dt 的单位是秒（app.js 把每帧的毫秒差除以 1000 并夹在 0.001~0.05），
     所以这里就是「1 小时需要多少秒」这个除数。 */
  const SECONDS_PER_HOUR = 5;
  /* 双击日月切换昼夜时的快进速度：12 小时（半天）摊在 1 秒里走完。
     用户 2026-10-23 的原话是「在一秒内让日/月来到原来的月/日所在地方」——
     所以不是原地换一张图，而是让时针真的把日月沿弧线送过去。 */
  const WARP_HOURS_PER_SEC = 12;

  /* 诊断开关（默认全关，行为与之前完全一致）：
     ?noattr=1     不写 applySun/applySky 的任何自定义属性 */
  window.__tidelineDiag = window.__tidelineDiag || {};
  const DIAG = Object.assign(window.__tidelineDiag, {
    noattr: /[?&]noattr=1/.test(window.location.search),
    /* 测量用：强制回到「每帧无条件写 :root」的旧行为，用来在同一次运行里
       对比缓存前后的样式重算成本。 */
    nocache: /[?&]nocache=1/.test(window.location.search),
    /* 测量用：把变量写回 :root（旧行为），对比「缩小失效范围」的收益。 */
    rootscope: /[?&]rootscope=1/.test(window.location.search),
  });

  /* 调用计数器：A/B 归一化用。整数自增，成本可忽略，默认也在跑，
     方便把「重算时间」除到「到底发生了多少次 :root 写入」上。 */
  const counters = {
    updates: 0,
    applySun: 0,
    applySky: 0,
    rootWrites: 0,
    rootApplied: 0,
  };
  window.__weatherCounters = counters;

  /* 自定义属性写入统一入口。
     ★ 修复 A（缓存）：值没变就完全不碰 DOM。阻尼过渡不受影响 —— 值真的在变时
       照样逐帧写，只是不再把同样的字符串重复 setProperty。
     ★ 修复 B（缩小失效范围，关键）：自定义属性会继承，写在 :root 上等于让整棵
       文档树样式失效（2936 行 CSS 全量重算）。而绝大多数天气变量只在
       .atmosphere 里被消费（太阳/天空/海色/月相/阴影），所以写到 .atmosphere
       元素上，只让那 ~30 个节点失效；只有跨卡片与聚焦层的 --ambient /
       --light-angle / --light-strength 才写到 .gallery 与 #focus 两处。
     两个修复叠加后，每帧的样式重算从「全文档」降到「一个小子树」。 */
  const varCache = new WeakMap();
  function setVar(target, name, value) {
    counters.rootWrites += 1;
    const el = DIAG.rootscope ? document.documentElement : target;
    if (!el) return;
    let cache = varCache.get(el);
    if (!cache) { cache = Object.create(null); varCache.set(el, cache); }
    if (!DIAG.nocache && cache[name] === value) return;
    cache[name] = value;
    counters.rootApplied += 1;
    el.style.setProperty(name, value);
  }
  /* 只在 .atmosphere 子树里被消费的变量（太阳/天空/海色/月相/阴影）。 */
  function setAtmo(name, value) { setVar(env.atmo, name, value); }
  /* 跨卡片 / 聚焦层 / 地平线光晕的变量：只写三个真正消费它们的子树。 */
  function setLight(name, value) {
    setVar(env.worldScope, name, value);
    setVar(env.focusScope, name, value);
    setVar(env.atmo, name, value);
  }

  const rgb = (c) => "rgb(" + Math.round(c[0] * 255) + ", " + Math.round(c[1] * 255) + ", " + Math.round(c[2] * 255) + ")";
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
  const rgba = (c, a) => "rgba(" + Math.round(c[0] * 255) + ", " + Math.round(c[1] * 255) + ", " + Math.round(c[2] * 255) + ", " + clamp(a).toFixed(3) + ")";
  const clone = (c) => [c[0], c[1], c[2]];

  const P = {
    day: {
      top: [0.969, 0.941, 0.875], mid: [0.941, 0.937, 0.882], horizon: [0.871, 0.918, 0.863],
      seaFar: [0.447, 0.757, 0.753], seaNear: [0.220, 0.608, 0.631], seaDeep: [0.098, 0.435, 0.475],
      sun: [1.0, 0.965, 0.855], glow: [1.0, 0.965, 0.855],
    },
    dusk: {
      top: [0.208, 0.235, 0.365], mid: [0.478, 0.318, 0.302], horizon: [0.949, 0.541, 0.298],
      seaFar: [0.239, 0.318, 0.373], seaNear: [0.102, 0.196, 0.271], seaDeep: [0.031, 0.094, 0.153],
      sun: [1.0, 0.588, 0.298], glow: [1.0, 0.478, 0.235],
    },
    night: {
      top: [0.031, 0.051, 0.114], mid: [0.063, 0.090, 0.176], horizon: [0.118, 0.157, 0.259],
      seaFar: [0.078, 0.137, 0.216], seaNear: [0.035, 0.078, 0.137], seaDeep: [0.012, 0.039, 0.086],
      sun: [0.855, 0.898, 0.925], glow: [0.647, 0.769, 0.851],
    },
  };

  const state = {
    timeTarget: 12,
    windTarget: 0.22,
    windDirection: 240,
    windDirectionTarget: 240,
    elevationOffset: 0,
    timeOfDay: 12,
    wind: 0.22,
    gust: 0,
    seaState: 0.2,
    sunElevation: 12,
    sunAzimuth: 180,
    sunX: 0.74,
    sunY: 0.11,
    latitude: 26.05,
    dayOfYear: 1,
    isNight: false,
    ambient: 1,
    manualTime: false,
    autoTime: true,
    /* 双击切换昼夜后还剩多少小时没快进完（12 = 半天）。> 0 时 update 会加
       速推进时针，并跳过常规的自动流逝，见 update 顶部。 */
    warpHours: 0,
    source: "climate",
    liveLabel: "CLIMATE",
    sky: {
      top: [0, 0, 0], mid: [0, 0, 0], horizon: [0, 0, 0],
      seaFar: [0, 0, 0], seaNear: [0, 0, 0], seaDeep: [0, 0, 0],
      sun: [1, 1, 1], glow: [1, 1, 1],
    },
  };

  const env = {
    quality: null,
    reducedMotion: null,
    celestial: null,
    lastSky: 0,
    /* 上一帧的 now（毫秒）。update 用它算「真实经过的时间」，见 clockDt。 */
    lastNow: 0,
  };

  function solarPosition(hours, doy, latitude) {
    const decl = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365) * DEG;
    const ha = (hours - 12) * 15 * DEG;
    const lat = latitude * DEG;
    const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
    const elevation = Math.asin(clamp(sinElev, -1, 1)) / DEG;
    const azimuth = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) / DEG + 180;
    return { elevation, azimuth: mod(azimuth, 360) };
  }

  /* 日出/日落时刻（小时，真太阳时）。球面三角的时角公式：
     cos(H0) = -tan(纬)·tan(赤纬)，H0 是半昼长（度）。用来给日/月弧线做归一化，
     这样日盘在日出那一刻正好落在画面左缘、日落那一刻落在右缘，不会在边缘空转。 */
  function dayWindow(doy, latitude) {
    const decl = 23.44 * Math.sin(2 * Math.PI * (doy - 81) / 365) * DEG;
    const cosH = clamp(-Math.tan(latitude * DEG) * Math.tan(decl), -1, 1);
    const half = Math.acos(cosH) / DEG / 15;
    return { rise: 12 - half, set: 12 + half };
  }

  function dayOfYear(date) {
    const start = Date.UTC(date.getFullYear(), 0, 0);
    return Math.floor((date.getTime() - start) / 86400000);
  }

  function resolvePalette() {
    const elev = state.sunElevation;
    const dayness = smooth(clamp((elev + 6) / 26));
    const duskness = clamp(1 - Math.abs(elev - 3) / 13);
    const keys = ["top", "mid", "horizon", "seaFar", "seaNear", "seaDeep", "sun", "glow"];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      let col = mix(P.night[key], P.day[key], dayness);
      col = mix(col, P.dusk[key], duskness * (1 - dayness * 0.35) * 0.8);
      state.sky[key] = col;
    }
    state.ambient = clamp(0.24 + dayness * 0.76, 0.14, 1);
  }

  function readSystemTime() {
    const now = new Date();
    state.dayOfYear = dayOfYear(now);
    state.timeOfDay = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    state.timeTarget = state.timeOfDay;
  }

  function climateSeed(date) {
    const d = date || new Date();
    return (d.getFullYear() * 372 + (d.getMonth() + 1) * 31 + d.getDate()) % 997;
  }

  /* 只剩风：云/雨/雷电都没有了。风决定 seaState → 海面涌浪幅度。 */
  function climateWeather() {
    const seed = climateSeed();
    const day = state.dayOfYear || 1;
    const wind = clamp(0.18 + 0.4 * Math.abs(Math.sin(day * 0.023 + seed * 0.07)));
    return { wind: wind, windDirection: mod(200 + 140 * Math.sin(day * 0.05 + seed), 360) };
  }

  function applyWeatherTargets(w, source, label) {
    state.source = source;
    state.liveLabel = label;
    state.windTarget = clamp(w.wind);
    if (Number.isFinite(Number(w.windDirection))) state.windDirectionTarget = Number(w.windDirection);
  }

  function useClimate() {
    applyWeatherTargets(climateWeather(), "climate", "CLIMATE");
  }

  window.Weather = {
    state: state,
    clamp: clamp,
    lerp: lerp,
    damp: damp,
    smooth: smooth,
    mix: mix,
    rgb: rgb,
    solarPosition: solarPosition,
    readSystemTime: readSystemTime,
    init: function (options) {
      env.quality = options && options.quality ? options.quality : null;
      env.reducedMotion = options && options.reducedMotion ? options.reducedMotion : null;
      readSystemTime();
      /* ?t=17.6 直接跳到指定时刻（0..24），用来对照不同高度角的太阳外观。
         它会停在那一刻（manualTime=true）不动；顶上那块 AUTO / RESET 面板
         已于 2026-10-23 整块删除，要恢复流动就重开一个不带 ?t= 的地址。 */
      var forced = /[?&]t=([0-9]*\.?[0-9]+)/.exec(window.location.search || "");
      if (forced) {
        var forcedHour = clamp(parseFloat(forced[1]), 0, 24);
        state.manualTime = true;
        state.autoTime = false;
        state.timeTarget = forcedHour;
        state.timeOfDay = forcedHour;
      }
      useClimate();
      initDOM();
      initCelestial();
    },
    update: function (dt, now) { update(dt, now); },
  };

  function update(dt, now) {
    counters.updates += 1;
    const reduced = env.reducedMotion && env.reducedMotion.matches;
    /* 时针按「真实经过的时间」走，不用上游的 dt：app.js 把 dt 夹在 0.05 s
       以内，只要有一帧超过 50 ms，那段时间就被悄悄扔掉，时针一慢一快，日月
       看着就是一顿一顿往前跳（用户 2026-10-23 的第三条反馈）。这里按 now 自己
       算，只对「切走标签页再回来」这种超长空档设 0.25 s 上限，免得回来一下午。 */
    const clockDt = env.lastNow ? clamp((now - env.lastNow) / 1000, 0, 0.25) : dt;
    env.lastNow = now;
    /* 双击切换昼夜 = 快进半天：12 小时摊进 1 秒，太阳沿弧线滑到左边落下、
       月亮从右边升起，最后停在另一个天体刚才所在的位置上。快进期间不再叠加
       常规的自动流逝，否则会多走出半分钟。 */
    if (state.warpHours > 0) {
      const step = Math.min(state.warpHours, clockDt * WARP_HOURS_PER_SEC);
      state.timeTarget = mod(state.timeTarget + step, 24);
      state.warpHours = state.warpHours - step > 1e-6 ? state.warpHours - step : 0;
    } else if (state.autoTime && !state.manualTime) {
      state.timeTarget = mod(state.timeTarget + (reduced ? 0 : clockDt / SECONDS_PER_HOUR), 24);
    }
    state.timeOfDay = state.manualTime ? damp(state.timeOfDay, state.timeTarget, 1.7, dt) : state.timeTarget;
    state.wind = damp(state.wind, state.windTarget, 0.5, dt);
    state.windDirection = damp(state.windDirection, state.windDirectionTarget, 0.35, dt);
    state.gust = 0.5 + 0.5 * Math.sin(now * 0.00013) * Math.sin(now * 0.00007 + 1.7);

    const solar = solarPosition(state.timeOfDay, state.dayOfYear, state.latitude);
    state.sunElevationRaw = solar.elevation;
    state.sunElevation = clamp(solar.elevation + state.elevationOffset, -18, 90);
    state.sunAzimuth = solar.azimuth;
    state.isNight = state.sunElevation < -0.5;
    state.seaState = damp(state.seaState, clamp(0.12 + state.wind * 0.68), 0.08, dt);

    resolvePalette();
    applySun();
    /* 快进那 1 秒里天色要连续变化，90 ms 的节流会看出跳色，所以整段放行。 */
    if (state.warpHours > 0 || now - env.lastSky > 90) { env.lastSky = now; applySky(); }
  }

  /* 太阳外观查表 —— 参考现实世界的两个物理事实：
     1. 太阳的视直径恒定（约 0.53°），变大的是光晕，不是本体；
     2. 高度角越低，光线穿过的空气越厚（地平线处约 38 倍大气质量），
        短波被瑞利散射掉、只剩长波 —— 白热 → 金黄 → 橙红 → 暗红，
        光晕同时张开，本体被大气折射压扁。
     所以按下表用「高度角」插值而不是按时刻：同一高度角的日出与日落确实同色
     （真实现象），但不同时刻的观感彼此不同。
       e      太阳高度角（度）
       core   光球颜色 sRGB 0..1
       a/a1   光球中心 / 中段不透明度（越低越被大气吃掉）
       bloom  光晕颜色
       ba     光晕不透明度
       spread 光晕张开倍数（越大越张开：路径更长、前向散射更强）
       flat   竖直压扁（折射，真实约 0.85） */
  var SUN_LOOK = [
    { e: -4, core: [1.00, 0.42, 0.18], a: 0.00, a1: 0.00, bloom: [1.00, 0.40, 0.18], ba: 0.00, spread: 1.85, flat: 0.82, hs: 58 },
    { e: -1, core: [1.00, 0.38, 0.14], a: 0.66, a1: 0.30, bloom: [1.00, 0.36, 0.14], ba: 0.30, spread: 1.72, flat: 0.85, hs: 52 },
    { e: 2, core: [1.00, 0.52, 0.20], a: 0.92, a1: 0.44, bloom: [1.00, 0.48, 0.20], ba: 0.46, spread: 1.60, flat: 0.89, hs: 40 },
    { e: 6, core: [1.00, 0.68, 0.36], a: 0.98, a1: 0.47, bloom: [1.00, 0.62, 0.30], ba: 0.54, spread: 1.44, flat: 0.92, hs: 31 },
    { e: 14, core: [1.00, 0.86, 0.62], a: 1.00, a1: 0.45, bloom: [1.00, 0.82, 0.56], ba: 0.58, spread: 1.22, flat: 0.96, hs: 23 },
    { e: 26, core: [1.00, 0.96, 0.86], a: 1.00, a1: 0.44, bloom: [1.00, 0.95, 0.82], ba: 0.68, spread: 1.08, flat: 0.99, hs: 18 },
    { e: 45, core: [1.00, 0.99, 0.96], a: 1.00, a1: 0.45, bloom: [1.00, 0.99, 0.94], ba: 0.68, spread: 1.02, flat: 1.00, hs: 16 },
    { e: 70, core: [1.00, 1.00, 1.00], a: 1.00, a1: 0.47, bloom: [1.00, 1.00, 0.98], ba: 0.66, spread: 0.98, flat: 1.00, hs: 15 },
  ];

  /* 月亮：视直径小、没有大气辉光，所以轮廓清楚、光晕很淡且偏冷。 */
  var MOON_LOOK = { core: [0.97, 0.99, 1.00], a: 1.00, a1: 1.00, bloom: [0.80, 0.88, 1.00], ba: 0.42, spread: 1.18, flat: 1.00, hs: 26 };

  function lookFor(elev) {
    var L = SUN_LOOK;
    if (elev <= L[0].e) return L[0];
    var last = L[L.length - 1];
    if (elev >= last.e) return last;
    var i = 0;
    while (i < L.length - 2 && elev > L[i + 1].e) i += 1;
    var p = L[i];
    var q = L[i + 1];
    var t = smooth((elev - p.e) / (q.e - p.e));
    return {
      core: mix(p.core, q.core, t),
      bloom: mix(p.bloom, q.bloom, t),
      a: lerp(p.a, q.a, t),
      a1: lerp(p.a1, q.a1, t),
      ba: lerp(p.ba, q.ba, t),
      spread: lerp(p.spread, q.spread, t),
      flat: lerp(p.flat, q.flat, t),
      hs: lerp(p.hs, q.hs, t),
    };
  }

  function applySun() {
    counters.applySun += 1;
    const celestial = env.celestial;
    if (!celestial) return;
    const day = !state.isNight;
    /* 弧线进度按真实的日出/日落时刻归一化，而不是写死 6..18：太阳在日出那一刻
       正好从画面右缘出现、日落那一刻正好从左缘消失（右 = 东，左 = 西）。写死
       6..18 的话，本纬度 10 月会多出 0.36 小时的空档 —— 日盘/月盘卡在边缘不动
       将近 2 秒，2 分钟一天的时候看得出一次「停顿」。 */
    const win = dayWindow(state.dayOfYear, state.latitude);
    const daySpan = Math.max(0.5, win.set - win.rise);
    const nightSpan = Math.max(0.5, 24 - daySpan);
    const u = day
      ? (state.timeOfDay - win.rise) / daySpan
      : mod(state.timeOfDay - win.set, 24) / nightSpan;
    const theta = clamp(u, 0, 1) * Math.PI;
    // Polar-light framing: the disc travels a short, low arc and never leaves
    // the frame, so it stays draggable and the sea always keeps a grazing sun.
    /* 日月同向：右缘是东、左缘是西，两个天体都「从右边升起、往左边落下」
       （2026-10-23 用户定稿；此前的实现是相反方向）。月亮不因为「反日」就倒着走
       —— 满月只是与太阳相隔 12 小时，太阳在西边（左缘）落下时它才刚从东边
       （右缘）升起，然后和太阳一样从右往左走完自己的那半圈。两段用同一个符号：
       theta=0（各自弧线的起点）在 x=88%，theta=π（终点）在 x=12%。 */
    const x = 50 + 38 * Math.cos(theta);
    // Keep the sun and the moon above the shoreline. The CSS horizon sits at
    // about 47.8% of the viewport, so elevation 0 maps just above it.
    const horizonY = 25.2;
    const topY = 13.4;
    /* 月亮高度 = 太阳高度的相反数（反日：满月永远在太阳对面）。再减掉 0.5° ——
       也就是 isNight 的翻转阈值本身：太阳刚落到 -0.5° 时它那支已被 clamp 在 0、
       停在地平线上，月亮此刻也应当正好从地平线升起。不减这 0.5°，交接瞬间
       日盘会凭空往上跳半个度（约 4px）；2 分钟一天，这半度每轮都会看见。 */
    const rawElevForArc = state.sunElevationRaw == null ? state.sunElevation : state.sunElevationRaw;
    const visualElev = day ? clamp(state.sunElevation, 0, 90) : clamp(-rawElevForArc - 0.5, 0, 74);
    // Perspective, not a linear ramp: the 3D sea reads this screen position as
    // a light direction, and a linear ramp squashes every daylight hour into
    // the last few degrees above the horizon (one permanent sunset glitter).
    const y = clamp(horizonY - Math.pow(visualElev / 90, 0.62) * (horizonY - topY), topY, horizonY);
    /* 视直径恒定：亮核尺寸不随时刻变化，变的是光晕（spread）。
       具体像素宽度由 CSS 的 clamp() 负责（见 .celestial 的 --sun-size），
       这样窗口大小变化时不用再进 JS 重算。 */
    state.sunX = x / 100;
    state.sunY = y / 100;
    if (!DIAG.noattr) {
      const look = day ? lookFor(state.sunElevation) : MOON_LOOK;
      const dim = 0.72 + 0.28 * state.ambient;
      const core = look.core;
      const bloom = look.bloom;
      /* 太阳沉到地平线以下的深度：0 = 刚落下，1 = 8 度以下，余晖已尽。 */
      const rawElev = state.sunElevationRaw == null ? state.sunElevation : state.sunElevationRaw;
      const belowHorizon = clamp((-rawElev - 0.5) / 7.5, 0, 1);
      /* 光球中心过曝：往白里推一点，否则正午的太阳偏灰。 */
      const hot = mix(core, [1, 1, 1], 0.35);
      /* 交接（rawElev = -0.5）两侧都必须收到 0：日月共用同一个元素，那一刻它的
         位置要从左缘跳到右缘（太阳在左缘落下、月亮在右缘升起）—— 这是天文事实，
         不是 bug，但只要还亮着就会看见一次「闪」。所以日面在最后 2° 里淡出、
         月面在最初 2.5° 里淡入，交接点两边都是 0，换位藏在「谁都还没亮」的瞬间。 */
      const sunDisc = smooth(clamp((rawElev + 0.5) / 2.0, 0, 1));
      const moonIn = day ? 0 : smooth(clamp((-rawElev - 0.5) / 2.5, 0, 1));
      /* 天光（日晕/炫光/月晕）用长得多的 6° 窗口：那是一片大面积柔光，跟着光球
         一起在 2° 里灭掉，2 分钟一天的时候看起来是「啪」地关灯。光球 2°、天光
         6°，两者在交接点都是 0，换位仍然看不见。 */
      const skyVis = day
        ? smooth(clamp((rawElev + 0.5) / 6.0, 0, 1))
        : smooth(clamp((-rawElev - 0.5) / 6.0, 0, 1));
      const discCore = day ? hot : mix([1.00, 0.74, 0.54], hot, moonIn);
      const discMid = day ? mix(core, bloom, 0.45) : mix([1.00, 0.70, 0.50], mix(core, bloom, 0.45), moonIn);
      /* 月面不吃 dim：普通混合下 alpha < 1 等于把月面往夜空里掺，满月会显得
         发灰发透，细节也跟着糊。夜间的深浅只由淡入淡出的 moonIn 决定。
         日面乘 sunDisc：贴海平线那最后 2° 里它越来越红、越来越暗，沉下去的一刻
         正好收干净。 */
      const discA = day ? look.a * dim * sunDisc : look.a * moonIn;
      const discA1 = day ? look.a1 * dim * sunDisc : look.a1 * moonIn;
      const sunColor = rgb(core);
      const sunGlow = rgb(bloom);
      setAtmo("--sun-x", x.toFixed(2) + "%");
      setAtmo("--sun-y", y.toFixed(2) + "%");
      /* 最里面那一小块是过曝的「死白」：太阳之所以刺眼，靠的就是这块没有细节的白，
         外面才有橙金的层次。月亮不参与（月面要留住纹理）。 */
      const hotWhite = mix(discCore, [1, 1, 1], day ? 0.88 : 0.30 * moonIn);
      setAtmo("--sun-core-hot", rgba(hotWhite, clamp(discA + (day ? 0.04 : 0))));
      setAtmo("--sun-core-0", rgba(discCore, discA));
      setAtmo("--sun-core-1", rgba(discMid, discA1));
      setAtmo("--sun-core-2", rgba(bloom, 0));
      /* 远处大范围眩光：逆光时整片天被洗亮一层，是「耀眼」最直接的证据。 */
      setAtmo("--sun-veil", rgba(mix(bloom, [1, 1, 1], 0.50), (day ? 0.09 + 0.07 * clamp(state.sunElevation / 40, 0, 1) : 0.05) * dim * skyVis));
      /* 入夜后近处紧光也收敛到月亮档，避免一过地平线就跳。 */
      const baUse = day ? look.ba : lerp(0.20, look.ba, belowHorizon);
      setAtmo("--sun-bloom-0", rgba(bloom, baUse * dim * skyVis));
      setAtmo("--sun-bloom-1", rgba(bloom, baUse * dim * 0.52 * skyVis));
      setAtmo("--sun-bloom-3", rgba(bloom, baUse * dim * 0.20 * skyVis));
      setAtmo("--sun-bloom-2", rgba(bloom, 0));
      setAtmo("--sun-bloom-scale", look.spread.toFixed(3));
      setAtmo("--sun-flatten", look.flat.toFixed(3));
      /* 月面是真实贴图（本身不透明），淡入淡出只能靠元素级 opacity，
         不能指望 --sun-core-* 的 alpha（那只管得住兜底渐变）。 */
      setAtmo("--sun-disc-opacity", (day ? 1 : moonIn).toFixed(3));
      /* 大气泛白（.atmosphere 第一层）负责整片天光；.celestial-bloom 只负责
         太阳近处那一圈紧光，由 spread 控制张开。白天低角度收到 0.62，
         与入夜那一刻接上，地平线两侧不跳。 */
      /* 正午的日晕要又小又猛：天光还是蓝的，太阳才刺得出来。
         贴近地平线时散射铺满整片天，那才是落日的橙。 */
      /* 亮度上限必须留给日面：日晕一浓，太阳就变成同一片白里的一块，反而看不出亮。
         所以日晕只做到「把天洗亮一点」，越贴地平线越宽（散射铺得开）。 */
      const haloA = (day ? 0.26 + 0.20 * (1 - clamp(state.sunElevation / 20, 0, 1)) : lerp(0.46, 0.34, belowHorizon)) * dim * skyVis;
      /* 夜里的余晖还是暖的（被散射掉的落日），越接近深蓝调才越接近月色。 */
      /* 日晕画的是「被点亮的天」，不是光本身：直接用饱和的日色压上去会把天空的
         G/B 通道一起拉低，日落时那圈橙色就发闷发褐。先往白里提，才像光在扩散。 */
      /* 刚入夜时那圈光还是落日散射的暖色，等月亮真升起来（moonIn→1）就换成
         银白的月色——两者都从同一个 bloom 出发，色相不会跳。 */
      const nightHalo = mix(bloom, [1, 1, 1], 0.62);
      const haloColor = day ? mix(bloom, [1, 1, 1], 0.55) : mix(mix(bloom, [1.00, 0.62, 0.42], 0.45), nightHalo, moonIn);
      setAtmo("--sun-halo", rgba(haloColor, haloA));
      setAtmo("--sun-halo-x", look.hs.toFixed(1) + "%");
      setAtmo("--sun-halo-y", (look.hs * (0.72 + 0.28 * look.flat)).toFixed(1) + "%");
      /* 月光小路（.moon-path）的浓度：只有夜里才有。
         注意这套模型里月亮的高度是太阳高度取反（见上面 visualElev：夜里
         -sunElevationRaw），rawElev 本身在地平线以下一直是负数，直接拿它算会
         恒得 0——光带永远不出现。所以要先取反，月亮爬高 6° 之后才拉满，
         免得天刚擦黑就凭空出现一条亮带。 */
      const pathA = day ? 0 : clamp(-rawElev / 6, 0, 1) * (0.55 + 0.45 * moonIn);
      setAtmo("--moon-path", pathA.toFixed(3));
      /* 仍被 .light-glow（3D 海面取光方向）与天气条圆点消费的旧变量。 */
      setAtmo("--sun-color", sunColor);
      setAtmo("--sun-glow", sunGlow);
      setAtmo("--sun-glow-alpha", (clamp((0.72 + 0.30 * state.ambient) * dim, 0, 1)).toFixed(3));
      /* 卡片水影只在自己卡片里用 --shadow-shift。 */
      setVar(env.worldScope, "--shadow-shift", ((0.5 - x / 100) * 110).toFixed(1) + "px");
    }
    celestial.classList.toggle("is-moon", !day);
    celestial.classList.toggle("is-warping", state.warpHours > 0);
  }

  function applySky() {
    counters.applySky += 1;
    if (DIAG.noattr) return;
    /* 只在 .atmosphere 子树里被消费：天空、海色、渲染阴影、月相。 */
    setAtmo("--sky-top", rgb(state.sky.top));
    setAtmo("--sky-mid", rgb(state.sky.mid));
    setAtmo("--sky-horizon", rgb(state.sky.horizon));
    setAtmo("--sea-far", rgb(state.sky.seaFar));
    setAtmo("--sea-near", rgb(state.sky.seaNear));
    setAtmo("--sea-deep", rgb(state.sky.seaDeep));
    setAtmo("--shade", ((1 - state.ambient) * 0.42).toFixed(3));
    /* 卡片面与聚焦层都要用的光照参数：只写 .gallery 与 #focus 两处。 */
    setLight("--ambient", state.ambient.toFixed(3));
    setLight("--light-angle", (90 + (state.sunAzimuth - 180) * 0.5).toFixed(1) + "deg");
    setLight("--light-strength", (0.4 + state.ambient * 0.6).toFixed(3));
    /* --cloud-dark / --wind / --storm / --cloud-cover / --rain 已无 CSS 消费，停止写入。 */
  }

  function initDOM() {
    env.celestial = document.getElementById("celestial");
    /* 自定义属性的写入目标（见 setVar）：只让真正消费它们的子树失效。 */
    env.atmo = document.querySelector(".atmosphere");
    env.galleryScope = document.getElementById("gallery");
    env.worldScope = document.getElementById("world");
    env.focusScope = document.getElementById("focus");
  }

  function initCelestial() {
    const el = env.celestial;
    if (!el) return;
    let dragging = false, moved = false;
    let startX = 0, startY = 0;
    /* 双击 / 双击（触屏上的双点）切换昼夜。判定放在 pointerup 里自己做，不挂
       dblclick —— 触屏上 dblclick 不可靠，而两次 pointerup 是同一套事件。
       DBL_TAP_MS 是两次点击的最大间隔，DBL_TAP_PX 是位移容差。 */
    const DBL_TAP_MS = 350;
    const DBL_TAP_PX = 28;
    let lastTapAt = 0, lastTapX = 0, lastTapY = 0;
    /* 拖的是太阳还是月亮，按「按下那一刻是白天还是夜里」判断。不能用指针高度
       猜：月亮夜里也在天顶，p.y < 0.6 会把深夜的拖动误判成白天弧。 */
    let nightDrag = false;
    function pos(e) {
      const g = document.getElementById("gallery");
      const r = g ? g.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    function toggleDayNight() {
      /* 白天 → 午夜、夜里 → 正午，但**不是原地换一张图**：把时针拨快，12 小时
         摊在 1 秒里走完（WARP_HOURS_PER_SEC），日月于是真的沿弧线走完全程 ——
         太阳在左边落下、月亮从右边升起，最后停在上一个天体原来的位置上。
         连按两次就攒成 24 小时，转一整天回到原处，仍然只往前、不倒退。 */
      /* 双击之间那 100~350 ms 是「点两下」的手速，不是要走的时间：把时钟
         基准清掉，下一帧退回上游 dt，否则这点间隔会被乘上 12 倍，第一帧
         就窜出去一两个小时。 */
      env.lastNow = 0;
      state.warpHours = Math.min(24, state.warpHours + 12);
      state.elevationOffset = 0;
      /* 快进期间不许有 manualTime 抖动，否则 timeOfDay 会被 damp 拖成一条慢吞
         吞的曲线；切完必须是「活的」表，所以 autoTime 保持真。 */
      state.manualTime = false;
      state.autoTime = true;
    }
    function applyDrag(e) {
      const p = pos(e);
      const dayArc = !nightDrag;
      /* 反解 applySun 的弧线：两段都是 x = 50 + 38·cos(theta)（右 = 东、左 = 西，
         各自从右缘升起、向左缘落下），只是走各自的时间区间 —— 白天 [rise, set]，
         夜里 [set, 24+rise]。振幅必须和 applySun 里的 38 一致，否则拖到画面边缘
         时刻会差几十分钟。 */
      const win = dayWindow(state.dayOfYear, state.latitude);
      const daySpan = Math.max(0.5, win.set - win.rise);
      const nightSpan = Math.max(0.5, 24 - daySpan);
      const cx = clamp((p.x * 100 - 50) / 38, -1, 1);
      const u = Math.acos(cx) / Math.PI;
      const t = dayArc ? win.rise + u * daySpan : win.set + u * nightSpan;
      /* 手指和时刻 1:1：直接置 timeOfDay，不让 update() 里的 damp 把日盘拖在
         手指后面 0.6 秒。垂直方向不参与 —— 时刻定了，高度就定了，日盘永远在
         这条弧线上（此前按 y 改 elevationOffset 会让它离开弧线，松手时再跳回来）。 */
      state.timeTarget = mod(t, 24);
      state.timeOfDay = state.timeTarget;
      state.elevationOffset = 0;
      state.manualTime = true;
      state.autoTime = false;
    }
    el.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false;
      startX = e.clientX; startY = e.clientY;
      nightDrag = state.isNight;
      el.classList.add("is-dragging");
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      if (!moved && Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 5) {
        moved = true;
      }
      /* 只有真的拖动了才改时刻：否则一次手抖的点击会把表挪走几十分钟。 */
      if (moved) applyDrag(e);
    });
    function finish(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging");
      if (moved) {
        /* 只借走时间，不关机：松手立刻把表交还给自动流动。原 bug（2026-10-23
           「拖完日月后时间就不走了」）就是 manualTime 在拖动结束后一直挂着。 */
        lastTapAt = 0;
      } else {
        const now = performance.now();
        const near = Math.abs(e.clientX - lastTapX) < DBL_TAP_PX && Math.abs(e.clientY - lastTapY) < DBL_TAP_PX;
        if (lastTapAt && now - lastTapAt < DBL_TAP_MS && near) {
          toggleDayNight();
          lastTapAt = 0;
        } else {
          lastTapAt = now;
          lastTapX = e.clientX;
          lastTapY = e.clientY;
        }
      }
      /* 无论拖动还是点击，指针离开时表都必须是走的。 */
      state.manualTime = false;
      state.autoTime = true;
      moved = false;
      if (el.releasePointerCapture) { try { el.releasePointerCapture(e.pointerId); } catch (err) {} }
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      /* 键盘等价于双击：切昼夜，时间继续流。 */
      toggleDayNight();
    });
  }

})();
