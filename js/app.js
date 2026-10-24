/* =========================================================
   TIDELINE
   A small, hand-built 3D promenade for postcards.
   ========================================================= */

const POSTCARDS = [
  {
    number: "01",
    title: "Morning Reading",
    meta: "26.11.2022 · 06:55",
    short: "A check-in at first light",
    quote: "“A quiet check-in at first light.”",
    quoteCn: "「把清晨的第一页，留给彼此。」",
    date: "2022",
    backAlt: "明信片背面：POSTCARD / Take a Photo Together",
    accent: "#c96e53",
    pixel: true,
    pixelWidth: 120,
    pixelHeight: 180,
    landscape: false,
    front: "assets/postcards/01-front.png",
    back: "assets/postcards/01-back.png",
  },
  {
    number: "02",
    title: "Along the Seaside",
    meta: "UNPOSTED · SHORELINE STUDY",
    short: "A little blue daydream",
    quote: "“Drive you along the seaside…”",
    quoteCn: "「沿海而行，让风替我们说话。」",
    date: "UNDATED",
    backAlt: "明信片背面：Drive you along the seaside……",
    accent: "#609aa3",
    pixel: true,
    pixelWidth: 100,
    pixelHeight: 150,
    landscape: false,
    front: "assets/postcards/02-front.png",
    back: "assets/postcards/02-back.png",
  },
  {
    number: "03",
    title: "Card 03",
    meta: "LANDSCAPE · NEW",
    short: "A new card joins the tide",
    quote: "“A new card joins the drift.”",
    quoteCn: "「新的一张，加入漂流。」",
    date: "2026",
    backAlt: "明信片背面：03",
    accent: "#609aa3",
    pixel: true,
    pixelWidth: 150,
    pixelHeight: 100,
    landscape: true,
    front: "assets/postcards/03-front.png",
    back: "assets/postcards/03-back.png",
  },
  {
    number: "04",
    title: "Placeholder 04",
    meta: "LANDSCAPE · PLACEHOLDER",
    short: "A wide blue day",
    quote: "“The horizon is wider when you stop counting.”",
    quoteCn: "「不再计数的时候，海平线会更宽。」",
    date: "PLACEHOLDER",
    backAlt: "占位明信片背面：04",
    accent: "#c96e53",
    pixel: false,
    landscape: true,
    front: "assets/postcards/04-front.svg",
    back: "assets/postcards/04-back.svg",
  },
  {
    number: "05",
    title: "Placeholder 05",
    meta: "PORTRAIT · PLACEHOLDER",
    short: "Salt and light",
    quote: "“Salt on the air, light on the water.”",
    quoteCn: "「空气里有盐，水面有光。」",
    date: "PLACEHOLDER",
    backAlt: "占位明信片背面：05",
    accent: "#7fb7b3",
    pixel: false,
    landscape: false,
    front: "assets/postcards/05-front.svg",
    back: "assets/postcards/05-back.svg",
  },
  {
    number: "06",
    title: "Placeholder 06",
    meta: "LANDSCAPE · PLACEHOLDER",
    short: "The long way round",
    quote: "“We took the long way, and the sea came too.”",
    quoteCn: "「我们绕了远路，海也跟着来了。」",
    date: "PLACEHOLDER",
    backAlt: "占位明信片背面：06",
    accent: "#609aa3",
    pixel: false,
    landscape: true,
    front: "assets/postcards/06-front.svg",
    back: "assets/postcards/06-back.svg",
  },
  {
    number: "07",
    title: "Placeholder 07",
    meta: "PORTRAIT · PLACEHOLDER",
    short: "The last ferry",
    quote: "“The last ferry leaves a line of light.”",
    quoteCn: "「末班渡轮留下一道亮线。」",
    date: "PLACEHOLDER",
    backAlt: "占位明信片背面：07",
    accent: "#c96e53",
    pixel: false,
    landscape: false,
    front: "assets/postcards/07-front.svg",
    back: "assets/postcards/07-back.svg",
  },
];

const PERSPECTIVE = 1500;
const FINE_POINTER = window.matchMedia("(pointer: fine)").matches;
const FOCUS_REST_TILT = Object.freeze({ x: 0.9, y: -3.4, z: 0 });
const REDUCED_MOTION = window.matchMedia("(prefers-reduced-motion: reduce)");

const $ = (selector, scope = document) => scope.querySelector(selector);
const $$ = (selector, scope = document) => [...scope.querySelectorAll(selector)];
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const mod = (value, period) => ((value % period) + period) % period;
const lerp = (a, b, t) => a + (b - a) * t;
const smootherstep = (t) => {
  t = clamp(t);
  return t * t * t * (t * (t * 6 - 15) + 10);
};
const easeOutCubic = (t) => 1 - Math.pow(1 - clamp(t), 3);
const pad = (value, length = 2) => String(value).padStart(length, "0");
const rad = Math.PI / 180;

function damp(current, target, lambda, dt) {
  return lerp(current, target, 1 - Math.exp(-lambda * dt));
}

