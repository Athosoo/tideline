/* =========================================================
   TIDELINE · Weather & Time
   A continuous weather field: time, sun/moon, cloud, wind,
   rain, storm and lightning are all damped scalars, so any
   value in between is a valid state (no preset textures).
   ========================================================= */
(function () {
  "use strict";

  const clamp = (v, min = 0, max = 1) => Math.min(max, Math.max(min, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const smooth = (t) => { t = clamp(t); return t * t * (3 - 2 * t); };
  const damp = (current, target, lambda, dt) => lerp(current, target, 1 - Math.exp(-lambda * dt));
  const mod = (v, m) => ((v % m) + m) % m;
  const DEG = Math.PI / 180;

  /* 诊断开关（默认全关，行为与之前完全一致）：
     ?norain=1     不画雨（含每帧全屏 clearRect）
     ?noattr=1     不写 applySun/applySky/--flash 的任何 :root 自定义属性 */
  window.__tidelineDiag = window.__tidelineDiag || {};
  const DIAG = Object.assign(window.__tidelineDiag, {
    norain: /[?&]norain=1/.test(window.location.search),
    noattr: /[?&]noattr=1/.test(window.location.search),
    /* 测量用：强制回到「每帧无条件写 :root」的旧行为，用来在同一次运行里
       对比缓存前后的样式重算成本。 */
    nocache: /[?&]nocache=1/.test(window.location.search),
    /* 测量用：把变量写回 :root（旧行为），对比「缩小失效范围」的收益。 */
    rootscope: /[?&]rootscope=1/.test(window.location.search),
  });

  /* 调用计数器：A/B 归一化用。整数自增，成本可忽略，默认也在跑，
     方便把「重算时间」除到「到底发生了多少次 :root 写入 / 2D 云生成」上。 */
  const counters = {
    updates: 0,
    applySun: 0,
    applySky: 0,
    updateRain: 0,
    rainCleared: 0,
    rootWrites: 0,
    rootApplied: 0,
  };
  window.__weatherCounters = counters;

  /* 自定义属性写入统一入口。
     ★ 修复 A（缓存）：值没变就完全不碰 DOM。阻尼过渡不受影响 —— 值真的在变时
       照样逐帧写，只是不再把同样的字符串重复 setProperty。
     ★ 修复 B（缩小失效范围，关键）：自定义属性会继承，写在 :root 上等于让整棵
       文档树样式失效（2936 行 CSS 全量重算）。而绝大多数天气变量只在
       .atmosphere 里被消费（太阳/天空/海色/云量/雨/闪电），所以写到 .atmosphere
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
  /* 只在 .atmosphere 子树里被消费的变量（太阳/天空/海色/云/雨/闪电）。 */
  function setAtmo(name, value) { setVar(env.atmo, name, value); }
  /* 跨卡片 / 聚焦层 / 地平线光晕的变量：只写三个真正消费它们的子树。 */
  function setLight(name, value) {
    setVar(env.worldScope, name, value);
    setVar(env.focusScope, name, value);
    setVar(env.atmo, name, value);
  }

  const rgb = (c) => "rgb(" + Math.round(c[0] * 255) + ", " + Math.round(c[1] * 255) + ", " + Math.round(c[2] * 255) + ")";
  const mix = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
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
    storm: {
      top: [0.259, 0.298, 0.318], mid: [0.325, 0.365, 0.384], horizon: [0.412, 0.451, 0.463],
      seaFar: [0.216, 0.286, 0.318], seaNear: [0.086, 0.157, 0.196], seaDeep: [0.039, 0.086, 0.118],
      sun: [0.784, 0.816, 0.831], glow: [0.706, 0.749, 0.769],
    },
  };

  const state = {
    timeTarget: 12,
    cloudTarget: 0.25,
    windTarget: 0.22,
    windDirection: 240,
    windDirectionTarget: 240,
    rainTarget: 0,
    stormTarget: 0,
    lightningTarget: 0,
    elevationOffset: 0,
    timeOfDay: 12,
    cloudCover: 0.25,
    wind: 0.22,
    rain: 0,
    storm: 0,
    lightning: 0,
    gust: 0,
    seaState: 0.2,
    flash: 0,
    sunElevation: 12,
    sunAzimuth: 180,
    sunX: 0.74,
    sunY: 0.11,
    latitude: 26.05,
    dayOfYear: 1,
    isNight: false,
    overcast: 0.16,
    storminess: 0.1,
    ambient: 1,
    manualTime: false,
    manualWeather: false,
    autoTime: true,
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
    storage: null,
    panel: null,
    celestial: null,
    cloudCanvas: null,
    rainCanvas: null,
    rainDirty: false,
    flashEl: null,
    lastSky: 0,
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

  function dayOfYear(date) {
    const start = Date.UTC(date.getFullYear(), 0, 0);
    return Math.floor((date.getTime() - start) / 86400000);
  }

  function resolvePalette() {
    const elev = state.sunElevation;
    const dayness = smooth(clamp((elev + 6) / 26));
    const duskness = clamp(1 - Math.abs(elev - 3) / 13);
    const storminess = state.storminess;
    const overcast = state.overcast;
    const keys = ["top", "mid", "horizon", "seaFar", "seaNear", "seaDeep", "sun", "glow"];
    for (let i = 0; i < keys.length; i += 1) {
      const key = keys[i];
      let col = mix(P.night[key], P.day[key], dayness);
      col = mix(col, P.dusk[key], duskness * (1 - dayness * 0.35) * 0.8);
      col = mix(col, P.storm[key], storminess * 0.8);
      const overcastTone = mix([0.10, 0.12, 0.16], [0.62, 0.64, 0.64], dayness);
      const overcastDeep = mix([0.05, 0.06, 0.09], [0.20, 0.22, 0.24], dayness);
      if (key !== "seaNear" && key !== "seaDeep") col = mix(col, overcastTone, overcast * 0.42);
      col = mix(col, overcastDeep, overcast * (key === "seaDeep" ? 0.3 : 0.12));
      state.sky[key] = col;
    }
    state.ambient = clamp(0.24 + dayness * 0.76 - overcast * 0.26 - storminess * 0.2, 0.14, 1);
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

  function climateWeather() {
    const seed = climateSeed();
    const day = state.dayOfYear || 1;
    const cloud = clamp(0.28 + 0.34 * Math.sin(day * 0.017 + seed * 0.013) + 0.12 * Math.sin(day * 0.11 + seed));
    const wind = clamp(0.18 + 0.4 * Math.abs(Math.sin(day * 0.023 + seed * 0.07)));
    const rain = clamp((cloud - 0.62) * 1.6) * 0.7;
    const storm = clamp((rain - 0.25) * 1.1);
    return { cloud: cloud, wind: wind, rain: rain, storm: storm, lightning: clamp(storm * 0.7), windDirection: mod(200 + 140 * Math.sin(day * 0.05 + seed), 360) };
  }

  function applyWeatherTargets(w, source, label, force) {
    state.source = source;
    state.liveLabel = label;
    if (!force && state.manualWeather) return;
    state.cloudTarget = clamp(w.cloud);
    state.windTarget = clamp(w.wind);
    state.rainTarget = clamp(w.rain);
    state.stormTarget = clamp(w.storm);
    if (Number.isFinite(Number(w.windDirection))) state.windDirectionTarget = Number(w.windDirection);
    state.lightningTarget = clamp(w.lightning == null ? 0 : w.lightning);
  }

  function useClimate() {
    applyWeatherTargets(climateWeather(), "climate", "CLIMATE");
  }

  function readWeatherCache() {
    if (!env.storage) return null;
    try {
      const raw = env.storage.getItem("tideline.weather.v1");
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (!parsed || !parsed.data || !parsed.at) return null;
      if (Date.now() - parsed.at > 15 * 60 * 1000) return null;
      return parsed;
    } catch (error) { return null; }
  }

  function writeWeatherCache(data) {
    if (!env.storage) return;
    try {
      env.storage.setItem("tideline.weather.v1", JSON.stringify({ at: Date.now(), data: data }));
    } catch (error) { /* no-op */ }
  }

  function fetchLiveWeather() {
    const cached = readWeatherCache();
    if (cached) { applyWeatherTargets(cached.data, "live", "LIVE"); return; }
    if (!("fetch" in window)) { useClimate(); return; }
    const controller = "AbortController" in window ? new AbortController() : null;
    const timer = controller ? setTimeout(function () { controller.abort(); }, 6000) : 0;
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + state.latitude +
      "&longitude=120&current=temperature_2m,cloud_cover,wind_speed_10m,wind_direction_10m,precipitation,weather_code,is_day&timezone=auto";
    let request;
    try {
      request = fetch(url, controller ? { signal: controller.signal } : {});
    } catch (error) {
      if (timer) clearTimeout(timer);
      useClimate();
      return;
    }
    request
      .then(function (res) { return res.ok ? res.json() : Promise.reject(new Error("http " + res.status)); })
      .then(function (json) {
        if (timer) clearTimeout(timer);
        const cur = json && json.current;
        if (!cur) throw new Error("no current");
        const code = Number(cur.weather_code == null ? 0 : cur.weather_code);
        const cloud = clamp(Number(cur.cloud_cover == null ? 40 : cur.cloud_cover) / 100);
        const wind = clamp(Number(cur.wind_speed_10m == null ? 8 : cur.wind_speed_10m) / 34);
        const precip = clamp(Number(cur.precipitation == null ? 0 : cur.precipitation) / 7);
        let rain = precip;
        let storm = 0;
        let lightning = 0;
        if (code >= 51 && code <= 57) rain = Math.max(rain, 0.22);
        else if (code >= 61 && code <= 67) rain = Math.max(rain, 0.5);
        else if (code >= 80 && code <= 82) { rain = Math.max(rain, 0.5); storm = 0.25; }
        else if (code >= 95) { rain = Math.max(rain, 0.6); storm = 0.8; lightning = 0.75; }
        const data = { cloud: cloud, wind: wind, rain: rain, storm: storm, lightning: lightning, windDirection: Number(cur.wind_direction_10m == null ? 240 : cur.wind_direction_10m) };
        applyWeatherTargets(data, "live", "LIVE");
        writeWeatherCache(data);
      })
      .catch(function () {
        if (timer) clearTimeout(timer);
        useClimate();
      });
  }

  function safeStorage() {
    try {
      if (!("localStorage" in window)) return null;
      const probe = "__tideline_probe__";
      window.localStorage.setItem(probe, "1");
      window.localStorage.removeItem(probe);
      return window.localStorage;
    } catch (error) { return null; }
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
    climateWeather: climateWeather,
    fetchLiveWeather: fetchLiveWeather,
    useClimate: useClimate,
    applyWeatherTargets: applyWeatherTargets,
    init: function (options) {
      env.quality = options && options.quality ? options.quality : null;
      env.reducedMotion = options && options.reducedMotion ? options.reducedMotion : null;
      env.storage = safeStorage();
      readSystemTime();
      useClimate();
      initDOM();
      initPanel();
      initCelestial();
      fetchLiveWeather();
    },
    update: function (dt, now) { update(dt, now); },
    resize: function () { resizeCanvases(); },
  };

  function update(dt, now) {
    counters.updates += 1;
    const reduced = env.reducedMotion && env.reducedMotion.matches;
    if (state.autoTime && !state.manualTime) {
      state.timeTarget = mod(state.timeTarget + (reduced ? 0 : dt / 3600), 24);
    }
    state.timeOfDay = state.manualTime ? damp(state.timeOfDay, state.timeTarget, 1.7, dt) : state.timeTarget;
    /* 云量的阻尼过渡：0.22 的时间常数是 4.5 s，慢机上更久 —— 用户把滑杆拉到 0
       之后十几秒天上还有云，看着像"关不掉"（实测 target=0 时 cover 仍 0.211）。
       0.9 的过渡仍然平滑（≈1.1 s 时间常数），但能在 ~4 s 内真正到位；
       再加一条吸附：差值小于 0.004 直接贴到目标值，保证 0 就是 0。 */
    state.cloudCover = damp(state.cloudCover, state.cloudTarget, 0.9, dt);
    if (Math.abs(state.cloudCover - state.cloudTarget) < 0.004) state.cloudCover = state.cloudTarget;
    state.wind = damp(state.wind, state.windTarget, 0.5, dt);
    state.windDirection = damp(state.windDirection, state.windDirectionTarget, 0.35, dt);
    state.rain = damp(state.rain, state.rainTarget, 0.8, dt);
    state.storm = damp(state.storm, state.stormTarget, 0.5, dt);
    state.lightning = damp(state.lightning, state.lightningTarget, 2.0, dt);
    state.gust = 0.5 + 0.5 * Math.sin(now * 0.00013) * Math.sin(now * 0.00007 + 1.7);

    const solar = solarPosition(state.timeOfDay, state.dayOfYear, state.latitude);
    state.sunElevationRaw = solar.elevation;
    state.sunElevation = clamp(solar.elevation + state.elevationOffset, -18, 90);
    state.sunAzimuth = solar.azimuth;
    state.isNight = state.sunElevation < -0.5;
    state.overcast = smooth(clamp((state.cloudCover - 0.12) / 0.82));
    state.storminess = clamp(state.rain * 0.7 + state.wind * 0.45 + state.storm * 0.55);
    state.seaState = damp(state.seaState, clamp(0.12 + state.wind * 0.68 + state.storm * 0.35 + state.rain * 0.15), 0.08, dt);

    resolvePalette();
    updateLightning(dt, now, reduced);
    applySun();
    if (now - env.lastSky > 90) { env.lastSky = now; applySky(); }
    updateRain(dt, now, reduced);
  }

  function updateLightning(dt, now, reduced) {
    state.flash = Math.max(0, state.flash - dt * 2.8);
    if (!DIAG.noattr) setAtmo("--flash", state.flash.toFixed(3));
    if (reduced) return;
    if (state.lightning < 0.02 || state.storminess < 0.25) return;
    const chance = state.lightning * state.storminess * 0.055 * dt;
    if (Math.random() < chance) {
      state.flash = 1;
      if (Math.random() < 0.7) setTimeout(function () { state.flash = Math.max(state.flash, 0.7); }, 90);
      if (Math.random() < 0.4) setTimeout(function () { state.flash = Math.max(state.flash, 0.5); }, 210);
    }
  }

  function applySun() {
    counters.applySun += 1;
    const celestial = env.celestial;
    if (!celestial) return;
    const day = !state.isNight;
    const raw = day ? state.timeOfDay : mod(state.timeOfDay - 12, 24);
    const theta = clamp((mod(raw, 24) - 6) / 12, 0, 1) * Math.PI;
    // Polar-light framing: the disc travels a short, low arc and never leaves
    // the frame, so it stays draggable and the sea always keeps a grazing sun.
    const x = 50 - 38 * Math.cos(theta);
    // Keep the sun and the moon above the shoreline. The CSS horizon sits at
    // about 47.8% of the viewport, so elevation 0 maps just above it.
    const horizonY = 25.2;
    const topY = 13.4;
    const visualElev = day ? clamp(state.sunElevation, 0, 90) : clamp(-(state.sunElevationRaw == null ? state.sunElevation : state.sunElevationRaw), 0, 74);
    // Perspective, not a linear ramp: the 3D sea reads this screen position as
    // a light direction, and a linear ramp squashes every daylight hour into
    // the last few degrees above the horizon (one permanent sunset glitter).
    const y = clamp(horizonY - Math.pow(visualElev / 90, 0.62) * (horizonY - topY), topY, horizonY);
    const size = day
      ? clamp(120 + (1 - clamp(state.sunElevation / 60, 0, 1)) * 140, 120, 280)
      : clamp(88 + (1 - visualElev / 60) * 60, 88, 158);
    state.sunX = x / 100;
    state.sunY = y / 100;
    if (!DIAG.noattr) {
      const sunColor = rgb(state.sky.sun);
      const sunGlow = rgb(state.sky.glow);
      setAtmo("--sun-x", x.toFixed(2) + "%");
      setAtmo("--sun-y", y.toFixed(2) + "%");
      setAtmo("--sun-size", size.toFixed(0) + "px");
      setAtmo("--sun-color", sunColor);
      setAtmo("--sun-glow", sunGlow);
      setAtmo("--sun-alpha", (state.ambient * (1 - state.overcast * 0.6) * (day ? 1 : 0.85)).toFixed(3));
      setAtmo("--sun-glow-alpha", ((1 - state.overcast * 0.5) * (day ? 0.9 : 0.7)).toFixed(3));
      /* 顶部天气条的圆点也用 --sun-color/--sun-glow，单独写它自己那一小块。 */
      setVar(env.weatherBar, "--sun-color", sunColor);
      setVar(env.weatherBar, "--sun-glow", sunGlow);
      /* 卡片水影只在自己卡片里用 --shadow-shift。 */
      setVar(env.worldScope, "--shadow-shift", ((0.5 - x / 100) * 110).toFixed(1) + "px");
    }
    celestial.classList.toggle("is-moon", !day);
    celestial.classList.toggle("is-overcast", state.overcast > 0.55);
  }

  function applySky() {
    counters.applySky += 1;
    if (DIAG.noattr) return;
    /* 只在 .atmosphere 子树里被消费：天空、海色、云量、雨、霾、月相。 */
    setAtmo("--sky-top", rgb(state.sky.top));
    setAtmo("--sky-mid", rgb(state.sky.mid));
    setAtmo("--sky-horizon", rgb(state.sky.horizon));
    setAtmo("--sea-far", rgb(state.sky.seaFar));
    setAtmo("--sea-near", rgb(state.sky.seaNear));
    setAtmo("--sea-deep", rgb(state.sky.seaDeep));
    setAtmo("--shade", ((1 - state.ambient) * 0.42 + state.overcast * 0.06).toFixed(3));
    setAtmo("--cloud-cover", state.cloudCover.toFixed(3));
    setAtmo("--rain", state.rain.toFixed(3));
    setAtmo("--moon-phase", mod(state.timeOfDay / 12, 1).toFixed(3));
    /* 卡片面与聚焦层都要用的光照参数：只写 .gallery 与 #focus 两处。 */
    setLight("--ambient", state.ambient.toFixed(3));
    setLight("--light-angle", (90 + (state.sunAzimuth - 180) * 0.5).toFixed(1) + "deg");
    setLight("--light-strength", (0.4 + state.ambient * 0.6).toFixed(3));
    /* --cloud-dark / --wind / --storm 没有任何 CSS 消费，停止写入。 */
  }

  function initDOM() {
    env.panel = document.getElementById("weatherPanel");
    env.celestial = document.getElementById("celestial");
    env.cloudCanvas = document.getElementById("cloudCanvas");
    env.rainCanvas = document.getElementById("rainCanvas");
    env.flashEl = document.getElementById("lightningFlash");
    /* 自定义属性的写入目标（见 setVar）：只让真正消费它们的子树失效。 */
    env.atmo = document.querySelector(".atmosphere");
    env.galleryScope = document.getElementById("gallery");
    env.worldScope = document.getElementById("world");
    env.focusScope = document.getElementById("focus");
    env.weatherBar = document.getElementById("weatherBar");
    env.cloudCtx = env.cloudCanvas ? env.cloudCanvas.getContext("2d", { alpha: true }) : null;
    env.rainCtx = env.rainCanvas ? env.rainCanvas.getContext("2d", { alpha: true }) : null;
    resizeCanvases();
  }

  function updateRain(dt, now, reduced) {
    counters.updateRain += 1;
    if (DIAG.norain) return;
    if (!env.rainCtx) return;
    const intensity = state.rain;
    /* 没雨的时候原来也会先全屏 clearRect 再 return —— 等于每帧把一个
       1280×800 / 1920×1065 的透明 canvas 层重新脏化、重新上传合成。
       现在：只清一次，然后把整块 canvas 从合成树里摘掉（display:none），
       之后整帧跳过；雨回来时再挂回去。 */
    if (intensity < 0.02) {
      if (env.rainDirty) {
        const idleCtx = env.rainCtx;
        idleCtx.setTransform(1, 0, 0, 1, 0, 0);
        idleCtx.clearRect(0, 0, env.rainCanvas.width, env.rainCanvas.height);
        env.rainDirty = false;
        counters.rainCleared += 1;
      }
      if (env.rainCanvas.style.display !== "none") env.rainCanvas.style.display = "none";
      return;
    }
    if (env.rainCanvas.style.display === "none") env.rainCanvas.style.display = "";
    env.rainDirty = true;
    const q = env.quality || {};
    const ctx = env.rainCtx;
    const w = env.rainCanvas.width, h = env.rainCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    counters.rainCleared += 1;
    const scale = w / Math.max(1, env.rainCanvas.clientWidth || w);
    const count = Math.round(((window.innerWidth < 680 ? q.rainParticlesMobile : q.rainParticles) || 140) * intensity);
    const wind = state.wind;
    const len = (7 + state.storm * 20 + intensity * 9) * scale;
    ctx.save();
    ctx.strokeStyle = "rgba(222,238,246," + (0.16 + intensity * 0.3).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, 0.7 * scale);
    for (let i = 0; i < count; i += 1) {
      const seed = i * 12.9898;
      const x = mod(Math.sin(seed) * 43758.5453, 1) * w;
      const y = mod(Math.sin(seed * 1.7) * 24634.6345 + now * (0.0009 + intensity * 0.0016), 1) * h;
      const l = len * (0.6 + mod(Math.sin(seed * 3.1) * 12345.678, 1));
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + wind * l * 0.7, y + l);
      ctx.stroke();
    }
    ctx.restore();
    if (reduced) return;
    const rings = Math.round(intensity * 14);
    ctx.save();
    ctx.strokeStyle = "rgba(236,245,240," + (0.06 + intensity * 0.13).toFixed(3) + ")";
    ctx.lineWidth = Math.max(1, 0.6 * scale);
    for (let i = 0; i < rings; i += 1) {
      const seed = i * 7.13 + Math.floor(now / 850);
      const x = mod(Math.sin(seed * 2.1) * 43758.5453, 1) * w;
      const y = h * (0.48 + mod(Math.sin(seed * 1.3) * 24634.6345, 1) * 0.5);
      const r = (2 + mod(Math.sin(seed * 4.7) * 12345.678, 1) * (6 + intensity * 10)) * scale;
      ctx.globalAlpha = (1 - mod(now * 0.0005 + i * 0.17, 1)) * (0.25 + intensity * 0.35);
      ctx.beginPath();
      ctx.ellipse(x, y, r, r * 0.34, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  function resizeCanvases() {
    const cap = env.quality && env.quality.dprCap ? env.quality.dprCap : 2;
    const dpr = Math.min(window.devicePixelRatio || 1, cap);
    if (env.cloudCanvas && env.cloudCtx) {
      const rect = env.cloudCanvas.getBoundingClientRect();
      const cdpr = Math.min(window.devicePixelRatio || 1, env.quality && env.quality.level === "lite" ? 1 : 1.5);
      env.cloudCanvas.width = Math.max(1, Math.round(rect.width * cdpr));
      env.cloudCanvas.height = Math.max(1, Math.round(rect.height * cdpr));
    }
    if (env.rainCanvas && env.rainCtx) {
      const rect = env.rainCanvas.getBoundingClientRect();
      const rdpr = Math.min(dpr, 1.5);
      const rw = Math.max(1, Math.round(rect.width * rdpr));
      const rh = Math.max(1, Math.round(rect.height * rdpr));
      /* 只在尺寸真的变了时才改 width/height：改这两个属性会重新分配并清空
         整块 canvas 后备存储，是纯浪费。 */
      if (env.rainCanvas.width !== rw) env.rainCanvas.width = rw;
      if (env.rainCanvas.height !== rh) env.rainCanvas.height = rh;
      env.rainDirty = false;
    }
  }

  function timeLabel(hours) {
    const h = Math.floor(mod(hours, 24));
    const m = Math.floor((mod(hours, 24) - h) * 60);
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m;
  }

  function conditionLabel() {
    if (state.storm > 0.55) return "STORM";
    if (state.rain > 0.45) return "RAIN";
    if (state.rain > 0.08) return "DRIZZLE";
    if (state.overcast > 0.7) return "OVERCAST";
    if (state.cloudCover > 0.4) return "PARTLY";
    if (state.isNight) return "CLEAR NIGHT";
    return "CLEAR";
  }

  function syncPanel() {
    const s = env.sliders;
    if (!s) return;
    if (document.activeElement !== s.cloud) s.cloud.value = String(Math.round(state.cloudCover * 100));
    if (document.activeElement !== s.weather) {
      const mixed = clamp(state.rain * 0.7 + state.wind * 0.5 + state.storm * 0.35);
      s.weather.value = String(Math.round(mixed * 100));
    }
    if (document.activeElement !== s.time) s.time.value = String(Math.round(mod(state.timeOfDay, 24) / 24 * 100));
    if (document.activeElement !== s.lightning) s.lightning.value = String(Math.round(state.lightningTarget * 100));
    const cv = document.getElementById("cloudValue");
    const wv = document.getElementById("weatherValue");
    const tv = document.getElementById("timeValue");
    const lv = document.getElementById("lightningValue");
    if (cv) cv.textContent = Math.round(state.cloudCover * 100) + "%";
    if (wv) wv.textContent = Math.round(clamp(state.rain * 0.7 + state.wind * 0.5 + state.storm * 0.35) * 100) + "%";
    if (tv) tv.textContent = timeLabel(state.timeOfDay);
    if (lv) lv.textContent = Math.round(state.lightningTarget * 100) + "%";
    const label = document.getElementById("weatherLabel");
    if (label) label.textContent = state.liveLabel + " · " + timeLabel(state.timeOfDay) + " · " + conditionLabel();
  }

  function initPanel() {
    const bar = document.getElementById("weatherBar");
    const toggle = document.getElementById("weatherToggle");
    const cloud = document.getElementById("cloudSlider");
    const weather = document.getElementById("weatherSlider");
    const time = document.getElementById("timeSlider");
    const lightning = document.getElementById("lightningSlider");
    const auto = document.getElementById("weatherAuto");
    const reset = document.getElementById("weatherReset");
    if (!bar || !toggle) return;
    env.bar = bar;
    env.toggle = toggle;
    toggle.addEventListener("click", function () {
      const open = bar.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", String(open));
    });
    bar.addEventListener("wheel", function (e) { e.stopPropagation(); }, { passive: false });
    bar.addEventListener("touchmove", function (e) { e.stopPropagation(); }, { passive: false });
    if (cloud) cloud.addEventListener("input", function () { state.cloudTarget = clamp(Number(cloud.value) / 100); state.manualWeather = true; });
    if (weather) weather.addEventListener("input", function () {
      const v = clamp(Number(weather.value) / 100);
      state.windTarget = clamp(0.12 + v * 0.88);
      state.rainTarget = clamp((v - 0.22) / 0.78);
      state.stormTarget = clamp((v - 0.58) / 0.42);
      state.manualWeather = true;
    });
    if (time) time.addEventListener("input", function () {
      state.timeTarget = Number(time.value) / 100 * 24;
      state.manualTime = true;
      state.autoTime = false;
    });
    if (lightning) lightning.addEventListener("input", function () {
      state.lightningTarget = clamp(Number(lightning.value) / 100);
      state.manualWeather = true;
    });
    if (auto) auto.addEventListener("click", function () {
      state.manualTime = false;
      state.manualWeather = false;
      state.autoTime = true;
      state.elevationOffset = 0;
      readSystemTime();
      fetchLiveWeather();
    });
    if (reset) reset.addEventListener("click", function () {
      state.cloudTarget = 0.25; state.windTarget = 0.22; state.rainTarget = 0;
      state.stormTarget = 0; state.lightningTarget = 0; state.elevationOffset = 0;
      state.manualWeather = false; state.manualTime = false; state.autoTime = true;
      readSystemTime();
      useClimate();
      syncPanel();
    });
    env.sliders = { cloud: cloud, weather: weather, time: time, lightning: lightning, auto: auto, reset: reset };
    syncPanel();
    setInterval(syncPanel, 500);
  }

  function initCelestial() {
    const el = env.celestial;
    if (!el) return;
    let dragging = false, moved = false, holdTimer = 0;
    let startX = 0, startY = 0;
    function pos(e) {
      const g = document.getElementById("gallery");
      const r = g ? g.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
      return { x: (e.clientX - r.left) / r.width, y: (e.clientY - r.top) / r.height };
    }
    function applyDrag(e) {
      const p = pos(e);
      const dayArc = p.y < 0.6;
      const cosT = clamp((50 - p.x * 100) / 42, -1, 1);
      const t = 6 + Math.acos(cosT) / Math.PI * 12;
      state.timeTarget = mod(dayArc ? t : t + 12, 24);
      state.manualTime = true;
      state.autoTime = false;
      const solarNow = solarPosition(state.timeTarget, state.dayOfYear, state.latitude);
      const wanted = clamp((0.62 - p.y) * 40, -18, 55);
      state.elevationOffset = clamp(wanted - solarNow.elevation, -25, 55);
    }
    el.addEventListener("pointerdown", function (e) {
      dragging = true; moved = false; state.cloudRamp = false;
      startX = e.clientX; startY = e.clientY;
      el.classList.add("is-dragging");
      if (el.setPointerCapture) { try { el.setPointerCapture(e.pointerId); } catch (err) {} }
      e.preventDefault();
      holdTimer = window.setTimeout(function () {
        holdTimer = 0;
        state.cloudRamp = true;
        state.manualWeather = true;
        el.classList.add("is-summoning");
      }, 520);
    });
    el.addEventListener("pointermove", function (e) {
      if (!dragging) return;
      if (Math.abs(e.clientX - startX) + Math.abs(e.clientY - startY) > 5) {
        moved = true;
        if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
      }
      if (state.cloudRamp) return;
      applyDrag(e);
    });
    function finish(e) {
      if (!dragging) return;
      dragging = false;
      el.classList.remove("is-dragging", "is-summoning");
      if (holdTimer) { clearTimeout(holdTimer); holdTimer = 0; }
      if (!state.cloudRamp && !moved) {
        state.manualTime = true;
        state.autoTime = false;
        state.timeTarget = state.isNight ? 12 : 0;
        state.elevationOffset = 0;
      }
      state.cloudRamp = false;
      moved = false;
      if (el.releasePointerCapture) { try { el.releasePointerCapture(e.pointerId); } catch (err) {} }
    }
    el.addEventListener("pointerup", finish);
    el.addEventListener("pointercancel", finish);
    el.addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== " ") return;
      e.preventDefault();
      state.manualTime = true;
      state.autoTime = false;
      state.timeTarget = state.isNight ? 12 : 0;
      state.elevationOffset = 0;
    });
  }

})();
