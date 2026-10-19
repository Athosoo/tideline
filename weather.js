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
    cloudVolume: null,
    clouds: null,
    cloudFailed: false,
    rainCanvas: null,
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
      syncCloudVolume();
      fetchLiveWeather();
    },
    update: function (dt, now) { update(dt, now); },
    resize: function () { resizeCanvases(); },
  };

  function update(dt, now) {
    const reduced = env.reducedMotion && env.reducedMotion.matches;
    if (state.autoTime && !state.manualTime) {
      state.timeTarget = mod(state.timeTarget + (reduced ? 0 : dt / 3600), 24);
    }
    state.timeOfDay = state.manualTime ? damp(state.timeOfDay, state.timeTarget, 1.7, dt) : state.timeTarget;
    state.cloudCover = damp(state.cloudCover, state.cloudTarget, 0.22, dt);
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
    updateClouds(dt, now, reduced);
    updateRain(dt, now, reduced);
    feedCloudFrame(now);
  }

  function updateLightning(dt, now, reduced) {
    state.flash = Math.max(0, state.flash - dt * 2.8);
    const root = document.documentElement;
    root.style.setProperty("--flash", state.flash.toFixed(3));
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
    const root = document.documentElement;
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
    root.style.setProperty("--sun-x", x.toFixed(2) + "%");
    root.style.setProperty("--shadow-shift", ((0.5 - x / 100) * 110).toFixed(1) + "px");
    root.style.setProperty("--sun-y", y.toFixed(2) + "%");
    root.style.setProperty("--sun-size", size.toFixed(0) + "px");
    root.style.setProperty("--sun-color", rgb(state.sky.sun));
    root.style.setProperty("--sun-glow", rgb(state.sky.glow));
    root.style.setProperty("--sun-alpha", (state.ambient * (1 - state.overcast * 0.6) * (day ? 1 : 0.85)).toFixed(3));
    root.style.setProperty("--sun-glow-alpha", ((1 - state.overcast * 0.5) * (day ? 0.9 : 0.7)).toFixed(3));
    celestial.classList.toggle("is-moon", !day);
    celestial.classList.toggle("is-overcast", state.overcast > 0.55);
  }

  function applySky() {
    const root = document.documentElement;
    root.style.setProperty("--sky-top", rgb(state.sky.top));
    root.style.setProperty("--sky-mid", rgb(state.sky.mid));
    root.style.setProperty("--sky-horizon", rgb(state.sky.horizon));
    root.style.setProperty("--sea-far", rgb(state.sky.seaFar));
    root.style.setProperty("--sea-near", rgb(state.sky.seaNear));
    root.style.setProperty("--sea-deep", rgb(state.sky.seaDeep));
    root.style.setProperty("--ambient", state.ambient.toFixed(3));
    root.style.setProperty("--shade", ((1 - state.ambient) * 0.42 + state.overcast * 0.06).toFixed(3));
    root.style.setProperty("--cloud-cover", state.cloudCover.toFixed(3));
    root.style.setProperty("--cloud-dark", state.storminess.toFixed(3));
    root.style.setProperty("--rain", state.rain.toFixed(3));
    root.style.setProperty("--wind", state.wind.toFixed(3));
    root.style.setProperty("--storm", state.storm.toFixed(3));
    root.style.setProperty("--light-angle", (90 + (state.sunAzimuth - 180) * 0.5).toFixed(1) + "deg");
    root.style.setProperty("--light-strength", (0.4 + state.ambient * 0.6).toFixed(3));
    root.style.setProperty("--moon-phase", mod(state.timeOfDay / 12, 1).toFixed(3));
  }

  function initDOM() {
    env.panel = document.getElementById("weatherPanel");
    env.celestial = document.getElementById("celestial");
    env.cloudCanvas = document.getElementById("cloudCanvas");
    env.cloudVolume = document.getElementById("cloudVolume");
    env.rainCanvas = document.getElementById("rainCanvas");
    env.flashEl = document.getElementById("lightningFlash");
    env.cloudCtx = env.cloudCanvas ? env.cloudCanvas.getContext("2d", { alpha: true }) : null;
    env.rainCtx = env.rainCanvas ? env.rainCanvas.getContext("2d", { alpha: true }) : null;
    env.offCloud = document.createElement("canvas");
    env.offCloud.width = 256;
    env.offCloud.height = 144;
    env.offCtx = env.offCloud.getContext("2d", { alpha: true });
    env.cloudImage = env.offCtx.createImageData(256, 144);
    env.lastCloud = 0;
    resizeCanvases();
  }

  function hash2(x, y) {
    const n = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return n - Math.floor(n);
  }

  function valueNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const a = hash2(xi, yi), b = hash2(xi + 1, yi);
    const c = hash2(xi, yi + 1), d = hash2(xi + 1, yi + 1);
    return lerp(lerp(a, b, u), lerp(c, d, u), v);
  }

  function fbm(x, y, oct) {
    let sum = 0, amp = 0.5, freq = 1;
    for (let i = 0; i < oct; i += 1) {
      sum += valueNoise(x * freq, y * freq) * amp;
      freq *= 2.03;
      amp *= 0.5;
    }
    return sum;
  }

  function updateClouds(dt, now, reduced) {
    if (state.cloudRamp) state.cloudTarget = clamp(state.cloudTarget + dt * 0.22);
    if (!env.cloudCtx || !env.offCtx) return;
    const q = env.quality || {};
    const interval = 1000 / (q.cloudFps || 15);
    if (now - env.lastCloud < interval) return;
    env.lastCloud = now;
    const w = env.offCloud.width, h = env.offCloud.height;
    const data = env.cloudImage.data;
    const cover = state.cloudCover;
    const dark = state.storminess;
    const drift = (reduced ? 0 : state.wind) * now * 0.00002;
    const scale = 3.4 * (q.cloudResolution || 1);
    const oct = q.fbmOctaves || 3;
    const threshold = 0.80 - cover * 0.72;
    for (let y = 0; y < h; y += 1) {
      const ny = y / h;
      const band = smooth(clamp((0.95 - ny) / 0.95));
      const flash = clamp(state.flash || 0, 0, 1);
      const sun = clamp(state.sunX == null ? 0.7 : state.sunX, 0, 1);
      for (let x = 0; x < w; x += 1) {
        const n = fbm(x / w * scale + drift, y / h * scale * 0.55 + drift * 0.35, oct);
        const density = clamp((n + band * 0.32 - threshold) * 3.4);
        const idx = (y * w + x) * 4;
        // Volume: the deck is lit along its top, dark underneath, and the side
        // facing the sun catches the light — a flat wash has no weight.
        const lift = clamp((0.62 - ny) / 0.62);
        const sunSide = clamp(1 - Math.abs(x / w - sun) * 1.7);
        const shade = clamp(
          0.68 - dark * 0.34 + lift * 0.30 + sunSide * 0.12 * density + flash * 0.55,
          0.18, 1.0,
        );
        data[idx] = Math.round(246 * shade);
        data[idx + 1] = Math.round(248 * shade);
        data[idx + 2] = Math.round(242 * shade);
        data[idx + 3] = Math.round(density * 240);
      }
    }
    env.offCtx.putImageData(env.cloudImage, 0, 0);
    const ctx = env.cloudCtx;
    const cw = env.cloudCanvas.width, ch = env.cloudCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, cw, ch);
    ctx.drawImage(env.offCloud, 0, 0, cw, ch);
  }

  function updateRain(dt, now, reduced) {
    if (!env.rainCtx) return;
    const q = env.quality || {};
    const ctx = env.rainCtx;
    const w = env.rainCanvas.width, h = env.rainCanvas.height;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const intensity = state.rain;
    if (intensity < 0.02) return;
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

  /* ── 体素云层（GIFT/clouds.js）────────────────────────────────────────
     只有 FULL 档、且没有 reduced-motion 时才尝试接管天空。create 返回 null
     或抛错就什么都不做，现有 2D 云画布路径原样保留（LITE / 无 WebGL2 回落）。 */
  function cloudEligible() {
    return !!env.quality && env.quality.level === "full" &&
      !(env.reducedMotion && env.reducedMotion.matches);
  }

  function syncCloudVolume() {
    if (env.clouds) {
      if (!cloudEligible()) disposeCloudVolume();
      return;
    }
    if (env.cloudFailed || !cloudEligible()) return;
    if (!env.cloudVolume || !window.TideClouds || typeof window.TideClouds.create !== "function") {
      env.cloudFailed = true;
      return;
    }
    let api = null;
    try {
      api = window.TideClouds.create(env.cloudVolume, {
        renderScale: 0.75,
        steps: 48,
        lightSteps: 5,
        budgetMs: 6,
      });
    } catch (error) {
      console.warn("[TIDELINE] volumetric clouds unavailable:", error && error.message ? error.message : error);
      api = null;
    }
    if (!api) { env.cloudFailed = true; return; }
    env.clouds = api;
    document.body.classList.add("has-cloud-volume");
  }

  function disposeCloudVolume() {
    if (!env.clouds) return;
    try { env.clouds.dispose(); } catch (error) { /* no-op */ }
    env.clouds = null;
    document.body.classList.remove("has-cloud-volume");
  }

  /* 与 app.js 的 SEA_PALETTE 同一套「参考风」线性色。云的环境光 / 霾色必须
     和 bundle 海面看到的是同一片天空，否则云和天空会脱色、出现色差硬边。 */
  const SEA_REFERENCE = {
    day: { zenith: [0.07, 0.20, 0.42], horizon: [0.52, 0.68, 0.82], sun: [1.0, 0.93, 0.80] },
    dusk: { zenith: [0.03, 0.05, 0.16], horizon: [0.85, 0.36, 0.16], sun: [1.0, 0.42, 0.14] },
    night: { zenith: [0.012, 0.02, 0.05], horizon: [0.06, 0.09, 0.15], sun: [0.75, 0.80, 0.90] },
    storm: { zenith: [0.08, 0.10, 0.12], horizon: [0.28, 0.32, 0.34], sun: [0.58, 0.62, 0.64] },
  };

  function mix3(a, b, t) {
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  }

  function cloudPalette() {
    const s = state;
    const elevation = clamp((s.sunElevation == null ? 20 : s.sunElevation) / 60, 0, 1);
    let p = {
      zenith: mix3(SEA_REFERENCE.dusk.zenith, SEA_REFERENCE.day.zenith, elevation),
      horizon: mix3(SEA_REFERENCE.dusk.horizon, SEA_REFERENCE.day.horizon, elevation),
      sun: mix3(SEA_REFERENCE.dusk.sun, SEA_REFERENCE.day.sun, elevation),
    };
    if (s.isNight) {
      p = { zenith: SEA_REFERENCE.night.zenith, horizon: SEA_REFERENCE.night.horizon, sun: SEA_REFERENCE.night.sun };
    }
    const gloom = clamp(Math.max((s.overcast || 0) * 0.8, s.storminess || 0), 0, 1);
    if (gloom > 0.01) {
      p = {
        zenith: mix3(p.zenith, SEA_REFERENCE.storm.zenith, gloom),
        horizon: mix3(p.horizon, SEA_REFERENCE.storm.horizon, gloom),
        sun: mix3(p.sun, SEA_REFERENCE.storm.sun, gloom),
      };
    }
    return p;
  }

  /* 每帧把 kernel v2 的参数喂给云层，并驱动它渲染。 */
  function feedCloudFrame(now) {
    syncCloudVolume();
    if (!env.clouds) return;
    const s = state;
    const night = s.isNight ? 1 : 0;
    const palette = cloudPalette();
    const hazeColor = mix3(palette.horizon, palette.sun, 0.10);
    env.clouds.setParams({
      coverage: s.cloudCover,
      storm: s.storminess,
      wind: 8 + s.wind * 52,              /* 8~60 m/s */
      sunX: s.sunX,
      sunY: s.sunY,
      night: night,
      haze: clamp(0.5 + s.storminess * 0.8 + s.overcast * 0.35 + night * 0.35, 0, 2),
      sunColor: palette.sun,
      skyTop: palette.zenith,
      skyHorizon: palette.horizon,
      hazeColor: hazeColor,
      sunElevation: s.sunElevation,
      flash: s.flash,
      seedX: 0,
      seedZ: 0,
      horizonY: 0.252,
      paused: !!(env.reducedMotion && env.reducedMotion.matches),
    });
    env.clouds.render(now);
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
    if (env.cloudVolume && env.clouds) {
      const crect = env.cloudVolume.getBoundingClientRect();
      const cdpr = Math.min(window.devicePixelRatio || 1, cap);
      env.clouds.resize(crect.width || window.innerWidth, crect.height || window.innerHeight * 0.26, cdpr);
    }
    if (env.rainCanvas && env.rainCtx) {
      const rect = env.rainCanvas.getBoundingClientRect();
      const rdpr = Math.min(dpr, 1.5);
      env.rainCanvas.width = Math.max(1, Math.round(rect.width * rdpr));
      env.rainCanvas.height = Math.max(1, Math.round(rect.height * rdpr));
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