function mulberry32(seed) {
  let t = seed >>> 0;
  return function random() {
    t += 0x6d2b79f5;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

function makeSeed() {
  return (Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

/* ── 诊断开关（全部默认关闭，关闭时行为与之前完全一致）──────────────────
   ?norain=1     跳过雨滴/涟漪绘制（含每帧全屏 clearRect 与冰晶）
   ?noattr=1     跳过 applySun/applySky/--flash 对 :root 自定义属性的写入
   ?nocardfx=1   卡片冻结 + 关掉光晕 blur（量「写 transform + blur」的总成本）
   ?nocardmove=1 卡片冻结但保留光晕 blur（和 nocardfx 相减即 blur 的成本） */
window.__tidelineDiag = window.__tidelineDiag || {};
const DIAG = Object.assign(window.__tidelineDiag, {
  bench: /[?&]bench=1/.test(window.location.search),
  norain: /[?&]norain=1/.test(window.location.search),
  noattr: /[?&]noattr=1/.test(window.location.search),
  nocardfx: /[?&]nocardfx=1/.test(window.location.search),
  nocardmove: /[?&]nocardmove=1/.test(window.location.search),
  /* ?ghosts=1 把「聚焦时其它明信片仍留在画面上」的旧行为放回来，用来在真机上
     确认那团影子到底是卡还是合成器残影。默认关，不带参数时没有任何影响。 */
  ghosts: /[?&]ghosts=1/.test(window.location.search),
  /* 开屏二分用：?noparkcorr=1 关掉「布盖着时不跑长廊管线」那条捷径，
     用来对照量它的收益（默认不带参数时行为就是开着捷径）。 */
  noparkcorr: /[?&]noparkcorr=1/.test(window.location.search),
});
if (DIAG.ghosts) document.documentElement.classList.add("diag-ghosts");

/* 主线程计量：只在 ?bench=1 时记录（默认连一次 performance.now() 都不多打）。
   面板里 JS cb 只包住 animate()；gap = 帧间隔 − JS cb，是 animate 之外的主线程
   样式/布局 + 光栅/合成时间。LoAF 只有 ≥50 ms 的帧才有条目。 */
function percentileOf(list, p) {
  if (!list.length) return null;
  const xs = list.slice().sort((a, b) => a - b);
  const pos = (xs.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

const PERF_MAIN = {
  frames: [],
  limit: 4096,
  lastFrameTime: 0,
  record(frameTime, callbackMs) {
    const dt = this.lastFrameTime ? frameTime - this.lastFrameTime : 0;
    this.lastFrameTime = frameTime;
    this.frames.push({ t: frameTime, dt, cb: callbackMs });
    if (this.frames.length > this.limit) this.frames.splice(0, this.frames.length - this.limit);
  },
  report(from, to) {
    const rows = this.frames.filter((f) => f.t >= from && f.t <= to);
    const timed = rows.filter((f) => f.dt > 0);
    const dts = timed.map((f) => f.dt);
    const cbs = rows.map((f) => f.cb);
    const gaps = timed.map((f) => Math.max(0, f.dt - f.cb));
    const spanMs = dts.reduce((a, b) => a + b, 0);
    const loaf = (window.__loaf || []).filter((e) => e.t >= from && e.t <= to);
    const styleDurs = loaf
      .filter((e) => e.style > 0)
      .map((e) => Math.max(0, e.t + e.dur - e.style));
    const renderDurs = loaf
      .filter((e) => e.render > 0)
      .map((e) => Math.max(0, e.t + e.dur - e.render));
    const loafDurs = loaf.map((e) => e.dur);
    return {
      frames: rows.length,
      spanMs,
      fps: spanMs > 0 ? (dts.length * 1000) / spanMs : null,
      intervalP50: percentileOf(dts, 0.5),
      intervalP95: percentileOf(dts, 0.95),
      cbP50: percentileOf(cbs, 0.5),
      cbP95: percentileOf(cbs, 0.95),
      cbMax: cbs.length ? Math.max(...cbs) : null,
      gapP50: percentileOf(gaps, 0.5),
      gapP95: percentileOf(gaps, 0.95),
      loaf: {
        count: loaf.length,
        mean: loafDurs.length ? loafDurs.reduce((a, b) => a + b, 0) / loafDurs.length : null,
        p95: percentileOf(loafDurs, 0.95),
        max: loafDurs.length ? Math.max(...loafDurs) : null,
        styleMean: styleDurs.length ? styleDurs.reduce((a, b) => a + b, 0) / styleDurs.length : null,
        styleP95: percentileOf(styleDurs, 0.95),
        styleMax: styleDurs.length ? Math.max(...styleDurs) : null,
        renderMean: renderDurs.length ? renderDurs.reduce((a, b) => a + b, 0) / renderDurs.length : null,
      },
    };
  },
};
window.__perfMain = PERF_MAIN;

/* 受控微基准（只在 ?bench=1 时挂到 window）：不依赖 rAF/GPU，用固定帧数驱动
   「一次 animate 的 DOM 变更 + 一次样式/布局刷新」，专门量 :root 写入的代价。
   base/toggle 在同一页面里交替跑，避开无头环境帧率漂移。 */
if (DIAG.bench) {
  window.__benchMicro = function (frames, opts) {
    const options = opts || {};
    const n = Math.max(1, Math.floor(frames));
    let t = performance.now();
    const start = t;
    for (let i = 0; i < n; i += 1) {
      t += 16.7;
      /* jitter：模拟用户拖太阳 / 拉云量滑杆时的阻尼过渡 —— 每一帧真实值都在变，
         用来量「不得不写」时的样式重算成本（缓存帮不上，只能靠缩小失效范围）。 */
      if (i === 0 && options.dampReset && window.Weather && Weather.state) {
        /* 复位成一个真实的阻尼过渡起点（相当于刚加载完 / 用户刚拉动滑杆）：
           这一整段 90~120 帧里天气值都在变，缓存帮不上忙，
           能对比的只有「写到 :root」和「写到消费它的子树」。 */
        const w = Weather.state;
        w.manualTime = true;
        w.timeOfDay = 12;
        w.timeTarget = 17.5;
        w.wind = 0.05;
        w.windTarget = 0.75;
      }
      if (options.jitter && window.Weather && Weather.state) {
        const w = Weather.state;
        w.manualTime = false;
        w.timeTarget = (w.timeTarget + 0.002) % 24;
        w.windTarget = 0.3 + 0.3 * Math.sin(i * 0.12);
      }
      if (options.sky !== false && window.Weather) Weather.update(0.0167, t);
      if (options.cards !== false) applyCardTransforms(t, 0.0167);
      /* 浏览器每帧收尾时本来就会做一次样式重算 + 布局；这里同步刷新，
         把这次代价算进同一个测量窗口。 */
      void document.body.offsetHeight;
    }
    return { ms: performance.now() - start, frames: n };
  };
}

const dom = {
  gallery: $("#gallery"),
  intro: $("#intro"),
  coverContent: $(".cover-content"),
  scrollCue: $("#scrollCue"),
  scrollTrack: $("#scrollTrack"),
  world: $("#world"),
  water: $("#waterCanvas"),
  ocean: $("#oceanCanvas"),
  particles: $("#ambientParticles"),
  cardCount: $("#cardCount"),
  coverCardWord: $("#coverCardWord"),
  coverCardWordCn: $("#coverCardWordCn"),
  coverEditionRange: $("#coverEditionRange"),
  sceneRange: $("#sceneRange"),
  currentCard: $("#currentCard"),
  currentNumber: $("#currentNumber"),
  currentTitle: $("#currentTitle"),
  currentMeta: $("#currentMeta"),
  railFill: $("#railFill"),
  railDot: $("#railDot"),
  railFrom: $("#railFrom"),
  railTo: $("#railTo"),
  scrollHint: $("#scrollHint"),
  shuffleButton: $("#shuffleButton"),
  qualityToggle: $("#qualityToggle"),
  immersiveToggle: $("#immersiveToggle"),
  immersiveLabel: $("#immersiveLabel"),
  immersiveUI: $("#immersiveUI"),
  immersiveExit: $("#immersiveExit"),
  qualityLabel: $("#qualityLabel"),
  cursor: $("#cursor"),
  cursorLabel: $("#cursorLabel"),
  skipLink: $(".skip-link"),
  focus: $("#focus"),
  focusClose: $("#focusClose"),
  focusCard: $("#focusCard"),
  focusTilt: $("#focusTilt"),
  focusRotor: $("#focusRotor"),
  focusSpin: $("#focusSpin"),
  focusFront: $("#focusFront"),
  focusBack: $("#focusBack"),
  focusNumber: $("#focusNumber"),
  focusNumberSmall: $("#focusNumberSmall"),
  focusTitle: $("#focusTitle"),
  focusMeta: $("#focusMeta"),
  focusQuote: $("#focusQuote"),
  focusQuoteCn: $("#focusQuoteCn"),
  focusDate: $("#focusDate"),
  sideMarker: $("#sideMarker"),
};

/* 截图/回归对比用：?seed=123 固定卡片随机布局。默认仍然每次随机。 */
const SEED_OVERRIDE = (function () {
  const m = /[?&]seed=(\d+)/.exec(window.location.search);
  return m ? (Number(m[1]) >>> 0) : null;
})();

const state = {
  cards: [],
  seed: SEED_OVERRIDE == null ? makeSeed() : SEED_OVERRIDE,
  metrics: null,
  gate: 0,
  camX: 0,
  camPrevious: 0,
  introPx: 0,
  loopPx: 0,
  period: 1,
  pxPerWorldX: 1,
  wander: 0,
  loopScene: 0,
  bgScene: 0,
  activeIndex: -1,
  hudTimer: 0,
  focusOpen: false,
  focusIndex: null,
  focusClosing: false,
  focusAnimating: false,
  focusFlipped: false,
  focusTilt: { ...FOCUS_REST_TILT },
  focusAnimations: [],
  lastFocused: null,
  pointer: {
    x: window.innerWidth * 0.5,
    y: window.innerHeight * 0.5,
    smoothX: window.innerWidth * 0.5,
    smoothY: window.innerHeight * 0.5,
    speed: 0,
  },
  cursorActive: false,
  cursorVisible: false,
  waterTime: 0,
  lastFrame: 0,
  introHidden: false,
  // 布后面那套长廊管线这一帧要不要跑（true = 跑一次，跑完自己清零）
  corridorDirty: true,
  corridorFloor: 0,
  immersive: false,
  immersiveIdleTimer: 0,
  immersiveFullscreen: false,
  galleryLive: false,
  scrollRestore: 0,
  hasFocusEverOpened: false,
  qualityProbeStart: 0,
  qualityProbeFrames: 0,
  qualityProbeDone: false,
  qualityProbeCounting: false,
  lastFps: 0,
  lastWaterDraw: 0,
};

const QUALITY_STORAGE_KEY = "tideline.quality.v1";

const QUALITY_PRESETS = {
  full: {
    dprCap: 2,
    waterLines: 52,
    waterMobileLines: 32,
    waterPasses: 3,
    waterFps: 0,
    crests: 18,
    shimmers: 52,
    shimmersMobile: 30,
    particles: 24,
    particlesMobile: 14,
    cloudFps: 15,
    cloudResolution: 1,
    fbmOctaves: 3,
    rainParticles: 160,
    rainParticlesMobile: 70,
    oceanRings: 200,
    oceanSegments: 200,
    oceanOctaves: 3,
    oceanDetailRadius: 140,
    oceanFoam: true,
    oceanGlitter: true,
    oceanChop: 3.6,
  },
  lite: {
    dprCap: 1.25,
    waterLines: 28,
    waterMobileLines: 18,
    waterPasses: 2,
    waterFps: 30,
    crests: 8,
    shimmers: 18,
    shimmersMobile: 10,
    particles: 8,
    particlesMobile: 4,
    cloudFps: 8,
    cloudResolution: 0.6,
    fbmOctaves: 2,
    rainParticles: 60,
    rainParticlesMobile: 28,
    oceanRings: 112,
    oceanSegments: 112,
    oceanOctaves: 2,
    oceanDetailRadius: 70,
    oceanFoam: false,
    oceanGlitter: true,
    oceanChop: 1.8,
  },
};

// Render budget every layer reads from. Any layer added later must read this
// object instead of hard-coding its own counts, so one switch downgrades the
// whole scene.
const quality = {
  mode: "auto",
  level: "full",
  probedLite: false,
  ...QUALITY_PRESETS.full,
};

function readQualityPreference() {
  try {
    const raw = window.localStorage.getItem(QUALITY_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && ["auto", "full", "lite"].includes(parsed.mode)) return parsed;
  } catch (error) { /* no-op */ }
  return null;
}

function writeQualityPreference() {
  try {
    window.localStorage.setItem(QUALITY_STORAGE_KEY, JSON.stringify({
      mode: quality.mode,
    }));
  } catch (error) { /* no-op */ }
}

function guessWeakDevice() {
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  const dpr = window.devicePixelRatio || 1;
  const area = window.innerWidth * window.innerHeight;
  let score = 0;
  if (cores <= 4) score += 2;
  else if (cores <= 6) score += 1;
  if (memory <= 4) score += 2;
  else if (memory <= 6) score += 1;
  if (dpr >= 2.5) score += 1;
  if (area > 2000000) score += 1;
  return score >= 3;
}

function applyQuality(mode = quality.mode) {
  quality.mode = mode;
  if (mode === "lite") quality.level = "lite";
  else if (mode === "full") quality.level = "full";
  else quality.level = quality.probedLite || guessWeakDevice() ? "lite" : "full";
  Object.assign(quality, QUALITY_PRESETS[quality.level]);
  document.body.classList.toggle("is-lite", quality.level === "lite");
  if (dom.qualityToggle) {
    dom.qualityToggle.setAttribute("aria-pressed", String(quality.level === "lite"));
    dom.qualityToggle.classList.toggle("is-auto", quality.mode === "auto");
  }
  if (dom.qualityLabel) dom.qualityLabel.textContent = quality.level === "lite" ? "LITE" : "FULL";
  if (waterPainter) waterPainter.resize();
  if (glOcean) glOcean.setQuality(quality);
  if (seaEngine) seaEngine.setQuality({ scale: quality.level === "lite" ? 0.75 : 1 });
  createParticles();
  writeQualityPreference();
}

function toggleQuality() {
  const next = quality.level === "lite" ? "full" : "lite";
  applyQuality(next);
  if (!REDUCED_MOTION.matches && dom.qualityToggle) {
    dom.qualityToggle.animate(
      [{ transform: "scale(1)" }, { transform: "scale(0.9)" }, { transform: "scale(1)" }],
      { duration: 320, easing: "cubic-bezier(.22,.9,.24,1)" },
    );
  }
}

function resetQualityToAuto() {
  quality.probedLite = guessWeakDevice();
  applyQuality("auto");
}

function initQuality() {
  const saved = readQualityPreference();
  if (saved) {
    quality.mode = saved.mode;
  }
  applyQuality(quality.mode);
  if (!dom.qualityToggle) return;
  dom.qualityToggle.addEventListener("click", toggleQuality);
  let holdTimer = 0;
  const clearHold = () => {
    if (holdTimer) window.clearTimeout(holdTimer);
    holdTimer = 0;
  };
  dom.qualityToggle.addEventListener("pointerdown", () => {
    clearHold();
    holdTimer = window.setTimeout(() => {
      holdTimer = 0;
      resetQualityToAuto();
      if (!REDUCED_MOTION.matches) {
        dom.qualityToggle.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 700, easing: "ease-out" });
      }
    }, 550);
  });
  dom.qualityToggle.addEventListener("pointerup", clearHold);
  dom.qualityToggle.addEventListener("pointerleave", clearHold);
  dom.qualityToggle.addEventListener("pointercancel", clearHold);
}

// Watch the real frame rate for a couple of seconds once the gallery is on
// screen. If it cannot hold about 45 fps, drop to the lite budget. This only
// runs in AUTO mode; an explicit FULL choice is never overridden.
function updateQualityProbe(now) {
  if (state.qualityProbeDone || quality.mode !== "auto") return;
  if (!state.galleryLive || state.gate < 0.98) return;
  if (!state.qualityProbeStart) {
    state.qualityProbeStart = now;
    state.qualityProbeFrames = 0;
    state.qualityProbeCounting = false;
    return;
  }
  const elapsed = (now - state.qualityProbeStart) / 1000;
  if (elapsed < 1.0) return; // warm up past the door transition
  if (!state.qualityProbeCounting) {
    state.qualityProbeCounting = true;
    state.qualityProbeStart = now;
    state.qualityProbeFrames = 0;
    return;
  }
  state.qualityProbeFrames += 1;
  const measured = (now - state.qualityProbeStart) / 1000;
  if (measured < 2.0) return;
  state.qualityProbeDone = true;
  const fps = state.qualityProbeFrames / measured;
  state.lastFps = fps;
  if (fps < 45 && state.qualityProbeFrames >= 8 && quality.level === "full") {
    quality.probedLite = true;
    applyQuality("auto");
    if (!REDUCED_MOTION.matches && dom.qualityToggle) {
      dom.qualityToggle.animate([{ opacity: 0.35 }, { opacity: 1 }], { duration: 900, easing: "ease-out" });
    }
  }
}
const imageCache = new Map();

function preloadImages() {
  POSTCARDS.forEach((card) => {
    [card.front, card.back].forEach((src) => {
      if (imageCache.has(src)) return;
      const image = new Image();
      image.decoding = "async";
      image.src = src;
      imageCache.set(src, image);
      if (image.decode) image.decode().catch(() => {});
    });
  });
}

function makeRandomCard(index, seed) {
  const random = mulberry32((seed + index * 0x9e3779b1) >>> 0);
  return {
    x: random() * 2 - 1,
    y: random() * 2 - 1,
    z: random() * 2 - 1,
    rx: random() * 2 - 1,
    ry: random() * 2 - 1,
    rz: random() * 2 - 1,
    phase: random() * Math.PI * 2,
    bobSpeed: 0.72 + random() * 0.36,
    bobX: 7 + random() * 8,
    bobY: 9 + random() * 9,
    hoverBias: random() * 2 - 1,
  };
}

function postcardMarkup(data, index) {
  const safeTitle = data.title.replace(/"/g, "&quot;");
  return `
    <div class="postcard" role="button" tabindex="0" aria-haspopup="dialog" aria-label="拾起明信片 ${data.number}：${safeTitle}">
      <span class="card-halo" aria-hidden="true"></span>
      <div class="card3d" aria-hidden="true">
        <div class="card-face card-face--front">
          <img src="${data.front}" alt="" draggable="false" />
          <span class="face-haze"></span>
          <span class="face-sheen"></span>
        </div>
        <div class="card-face card-face--back">
          <img src="${data.back}" alt="" draggable="false" />
          <span class="face-haze"></span>
          <span class="face-sheen"></span>
        </div>
        <span class="card-edge card-edge--left"></span>
        <span class="card-edge card-edge--right"></span>
        <span class="card-edge card-edge--top"></span>
        <span class="card-edge card-edge--bottom"></span>
      </div>
      <span class="pickup-label"><i></i>PICK UP <span>/ 拾起</span></span>
    </div>
    <span class="card-water-shadow" aria-hidden="true"></span>
    <span class="card-ripple" aria-hidden="true"><span></span><span></span><span></span></span>
  `;
}

function buildCards() {
  dom.world.innerHTML = "";

  POSTCARDS.forEach((data, index) => {
    const slot = document.createElement("article");
    slot.className = "postcard-slot";
    if (data.pixel) slot.classList.add("is-pixel");
    if (data.landscape) slot.classList.add("is-landscape");
    slot.dataset.index = String(index);
    slot.innerHTML = postcardMarkup(data, index);
    dom.world.append(slot);

    const postcard = $(".postcard", slot);
    const card3d = $(".card3d", slot);

    const card = {
      data,
      index,
      slot,
      postcard,
      card3d,
      random: makeRandomCard(index, state.seed),
      home: { x: 0, y: 0, z: -450, rx: 0, ry: 0, rz: 0 },
      current: { x: 0, y: 0, z: -450, rx: 0, ry: 0, rz: 0 },
      hover: 0,
      hoverTarget: 0,
      pointerX: 0,
      pointerY: 0,
      currentRx: 0,
      currentRy: 0,
      currentRz: 0,
      driftTime: 0,
    };

    postcard.addEventListener("click", () => openPostcard(card.index, postcard));
    postcard.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openPostcard(card.index, postcard);
    });

    postcard.addEventListener("pointerenter", () => {
      if (state.focusOpen) return;
      card.hoverTarget = 1;
      setCursor(true, "PICK UP");
    });

    postcard.addEventListener("pointermove", (event) => {
      if (!FINE_POINTER || state.focusOpen) return;
      const rect = postcard.getBoundingClientRect();
      card.pointerX = clamp(((event.clientX - rect.left) / rect.width) * 2 - 1, -1, 1);
      card.pointerY = clamp(((event.clientY - rect.top) / rect.height) * 2 - 1, -1, 1);
    });

    postcard.addEventListener("pointerleave", () => {
      card.hoverTarget = 0;
      card.pointerX = 0;
      card.pointerY = 0;
      setCursor(false);
    });

    state.cards.push(card);
  });

  const count = POSTCARDS.length;
  const words = ["Zero", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten"];
  const chineseNumbers = ["零", "一", "两", "三", "四", "五", "六", "七", "八", "九", "十"];
  const firstNumber = POSTCARDS[0]?.number || "01";
  const lastNumber = POSTCARDS[count - 1]?.number || "01";
  const countWord = count <= 10 ? words[count] : String(count);
  const countWordCn = count <= 10 ? chineseNumbers[count] : String(count);
  dom.cardCount.textContent = `${pad(count)} ${count === 1 ? "CARD" : "CARDS"}`;
  dom.coverCardWord.textContent = countWord;
  dom.coverCardWordCn.textContent = countWord === "One" ? "一张" : `${countWordCn}张`;
  dom.coverEditionRange.textContent = `ED. ${firstNumber}—${lastNumber}`;
  dom.sceneRange.textContent = `${firstNumber}°—${lastNumber}°`;
  dom.railFrom.textContent = firstNumber;
  dom.railTo.textContent = lastNumber;

}

function getMetrics() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  const mobile = width <= 680;
  const tablet = width <= 1100;

  let gap;
  if (mobile) gap = Math.max(800, Math.min(width * 2.08, 960));
  else if (tablet) gap = Math.max(980, Math.min(width * 1.12, 1180));
  else gap = Math.max(1140, Math.min(width * 0.88, 1370));

  let projectedEven = mobile
    ? Math.min(292, width * 0.7)
    : tablet
      ? Math.min(315, width * 0.34)
      : Math.min(366, width * 0.254);

  let projectedOdd = mobile
    ? Math.min(250, width * 0.62)
    : tablet
      ? Math.min(276, width * 0.29)
      : Math.min(320, width * 0.222);

  const short = height < 760;
  if (short) {
    const fitFactor = height < 560 ? 0.6 : 0.7;
    projectedEven *= Math.min(1, (height * fitFactor) / (projectedEven * 1.5));
    projectedOdd *= Math.min(1, (height * fitFactor) / (projectedOdd * 1.5));
  }

  const nearZ = mobile ? -340 : -418;
  const farZ = mobile ? -720 : -800;

  return {
    width,
    height,
    mobile,
    tablet,
    short,
    gap,
    projectedEven,
    projectedOdd,
    nearZ,
    farZ,
  };
}

function rebuildLayout(snap = false) {
  const metrics = getMetrics();
  state.metrics = metrics;
  const count = Math.max(1, state.cards.length);
  state.period = count * metrics.gap;

  state.cards.forEach((card, index) => {
    const t = index / count;
    // A depth wave that repeats exactly after one full cycle, keeping the
    // seam between the last and first card invisible.
    const wave = 0.5 + 0.5 * Math.sin(t * Math.PI * 2 + card.random.z * 0.9);
    const z = lerp(metrics.nearZ, metrics.farZ, wave) + card.random.z * 24;
    let projected = lerp(metrics.projectedEven, metrics.projectedOdd, wave);
    if (card.data.pixel && card.data.pixelWidth) {
      const unit = card.data.landscape ? card.data.pixelHeight : card.data.pixelWidth;
      projected = Math.max(unit, Math.round(projected / unit) * unit);
    }
    const worldWidth = projected * (PERSPECTIVE - z) / PERSPECTIVE;
    const worldHeight = worldWidth * 1.5;
    const jitterRange = index === 0 ? (metrics.mobile ? 24 : 54) : (metrics.mobile ? 46 : 76);
    const jitterX = card.random.x * jitterRange;
    const jitterY = card.random.y * (metrics.short ? 14 : metrics.mobile ? 27 : 34);
    const verticalBase = lerp(
      metrics.height < 560 ? -6 : metrics.short ? -10 : (metrics.mobile ? -14 : -28),
      metrics.height < 560 ? 8 : metrics.short ? 30 : (metrics.mobile ? 66 : 84),
      wave,
    );
    const desiredScreenY = verticalBase + jitterY;
    const worldY = desiredScreenY * (PERSPECTIVE - z) / PERSPECTIVE;

    card.home = {
      x: index * metrics.gap + jitterX,
      y: worldY,
      z,
      rx: card.random.rx * 5.0,
      ry: card.random.ry * (12 + wave * 3),
      rz: card.random.rz * 4.6,
      width: worldWidth,
      height: worldHeight,
    };

    card.slot.style.width = `${worldWidth.toFixed(2)}px`;
    card.slot.style.height = `${worldHeight.toFixed(2)}px`;
    card.slot.style.marginLeft = `${(-worldWidth / 2).toFixed(2)}px`;
    card.slot.style.marginTop = `${(-worldHeight / 2).toFixed(2)}px`;
    card.slot.style.setProperty("--haze", `${(0.11 + Math.min(index, 3) * 0.035).toFixed(3)}`);
    card.slot.style.setProperty("--ripple-opacity", `${(0.52 - Math.min(index, 3) * 0.055).toFixed(3)}`);

    if (snap) card.current = { ...card.home };
  });
}

function randomizeCards() {
  state.seed = makeSeed();
  state.cards.forEach((card, index) => {
    card.random = makeRandomCard(index, state.seed);
  });
  rebuildLayout(REDUCED_MOTION.matches);
  setActiveCard(findActiveIndex(state.camX), true);
  if (!REDUCED_MOTION.matches) {
    dom.shuffleButton.animate(
      [
        { transform: "rotate(0deg)" },
        { transform: "rotate(180deg)" },
        { transform: "rotate(360deg)" },
      ],
      { duration: 620, easing: "cubic-bezier(.22,.9,.24,1)" },
    );
  }
}

function createParticles() {
  dom.particles.innerHTML = "";
  const random = mulberry32(0xc0ffee);
  const count = window.innerWidth < 680 ? quality.particlesMobile : quality.particles;
  for (let i = 0; i < count; i += 1) {
    const mote = document.createElement("span");
    mote.className = "mote";
    const size = (0.7 + random() * 2.2).toFixed(2);
    mote.style.setProperty("--size", `${size}px`);
    mote.style.setProperty("--left", `${(4 + random() * 92).toFixed(2)}%`);
    mote.style.setProperty("--top", `${(14 + random() * 72).toFixed(2)}%`);
    mote.style.setProperty("--alpha", (0.08 + random() * 0.32).toFixed(2));
    mote.style.setProperty("--duration", `${(10 + random() * 17).toFixed(1)}s`);
    mote.style.setProperty("--delay", `${(-random() * 20).toFixed(1)}s`);
    mote.style.setProperty("--dx", `${(-24 + random() * 54).toFixed(1)}px`);
    mote.style.setProperty("--dy", `${(-36 + random() * 18).toFixed(1)}px`);
    dom.particles.append(mote);
  }
}

class WaterPainter {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { alpha: true });
    this.width = 0;
    this.height = 0;
    this.dpr = 1;
    this.shimmers = [];
    this.crests = [];
    this.resize();
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    this.width = Math.max(1, rect.width);
    this.height = Math.max(1, rect.height);
    this.dpr = Math.min(window.devicePixelRatio || 1, quality.dprCap);
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.makeDetails();
  }

  makeDetails() {
    const random = mulberry32(0x51a7c0de);
    const count = this.width < 700 ? quality.shimmersMobile : quality.shimmers;
    this.shimmers = Array.from({ length: count }, () => ({
      x: random(),
      y: 0.14 + Math.pow(random(), 1.25) * 0.84,
      length: 0.6 + random() * 4.5,
      delay: random() * Math.PI * 2,
      speed: 0.18 + random() * 0.22,
      weight: 0.3 + random() * 0.7,
    }));

    this.crests = Array.from({ length: quality.crests }, () => ({
      x: random(),
      y: 0.28 + Math.pow(random(), 1.5) * 0.7,
      width: 0.8 + random() * 5.2,
      depth: random(),
      drift: random() * 8,
    }));
  }

  draw(time, scene, weather) {
    const ctx = this.ctx;
    const width = this.width;
    const height = this.height;
    if (!width || !height) return;

    const w = weather || {};
    const sea = clamp(w.seaState == null ? 0.45 : w.seaState, 0, 1);
    const wind = clamp(w.wind == null ? 0.2 : w.wind, 0, 1);
    const night = Boolean(w.isNight);
    const sunX = clamp(w.sunX == null ? 0.735 : w.sunX, 0.06, 0.94);
    const ambient = clamp(w.ambient == null ? 1 : w.ambient, 0.06, 1);
    const windRad = ((w.windDirection == null ? 240 : w.windDirection) * Math.PI) / 180;
    const sparkle = 1;
    const far = (w.sky && w.sky.seaFar) || [0.45, 0.76, 0.75];
    const near = (w.sky && w.sky.seaNear) || [0.22, 0.61, 0.63];
    const deep = (w.sky && w.sky.seaDeep) || [0.1, 0.44, 0.48];
    const sunCol = (w.sky && w.sky.sun) || [1, 0.96, 0.86];
    const rgba = (c, a) => "rgba(" + Math.round(c[0] * 255) + ", " + Math.round(c[1] * 255) + ", " + Math.round(c[2] * 255) + ", " + a + ")";
    const mixC = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    // Water body: bright far, deep near. The strong value range sells depth.
    const body = ctx.createLinearGradient(0, 0, 0, height);
    body.addColorStop(0, rgba(far, 0.5));
    body.addColorStop(0.2, rgba(mixC(far, near, 0.5), 0.82));
    body.addColorStop(0.58, rgba(near, 0.94));
    body.addColorStop(1, rgba(deep, 1));
    ctx.fillStyle = body;
    ctx.fillRect(0, 0, width, height);

    // Horizon haze: atmospheric perspective.
    const haze = ctx.createLinearGradient(0, 0, 0, height * 0.42);
    haze.addColorStop(0, rgba(mixC(far, [1, 1, 1], 0.3), 0.85));
    haze.addColorStop(0.42, rgba(far, 0.3));
    haze.addColorStop(1, rgba(far, 0));
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.fillStyle = haze;
    ctx.fillRect(0, 0, width, height * 0.42);
    ctx.restore();

    // Sun / moon specular path.
    const glint = sparkle * (night ? 0.5 : 1);
    if (glint > 0.05) {
      const cx = sunX * width;
      const topW = width * 0.012;
      const botW = width * (0.05 + wind * 0.05);
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      const g = ctx.createLinearGradient(0, 0, 0, height);
      g.addColorStop(0, rgba(sunCol, 0.06 * glint));
      g.addColorStop(0.32, rgba(sunCol, 0.2 * glint));
      g.addColorStop(0.7, rgba(sunCol, 0.1 * glint));
      g.addColorStop(1, rgba(sunCol, 0.02 * glint));
      ctx.beginPath();
      ctx.moveTo(cx - topW, 0);
      ctx.lineTo(cx + topW, 0);
      ctx.lineTo(cx + botW, height);
      ctx.lineTo(cx - botW, height);
      ctx.closePath();
      ctx.fillStyle = g;
      ctx.fill();
      ctx.restore();
    }

    // Directional swell components. Near the viewer the waves are long and
    // tall; toward the horizon they compress and flatten (perspective).
    const comps = [
      { len: 1050, amp: 30 * (0.45 + sea), dir: 0.05, speed: 0.055 },
      { len: 620, amp: 17 * (0.45 + sea), dir: 0.32, speed: 0.08 },
      { len: 360, amp: 10 * (0.45 + sea), dir: -0.52, speed: 0.115 },
      { len: 200, amp: 6 * (0.45 + sea), dir: 0.62, speed: 0.17 },
      { len: 110, amp: 3.6 * (0.45 + sea), dir: -0.3, speed: 0.26 },
    ];
    const dirShift = wind * 0.45;
    const horizon = height * 0.012;
    const lineCount = Math.min(88, Math.round((width < 700 ? quality.waterMobileLines : quality.waterLines) * (0.8 + sea * 0.5)));
    const highlight = quality.waterPasses >= 3;

    ctx.save();
    ctx.globalCompositeOperation = "screen";
    ctx.lineCap = "round";
    for (let i = 0; i < lineCount; i += 1) {
      const depth = i / Math.max(1, lineCount - 1);
      const persp = 0.03 + Math.pow(depth, 1.5) * 1.8;
      const waveLen = 0.16 + depth * 2.2;
      const speedScale = 0.4 + depth * 1.7;
      const baseY = horizon + Math.pow(depth, 1.7) * (height - horizon);
      const alpha = (0.05 + depth * 0.15) * (0.65 + ambient * 0.55);
      if (alpha < 0.02) continue;
      const lw = 0.5 + depth * 1.5;
      const step = width < 700 ? 22 : 30;
      const pts = [];
      for (let x = -step; x <= width + step; x += step) {
        let disp = 0;
        for (let c = 0; c < comps.length; c += 1) {
          const comp = comps[c];
          const dir = comp.dir + dirShift;
          const k = (Math.PI * 2) / (comp.len * waveLen);
          const a = comp.amp * persp;
          const phase = k * (x * Math.cos(dir) + depth * 320 * Math.sin(dir)) - time * comp.speed * 60 * speedScale;
          disp += a * (Math.sin(phase) + 0.22 * Math.sin(phase * 2));
        }
        pts.push(x, baseY + disp);
      }
      ctx.beginPath();
      ctx.moveTo(pts[0], pts[1]);
      for (let p = 2; p < pts.length; p += 2) ctx.lineTo(pts[p], pts[p + 1]);
      ctx.strokeStyle = rgba(sunCol, alpha * (night ? 0.62 : 1));
      ctx.lineWidth = lw;
      ctx.stroke();
      if (highlight) {
        ctx.beginPath();
        ctx.moveTo(pts[0], pts[1] - 1.4 - depth * 2.2);
        for (let p = 2; p < pts.length; p += 2) ctx.lineTo(pts[p], pts[p + 1] - 1.4 - depth * 2.2);
        ctx.strokeStyle = rgba(sunCol, alpha * 0.9 * (night ? 0.5 : 1));
        ctx.lineWidth = lw * 0.55;
        ctx.stroke();
      }
    }
    ctx.restore();

    // Whitecaps and foam: driven by wind only (no rain / storm on this site).
    const foamAmount = clamp(wind * 0.45);
    if (foamAmount > 0.08) {
      ctx.save();
      ctx.globalCompositeOperation = "screen";
      ctx.strokeStyle = rgba([0.93, 0.97, 0.96], 0.18 + foamAmount * 0.32);
      for (let i = 0; i < this.crests.length; i += 1) {
        const crest = this.crests[i];
        const depth = 0.15 + crest.depth * 0.85;
        const x = (((crest.x + scene * 0.02 + wind * time * 0.02) % 1) + 1) % 1 * width;
        const y = horizon + Math.pow(depth, 1.7) * (height - horizon) + Math.sin(time * 0.6 + crest.drift) * (4 + depth * 12);
        const l = crest.width * (4 + depth * 18) * (0.5 + foamAmount);
        ctx.lineWidth = 0.6 + depth * 1.4;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + l * 0.5, y - (2 + depth * 6), x + l, y);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Specular sparkles along the light path.
    ctx.save();
    ctx.globalCompositeOperation = "screen";
    this.shimmers.forEach((shimmer, index) => {
      const pulse = (Math.sin(time * shimmer.speed + shimmer.delay) + 1) * 0.5;
      if (pulse < 0.3) return;
      /* 亮点必须长在光路里。原来 x 是 (随机 + 场景漂移) 铺满整个画面宽度，
         日月挪到哪儿这 52 个亮点都在原地闪，海面于是像在自顾自地亮。现在以
         光盘的屏幕横坐标为中心散成一条带 —— 越近越宽，真实高光带就是这个形状
         —— 并按离带心的横向偏移给每道亮纹一点倾角，带子因此斜着指向光源。 */
      const bandCx = sunX * width;
      const bandW = width * (0.03 + shimmer.y * 0.13 + wind * 0.04);
      const off = shimmer.x * 2 - 1;
      const x = bandCx + off * bandW + Math.sin(time * 0.15 + shimmer.delay) * 3;
      if (x < -12 || x > width + 12) return;
      const y = shimmer.y * height + Math.sin(time * 0.25 + index) * 3;
      const l = shimmer.length * (0.6 + pulse) * (width < 700 ? 1.3 : 1);
      const tilt = off * l * 0.28;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.quadraticCurveTo(x + l * 0.5, y - 1.6 + tilt, x + l, y + tilt * 0.35);
      ctx.strokeStyle = rgba(sunCol, (0.05 + pulse * 0.3) * shimmer.weight * sparkle * (night ? 0.6 : 1));
      ctx.lineWidth = 0.6 + shimmer.weight * 0.8;
      ctx.stroke();
    });
    ctx.restore();

    // Foreground shade deepens the near water.
    const shade = ctx.createLinearGradient(0, height * 0.35, 0, height);
    shade.addColorStop(0, rgba(deep, 0));
    shade.addColorStop(0.75, rgba(deep, 0.12 + (1 - ambient) * 0.16));
    shade.addColorStop(1, rgba(deep, 0.42 + (1 - ambient) * 0.2));
    ctx.fillStyle = shade;
    ctx.fillRect(0, height * 0.3, width, height * 0.7);
  }
}

// The sea has two possible backends: the WebGL2 ocean (ocean.js, realtime 3D
// Gerstner surface) and the Canvas-2D painter kept for browsers without
// WebGL2. Exactly one of them owns #waterCanvas.
let waterPainter = null;
let glOcean = null;       // hand-written WebGL2 fallback
let seaEngine = null;     // the ported open-sea renderer (sea.bundle.js)

function useCanvasSea() {
  if (waterPainter || glOcean) return;
  waterPainter = new WaterPainter(dom.water);
}

function useFallbackSea() {
  if (window.Ocean && window.Ocean.init(dom.water, { quality: quality })) {
    glOcean = window.Ocean;
    document.body.classList.add("has-gl-ocean");
    return;
  }
  useCanvasSea();
}

/* `.gallery` 是 position:fixed 铺满视口的，`.ocean-canvas` 又 absolute inset:0
   铺满它 —— 这块画布的盒子只在视口尺寸变化时才会变。可它原来是每帧量一次：
   而这一帧之前蛋糕门刚写过几百个 SVG 属性，这一次量测就是一次强制同步布局，
   把整页重新排一遍。开屏那 9 秒里 getBoundingClientRect 自身耗时 1441ms，
   排第一。实测整段开屏（fly/aim/cut/open 加滚动、加切片）里这个 rect 一直是
   0,0,vw,vh，只有改视口尺寸时才变过 —— 所以改成跟视口一起量。 */
const oceanBox = { left: 0, top: 0, width: 0, height: 0, bottom: 0 };
let oceanBoxStale = true;

function oceanRect() {
  if (oceanBoxStale) {
    const rect = dom.ocean.getBoundingClientRect();
    oceanBox.left = rect.left;
    oceanBox.top = rect.top;
    oceanBox.width = rect.width;
    oceanBox.height = rect.height;
    oceanBox.bottom = rect.bottom;
    oceanBoxStale = false;
  }
  return oceanBox;
}

function startSea() {
  if (window.OpenSea && window.OpenSea.createSea && !/[?&]nogl=1/.test(window.location.search)) {
    // Show the cheap canvas sea immediately and upgrade to the 3D renderer when
    // its device is ready: the engine takes a moment to initialise, and an
    // empty horizon in the meantime looks like a bug.
    useCanvasSea();
    oceanBoxStale = true;
    const rect = oceanRect();
    const width = Math.max(2, Math.round(rect.width || window.innerWidth));
    const height = Math.max(2, Math.round(rect.height || window.innerHeight));
    window.OpenSea.createSea({
      canvas: dom.ocean,
      width,
      height,
      segments: quality.level === "lite" || width < 760 ? 160 : 256,
    }).then((engine) => {
      seaEngine = engine;
      document.body.classList.add("has-sea-bundle");
      engine.setQuality({ scale: quality.level === "lite" ? 0.75 : 1 });
      engine.resize(width, height);
    }).catch((err) => {
      console.warn("[TIDELINE] open-sea engine unavailable, keeping the fallback sea:", err && err.message ? err.message : err);
      document.body.classList.remove("has-sea-bundle");
      if (!waterPainter) useFallbackSea();
    });
    return;
  }
  useFallbackSea();
}

// The reference palette. It is written as if it were linear light (the engine
// tone-maps it), which is why our sRGB palette cannot simply be handed over:
// a pale sky reflects the same pale colour whatever the waves do.
const SEA_PALETTE = {
  day: { zenith: [0.07, 0.2, 0.42], horizon: [0.52, 0.68, 0.82], deep: [0.015, 0.09, 0.11], shallow: [0.06, 0.32, 0.36], sun: [1.0, 0.93, 0.8], sunI: 1.6 },
  dusk: { zenith: [0.03, 0.05, 0.16], horizon: [0.85, 0.36, 0.16], deep: [0.02, 0.045, 0.075], shallow: [0.09, 0.15, 0.2], sun: [1.0, 0.42, 0.14], sunI: 2.6 },
  /* 夜色下的海不是黑的，是「暗底 + 一条月光路」。
     sunI 原为 0.55，直射太弱，反射进来的高光凑不成一条路（只剩几个孤立的亮点）；
     抬到 1.55、色相推向银蓝之后，引擎自己的 specular 就能画出带颗粒的波光。
     2026-10-24：叠在海面上的那条 CSS 三角形光带已删。那层是
     贴死的渐变、不随波浪走，用户要的是海面真正响应 —— 做不到的部分宁可不做，
     也不再补一层假光。 */
  night: { zenith: [0.012, 0.02, 0.05], horizon: [0.06, 0.09, 0.15], deep: [0.006, 0.014, 0.03], shallow: [0.03, 0.06, 0.1], sun: [0.8, 0.88, 1.0], sunI: 1.55 },
};

function mix3(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function seaPaletteFor(weather) {
  const elevation = clamp((weather.sunElevation == null ? 20 : weather.sunElevation) / 60, 0, 1);
  let p = {
    zenith: mix3(SEA_PALETTE.dusk.zenith, SEA_PALETTE.day.zenith, elevation),
    horizon: mix3(SEA_PALETTE.dusk.horizon, SEA_PALETTE.day.horizon, elevation),
    deep: mix3(SEA_PALETTE.dusk.deep, SEA_PALETTE.day.deep, elevation),
    shallow: mix3(SEA_PALETTE.dusk.shallow, SEA_PALETTE.day.shallow, elevation),
    sun: mix3(SEA_PALETTE.dusk.sun, SEA_PALETTE.day.sun, elevation),
    sunI: 2.6 + (1.6 - 2.6) * elevation,
  };
  if (weather.isNight) p = SEA_PALETTE.night;
  return p;
}

function applySeaFrame() {
  if (!seaEngine) return;
  const weather = Weather.state;
  const p = seaPaletteFor(weather);
  const ambient = clamp(weather.ambient == null ? 1 : weather.ambient, 0, 1.4);

  seaEngine.setTime(state.waterTime);
  seaEngine.setSea(0.25 + clamp(weather.seaState || 0, 0, 1) * 1.5);
  seaEngine.setSky(p.zenith, p.horizon);
  seaEngine.setWater(p.deep, p.shallow);

  // Light direction follows the sun/moon disc that the viewer can drag: the
  // azimuth is the disc's screen x, the elevation is lifted so the glitter
  // reads as a path rather than as one permanent sunset.
  const rect = oceanRect();
  const vh = Math.max(1, window.innerHeight);
  const topF = rect.top / vh;
  const heightF = Math.max(0.0001, (rect.bottom - rect.top) / vh);
  const cy = ((weather.sunY || 0.25) - topF) / heightF;
  const vHalf = Math.tan((55 * Math.PI) / 360);
  const n0 = 1 - 2 * 0.26;
  let yView = vHalf * (1 - 2 * cy - n0);
  if (!(yView > 0.02)) yView = 0.02;
  const cssElev = (Math.atan(yView) * 180) / Math.PI;
  yView = Math.tan(((9 + cssElev * 1.7) * Math.PI) / 180);
  const aspect = rect.width / Math.max(1, rect.height);
  const xView = ((weather.sunX || 0.7) * 2 - 1) * vHalf * aspect;
  const len = Math.hypot(xView, yView, 1) || 1;
  const gain = p.sunI * (0.55 + ambient * 0.5);
  seaEngine.setLight(
    [xView / len, yView / len, -1 / len],
    [p.sun[0] * gain, p.sun[1] * gain, p.sun[2] * gain],
  );
  seaEngine.setWeather({
    /* 天空里的旧云（bundle 自绘的解析云板 uSkyDeck）是过时的「纸片」观感，
       体素云移除后它就成了画面里唯一还剩下的云。先关掉，等新云板接上再开：
       sea-entry.js 在 cloud<=0.001 时把 uSkyDeck 置 0，天空就干净裸着。
       云影响海面（压暗直射）不受影响 —— 那是下面独立的 shade 字段。 */
    cloud: 0,
    stormy: 0,
    flash: 0,
    // The second cloud layer is the expensive one; LITE keeps a single layer.
    cloudDetail: quality.level === "lite" ? 0 : 1,
    /* 站点暂时没有云（FULL 无云设计）：不压暗海面直射。将来接上云板时，
       这里改成由云的覆盖率算遮光即可。 */
    shade: 1,
  });
}

function setCursor(active, label = "") {
  if (!FINE_POINTER) return;
  state.cursorActive = active;
  dom.cursor.classList.toggle("is-active", active);
  if (label) dom.cursorLabel.textContent = label;
}

function initCursor() {
  if (!FINE_POINTER) return;
  document.body.classList.add("has-custom-cursor");

  const reveal = (x, y) => {
    state.pointer.x = x;
    state.pointer.y = y;
    if (!state.cursorVisible) {
      state.pointer.smoothX = x;
      state.pointer.smoothY = y;
      state.cursorVisible = true;
      dom.cursor.classList.add("is-visible");
    }
    const ink = !state.introHidden && !state.focusOpen;
    dom.cursor.classList.toggle("is-ink", ink);
  };

  document.addEventListener("pointermove", (event) => {
    reveal(event.clientX, event.clientY);
  }, { passive: true });

  document.addEventListener("pointerleave", () => {
    state.cursorVisible = false;
    dom.cursor.classList.remove("is-visible");
    setCursor(false);
  });

  document.addEventListener("pointerover", (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;

    if (state.focusOpen) {
      if (target.closest(".focus-card")) setCursor(true, "TURN");
      else if (target.closest(".focus-close")) setCursor(true, "CLOSE");
      else setCursor(true, "RELEASE");
      return;
    }

    if (target.closest(".postcard")) {
      setCursor(true, "PICK UP");
      return;
    }
    if (target.closest(".scroll-cue")) {
      setCursor(true, "OPEN");
      return;
    }
    if (target.closest(".shuffle-button")) {
      setCursor(true, "SHUFFLE");
      return;
    }
    setCursor(false);
  });
}

function getScrollMax() {
  return Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
}

function updateScrollMetrics() {
  const metrics = getMetrics();
  const count = Math.max(1, state.cards.length);
  const height = Math.max(1, window.innerHeight);
  state.introPx = Math.max(420, height * 0.92);
  // The cover is a one-way door, and now literally one: nothing in the UI walks
  // back to it. Once it has been pushed open the promenade never scrolls back
  // over it — the ring re-anchors the walk here.
  //
  // This sits exactly where the door gate saturates (gate === 1), so inside
  // the ring the cover is always fully gone — the doors never even flicker.
  state.corridorFloor = state.introPx;
  state.period = count * metrics.gap;
  // One loop is a few screens of scrolling: long enough to feel like a
  // promenade, short enough that the walk wraps in a reasonable time.
  const screens = clamp(count * 0.8, 2.6, 5.6);
  state.loopPx = screens * height;
  state.pxPerWorldX = state.loopPx / Math.max(1, state.period);
  const trackHeight = height + state.introPx + state.loopPx * 2;
  dom.scrollTrack.style.height = `${Math.round(trackHeight)}px`;
}

// The promenade closes into a ring at both ends. Walking past either edge
// shifts the page by exactly one cycle, which is exactly one camera period —
// so the sea, the cards and the light are pixel-identical on the other side
// and the wrap is invisible in either direction.
//
// The doors are the one exception: before they are open the walk is allowed to
// retreat below the corridor floor. Once the cloth has parted, nothing closes
// it again — there is no way back to the cover, by scroll or by button.
function wrapCorridorScroll() {
  const cycle = state.loopPx;
  if (!cycle) return;
  if (!state.introHidden) return;
  const lower = state.corridorFloor;
  const upper = state.introPx + cycle * 1.75;
  let y = window.scrollY;
  if (y > upper) {
    while (y > upper) y -= cycle;
    window.scrollTo(0, y);
  } else if (y < lower) {
    while (y < lower) y += cycle;
    window.scrollTo(0, y);
  }
}

function setActiveCard(index, force = false) {
  if (!state.cards[index]) return;
  if (!force && index === state.activeIndex) return;
  state.activeIndex = index;

  const apply = () => {
    const card = state.cards[index];
    if (!card) return;
    dom.currentNumber.textContent = card.data.number;
    dom.currentTitle.textContent = card.data.title;
    dom.currentMeta.textContent = card.data.short;
    dom.currentCard.classList.remove("is-switching");
  };

  clearTimeout(state.hudTimer);
  if (force) {
    apply();
    return;
  }

  dom.currentCard.classList.add("is-switching");
  state.hudTimer = window.setTimeout(apply, 170);
}

function findActiveIndex(camX) {
  const period = Math.max(1, state.period);
  let active = 0;
  let closest = Infinity;

  state.cards.forEach((card, index) => {
    const depthScale = PERSPECTIVE / (PERSPECTIVE - card.current.z);
    const wrapped = mod(card.current.x - camX + period * 0.5, period) - period * 0.5;
    const distance = Math.abs(wrapped * depthScale);
    if (distance < closest) {
      closest = distance;
      active = index;
    }
  });

  return active;
}

function updateRail(activeIndex, period) {
  const count = state.cards.length;
  if (!count) return;
  const active = state.cards[activeIndex];
  const next = state.cards[(activeIndex + 1) % count];
  dom.railFrom.textContent = active.data.number;
  dom.railTo.textContent = next.data.number;
  const spacing = Math.max(1, period / count);
  const wrapped = mod(active.home.x - state.camX + period * 0.5, period) - period * 0.5;
  const t = clamp(0.5 - wrapped / spacing, 0, 1);
  dom.railFill.style.transform = `scaleX(${t.toFixed(4)})`;
  dom.railDot.style.left = `${(t * 100).toFixed(3)}%`;
}

function updateScrollState(dt) {
  if (state.focusOpen) return;

  wrapCorridorScroll();

  // 切开那一刀是「啪」一下就到长廊的：相机必须同一帧就位，
  // 否则滚动瞬间会有一张放大到铺满屏的明信片飞过（那正是「切完还剩一帧」）。
  const direct = REDUCED_MOTION.matches || state.snapCamera === true;
  if (state.snapCamera) state.snapCamera = false;
  const start = Math.max(1, state.introPx);
  // 幕布锁着时滚动一律不算数：这道门只能切，不能滚。
  const gateRaw = state.coverLocked ? 0 : clamp((window.scrollY - start * 0.08) / (start * 0.92));
  const gateTarget = smootherstep(gateRaw);
  state.gate = direct ? gateTarget : damp(state.gate, gateTarget, 9, dt);

  const pxPer = Math.max(0.05, state.pxPerWorldX);
  const period = Math.max(1, state.period);
  let targetCam = Math.max(0, (window.scrollY - start * 0.9) / pxPer);
  // Keep the damped camera close to its current value across the scroll wrap.
  // A single rounded correction is O(1) even after many loops.
  targetCam += Math.round((state.camX - targetCam) / period) * period;
  state.camX = direct ? targetCam : damp(state.camX, targetCam, 7.5, dt);

  state.wander = state.camX / period;
  state.loopScene = mod(state.wander, 1);
  const bgTarget = 0.5 - 0.5 * Math.cos(state.loopScene * Math.PI * 2);
  state.bgScene = direct ? bgTarget : damp(state.bgScene, bgTarget, 5.4, dt);

  const coverFade = 1 - smootherstep(clamp((state.gate - 0.05) / 0.29));
  const coverLift = (1 - coverFade) * 38;
  dom.intro.style.setProperty("--gate", state.gate.toFixed(4));
  dom.coverContent.style.opacity = String(coverFade);
  dom.coverContent.style.transform = `translate3d(0, ${(-coverLift).toFixed(2)}px, 0)`;
  dom.intro.style.pointerEvents = state.gate > 0.86 || coverFade <= 0.01 ? "none" : "auto";

  // 刀还没走完，这一层就不能撤：撤了布当场消失，看着就是「开门太快」。
  const shouldHideIntro = state.gate > 0.997 && !state.cakeCutting;
  if (shouldHideIntro && !state.introHidden) {
    dom.intro.classList.add("is-hidden");
    state.introHidden = true;
  } else if (!shouldHideIntro && state.introHidden) {
    dom.intro.classList.remove("is-hidden");
    state.introHidden = false;
  }

  const shouldInertCover = coverFade <= 0.02 || state.introHidden;
  if (dom.coverContent.inert !== shouldInertCover) dom.coverContent.inert = shouldInertCover;

  const live = state.gate > 0.72;
  if (live !== state.galleryLive) {
    state.galleryLive = live;
    dom.gallery.classList.toggle("is-live", live);
  }

  if (!state.focusOpen) {
    const galleryGated = state.gate < 0.84;
    if (dom.gallery.inert !== galleryGated) dom.gallery.inert = galleryGated;
  }

  const activeIndex = findActiveIndex(state.camX);
  setActiveCard(activeIndex);
  updateRail(activeIndex, period);

  dom.scrollHint.classList.toggle("is-idle", window.scrollY > state.introPx * 1.1);
}

/* --scene/--mx/--my 只有 .gallery 子树在用。它们原来是每帧无条件 setProperty，
   即使数值没变也会让整个 gallery 子树样式失效（卡片、背景、太阳全在里面）。
   缓存上一次的字符串，值没变就不碰 DOM。 */
const galleryVarCache = Object.create(null);
function setGalleryVar(name, value) {
  if (galleryVarCache[name] === value) return;
  galleryVarCache[name] = value;
  dom.gallery.style.setProperty(name, value);
}

function applyCardTransforms(now, dt) {
  // The card in hand keeps its gallery pose frozen; the rest of the promenade stays live.


  const nx = clamp((state.pointer.smoothX / window.innerWidth) * 2 - 1, -1, 1);
  const ny = clamp((state.pointer.smoothY / window.innerHeight) * 2 - 1, -1, 1);
  const still = REDUCED_MOTION.matches;

  setGalleryVar("--scene", state.bgScene.toFixed(4));
  setGalleryVar("--mx", still ? "0" : nx.toFixed(3));
  setGalleryVar("--my", still ? "0" : ny.toFixed(3));

  /* 诊断：nocardmove（保留 blur）与 nocardfx（关 blur）都冻结卡片；gallery 的
     三个变量照写，两者的差值就只剩光晕 filter 一项。 */
  if (DIAG.nocardfx || DIAG.nocardmove) { state.camPrevious = state.camX; return; }

  const scrollImpulse = clamp((state.camX - state.camPrevious) * 0.024, -3.6, 3.6);
  const period = Math.max(1, state.period);
  const heldIndex = state.focusOpen ? state.focusIndex : -1;
  /* Nothing on the promenade may move while a card is in hand: the leftover
     cards are hidden by `body.is-holding .postcard-slot`, and writing seven
     transforms per frame for pixels nobody can see is exactly the main-thread
     cost this pass is trying to remove. */
  if (state.focusOpen) { state.camPrevious = state.camX; return; }
  state.cards.forEach((card, index) => {
    if (index === heldIndex) return;

    const stiffness = 2.9;
    if (!still) card.driftTime += dt;
    card.current.x = damp(card.current.x, card.home.x, stiffness, dt);
    card.current.y = damp(card.current.y, card.home.y, stiffness, dt);
    card.current.z = damp(card.current.z, card.home.z, stiffness, dt);
    card.current.rx = damp(card.current.rx, card.home.rx, stiffness, dt);
    card.current.ry = damp(card.current.ry, card.home.ry, stiffness, dt);
    card.current.rz = damp(card.current.rz, card.home.rz, stiffness, dt);
    card.hover = damp(card.hover, card.hoverTarget, 5.8, dt);

    const phase = card.random.phase + card.driftTime * card.random.bobSpeed;
    const depth = PERSPECTIVE / (PERSPECTIVE - card.current.z);
    const floatX = still
      ? 0
      : (Math.sin(phase * 0.83 + 0.2) * card.random.bobX * 1.65
        + Math.sin(phase * 1.71 + 1.1) * card.random.bobX * 0.55) * depth;
    const floatY = still
      ? 0
      : (Math.sin(phase) * card.random.bobY * 1.25
        + Math.cos(phase * 0.53 + 0.9) * card.random.bobY * 0.35) * depth;
    const floatZ = still ? 0 : Math.cos(phase * 0.63 + 1.4) * 24;
    const parallaxStrength = index === 0 ? 10 : 6;

    const spread = card.current.x - state.camX + floatX + nx * parallaxStrength;
    const x = mod(spread + period * 0.5, period) - period * 0.5;
    const y = card.current.y + floatY - ny * 6;
    const z = card.current.z + floatZ;

    const hoverTiltX = card.pointerY * card.hover * 4.4;
    const hoverTiltY = card.pointerX * card.hover * 7.2;
    const idleTiltX = still
      ? 0
      : Math.sin(phase * 0.74 + 0.35) * 1.9 + Math.cos(phase * 0.37 + 1.2) * 0.65;
    const idleTiltY = still
      ? 0
      : Math.cos(phase * 0.61 + 0.2) * 2.7 + Math.sin(card.driftTime * 0.19 + card.random.phase) * 1.15;
    const idleTiltZ = still
      ? 0
      : Math.sin(phase * 0.52 + 1.3) * 1.55 + Math.cos(phase * 0.29) * 0.6;

    const rx = card.current.rx + idleTiltX + hoverTiltX + ny * 1.1;
    const ry = card.current.ry + idleTiltY + hoverTiltY + nx * 1.7 + scrollImpulse;
    const rz = card.current.rz + idleTiltZ + card.pointerX * card.hover * 1.6;
    const scale = 1 + card.hover * 0.025;

    card.currentRx = rx;
    card.currentRy = ry;
    card.currentRz = rz;

    /* 量化到 3 位小数后，慢速漂移时字符串经常和上一帧完全相同；一样就别写，
       省掉一次该卡片的样式失效。 */
    const slotTransform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, ${z.toFixed(2)}px)`;
    if (card.lastSlotTransform !== slotTransform) {
      card.lastSlotTransform = slotTransform;
      card.slot.style.transform = slotTransform;
    }
    const cardTransform = `rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) rotateZ(${rz.toFixed(2)}deg) scale(${scale.toFixed(4)})`;
    if (card.lastCardTransform !== cardTransform) {
      card.lastCardTransform = cardTransform;
      card.card3d.style.transform = cardTransform;
    }
  });

  state.camPrevious = state.camX;
}

function updateCursor(dt) {
  if (!FINE_POINTER || !state.cursorVisible) return;
  state.pointer.smoothX = damp(state.pointer.smoothX, state.pointer.x, 18, dt);
  state.pointer.smoothY = damp(state.pointer.smoothY, state.pointer.y, 18, dt);
  dom.cursor.style.transform = `translate3d(${state.pointer.smoothX.toFixed(2)}px, ${state.pointer.smoothY.toFixed(2)}px, 0)`;
}

function openArchive(instant) {
  if (state.focusOpen) return;
  // 瞬移进长廊时让相机同帧对齐（见 updateScrollState 里的 direct）
  if (instant) state.snapCamera = true;
  state.corridorDirty = true;
  const target = state.introPx * 1.02
  window.scrollTo({
    top: target,
    behavior: instant || REDUCED_MOTION.matches ? "auto" : "smooth",
  });
  // 瞬移之后必须**这一帧**就把相机和 --gate 推到位：animate() 里
  // updateScrollState 跑在 CakeGate.update 之前，瞬移又是 CakeGate 发起的，
  // 不补这一下，海就会拿跳转前的旧相机画一帧 —— 那一帧就是「切开之后那张
  // 不知道啥」。dt 传 0：只做对齐，不做任何阻尼推进。
  if (instant) updateScrollState(0);
}

function setFocusContent(card) {
  const data = card.data;
  if (dom.focusFront.getAttribute("src") !== data.front) dom.focusFront.src = data.front;
  if (dom.focusBack.getAttribute("src") !== data.back) dom.focusBack.src = data.back;
  dom.focusNumber.textContent = data.number;
  dom.focusNumberSmall.textContent = data.number;
  dom.focusTitle.textContent = data.title;
  dom.focusMeta.textContent = data.meta;
  dom.focusQuote.textContent = data.quote;
  dom.focusQuoteCn.textContent = data.quoteCn;
  dom.focusDate.textContent = data.date;
  dom.focusFront.alt = `${data.title}，明信片正面`;
  dom.focusBack.alt = data.backAlt || `${data.title}，明信片背面`;
  dom.focus.classList.toggle("is-pixel", Boolean(data.pixel));
  dom.focus.classList.toggle("is-landscape", Boolean(data.landscape));
  dom.focus.style.setProperty("--card-accent", data.accent);
  dom.focusCard.setAttribute("aria-label", `${data.title}，明信片正面，点击翻面`);
  dom.focusCard.setAttribute("aria-pressed", "false");
}

function focusTiltTransform(tilt) {
  return `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg) rotateZ(${tilt.z.toFixed(2)}deg)`;
}

function setFocusTilt(x, y, z = 0) {
  state.focusTilt.x = x;
  state.focusTilt.y = y;
  state.focusTilt.z = z;
  dom.focusTilt.style.transform = focusTiltTransform(state.focusTilt);
}

function readFocusSpin() {
  const value = window.getComputedStyle(dom.focusSpin).transform;
  if (!value || value === "none") return 0;
  try {
    const matrix = new DOMMatrixReadOnly(value);
    return Math.atan2(matrix.b, matrix.a) / rad;
  } catch (error) {
    return 0;
  }
}

function readFocusTilt() {
  const value = window.getComputedStyle(dom.focusTilt).transform;
  if (!value || value === "none") return { ...state.focusTilt };
  try {
    const matrix = new DOMMatrixReadOnly(value);
    return {
      x: Math.atan2(-matrix.m32, matrix.m33) / rad,
      y: Math.asin(clamp(matrix.m31, -1, 1)) / rad,
      z: Math.atan2(-matrix.m21, matrix.m11) / rad,
    };
  } catch (error) {
    return { ...state.focusTilt };
  }
}

// Match the hidden gallery card to the held card's last visible pose. The
// close flight then only changes position and scale, so the card never appears
// to straighten itself while travelling back to the promenade.
function syncCardAnglesToFocus(card, tilt) {
  const still = REDUCED_MOTION.matches;
  const t = card.driftTime;
  const nx = clamp((state.pointer.smoothX / window.innerWidth) * 2 - 1, -1, 1);
  const ny = clamp((state.pointer.smoothY / window.innerHeight) * 2 - 1, -1, 1);
  const phase = card.random.phase + t * card.random.bobSpeed;
  const hoverTiltX = card.pointerY * card.hover * 4.4;
  const hoverTiltY = card.pointerX * card.hover * 7.2;
  const idleTiltX = still ? 0 : Math.sin(phase * 0.74 + 0.35) * 1.9 + Math.cos(phase * 0.37 + 1.2) * 0.65;
  const idleTiltY = still ? 0 : Math.cos(phase * 0.61 + 0.2) * 2.7 + Math.sin(t * 0.19 + card.random.phase) * 1.15;
  const idleTiltZ = still ? 0 : Math.sin(phase * 0.52 + 1.3) * 1.55 + Math.cos(phase * 0.29) * 0.6;
  card.current.rx = tilt.x - (idleTiltX + hoverTiltX + ny * 1.1);
  card.current.ry = tilt.y - (idleTiltY + hoverTiltY + nx * 1.7);
  card.current.rz = tilt.z - (idleTiltZ + card.pointerX * card.hover * 1.6);
}

// Measure the portrait and focus-target boxes for a card. A landscape card
// keeps a 3:2 frame in focus; the rack card is always the 2:3 portrait box.
function measureFocusSizes(card) {
  const landscape = Boolean(card.data.landscape);
  dom.focus.classList.toggle("is-landscape", landscape);
  dom.focusCard.style.width = "";
  dom.focusCard.style.height = "";
  const cached = imageCache.get(card.data.front);
  const iw = card.data.pixelWidth || (cached && cached.naturalWidth) || dom.focusFront.naturalWidth || 0;
  const ih = card.data.pixelHeight || (cached && cached.naturalHeight) || dom.focusFront.naturalHeight || 0;
  if (card.data.pixel && iw && ih) {
    // Pixel art must land on an integer multiple of its source grid, or the
    // rack rotation and the focus turn resample the pixels unevenly.
    const baseW = dom.focusCard.offsetWidth;
    const unitW = landscape ? ih : iw;
    const unitH = landscape ? iw : ih;
    const k = Math.max(1, Math.round(baseW / unitW));
    dom.focusCard.style.width = `${k * unitW}px`;
    dom.focusCard.style.height = `${k * unitH}px`;
  }
  return { w: dom.focusCard.offsetWidth, h: dom.focusCard.offsetHeight };
}

// A held card rides out a viewport change (a window resize, a fullscreen
// hand-off) instead of dropping the viewer back into the promenade. The
// opening flight's last frame is viewport-relative — `translate(-50%,-50%)`
// over the CSS box — so cancelling the animations and re-measuring the box is
// all it takes to keep the pose.
function holdFocusThroughResize(card) {
  state.focusAnimations.forEach((animation) => {
    try { animation.cancel(); } catch (error) { /* already done */ }
  });
  state.focusAnimations = [];
  state.focusAnimating = false;

  dom.focusCard.getAnimations().forEach((animation) => animation.cancel());
  dom.focusTilt.getAnimations().forEach((animation) => animation.cancel());
  dom.focusFront.getAnimations().forEach((animation) => animation.cancel());
  dom.focusBack.getAnimations().forEach((animation) => animation.cancel());
  dom.focusSpin.getAnimations().forEach((animation) => animation.cancel());

  measureFocusSizes(card);
  dom.focusCard.style.transform = "";
  setFocusTilt(FOCUS_REST_TILT.x, FOCUS_REST_TILT.y, FOCUS_REST_TILT.z);
  dom.focusSpin.style.transform = card.data.landscape ? "rotateZ(-90deg)" : "";
}

function openPostcard(index, source) {
  if (state.focusOpen || state.focusClosing) return;
  const card = state.cards[index];
  if (!card) return;

  state.focusOpen = true;
  state.focusIndex = index;
  state.focusClosing = false;
  state.focusAnimating = true;
  state.focusFlipped = false;
  state.lastFocused = source;
  state.lastCard = card;
  state.scrollRestore = window.scrollY;
  document.documentElement.classList.add("is-locked");
  document.body.classList.add("is-holding");
  dom.gallery.inert = true;
  dom.focus.inert = false;

  dom.focusCard.getAnimations().forEach((animation) => animation.cancel());
  dom.focusTilt.getAnimations().forEach((animation) => animation.cancel());
  dom.focusFront.getAnimations().forEach((animation) => animation.cancel());
  dom.focusBack.getAnimations().forEach((animation) => animation.cancel());
  dom.focusSpin.getAnimations().forEach((animation) => animation.cancel());
  state.focusAnimations = [];
  dom.focusCard.style.transform = "";
  dom.focusCard.style.width = "";
  dom.focusCard.style.height = "";
  dom.focusSpin.style.transform = "";
  setFocusTilt(card.currentRx, card.currentRy, card.currentRz);
  dom.focusRotor.classList.remove("is-flipped");
  dom.focusRotor.style.transitionDuration = "";
  dom.focus.classList.remove("is-closing", "is-back");
  dom.focusRotor.style.transform = "";
  setCursor(true, "TURN");

  const sourceRect = card.card3d.getBoundingClientRect();

  setFocusContent(card);
  dom.focus.classList.add("is-visible");
  dom.focus.setAttribute("aria-hidden", "false");
  dom.focus.focus({ preventScroll: true });

  const box = measureFocusSizes(card);

  card.slot.classList.add("is-lifted");

  void dom.focusCard.offsetWidth;
  const anchorRect = dom.focusCard.getBoundingClientRect();
  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const dx = sourceCenterX - anchorCenterX;
  const dy = sourceCenterY - anchorCenterY;
  const startScale = Math.min(
    sourceRect.width / Math.max(1, box.w),
    sourceRect.height / Math.max(1, box.h),
  );
  const wobble = (card.random.x >= 0 ? 1 : -1) * (4 + Math.abs(card.random.y) * 7);
  const base = "translate(-50%, -50%)";
  const offsets = [0, 0.09, 0.2, 0.48, 0.8, 1];
  const transforms = [
    `${base} translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) rotateZ(${card.currentRz.toFixed(2)}deg) scale(${startScale.toFixed(4)})`,
    `${base} translate(${(dx * 0.975 + wobble).toFixed(2)}px, ${(dy * 0.95 - 5).toFixed(2)}px) rotateZ(${(card.currentRz + 2.2).toFixed(2)}deg) scale(${(startScale * 1.015).toFixed(4)})`,
    `${base} translate(${(dx * 0.91 - wobble).toFixed(2)}px, ${(dy * 0.84 - 18).toFixed(2)}px) rotateZ(${(card.currentRz - 1.5).toFixed(2)}deg) scale(${(startScale * 1.065).toFixed(4)})`,
    `${base} translate(${(dx * 0.58).toFixed(2)}px, ${(dy * 0.48 - 42).toFixed(2)}px) rotateZ(${(-card.currentRz * 0.32).toFixed(2)}deg) scale(${lerp(startScale, 1, 0.62).toFixed(4)})`,
    `${base} translate(${(dx * 0.16).toFixed(2)}px, ${(dy * 0.13 - 17).toFixed(2)}px) rotateZ(${(card.currentRz * 0.08).toFixed(2)}deg) scale(1.014)`,
    `${base} translate(0px, 0px) rotateZ(0deg) scale(1)`,
  ];
  const duration = REDUCED_MOTION.matches ? 40 : 1080;

  const flightFrames = offsets.map((offset, frameIndex) => ({
    offset,
    transform: transforms[frameIndex],
  }));

  const flight = dom.focusCard.animate(flightFrames, {
    duration,
    easing: "cubic-bezier(0.16, 0.82, 0.2, 1)",
    fill: "forwards",
  });

  const tilt = dom.focusTilt.animate(
    [
      { transform: `rotateX(${card.currentRx.toFixed(2)}deg) rotateY(${card.currentRy.toFixed(2)}deg) rotateZ(${card.currentRz.toFixed(2)}deg)` },
      { transform: `rotateX(${(card.currentRx * 0.35).toFixed(2)}deg) rotateY(${(card.currentRy * 0.2 + 4).toFixed(2)}deg) rotateZ(${(card.currentRz * 0.4).toFixed(2)}deg)`, offset: 0.24 },
      { transform: focusTiltTransform(FOCUS_REST_TILT) },
    ],
    {
      duration: REDUCED_MOTION.matches ? 40 : 1020,
      easing: "cubic-bezier(0.22, 0.82, 0.24, 1)",
      fill: "forwards",
    },
  );

  const animations = [flight, tilt];
  if (card.data.landscape) {
    // One rigid body: the frame and the artwork rotate together. No width or
    // height morph, no counter-rotation of the image inside the frame.
    const spin = dom.focusSpin.animate(
      [
        { offset: 0, transform: "rotateZ(0deg)" },
        { offset: 0.22, transform: "rotateZ(0deg)" },
        { offset: 0.78, transform: "rotateZ(-90deg)" },
        { offset: 1, transform: "rotateZ(-90deg)" },
      ],
      { duration, easing: "cubic-bezier(0.42, 0, 0.2, 1)", fill: "forwards" },
    );
    animations.push(spin);
  }

  state.focusAnimations = animations;

  Promise.all(animations.map((animation) => animation.finished))
    .then(() => {
      if (!state.focusOpen || state.focusIndex !== index || state.focusClosing) return;
      state.focusAnimating = false;
      setFocusTilt(FOCUS_REST_TILT.x, FOCUS_REST_TILT.y, FOCUS_REST_TILT.z);
      dom.focusCard.focus({ preventScroll: true });
    })
    .catch(() => {});
}

function flipPostcard() {
  if (!state.focusOpen || state.focusClosing || state.focusAnimating) return;
  const card = state.cards[state.focusIndex];
  if (!card) return;

  state.focusFlipped = !state.focusFlipped;
  dom.focusRotor.classList.toggle("is-flipped", state.focusFlipped);
  dom.focus.classList.toggle("is-back", state.focusFlipped);
  dom.focusCard.setAttribute("aria-pressed", String(state.focusFlipped));
  dom.focusCard.setAttribute(
    "aria-label",
    `${card.data.title}，明信片${state.focusFlipped ? "背面" : "正面"}，点击翻面`,
  );
  setCursor(true, state.focusFlipped ? "FRONT" : "TURN");
}

function closePostcard(options = {}) {
  if (!state.focusOpen || state.focusClosing) return;
  const card = state.cards[state.focusIndex];
  if (!card) return;

  // Sample the pose and the on-screen box before cancelling anything, so a
  // close that interrupts the opening flight starts where the viewer is.
  const tilt = readFocusTilt();
  const spinCurrent = readFocusSpin();
  const held = { w: dom.focusCard.offsetWidth, h: dom.focusCard.offsetHeight };

  state.focusClosing = true;
  state.focusAnimating = false;

  state.focusAnimations.forEach((animation) => {
    try { animation.cancel(); } catch (error) { /* no-op */ }
  });
  state.focusAnimations = [];

  dom.focusCard.getAnimations().forEach((animation) => animation.cancel());
  dom.focusTilt.getAnimations().forEach((animation) => animation.cancel());
  dom.focusFront.getAnimations().forEach((animation) => animation.cancel());
  dom.focusBack.getAnimations().forEach((animation) => animation.cancel());
  dom.focusSpin.getAnimations().forEach((animation) => animation.cancel());
  dom.focusSpin.style.transform = `rotateZ(${spinCurrent.toFixed(2)}deg)`;

  const portrait = held;
  dom.focusCard.style.transform = "";
  dom.focusCard.style.width = "";
  dom.focusCard.style.height = "";
  dom.focusTilt.style.transform = focusTiltTransform(tilt);
  state.focusTilt = tilt;

  // Give the hidden gallery card the same orientation before measuring its
  // screen rect. The return flight can then keep one unchanged card shape
  // from the enlarged view all the way down to the promenade.
  const hoverScale = 1 + card.hover * 0.025;
  card.card3d.style.transform = `${focusTiltTransform(tilt)} scale(${hoverScale.toFixed(4)})`;
  const sourceRect = card.card3d.getBoundingClientRect();
  const anchorRect = dom.focusCard.getBoundingClientRect();

  const sourceCenterX = sourceRect.left + sourceRect.width / 2;
  const sourceCenterY = sourceRect.top + sourceRect.height / 2;
  const anchorCenterX = anchorRect.left + anchorRect.width / 2;
  const anchorCenterY = anchorRect.top + anchorRect.height / 2;
  const dx = sourceCenterX - anchorCenterX;
  const dy = sourceCenterY - anchorCenterY;
  const endScale = Math.min(
    sourceRect.width / Math.max(1, portrait.w),
    sourceRect.height / Math.max(1, portrait.h),
  );
  const base = "translate(-50%, -50%)";

  dom.focus.classList.add("is-closing");
  document.body.classList.remove("is-holding");

  if (state.focusFlipped) {
    dom.focusRotor.style.transitionDuration = "720ms";
    dom.focusRotor.classList.remove("is-flipped");
    dom.focus.classList.remove("is-back");
    state.focusFlipped = false;
  }

  if (options.instant || REDUCED_MOTION.matches) {
    landPostcard(card, tilt, true);
    return;
  }

  const offsets = [0, 0.24, 0.62, 0.88, 1];
  const transforms = [
    `${base} translate(0px, 0px) scale(1)`,
    `${base} translate(${(dx * 0.14).toFixed(2)}px, ${(dy * 0.1 - 8).toFixed(2)}px) scale(${lerp(1, endScale, 0.14).toFixed(4)})`,
    `${base} translate(${(dx * 0.63).toFixed(2)}px, ${(dy * 0.58 - 7).toFixed(2)}px) scale(${lerp(1, endScale, 0.64).toFixed(4)})`,
    `${base} translate(${(dx * 0.92).toFixed(2)}px, ${(dy * 0.9).toFixed(2)}px) scale(${lerp(1, endScale, 0.93).toFixed(4)})`,
    `${base} translate(${dx.toFixed(2)}px, ${dy.toFixed(2)}px) scale(${endScale.toFixed(4)})`,
  ];
  const duration = 680;

  const flightFrames = offsets.map((offset, frameIndex) => ({
    offset,
    transform: transforms[frameIndex],
  }));

  const flight = dom.focusCard.animate(flightFrames, {
    duration,
    easing: "cubic-bezier(0.4, 0, 0.16, 1)",
    fill: "forwards",
  });

  const animations = [flight];
  if (card.data.landscape) {
    const spin = dom.focusSpin.animate(
      [
        { offset: 0, transform: `rotateZ(${spinCurrent.toFixed(2)}deg)` },
        { offset: 0.2, transform: `rotateZ(${spinCurrent.toFixed(2)}deg)` },
        { offset: 0.82, transform: "rotateZ(0deg)" },
        { offset: 1, transform: "rotateZ(0deg)" },
      ],
      { duration, easing: "cubic-bezier(0.42, 0, 0.2, 1)", fill: "forwards" },
    );
    animations.push(spin);
  }

  state.focusAnimations = animations;
  flight.finished
    .then(() => landPostcard(card, tilt))
    .catch(() => {});
}

function landPostcard(card, tilt, instant = false) {
  if (!state.focusOpen || !state.focusClosing) return;

  if (instant) {
    card.slot.classList.remove("is-lifted");
    finishClose(card);
    return;
  }

  // Hand the same pose to the real gallery card, then dissolve the held copy
  // in place. Both are the same size and orientation at this moment.
  syncCardAnglesToFocus(card, tilt);
  card.slot.classList.remove("is-lifted");

  const fade = dom.focusCard.animate(
    [
      { opacity: 1 },
      { opacity: 0 },
    ],
    { duration: 170, easing: "cubic-bezier(0.4, 0, 0.2, 1)", fill: "forwards" },
  );
  state.focusAnimations = [fade];
  fade.finished
    .then(() => finishClose(card))
    .catch(() => {});
}

function finishClose(card) {
  if (!state.focusOpen) return;

  state.focusAnimations.forEach((animation) => {
    try { animation.cancel(); } catch (error) { /* no-op */ }
  });
  state.focusAnimations = [];
  dom.focusFront.getAnimations().forEach((animation) => animation.cancel());
  dom.focusBack.getAnimations().forEach((animation) => animation.cancel());
  dom.focusSpin.getAnimations().forEach((animation) => animation.cancel());

  dom.focus.style.transition = "none";
  dom.focus.classList.remove("is-visible", "is-closing", "is-back");
  dom.focus.setAttribute("aria-hidden", "true");
  dom.focus.inert = true;
  dom.focusCard.getAnimations().forEach((animation) => animation.cancel());
  dom.focusTilt.getAnimations().forEach((animation) => animation.cancel());
  dom.focusCard.style.transform = "";
  dom.focusTilt.style.transform = "";
  dom.focusSpin.style.transform = "";
  dom.focusRotor.style.transitionDuration = "";
  dom.focusRotor.style.transform = "";
  dom.focusRotor.classList.remove("is-flipped");
  dom.focus.classList.remove("is-back", "is-landscape");
  dom.focusCard.style.width = "";
  dom.focusCard.style.height = "";
  dom.gallery.inert = false;
  card.slot.classList.remove("is-lifted");
  document.documentElement.classList.remove("is-locked");
  document.body.classList.remove("is-holding");
  window.requestAnimationFrame(() => {
    dom.focus.style.transition = "";
  });

  if (Math.abs(window.scrollY - state.scrollRestore) > 2) {
    window.scrollTo(0, state.scrollRestore);
  }

  state.focusOpen = false;
  state.focusIndex = null;
  state.focusClosing = false;
  state.focusAnimating = false;
  state.focusFlipped = false;
  state.focusAnimations = [];
  state.lastCard = null;
  setCursor(false);

  const target = state.lastFocused;
  state.lastFocused = null;
  if (target) target.focus({ preventScroll: true });
}

function initFocus() {
  dom.focus.inert = true;
  dom.focus.setAttribute("aria-hidden", "true");

  dom.focus.addEventListener("click", (event) => {
    if (!state.focusOpen || state.focusClosing) return;
    if (event.target.closest(".focus-card")) return;
    closePostcard();
  });

  dom.focusCard.addEventListener("click", (event) => {
    event.stopPropagation();
    flipPostcard();
  });

  dom.focusCard.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    event.stopPropagation();
    flipPostcard();
  });

  dom.focusCard.addEventListener("pointermove", (event) => {
    if (!state.focusOpen || state.focusClosing || state.focusAnimating || !FINE_POINTER) return;
    const nx = clamp((event.clientX / window.innerWidth) * 2 - 1, -1, 1);
    const ny = clamp((event.clientY / window.innerHeight) * 2 - 1, -1, 1);
    setFocusTilt(0.9 - ny * 3.2, -3.4 + nx * 4.4, 0);
  });

  dom.focusCard.addEventListener("pointerleave", () => {
    if (!state.focusOpen) return;
    setFocusTilt(FOCUS_REST_TILT.x, FOCUS_REST_TILT.y, FOCUS_REST_TILT.z);
  });

  const stopScroll = (event) => event.preventDefault();
  dom.focus.addEventListener("wheel", stopScroll, { passive: false });
  dom.focus.addEventListener("touchmove", stopScroll, { passive: false });

  document.addEventListener("keydown", (event) => {
    if (!state.focusOpen) return;

    if (event.key === "Escape") {
      event.preventDefault();
      closePostcard();
      return;
    }

    if (event.key === "Tab") {
      const items = [dom.focusClose, dom.focusCard];
      const current = items.indexOf(document.activeElement);
      const direction = event.shiftKey ? -1 : 1;
      const next = (current + direction + items.length) % items.length;
      event.preventDefault();
      items[next].focus({ preventScroll: true });
      return;
    }

    if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", "Home", "End", " "].includes(event.key)) {
      if (document.activeElement === dom.focusCard && event.key === " ") return;
      event.preventDefault();
    }
  });
}

let resizeTimer = 0;

function handleResize() {
  window.clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => {
    const activeBefore = state.cards.length ? findActiveIndex(state.camX) : 0;
    const wasInCorridor = state.gate > 0.5;

    // A viewport change re-lays the promenade, but a held postcard stays in
    // hand: it is measured again for the new size and keeps its pose. Only a
    // close that was already in flight still has to be finished.
    if (state.focusOpen) {
      const card = state.cards[state.focusIndex];
      if (card && state.focusClosing) finishClose(card);
      else if (card) holdFocusThroughResize(card);
      else closePostcard({ instant: true });
    }

    rebuildLayout(true);
    updateScrollMetrics();

    if (wasInCorridor && state.cards[activeBefore]) {
      const period = Math.max(1, state.period);
      state.camX = mod(state.cards[activeBefore].home.x, period);
      state.wander = state.camX / period;
      state.loopScene = mod(state.wander, 1);
      state.bgScene = 0.5 - 0.5 * Math.cos(state.loopScene * Math.PI * 2);
      const target = state.corridorFloor + state.camX * state.pxPerWorldX;
      window.scrollTo(0, clamp(target, 0, getScrollMax()));
    } else {
      state.camX = 0;
      state.wander = 0;
      state.loopScene = 0;
      state.bgScene = 0;
      window.scrollTo(0, 0);
    }

    oceanBoxStale = true;
    state.corridorDirty = true;
    if (seaEngine) {
      const rect = oceanRect();
      seaEngine.resize(Math.round(rect.width || window.innerWidth), Math.round(rect.height || window.innerHeight));
    } else if (glOcean) {
      glOcean.resize();
      glOcean.draw(REDUCED_MOTION.matches ? 0 : state.waterTime, state.wander, Weather.state, 0);
    } else if (waterPainter) {
      waterPainter.resize();
      waterPainter.draw(REDUCED_MOTION.matches ? 0 : state.waterTime, state.wander, Weather.state);
    }
    if (window.innerWidth < 680) createParticles();
    setActiveCard(activeBefore, true);
  }, 160);
}

function focusFirstCardWhenReady(attempt = 0) {
  if (state.gate > 0.9 && !state.focusOpen && state.cards[0]) {
    state.cards[0].postcard.focus({ preventScroll: true });
    return;
  }
  if (attempt < 40) window.setTimeout(() => focusFirstCardWhenReady(attempt + 1), 100);
}

/* ── sideways walking ──────────────────────────────────────────────────────
   The promenade is a horizontal thing, so a horizontal gesture should move it.
   A trackpad swipe (a wheel event whose deltaX dominates) or a finger dragged
   across the stage is simply turned into the very same page scroll the
   vertical swipe produces — everything downstream (the cover gate, the ring,
   the camera damping) is untouched, and both ends still wrap. */
function initSidewaysInput() {
  const canWalk = () => !state.focusOpen && !state.focusClosing;

  window.addEventListener(
    "wheel",
    (event) => {
      if (!canWalk()) return;
      const dx = event.deltaX;
      if (!dx || Math.abs(dx) <= Math.abs(event.deltaY) * 1.15) return;
      // Claiming the gesture also stops the browser from reading a two-finger
      // swipe as a history navigation.
      event.preventDefault();
      window.scrollBy(0, dx);
    },
    { passive: false },
  );

  // Touch needs a small amount of discipline: only take over once the drag is
  // clearly sideways, so a vertical or diagonal swipe keeps scrolling the page
  // exactly as before.
  let touchId = null;
  let startX = 0;
  let startY = 0;
  let lastX = 0;
  let claimed = false;
  let suppressClick = false;
  let suppressTimer = 0;

  const release = () => {
    touchId = null;
    claimed = false;
  };

  window.addEventListener(
    "touchstart",
    (event) => {
      release();
      if (!canWalk() || event.touches.length !== 1) return;
      const touch = event.touches[0];
      touchId = touch.identifier;
      startX = touch.clientX;
      startY = touch.clientY;
      lastX = touch.clientX;
    },
    { passive: true },
  );

  window.addEventListener(
    "touchmove",
    (event) => {
      if (touchId === null || !canWalk()) return;
      let touch = null;
      for (let i = 0; i < event.touches.length; i += 1) {
        if (event.touches[i].identifier === touchId) touch = event.touches[i];
      }
      if (!touch) return;

      if (!claimed) {
        const dx = touch.clientX - startX;
        const dy = touch.clientY - startY;
        if (Math.abs(dx) < 12) return;
        if (Math.abs(dx) < Math.abs(dy) * 1.15) {
          release();
          return;
        }
        claimed = true;
      }

      event.preventDefault();
      window.scrollBy(0, -(touch.clientX - lastX));
      lastX = touch.clientX;

      // The drag must not be read as a tap on the card it started on.
      suppressClick = true;
      window.clearTimeout(suppressTimer);
      suppressTimer = window.setTimeout(() => {
        suppressClick = false;
      }, 420);
    },
    { passive: false },
  );

  window.addEventListener("touchend", release, { passive: true });
  window.addEventListener("touchcancel", release, { passive: true });

  window.addEventListener(
    "click",
    (event) => {
      if (!suppressClick) return;
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
    },
    true,
  );
}

function initEvents() {
  initSidewaysInput();
  dom.scrollCue.addEventListener("click", () => {
    if (window.CakeGate && CakeGate.isActive()) CakeGate.cut();
    else openArchive(true);
  });
  dom.shuffleButton.addEventListener("click", randomizeCards);
  dom.skipLink.addEventListener("click", (event) => {
    event.preventDefault();
    openArchive();
    focusFirstCardWhenReady();
  });
  window.addEventListener("resize", handleResize, { passive: true });
  window.addEventListener("orientationchange", handleResize, { passive: true });
}

function animate(now) {
  const cbStart = DIAG.bench ? performance.now() : 0;
  if (!state.lastFrame) state.lastFrame = now;
  const dt = clamp((now - state.lastFrame) / 1000, 0.001, 0.05);
  state.lastFrame = now;

  /* 布还没裂开的时候，观众看到的是那块不透明的亚麻布：长廊、明信片、
     太阳、海面全在布后面。这 1.3 秒（飞刀 + 瞄准）里每帧照算一遍滚动阻尼、
     七张明信片的变换和整个 WebGPU 海面，是在给看不见的像素付账 —— 而它恰好
     是整段开屏里最该稳的一段。布一让开（isSealed 变假）立刻恢复，一帧不差：
     openArchive 瞬移那次会先把 corridorDirty 立起来，保证处理到位再停。 */
  const sealed = state.coverLocked && !state.cakeCutting &&
    (!window.CakeGate || CakeGate.isSealed());
  const parkCorridor = sealed && !DIAG.noparkcorr;
  const corridorLive = !parkCorridor || state.corridorDirty === true;
  if (corridorLive) {
    state.corridorDirty = false;
    updateScrollState(dt);
  }
  if (window.CakeGate) CakeGate.update(dt, state.gate);
  if (corridorLive) applyCardTransforms(now, dt);
  updateCursor(dt);
  if (window.Weather) Weather.update(dt, now);

  // Hold the sea and the cards still while a postcard is in hand.
  // Keeping a single accumulated clock avoids a phase jump when it resumes.
  //
  // 海面这边一分钱都不省：把画布停掉能让合成器把那几层全屏的布纹一起丢进
  // 睡眠，等布裂开再一起醒，头几帧要重算整张表面 —— 实测卡在缝张开那一刻，
  // 480ms 一帧，连着两三帧。相比之下停掉海面省下的那点根本不够赔。
  // （对照实验：海面照画时 cut 段 avg 30.6ms，把海面按 5fps 热着是 37.9ms，
  // 全停是 48–54ms 并且带 480–630ms 的尖峰。）
  if (seaEngine) {
    if (!REDUCED_MOTION.matches) state.waterTime += dt;
    const seaInterval = quality.waterFps > 0 ? 1 / quality.waterFps : 0;
    if (seaInterval === 0 || state.waterTime - state.lastWaterDraw >= seaInterval) {
      state.lastWaterDraw = state.waterTime;
      applySeaFrame();
      seaEngine.render();
    }
  } else {
    const sea = glOcean || waterPainter;
    if (sea) {
      if (!REDUCED_MOTION.matches) state.waterTime += dt;
      const waterInterval = quality.waterFps > 0 ? 1 / quality.waterFps : 0;
      if (waterInterval === 0 || state.waterTime - state.lastWaterDraw >= waterInterval) {
        state.lastWaterDraw = state.waterTime;
        if (glOcean) glOcean.draw(state.waterTime, state.wander, Weather.state, dt);
        else waterPainter.draw(state.waterTime, state.wander, Weather.state);
      }
    }
  }

  updateQualityProbe(now);

  if (DIAG.bench) PERF_MAIN.record(now, performance.now() - cbStart);
  window.requestAnimationFrame(animate);
}

/* ── immersive mode ────────────────────────────────────────────────────────
   Cinema lighting for the promenade. Every piece of interface chrome steps
   aside — header, weather panel, rails, hints, the custom cursor — and only
   the postcards, their words and the sea remain. `F` toggles, `Esc` leaves,
   and the exit pill surfaces again on any pointer movement. */
const IMMERSIVE_STORAGE_KEY = "tideline.immersive.v1";

function readImmersivePreference() {
  try {
    const store = window.localStorage;
    return store ? store.getItem(IMMERSIVE_STORAGE_KEY) === "1" : false;
  } catch (err) {
    return false;
  }
}

function writeImmersivePreference(on) {
  try {
    const store = window.localStorage;
    if (store) store.setItem(IMMERSIVE_STORAGE_KEY, on ? "1" : "0");
  } catch (err) {
    /* Private mode or file:// without storage: the mode still works, it just
       will not be remembered. */
  }
}

function wakeImmersiveUI() {
  if (!state.immersive || !dom.immersiveUI) return;
  dom.immersiveUI.classList.add("is-awake");
  window.clearTimeout(state.immersiveIdleTimer);
  state.immersiveIdleTimer = window.setTimeout(() => {
    if (dom.immersiveUI) dom.immersiveUI.classList.remove("is-awake");
  }, 2600);
}

function requestImmersiveFullscreen() {
  const el = document.documentElement;
  if (!el || !el.requestFullscreen || document.fullscreenElement) return;
  try {
    const pending = el.requestFullscreen({ navigationUI: "hide" });
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch (err) {
    /* Browsers that refuse (older Safari, some file:// hosts) simply keep the
       CSS-only theatre — the scene is identical either way. */
  }
}

function exitImmersiveFullscreen() {
  if (!document.fullscreenElement || !document.exitFullscreen) return;
  try {
    const pending = document.exitFullscreen();
    if (pending && typeof pending.catch === "function") pending.catch(() => {});
  } catch (err) {
    /* nothing to unwind */
  }
}

function setImmersive(on, options = {}) {
  const next = Boolean(on);
  const changed = next !== state.immersive;
  state.immersive = next;
  document.body.classList.toggle("is-immersive", next);

  if (dom.immersiveUI) dom.immersiveUI.classList.toggle("is-awake", next);
  if (dom.immersiveToggle) {
    dom.immersiveToggle.setAttribute("aria-pressed", String(next));
    dom.immersiveToggle.classList.toggle("is-on", next);
  }
  if (dom.immersiveLabel) dom.immersiveLabel.textContent = next ? "EXIT" : "IMMERSIVE";

  if (next) {
    if (dom.immersiveExit) dom.immersiveExit.focus({ preventScroll: true });
    if (options.fullscreen !== false) requestImmersiveFullscreen();
    wakeImmersiveUI();
  } else {
    exitImmersiveFullscreen();
    state.immersiveFullscreen = false;
    window.clearTimeout(state.immersiveIdleTimer);
    state.immersiveIdleTimer = 0;
    if (dom.immersiveToggle && document.activeElement === dom.immersiveExit) {
      dom.immersiveToggle.focus({ preventScroll: true });
    }
  }
  if (options.persist !== false) writeImmersivePreference(next);
}

function initImmersive() {
  if (dom.immersiveToggle) {
    dom.immersiveToggle.addEventListener("click", () => setImmersive(!state.immersive));
  }
  if (dom.immersiveExit) {
    dom.immersiveExit.addEventListener("click", () => setImmersive(false));
  }

  window.addEventListener("pointermove", wakeImmersiveUI, { passive: true });
  window.addEventListener("pointerdown", wakeImmersiveUI, { passive: true });

  window.addEventListener("keydown", (event) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    if (event.key === "f" || event.key === "F") {
      event.preventDefault();
      setImmersive(!state.immersive);
      return;
    }
    if (event.key === "Escape" && state.immersive && !state.focusOpen) {
      event.preventDefault();
      setImmersive(false);
    }
  });

  // Leaving browser fullscreen (Esc, or the browser's own exit) also leaves
  // the immersive pass, so the two always stay in step.
  document.addEventListener("fullscreenchange", () => {
    if (document.fullscreenElement) {
      state.immersiveFullscreen = true;
      return;
    }
    if (state.immersive && state.immersiveFullscreen) {
      state.immersiveFullscreen = false;
      setImmersive(false);
    }
  });

  if (readImmersivePreference()) setImmersive(true, { fullscreen: false, persist: false });
}

function init() {
  if (DIAG.nocardfx) {
    document.body.classList.add("is-nocardfx");
    /* 诊断样式随开关注入，不常驻 styles.css，避免诊断代码污染正式样式。 */
    const diagStyle = document.createElement("style");
    diagStyle.textContent = "body.is-nocardfx .card-halo, body.is-nocardfx .card-water-shadow { filter: none !important; }";
    document.head.appendChild(diagStyle);
  }
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";
  window.scrollTo(0, 0);

  preloadImages();
  buildCards();
  updateScrollMetrics();
  rebuildLayout(true);
  state.camX = 0;
  state.wander = 0;
  state.loopScene = 0;
  state.bgScene = 0;
  state.coverLocked = false;   // 幕布层接管后由 CakeGate 置 true
  state.cakeCutting = false;
  initCursor();
  initFocus();
  initEvents();
  initImmersive();
  createParticles();

  if (window.matchMedia("(pointer: coarse)").matches) {
    dom.scrollCue.querySelector(".cue-copy small").textContent = "向上滑动 · 切一刀";
  }

  startSea();
  initQuality();
  if (window.Weather) Weather.init({ quality: quality, reducedMotion: REDUCED_MOTION });
  setActiveCard(0, true);

  if (window.CakeGate) {
    CakeGate.init({
      openArchive: openArchive,
      reducedMotion: REDUCED_MOTION,
      setCoverLocked: (locked) => { state.coverLocked = locked === true; },
      setCutting: (cutting) => { state.cakeCutting = cutting === true; },
    });
  }

  state.initialized = true;
  window.requestAnimationFrame(animate);
}

init();
