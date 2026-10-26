/* ==========================================================================
   audio.js — TIDELINE 的声音系统

   声音只有三种：海浪、海风、（偶尔的）海鸥，加上开屏那一刀的全套拟音和一首
   宁静的背景音乐。没有雨、没有雷、没有别的。

   为什么要自己合成，而不是放几个 wav 进来
   -------------------------------------------------------------------------
   站点是 `file://` 双击打开、无构建、无 CDN 的静态站（见 SITE-RULES.md）。
   本地文件**读不到字节**：fetch / XHR 一律失败，`<audio>` 能放却不能接进
   WebAudio（file:// 的 origin 是 null，媒体被当成跨域，接进来就是静音）。
   所以：
     · 环境声（浪 / 风）与拟音（刀 / 撕布 / 吹烛）→ 在 JS 里合成 Float32 采样，
       再交给 WebAudio 播。无限、无缝、而且能跟着 Weather.state 的
       seaState / wind / gust 实时变。
     · 海鸥 → 短样本，base64 内嵌在 js/audio-assets.js（可选文件）。
       找不到就退回合成（听感差一些，但站点不残）。
     · 背景音乐 → 用户自己放进去的 mp3，用 `<audio>` 元素播，只能用 volume
       做 ducking（原因同上）。

   烘焙成本
   -------------------------------------------------------------------------
   合成噪声比想象中贵（几百万次随机 + 二阶滤波）。它**绝不能落在首帧**：
   开屏那 1–2 秒已经要付加载屏和 WebGPU 管线的账了（见 app.js 的
   initBootScreen）。所以烘焙走 setTimeout 分片，每片 ~7ms，藏在加载屏和
   封面阅读期里。用户第一次点蛋糕时，通常已经烘完了。

   接口
   -------------------------------------------------------------------------
     TideAudio.init({...})             app.js 启动时调一次
     TideAudio.update(dt, env, app)    每帧（env = Weather.state）
     TideAudio.cue(name, detail)       cakegate.js 的动作点（刀 / 切 / 开）
     TideAudio.setMuted(b) / toggleMute() / isMuted()
     TideAudio.debugState()            给验证脚本读
     TideAudio.renderPreview(spec)     离线渲染一段 WAV（base64），用来听
   ========================================================================== */
(function () {
  "use strict";

  if (typeof window === "undefined" && typeof globalThis === "undefined") return;

  var VERSION = "1.1.0";

  /* 32kHz：环境噪声没有 16kHz 以上的内容，拟音的高频也够用；
     比 44.1k 省 27% 的烘焙时间和内存。 */
  var BAKE_RATE = 32000;

  var LEVEL = {
    sea: 0.9,        // 海的总线
    wind: 1.0,
    gull: 1.0,
    foley: 0.95,     // 拟音总线（开屏那一刀）
    music: 0.30,     // 音乐基量：C418 那种安静的曲子，0.3 是「垫在下面」
    musicGallery: 0.24,
    /* 混响：海边不是一个房间，是一条开阔的岸线 —— IR 用程序化生成的
       2.6s 扩散 + 稀疏早期反射，湿声只补「空间」不糊直接声 */
    revBed: 0.10,
    revWind: 0.08,
    revSwell: 0.20,
    revSwellFar: 0.46,   // 远处的浪：直达声小、混响大，这才是距离感
    revGull: 0.34,
  };
  /* 音乐：站点自带的曲子是用户本地放的（不入库）。先按 README 约定的
     music.* 找，找不到再认用户实际放下的文件名 —— 两种都不必改名。 */
  /* 用户放下的成品曲：两个格式各一份，谁先能解用谁。
     后面几个通用名是留给「以后想换曲子直接改名覆盖」的退路。 */
  var MUSIC_SRC = [
    "assets/audio/music/1-05. Minecraft.mp3",
    "assets/audio/music/1-05. Minecraft.ogg",
    "assets/audio/music/music.m4a",
    "assets/audio/music/music.ogg",
    "assets/audio/music/music.mp3",
  ];

  var STORE_MUTE = "tideline.audio.muted.v1";

  /* ------------------------------------------------------------------ *
   * 小工具
   * ------------------------------------------------------------------ */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function damp(cur, target, lambda, dt) { return cur + (target - cur) * (1 - Math.exp(-lambda * dt)); }
  function smoothstep(a, b, x) {
    var t = clamp((x - a) / (b - a || 1e-6), 0, 1);
    return t * t * (3 - 2 * t);
  }
  function lerp(a, b, t) { return a + (b - a) * t; }

  function mulberry32(a) {
    return function () {
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ------------------------------------------------------------------ *
   * 噪声源
   * ------------------------------------------------------------------ */
  function whiteNoise(n, rnd) {
    var o = new Float32Array(n);
    for (var i = 0; i < n; i++) o[i] = rnd() * 2 - 1;
    return o;
  }

  /* Paul Kellet 的粉噪：环境声的底子。白噪听着像砂纸，粉噪像空气。 */
  function pinkNoise(n, rnd) {
    var o = new Float32Array(n);
    var b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (var i = 0; i < n; i++) {
      var w = rnd() * 2 - 1;
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      o[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    }
    return o;
  }

  /* 褐噪：极低频的「深水」体感，海浪的胸口那一下。 */
  function brownNoise(n, rnd) {
    var o = new Float32Array(n);
    var last = 0;
    for (var i = 0; i < n; i++) {
      last = (last + 0.02 * (rnd() * 2 - 1)) / 1.02;
      o[i] = last * 3.5;
    }
    return o;
  }

  /* ------------------------------------------------------------------ *
   * RBJ 二阶滤波器（常系数 / 逐块扫频两种）
   * ------------------------------------------------------------------ */
  function coeffs(type, f0, q, rate) {
    var w0 = 2 * Math.PI * clamp(f0, 10, rate * 0.47) / rate;
    var cw = Math.cos(w0), sw = Math.sin(w0);
    var alpha = sw / (2 * Math.max(0.05, q));
    var b0, b1, b2, a0, a1, a2;
    if (type === "lowpass") {
      b0 = (1 - cw) * 0.5; b1 = 1 - cw; b2 = (1 - cw) * 0.5;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else if (type === "highpass") {
      b0 = (1 + cw) * 0.5; b1 = -(1 + cw); b2 = (1 + cw) * 0.5;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    } else { // bandpass（0dB 峰值）
      b0 = alpha; b1 = 0; b2 = -alpha;
      a0 = 1 + alpha; a1 = -2 * cw; a2 = 1 - alpha;
    }
    return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
  }

  function runFilter(buf, co) {
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var i = 0, n = buf.length; i < n; i++) {
      var x = buf[i];
      var y = co.b0 * x + co.b1 * x1 + co.b2 * x2 - co.a1 * y1 - co.a2 * y2;
      x2 = x1; x1 = x; y2 = y1; y1 = y;
      buf[i] = y;
    }
    return buf;
  }

  /* fFn(t) → 频率；每 96 点换一次系数，够细，够快。 */
  function sweepFilter(buf, rate, type, fFn, q, blockSize) {
    var bs = blockSize || 96;
    var x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    for (var start = 0; start < buf.length; start += bs) {
      var co = coeffs(type, fFn(start / rate), q, rate);
      var end = Math.min(start + bs, buf.length);
      for (var i = start; i < end; i++) {
        var x = buf[i];
        var y = co.b0 * x + co.b1 * x1 + co.b2 * x2 - co.a1 * y1 - co.a2 * y2;
        x2 = x1; x1 = x; y2 = y1; y1 = y;
        buf[i] = y;
      }
    }
    return buf;
  }

  /* ------------------------------------------------------------------ *
   * buffer 收尾：去直流、归一、边缘淡化（防止循环接缝爆音）
   * ------------------------------------------------------------------ */
  function normalize(chans, peak, keepRatio) {
    var max = 0;
    for (var c = 0; c < chans.length; c++) {
      var a = chans[c];
      for (var i = 0; i < a.length; i++) { var v = a[i] < 0 ? -a[i] : a[i]; if (v > max) max = v; }
    }
    if (max < 1e-9) return chans;
    var g = (peak || 1) / max;
    for (var c2 = 0; c2 < chans.length; c2++) {
      var b = chans[c2];
      for (var j = 0; j < b.length; j++) b[j] *= g;
    }
    return chans;
  }

  function removeDC(buf) {
    var sum = 0;
    for (var i = 0; i < buf.length; i++) sum += buf[i];
    var mean = sum / (buf.length || 1);
    for (var j = 0; j < buf.length; j++) buf[j] -= mean;
    return buf;
  }

  function fadeEdges(buf, rate, ms) {
    var n = Math.max(1, Math.round((ms || 6) * rate / 1000));
    if (n * 2 >= buf.length) n = Math.floor(buf.length / 4);
    for (var i = 0; i < n; i++) {
      var w = i / n;
      buf[i] *= w;
      buf[buf.length - 1 - i] *= w;
    }
    return buf;
  }

  /* 一次性拟音只能用这个：**只淡尾巴**。
     开头的瞬态（入刀那一下、吹烛那口气）正是这几层存在的理由，
     用 fadeEdges 把它抹掉就白做了 —— 实测 slice 的峰值会被 5ms 淡入削到 0.21。 */
  function fadeTail(buf, rate, ms) {
    var n = Math.max(1, Math.round((ms || 10) * rate / 1000));
    if (n >= buf.length) n = Math.floor(buf.length / 3);
    for (var i = 0; i < n; i++) buf[buf.length - 1 - i] *= i / n;
    return buf;
  }

  /* 开头垫几毫秒静音：瞬态落在 0 号样本上的话，任何淡入都会削它 */
  function padHead(buf, rate, ms) {
    var n = Math.max(1, Math.round((ms || 6) * rate / 1000));
    var out = new Float32Array(buf.length + n);
    out.set(buf, n);
    return out;
  }

  /* 包络表：每 block 个样本算一次，中间线性插值。
     逐样本 Math.pow / Math.sin 是烘焙的头号开销 —— 这些循环一次只跑一遍，
     进不了 TurboFan，实测 2.2s 里大半花在这里。 */
  function envTable(n, block, fn) {
    var cells = Math.ceil(n / block) + 2;
    var tbl = new Float32Array(cells);
    for (var i = 0; i < cells; i++) tbl[i] = fn(Math.min(1, (i * block) / n));
    var out = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      var f = j / block, idx = f | 0, fr = f - idx;
      out[j] = tbl[idx] + (tbl[idx + 1] - tbl[idx]) * fr;
    }
    return out;
  }

  /* 把 len+xf 的生成序列折成 len 的无缝循环：开头 xf 段用尾巴盖过去。 */
  function loopify(gen, lenSamples, xfSamples) {
    var out = new Float32Array(lenSamples);
    for (var i = 0; i < lenSamples; i++) {
      if (i < xfSamples) {
        var w = i / xfSamples;
        out[i] = gen[i] * w + gen[lenSamples + i] * (1 - w);
      } else {
        out[i] = gen[i];
      }
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 海浪底噪
   *   远处连着线的海：低频涌（60–200Hz）+ 中频「沙」（400–1500Hz）+ 一点
   *   高频「毛边」（2k 左右的空气感）。循环 6s，交叉淡化 0.7s。
   * ------------------------------------------------------------------ */
  function bakeBed(rate) {
    /* 13.7s，且不是整数秒 —— 4.5s 的旧循环被整段包络自相关一眼抓到
       （实测 ambient 60s：period 4.50s / strength 0.44），听久了就是「这段背景
       在转圈」。循环一长，同一段 60s 里只装 4 个周期，自相关就压下去了。 */
    var LEN = 13.7, XF = 1.1;
    var L = Math.round(LEN * rate);
    var X = Math.round(XF * rate);
    var n = L + X;
    var chans = [];
    for (var c = 0; c < 2; c++) {
      var rnd = mulberry32(0x51ee + c * 7919);
      /* 一个粉噪源，复制两份用不同滤波拉开频段：比生成三个独立噪声省一半时间，
         而环境噪声里「同一源的两个频段」本来就高度相关，听不出区别。 */
      var src = pinkNoise(n, rnd);
      var low = src.slice();
      runFilter(low, coeffs("lowpass", 240, 0.55, rate));
      var mid = src.slice();
      runFilter(mid, coeffs("highpass", 220, 0.5, rate));
      runFilter(mid, coeffs("lowpass", 1500, 0.5, rate));
      var sub = brownNoise(n, mulberry32(0x77 + c * 31));
      runFilter(sub, coeffs("lowpass", 120, 0.7, rate));
      removeDC(sub);
      /* 慢起伏只用中频：3/5/8 个周期叠在同一个循环长度上（周期 4.6/2.7/1.7s），
         接缝严格对齐、彼此不同步。低频与超低频保持恒定 —— 真正的一涨一落交给
         浪自己（每次都是新排程的），循环层别再自己「呼吸」，那才是最容易被听出
         重复的地方。 */
      var ph = c * 1.7;
      /* 逐样本算 3 条正弦：14.8s 的 buffer 上光 sin 就要 2.8M 次，Node 里烘一轮
         直接从 1.5s 涨到 4.6s。慢包络不需要那么细的网格，按 48 采样一格插值足够
         （周期 1.7s 的最细一条也有 1100 格）。 */
      var beat = envTable(n, 48, function (u) {
        var w = (u * n / L) * Math.PI * 2;
        return 0.90 + 0.07 * Math.sin(w * 3 + ph) + 0.02 * Math.sin(w * 5 + 1.9) + 0.01 * Math.sin(w * 8 + 4.1);
      });
      var mix = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        mix[i] = low[i] * 0.85 + mid[i] * 0.61 * beat[i] + sub[i] * 1.25;
      }
      chans.push(removeDC(loopify(mix, L, X)));
    }
    normalize(chans, 0.72);
    return { name: "bed", rate: rate, chans: chans };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 海风
   *   带通 400–900Hz 的宽频嘶声 + 极慢的呼吸起伏；高频留一点（1.5k 以上
   *   只在阵风里出现，靠实时滤波提上来）。
   * ------------------------------------------------------------------ */
  function bakeWind(rate) {
    /* 9.7s：和 bed 一样避开整数秒与浪的周期，循环感更弱 */
    var LEN = 9.7, XF = 0.8;
    var L = Math.round(LEN * rate);
    var X = Math.round(XF * rate);
    var n = L + X;
    var chans = [];
    for (var c = 0; c < 2; c++) {
      var rnd = mulberry32(0x2f1d + c * 4099);
      var raw = pinkNoise(n, rnd);
      var body = raw.slice();
      runFilter(body, coeffs("bandpass", 620, 0.62, rate));
      var hiss = raw.slice();
      runFilter(hiss, coeffs("highpass", 1800, 0.6, rate));
      /* 三条以「循环长度」为周期的正弦叠出来的慢起伏 —— 不用 random walk，
         因为循环 buffer 里的 random walk 一定会在接缝处断层。周期要按 L 算
         （早先按 t 直接乘 0.63/1.37，接缝处包络根本对不上）。 */
      var wander = envTable(n, 512, function (u) {
        var w = (u * n / L) * Math.PI * 2;
        return 0.62 + 0.18 * Math.sin(w * 2 + c * 2.1) +
          0.08 * Math.sin(w * 5 + 1.3) + 0.04 * Math.sin(w * 9 + c);
      });
      var mix = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        /* 嘶声只留一点点：多给「风」听着像吹风机 —— 实测 0.16 时质心 3.3kHz */
        mix[i] = (body[i] * 0.95 + hiss[i] * 0.055) * wander[i];
      }
      chans.push(loopify(mix, L, X));
    }
    /* 归一化到 0.82 而不是 0.6：慢起伏改平之后 RMS 从 0.137 掉到 0.098（约 3dB），
       在同一条 windGain 曲线上听着就是「风声变小了」。buffer 峰值抬高补回来，
       混音里再没有别处需要改。 */
    normalize(chans, 0.82);
    return { name: "wind", rate: rate, chans: chans };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 一阵涌到岸上的浪（一次性）
   *   包络：前 15% 快速抬起 → 保持 → 尾部慢慢收；频率随包络上抬再落回，
   *   所以在岸上「啪」的那一下最亮。四支变体，播的时候随机挑。
   * ------------------------------------------------------------------ */
  function bakeSurf(rate, seed, cfg) {
    var dur = cfg.dur;
    var n = Math.round(dur * rate);
    var rnd = mulberry32(seed);
    var raw = pinkNoise(n, rnd);
    var body = raw.slice();
    var peakAt = cfg.peakAt;      // 0..1
    var bright = cfg.bright;      // 峰值时的带通中心
    var dark = cfg.dark;          // 起 / 收时的带通中心
    sweepFilter(body, rate, "bandpass", function (t) {
      var u = t / dur;
      /* 先升后落：u<peakAt 从 dark 升到 bright，之后回到 dark*0.8 */
      if (u < peakAt) return lerp(dark, bright, smoothstep(0, peakAt, u));
      var v = (u - peakAt) / Math.max(0.001, 1 - peakAt);
      return lerp(bright, dark * 0.8, Math.pow(v, 0.8));
    }, cfg.q || 0.85, 192);
    var foam = raw.slice();
    sweepFilter(foam, rate, "highpass", function (t) {
      return lerp(2400, 4600, smoothstep(0, peakAt, t / dur));
    }, 0.7, 192);
    var sub = brownNoise(n, mulberry32(seed ^ 0x1111));
    runFilter(sub, coeffs("lowpass", 115, 0.8, rate));
    var attackPow = cfg.attackPow || 1.6, tailPow = cfg.tailPow || 2.2;
    var env = envTable(n, 96, function (u) {
      if (u < peakAt) return Math.pow(smoothstep(0, peakAt, u), attackPow);
      var v = (u - peakAt) / Math.max(0.001, 1 - peakAt);
      return Math.pow(1 - v, tailPow);
    });
    /* 浪的尾巴里高频先没：泡沫过去之后只剩低频的「呼」 */
    var foamEnv = envTable(n, 96, function (u) {
      if (u < peakAt) return Math.pow(smoothstep(0, peakAt * 0.85, u), 2);
      return Math.pow(1 - Math.min(1, ((u - peakAt) / (1 - peakAt)) * 1.7), 1.6);
    });
    var subEnv = envTable(n, 96, function (u) {
      if (u < peakAt) return Math.pow(smoothstep(0, peakAt, u), 2.2);
      return Math.pow(1 - Math.min(1, ((u - peakAt) / (1 - peakAt)) * 1.15), 2.6);
    });
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      out[i] = body[i] * env[i] + foam[i] * foamEnv[i] * (cfg.foam || 0.24) + sub[i] * subEnv[i] * (cfg.sub || 1.3);
    }
    removeDC(out);
    normalize([out], cfg.peak || 0.82);
    fadeEdges(out, rate, 12);
    return { name: "surf", rate: rate, chans: [out], tag: cfg.tag || "mid", bright: cfg.bright, dur: dur };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 混响脉冲响应（IR）
   *   程序化生成：指数衰减的立体声噪声 + 一串稀疏早期反射。
   *   湿声只要「开阔」不要「浴室」：衰减 2.6s、6k 以上先滤掉，
   *   早期反射按 0.011–0.058s 摆在前面，耳朵靠它判断「岸有多远」。
   * ------------------------------------------------------------------ */
  function bakeReverbIR(rate) {
    var LEN = 2.6;
    var n = Math.round(LEN * rate);
    var chans = [];
    var early = [0.011, 0.017, 0.023, 0.031, 0.044, 0.058, 0.077];
    for (var c = 0; c < 2; c++) {
      var rnd = mulberry32(0x6a11 + c * 3301);
      var ch = new Float32Array(n);
      for (var i = 0; i < n; i++) {
        var u = i / n;
        /* 双指数：先按扩散场掉，尾巴再慢一点 —— 只有一条曲线会像「关门」 */
        var env = Math.pow(1 - u, 2.2) * (0.55 + 0.45 * Math.exp(-u * 2.4));
        ch[i] = (rnd() * 2 - 1) * env;
      }
      runFilter(ch, coeffs("lowpass", 5200, 0.6, rate));
      runFilter(ch, coeffs("highpass", 170, 0.6, rate));
      /* 早期反射：左右错开一点，稀疏、带符号 —— 纯噪声扩散没有方向感 */
      for (var k = 0; k < early.length; k++) {
        var idx = Math.round(early[k] * rate * (1 + c * 0.11) + c * 37);
        if (idx > 0 && idx < n) ch[idx] += (c ? -1 : 1) * Math.pow(0.84, k) * (0.7 - k * 0.06);
      }
      removeDC(ch);
      chans.push(ch);
    }
    normalize(chans, 0.5);
    return { name: "reverb", rate: rate, chans: chans };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 退水（backwash）
   *   浪碎了之后水从沙上退回去：一条往下滑的带通噪声，很轻、尾巴长。
   *   没有这一层，浪会「来了就不走」，听着像循环音效而不是海。
   * ------------------------------------------------------------------ */
  function bakeWash(rate, seed, cfg) {
    var dur = cfg.dur;
    var n = Math.round(dur * rate);
    var rnd = mulberry32(seed);
    var raw = pinkNoise(n, rnd);
    var body = raw.slice();
    sweepFilter(body, rate, "bandpass", function (t) {
      var u = t / dur;
      return lerp(cfg.hi, cfg.lo, Math.pow(u, 0.7)) * (1 + 0.06 * Math.sin(t * 3.1));
    }, cfg.q || 0.9, 192);
    var sub = raw.slice();
    runFilter(sub, coeffs("lowpass", 240, 0.7, rate));
    var env = envTable(n, 96, function (u) {
      /* 起得比浪慢、收得比浪长：水是「慢慢退」的 */
      return Math.pow(smoothstep(0, 0.18, u), 1.2) * Math.pow(1 - u, 1.5);
    });
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) out[i] = body[i] * env[i] + sub[i] * env[i] * (cfg.sub || 0.5);
    removeDC(out);
    normalize([out], cfg.peak || 0.4);
    fadeEdges(out, rate, 20);
    return { name: "wash", rate: rate, chans: [out] };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙 · 拟音
   * ------------------------------------------------------------------ */

  /* 刀从画面外飞进来：空气被划开的声音。质心 300 → 2200 → 500。 */
  function bakeWhoosh(rate) {
    var dur = 0.95, n = Math.round(dur * rate);
    var rnd = mulberry32(0x9a1c);
    var air = pinkNoise(n, rnd);
    var buf = air.slice();
    sweepFilter(buf, rate, "bandpass", function (t) {
      var u = t / dur;
      if (u < 0.45) return lerp(320, 2200, Math.pow(u / 0.45, 1.5));
      var v = (u - 0.45) / 0.55;
      return lerp(2200, 480, Math.pow(v, 1.2));
    }, 1.15);
    var shing = pinkNoise(n, mulberry32(0x3311));
    runFilter(shing, coeffs("highpass", 3400, 0.8, rate));
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var u = i / n;
      var env = Math.pow(smoothstep(0, 0.34, u), 1.4) * Math.pow(1 - u, 1.7);
      var sh = Math.pow(smoothstep(0.1, 0.42, u), 2) * Math.pow(1 - u, 2.4);
      out[i] = buf[i] * env + shing[i] * sh * 0.22;
    }
    removeDC(out);
    normalize([out], 0.8);
    fadeEdges(out, rate, 8);
    return { name: "whoosh", rate: rate, chans: [out] };
  }

  /* 刀真的划过布：砂砾感的刮擦，颗粒密度 ~95Hz。 */
  function bakeSlice(rate) {
    var dur = 0.62, n = Math.round(dur * rate);
    var rnd = mulberry32(0x4711);
    var noise = pinkNoise(n, rnd);
    sweepFilter(noise, rate, "bandpass", function (t) {
      return lerp(2200, 3100, smoothstep(0, dur, t));
    }, 1.5);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / rate;
      var u = t / dur;
      /* 两路互质频率的 |sin| 相乘 = 不规则的颗粒，比单一 AM 更像布 */
      var g = Math.abs(Math.sin(Math.PI * 2 * 93 * t + 0.7)) *
        Math.abs(Math.sin(Math.PI * 2 * 131 * t + 1.9));
      g = 0.35 + 0.65 * g;
      var env = Math.pow(smoothstep(0, 0.07, u), 1.2) * Math.pow(1 - u, 0.85);
      out[i] = noise[i] * g * env;
    }
    /* 入刀那一下的瞬态：3ms 的高频爆点 */
    var tr = Math.min(n, Math.round(0.006 * rate));
    for (var k = 0; k < tr; k++) out[k] += (Math.random() * 2 - 1) * Math.pow(1 - k / tr, 2) * 0.5;
    removeDC(out);
    normalize([out], 0.78);
    var ss = padHead(out, rate, 4);
    fadeTail(ss, rate, 12);
    return { name: "slice", rate: rate, chans: [ss] };
  }

  /* 布被撕开：密集的纤维断裂颗粒 + 底下的低频拉扯。1.9s。 */
  function bakeTear(rate) {
    var dur = 1.9, n = Math.round(dur * rate);
    var rnd = mulberry32(0xbeef);
    var base = pinkNoise(n, rnd);
    sweepFilter(base, rate, "bandpass", function (t) {
      var u = t / dur;
      return 1500 + 900 * Math.sin(Math.PI * clamp(u, 0, 1));
    }, 1.1);
    /* 颗粒门：随机撒 ~120 个衰减脉冲，中段最密 */
    var gate = new Float32Array(n);
    var count = Math.round(dur * 78);
    for (var k = 0; k < count; k++) {
      var pos = Math.pow(rnd(), 0.72) * (n - 1);
      var amp = 0.25 + rnd() * 0.75;
      var decayN = Math.round((0.004 + rnd() * 0.01) * rate);
      var at = pos | 0;
      for (var j = 0; j < decayN && at + j < n; j++) {
        gate[at + j] += amp * Math.exp(-j / (decayN * 0.35));
      }
    }
    /* 轻微平滑，别让颗粒变成咔哒 */
    var gate2 = new Float32Array(n);
    var sm = 3;
    for (var i = 0; i < n; i++) {
      var s = 0, c = 0;
      for (var d = -sm; d <= sm; d++) {
        var idx = i + d;
        if (idx >= 0 && idx < n) { s += gate[idx]; c++; }
      }
      gate2[i] = s / (c || 1);
    }
    var low = brownNoise(n, mulberry32(0x1234));
    runFilter(low, coeffs("lowpass", 95, 0.8, rate));
    var out = new Float32Array(n);
    for (var i2 = 0; i2 < n; i2++) {
      var u2 = i2 / n;
      var env = smoothstep(0, 0.06, u2) * Math.pow(1 - u2, 0.55);
      var lowEnv = Math.pow(smoothstep(0.05, 0.45, u2), 2) * Math.pow(1 - u2, 1.6);
      out[i2] = base[i2] * gate2[i2] * env * 2.6 + low[i2] * lowEnv * 0.55;
    }
    removeDC(out);
    normalize([out], 0.85);
    fadeEdges(out, rate, 10);
    return { name: "tear", rate: rate, chans: [out] };
  }

  /* 刀风把十九支蜡烛吹灭：一口气，高频先糊掉，尾巴带一点火苗的抖动。 */
  function bakePuff(rate) {
    var dur = 0.62, n = Math.round(dur * rate);
    var rnd = mulberry32(0x60d0);
    var noise = pinkNoise(n, rnd);
    var buf = noise.slice();
    sweepFilter(buf, rate, "lowpass", function (t) {
      var u = t / dur;
      return lerp(2600, 210, Math.pow(u, 0.55));
    }, 0.85);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var t = i / rate;
      var env = Math.pow(smoothstep(0, 0.018, t), 1.1) * Math.exp(-t * 7.5);
      var flutter = 0.82 + 0.18 * Math.sin(Math.PI * 2 * 11.5 * t);
      out[i] = buf[i] * env * flutter;
    }
    removeDC(out);
    normalize([out], 0.82);
    var pp = padHead(out, rate, 3);
    fadeTail(pp, rate, 14);
    return { name: "puff", rate: rate, chans: [pp] };
  }

  /* 刀落下去那一下的闷响（布 + 蛋糕被压到）。 */
  function bakeThump(rate) {
    var dur = 0.34, n = Math.round(dur * rate);
    var out = new Float32Array(n);
    var rnd = mulberry32(0x88a1);
    var nz = pinkNoise(n, rnd);
    runFilter(nz, coeffs("lowpass", 700, 0.7, rate));
    for (var i = 0; i < n; i++) {
      var t = i / rate;
      var body = Math.sin(Math.PI * 2 * (62 - 14 * Math.min(1, t * 3)) * t) * Math.exp(-t * 11);
      out[i] = body * 0.85 + nz[i] * Math.exp(-t * 26) * 0.55;
    }
    removeDC(out);
    normalize([out], 0.7);
    var tt = padHead(out, rate, 4);
    fadeTail(tt, rate, 16);
    return { name: "thump", rate: rate, chans: [tt] };
  }

  /* 碎屑崩开：几粒小东西掉在盘子上。 */
  function bakeCrumbs(rate) {
    var dur = 0.5, n = Math.round(dur * rate);
    var out = new Float32Array(n);
    var rnd = mulberry32(0xc0de);
    var hits = 9;
    for (var k = 0; k < hits; k++) {
      var pos = Math.round((0.02 + Math.pow(rnd(), 1.4) * 0.42) * rate);
      var f = 1700 + rnd() * 2600;
      var amp = 0.25 + rnd() * 0.75;
      var len = Math.round((0.012 + rnd() * 0.02) * rate);
      for (var j = 0; j < len && pos + j < n; j++) {
        var t = j / rate;
        out[pos + j] += Math.sin(Math.PI * 2 * f * t) * Math.exp(-t * 260) * amp * 0.5;
      }
    }
    removeDC(out);
    normalize([out], 0.55);
    fadeTail(out, rate, 12);
    return { name: "crumbs", rate: rate, chans: [out] };
  }

  /* 烛火重新点亮：气流回来 + 火苗「呼」地一声立起来。 */
  function bakeRelight(rate) {
    var dur = 0.9, n = Math.round(dur * rate);
    var rnd = mulberry32(0x1a2b);
    var noise = pinkNoise(n, rnd);
    var buf = noise.slice();
    sweepFilter(buf, rate, "bandpass", function (t) {
      return lerp(320, 1150, smoothstep(0, dur * 0.7, t));
    }, 1.0);
    var out = new Float32Array(n);
    for (var i = 0; i < n; i++) {
      var u = i / n;
      var env = Math.pow(smoothstep(0, 0.5, u), 1.5) * Math.pow(1 - u, 1.1);
      out[i] = buf[i] * env;
    }
    removeDC(out);
    normalize([out], 0.6);
    fadeEdges(out, rate, 10);
    return { name: "relight", rate: rate, chans: [out] };
  }

  /* 合成海鸥（没有样本时的退路）：两声「kee-ow」，带一点空气和尾音。 */
  function bakeGullSynth(rate, seed) {
    var rnd = mulberry32(seed);
    var dur = 1.05 + rnd() * 0.3;
    var n = Math.round(dur * rate);
    var out = new Float32Array(n);
    /* 每支变体的基频、两声的间隔与长度都抽一次：两支不同才叫「变体」 */
    var base = 1020 + rnd() * 340;
    var calls = [
      { at: 0.02 + rnd() * 0.04, len: 0.28 + rnd() * 0.1, f0: base, f1: base * (0.68 + rnd() * 0.1) },
      { at: 0.34 + rnd() * 0.14, len: 0.4 + rnd() * 0.18, f0: base * (1.05 + rnd() * 0.12), f1: base * (0.55 + rnd() * 0.12) },
    ];
    for (var c = 0; c < calls.length; c++) {
      var call = calls[c];
      var start = Math.round(call.at * rate);
      var len = Math.round(call.len * rate);
      var phase = 0;
      var vib = 4.5 + rnd() * 2.5;
      for (var i = 0; i < len && start + i < n; i++) {
        var u = i / len;
        var t = i / rate;
        var f = lerp(call.f0, call.f1, Math.pow(u, 0.7)) * (1 + 0.018 * Math.sin(Math.PI * 2 * vib * t));
        phase += (Math.PI * 2 * f) / rate;
        /* 谐波：基频 + 2 次 + 3 次，越往上越少 */
        var v = Math.sin(phase) + 0.42 * Math.sin(phase * 2) + 0.15 * Math.sin(phase * 3);
        var env = Math.pow(Math.sin(Math.PI * Math.pow(u, 0.8)), 1.3);
        out[start + i] += v * env * 0.5;
      }
    }
    /* 一点尾巴：海边的开阔感靠这个，否则像玩具 */
    var tailN = Math.round(0.32 * rate);
    var mixed = new Float32Array(n);
    for (var j = 0; j < n; j++) {
      mixed[j] = out[j] + (j >= tailN ? out[j - tailN] * 0.12 : 0);
    }
    removeDC(mixed);
    normalize([mixed], 0.5);
    fadeEdges(mixed, rate, 10);
    return { name: "gull", rate: rate, chans: [mixed] };
  }

  /* ------------------------------------------------------------------ *
   * 烘焙总调度（分片跑，每片 ≤ 7ms）
   * ------------------------------------------------------------------ */
  function bakeSteps() {
    var rate = BAKE_RATE;
    return [
      function () { return bakeBed(rate); },
      function () { return bakeWind(rate); },
      function () { return bakeReverbIR(rate); },
      /* 近岸：亮、短、脆（礁石边上碎开的那一道） */
      function () {
        return bakeSurf(rate, 0x11a1, { dur: 3.9, peakAt: 0.30, bright: 1150, dark: 320, q: 0.9, foam: 0.26, sub: 1.35, tailPow: 2.3, tag: "near" });
      },
      function () {
        return bakeSurf(rate, 0x33c3, { dur: 3.6, peakAt: 0.34, bright: 1350, dark: 360, q: 1.0, foam: 0.30, sub: 1.15, tailPow: 2.5, tag: "near" });
      },
      function () {
        return bakeSurf(rate, 0x55e5, { dur: 3.2, peakAt: 0.38, bright: 1500, dark: 400, q: 1.1, foam: 0.34, sub: 1.0, tailPow: 2.7, tag: "near" });
      },
      /* 远处：暗、长、厚（隔着一段水面的那一排） */
      function () {
        return bakeSurf(rate, 0x22b2, { dur: 4.5, peakAt: 0.26, bright: 900, dark: 290, q: 0.8, foam: 0.20, sub: 1.5, tailPow: 2.0, tag: "far" });
      },
      function () {
        return bakeSurf(rate, 0x44d4, { dur: 4.8, peakAt: 0.24, bright: 830, dark: 270, q: 0.75, foam: 0.18, sub: 1.6, tailPow: 2.1, tag: "far" });
      },
      function () {
        return bakeSurf(rate, 0x66f6, { dur: 5.4, peakAt: 0.22, bright: 760, dark: 250, q: 0.7, foam: 0.16, sub: 1.7, tailPow: 1.9, tag: "far" });
      },
      function () { return bakeWash(rate, 0x71a1, { dur: 2.6, hi: 900, lo: 260, q: 0.85, sub: 0.55, peak: 0.42 }); },
      function () { return bakeWash(rate, 0x72a2, { dur: 3.2, hi: 1100, lo: 220, q: 0.75, sub: 0.65, peak: 0.38 }); },
      function () { return bakeWhoosh(rate); },
      function () { return bakeSlice(rate); },
      function () { return bakeTear(rate); },
      function () { return bakePuff(rate); },
      function () { return bakeThump(rate); },
      function () { return bakeCrumbs(rate); },
      function () { return bakeRelight(rate); },
      function () { return bakeGullSynth(rate, 0x7c1); },
      function () { return bakeGullSynth(rate, 0x7c2); },
    ];
  }

  /* 同步烘焙（Node 测试 / 预览兜底用）。线上走 runBake 分片。 */
  function bakeAll() {
    var steps = bakeSteps();
    var layers = {};
    var surf = [];
    var gull = [];
    var wash = [];
    for (var i = 0; i < steps.length; i++) {
      var r = steps[i]();
      if (r.name === "surf") surf.push(r);
      else if (r.name === "gull") gull.push(r);
      else if (r.name === "wash") wash.push(r);
      else layers[r.name] = r;
    }
    return { rate: BAKE_RATE, layers: layers, surf: surf, gull: gull, wash: wash };
  }

  /* ------------------------------------------------------------------ *
   * WAV 编码（预览用）
   * ------------------------------------------------------------------ */
  function encodeWav(chans, rate) {
    var ch = chans.length;
    var len = chans[0].length;
    var bytes = 44 + len * ch * 2;
    var buf = new ArrayBuffer(bytes);
    var view = new DataView(buf);
    function str(off, s) { for (var i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); }
    str(0, "RIFF"); view.setUint32(4, bytes - 8, true); str(8, "WAVE");
    str(12, "fmt "); view.setUint32(16, 16, true);
    view.setUint16(20, 1, true); view.setUint16(22, ch, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * ch * 2, true);
    view.setUint16(32, ch * 2, true); view.setUint16(34, 16, true);
    str(36, "data"); view.setUint32(40, len * ch * 2, true);
    var off = 44;
    for (var i = 0; i < len; i++) {
      for (var c = 0; c < ch; c++) {
        var v = clamp(chans[c][i], -1, 1);
        view.setInt16(off, v < 0 ? v * 0x8000 : v * 0x7fff, true);
        off += 2;
      }
    }
    return new Uint8Array(buf);
  }

  function toBase64(bytes) {
    var s = "";
    var chunk = 0x8000;
    for (var i = 0; i < bytes.length; i += chunk) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + chunk, bytes.length)));
    }
    if (typeof btoa === "function") return btoa(s);
    /* Node（测试用）：手写一个 base64 */
    var chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    var out = "";
    for (var j = 0; j < s.length; j += 3) {
      var a = s.charCodeAt(j), b = s.charCodeAt(j + 1), c2 = s.charCodeAt(j + 2);
      var hasB = j + 1 < s.length, hasC = j + 2 < s.length;
      var t = (a << 16) | ((hasB ? b : 0) << 8) | (hasC ? c2 : 0);
      out += chars[(t >> 18) & 63] + chars[(t >> 12) & 63] + (hasB ? chars[(t >> 6) & 63] : "=") + (hasC ? chars[t & 63] : "=");
    }
    return out;
  }

  /* ------------------------------------------------------------------ *
   * 运行时状态
   * ------------------------------------------------------------------ */
  var state = {
    inited: false,
    ready: false,          // 烘焙完毕
    assets: null,          // 烘焙结果（Float32）
    ctx: null,
    G: null,               // 图
    t: 0,
    muted: false,
    visible: true,
    ambTarget: 0,          // 0 封着 · 0.22 封面 · 1 长廊
    mix: { amb: 0, sea: 0.9, swell: 0.5, wind: 0.1, windFreq: 500, gull: 1 },
    nextSwell: 0,
    nextGull: 0,
    duck: 0,
    counters: { swells: 0, gulls: 0, cues: {}, bakeMs: 0, bakeSteps: 0 },
    /* 海鸥：先有合成样本兜底（烘焙时就绪），真实录音解码完再顶上去 */
    gullBuffers: null,
    gullSource: "synth",
    samplesTried: false,
    music: { el: null, level: 0, target: 0, available: false, tried: 0, playing: false },
    seeded: false,
    preview: false,
    lastPick: {},          // 每种一次性声音上一次挑了哪支，避免连着重复
    swellPlan: null,       // 浪的组成状态（组内第几道 / 声像 / 强度）
  };

  /* ------------------------------------------------------------------ *
   * 图
   * ------------------------------------------------------------------ */
  function buildGraph(ctx) {
    var G = {};
    G.ctx = ctx;

    /* 限幅器兜底：合成音叠在一起很容易顶到 0dBFS 以上，削波在耳机上很难听 */
    G.limiter = ctx.createDynamicsCompressor();
    G.limiter.threshold.value = -4;
    G.limiter.knee.value = 0;
    G.limiter.ratio.value = 20;
    G.limiter.attack.value = 0.002;
    G.limiter.release.value = 0.18;
    G.limiter.connect(ctx.destination);

    G.master = ctx.createGain();
    G.master.gain.value = 0;
    G.master.connect(G.limiter);

    /* 环境总线上的「音色整形」：+2dB 低频给胸口那一下，-2.5dB 高频把
       嘶声压回去 —— 合成噪声最容易在 6k 以上变得刺耳，而海本来是柔的。 */
    G.amb = ctx.createGain();
    G.amb.gain.value = 0;
    G.ambLow = ctx.createBiquadFilter();
    G.ambLow.type = "lowshelf";
    G.ambLow.frequency.value = 150;
    G.ambLow.gain.value = 2.0;
    G.ambHigh = ctx.createBiquadFilter();
    G.ambHigh.type = "highshelf";
    G.ambHigh.frequency.value = 5600;
    G.ambHigh.gain.value = -2.5;
    G.amb.connect(G.ambLow);
    G.ambLow.connect(G.ambHigh);
    G.ambHigh.connect(G.master);

    /* 混响：一条并联的湿声支路。IR 在 installBuffers 里挂上（要 ctx 采样率）。
       返回端再过一道低通 —— 混响的高频是「糊」的主要来源。 */
    G.revSend = ctx.createGain();
    G.revSend.gain.value = 1;
    G.conv = ctx.createConvolver();
    G.conv.normalize = true;
    G.revLow = ctx.createBiquadFilter();
    G.revLow.type = "lowpass";
    G.revLow.frequency.value = 4200;
    G.revLow.Q.value = 0.4;
    G.revLow2 = ctx.createBiquadFilter();
    G.revLow2.type = "highpass";
    G.revLow2.frequency.value = 190;
    G.revLow2.Q.value = 0.5;
    G.revReturn = ctx.createGain();
    G.revReturn.gain.value = 0.85;
    G.revSend.connect(G.conv);
    G.conv.connect(G.revLow);
    G.revLow.connect(G.revLow2);
    G.revLow2.connect(G.revReturn);
    G.revReturn.connect(G.amb);

    G.sea = ctx.createGain();
    G.sea.gain.value = LEVEL.sea;
    G.sea.connect(G.amb);

    G.wind = ctx.createGain();
    G.wind.gain.value = LEVEL.wind;
    G.wind.connect(G.amb);

    G.gull = ctx.createGain();
    G.gull.gain.value = LEVEL.gull;
    G.gull.connect(G.amb);

    G.foley = ctx.createGain();
    G.foley.gain.value = LEVEL.foley;
    G.foley.connect(G.master);

    return G;
  }

  function toAudioBuffer(ctx, layer) {
    var buf = ctx.createBuffer(layer.chans.length, layer.chans[0].length, layer.rate);
    for (var c = 0; c < layer.chans.length; c++) buf.copyToChannel(layer.chans[c], c);
    return buf;
  }

  /* 真实海鸥录音：js/audio-assets.js 里的 base64 mp3 → AudioBuffer。
     file:// 读不到文件字节，所以样本只能以字符串随脚本进页面。
     解码失败 / 没有这个文件 → 保留烘焙出来的合成海鸥，不报错、不静音。 */
  function loadSampleGulls() {
    var A = typeof window !== "undefined" ? window.TIDELINE_AUDIO_ASSETS : null;
    if (!A || !A.items || !A.items.length) return;
    if (state.samplesTried) return;
    state.samplesTried = true;
    var ctx = state.ctx;
    if (!ctx || !ctx.decodeAudioData) return;
    var out = [];
    var left = A.items.length;
    function done() {
      if (--left > 0) return;
      if (out.length) {
        state.gullBuffers = out;
        state.gullSource = "sample";
      }
    }
    for (var i = 0; i < A.items.length; i++) {
      (function (item) {
        var bytes, bin;
        try { bin = atob(item.b64); } catch (e) { done(); return; }
        bytes = new Uint8Array(bin.length);
        for (var j = 0; j < bin.length; j++) bytes[j] = bin.charCodeAt(j);
        /* 新旧两种 decodeAudioData 签名都兜住：老 Safari 只认回调，
           新草案只认 promise。两者都挂上，谁先到算谁的。 */
        var settled = false;
        var ok = function (buf) { if (settled) return; settled = true; out.push(buf); done(); };
        var bad = function () { if (settled) return; settled = true; done(); };
        try {
          var ret = ctx.decodeAudioData(bytes.buffer, ok, bad);
          if (ret && ret.then) ret.then(ok, bad);
        } catch (e) { bad(); }
      })(A.items[i]);
    }
  }

  /* 左右「此消彼长」的慢速摆动：海面会在左右之间呼吸，
     这是立体感里最不容易做假的一半 —— 纯静态的去相关听起来只是「宽」，
     没有「在动」。每个通道挂一只 0.02–0.05Hz 的正弦，相位相反。 */
  function stereoWiden(ctx, srcNode, dest, depth, fL, fR) {
    var sp = ctx.createChannelSplitter(2);
    var mg = ctx.createChannelMerger(2);
    var gl = ctx.createGain();
    gl.gain.value = 1;
    var gr = ctx.createGain();
    gr.gain.value = 1;
    srcNode.connect(sp);
    sp.connect(gl, 0, 0);
    gl.connect(mg, 0, 0);
    sp.connect(gr, 1, 0);
    gr.connect(mg, 0, 1);
    mg.connect(dest);
    var ol = ctx.createOscillator();
    ol.type = "sine";
    ol.frequency.value = fL;
    var or = ctx.createOscillator();
    or.type = "sine";
    or.frequency.value = fR;
    var dl = ctx.createGain();
    dl.gain.value = depth;
    var dr = ctx.createGain();
    dr.gain.value = -depth;
    ol.connect(dl);
    dl.connect(gl.gain);
    or.connect(dr);
    dr.connect(gr.gain);
    try { ol.start(0); or.start(0); } catch (e) { /* 老浏览器 */ }
    return mg;
  }

  function installBuffers(ctx, G, A) {
    G.buffers = {};
    for (var k in A.layers) {
      if (Object.prototype.hasOwnProperty.call(A.layers, k)) G.buffers[k] = toAudioBuffer(ctx, A.layers[k]);
    }
    G.buffers.surf = A.surf.map(function (s) { return toAudioBuffer(ctx, s); });
    G.buffers.gull = A.gull.map(function (s) { return toAudioBuffer(ctx, s); });
    G.buffers.wash = (A.wash || []).map(function (s) { return toAudioBuffer(ctx, s); });
    /* 浪按远近分组：近岸的短而脆，远处的长而闷，播的时候按距离挑 */
    G.surfNear = [];
    G.surfFar = [];
    for (var q = 0; q < A.surf.length; q++) {
      var lb = G.buffers.surf[q];
      if (A.surf[q].tag === "near") G.surfNear.push(lb);
      else G.surfFar.push(lb);
    }
    if (!G.surfNear.length) G.surfNear = G.buffers.surf;
    if (!G.surfFar.length) G.surfFar = G.buffers.surf;

    /* 混响 IR：bake 时按 32k 生成；ConvolverNode 的 buffer 允许和 ctx 采样率
       不同（规范要求重采样），万一某家浏览器抛错就现场按 ctx 采样率再生一份。 */
    if (G.conv && A.layers.reverb) {
      try {
        G.conv.buffer = toAudioBuffer(ctx, A.layers.reverb);
      } catch (e) {
        try { G.conv.buffer = toAudioBuffer(ctx, bakeReverbIR(ctx.sampleRate)); } catch (e2) { /* 放弃湿声 */ }
      }
    }

    /* 海浪底噪：循环，常驻一个 source */
    G.bedSrc = ctx.createBufferSource();
    G.bedSrc.buffer = G.buffers.bed;
    G.bedSrc.loop = true;
    G.bedFilter = ctx.createBiquadFilter();
    G.bedFilter.type = "lowpass";
    G.bedFilter.frequency.value = 2600;
    G.bedFilter.Q.value = 0.4;
    G.bedGain = ctx.createGain();
    G.bedGain.gain.value = 0;
    G.bedSrc.connect(G.bedFilter);
    G.bedFilter.connect(G.bedGain);
    G.bedWide = stereoWiden(ctx, G.bedGain, G.sea, 0.16, 0.031, 0.047);
    /* 底噪也送一点进混响：整片海是「在一个空间里」的，不是贴脸的干声 */
    G.bedSend = ctx.createGain();
    G.bedSend.gain.value = LEVEL.revBed;
    G.bedGain.connect(G.bedSend);
    G.bedSend.connect(G.revSend);
    G.bedSrc.start(0);

    /* 海风：循环 + 带通（阵风时把中心频率提上去） */
    G.windSrc = ctx.createBufferSource();
    G.windSrc.buffer = G.buffers.wind;
    G.windSrc.loop = true;
    G.windFilter = ctx.createBiquadFilter();
    G.windFilter.type = "bandpass";
    G.windFilter.frequency.value = 520;
    G.windFilter.Q.value = 0.55;
    G.windGain = ctx.createGain();
    G.windGain.gain.value = 0;
    G.windSrc.connect(G.windFilter);
    G.windFilter.connect(G.windGain);
    G.windWide = stereoWiden(ctx, G.windGain, G.wind, 0.22, 0.019, 0.024);
    G.windSend = ctx.createGain();
    G.windSend.gain.value = LEVEL.revWind;
    G.windGain.connect(G.windSend);
    G.windSend.connect(G.revSend);
    G.windSrc.start(0);
    return G;
  }

  /* ------------------------------------------------------------------ *
   * 播放：一阵浪 / 一声鸥 / 一个拟音
   * ------------------------------------------------------------------ */
  /* 不连着放同一支变体：四支样本随机挑，连续三次撞同一支的概率不小，
     耳朵一旦认出「又是它」整段就废了。 */
  function pickNoRepeat(list, key, rnd) {
    if (!list || !list.length) return null;
    var r = rnd ? rnd() : Math.random();
    var i = Math.min(list.length - 1, (r * list.length) | 0);
    if (list.length > 1 && state.lastPick[key] === i) i = (i + 1 + ((r * 977) | 0) % (list.length - 1)) % list.length;
    state.lastPick[key] = i;
    return list[i];
  }

  /* 一道浪。
     o: { pan0, pan1, near, rate, reverb, rnd }
     · 近岸 / 远处用不同的样本组 + 不同的实时低通（远 = 高频被空气吃掉）
     · 声像从 pan0 扫到 pan1：浪头是横着推过来的，不是钉在一个点上
     · 远处送更多混响：距离感靠「直达声/混响比」，不是靠音量 */
  function playSwell(G, t, gain, o) {
    if (!G || !G.buffers || !G.buffers.surf.length) return;
    var ctx = G.ctx;
    o = o || {};
    var rnd = o.rnd || Math.random;
    var near = o.near !== false;
    var buf = pickNoRepeat(near ? G.surfNear : G.surfFar, "surf", rnd) || G.buffers.surf[0];
    var src = ctx.createBufferSource();
    src.buffer = buf;
    var rate = o.rate || ((near ? 0.95 : 0.9) + rnd() * 0.14);
    src.playbackRate.value = rate;
    var hp = ctx.createBiquadFilter();
    hp.type = "highpass";
    hp.frequency.value = near ? 85 : 130;
    hp.Q.value = 0.6;
    var lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    /* 远处的浪没有 1.5k 以上的东西；近岸的留到 8k 让泡沫「沙」出来 */
    lp.frequency.value = near ? 8000 : 1450 + rnd() * 700;
    lp.Q.value = 0.5;
    var g = ctx.createGain();
    g.gain.value = gain;
    var p = ctx.createStereoPanner();
    var pan0 = clamp(o.pan0 == null ? 0 : o.pan0, -1, 1);
    var pan1 = clamp(o.pan1 == null ? pan0 : o.pan1, -1, 1);
    var sweepAt = t + buf.duration / Math.max(0.5, rate) * (0.55 + rnd() * 0.25);
    p.pan.setValueAtTime(pan0, t);
    p.pan.linearRampToValueAtTime(pan1, sweepAt);
    src.connect(hp);
    hp.connect(lp);
    lp.connect(g);
    g.connect(p);
    p.connect(G.sea);
    if (G.revSend) {
      var s = ctx.createGain();
      s.gain.value = near ? LEVEL.revSwell : LEVEL.revSwellFar;
      g.connect(s);
      s.connect(G.revSend);
    }
    src.start(t);
    state.counters.swells++;
  }

  /* 一声鸥。
     鸟在天上：用 HRTF 的 3D 声源做一次「飞过」——两声之间从一侧移到另一侧，
     高度也变。比 StereoPanner 的固定声像真实得多（那是「贴在墙上的鸟」）。 */
  function playGull(G, t, gain, pan) {
    if (!G || !G.buffers) return;
    var list = state.gullBuffers && state.gullBuffers.length ? state.gullBuffers : G.buffers.gull;
    if (!list || !list.length) return;
    var ctx = G.ctx;
    var buf = pickNoRepeat(list, "gull", Math.random);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.94 + Math.random() * 0.13;
    var g = ctx.createGain();
    g.gain.value = gain;
    var side = pan >= 0 ? 1 : -1;
    var dur = buf.duration / Math.max(0.6, src.playbackRate.value);
    var node;
    if (ctx.createPanner) {
      var pn = ctx.createPanner();
      pn.panningModel = "HRTF";
      pn.distanceModel = "inverse";
      pn.refDistance = 4;
      pn.rolloffFactor = 0.55;
      pn.maxDistance = 80;
      var x0 = side * (5 + Math.random() * 7);
      var x1 = -x0 * (0.7 + Math.random() * 0.6);
      var y0 = 3.5 + Math.random() * 4;
      var y1 = y0 + 1.5 + Math.random() * 3;
      var z0 = -6 - Math.random() * 8;
      var z1 = z0 + 3 + Math.random() * 7;
      var ramp = Math.max(0.2, dur * 0.9);
      if (pn.positionX) {
        pn.positionX.setValueAtTime(x0, t);
        pn.positionX.linearRampToValueAtTime(x1, t + ramp);
        pn.positionY.setValueAtTime(y0, t);
        pn.positionY.linearRampToValueAtTime(y1, t + ramp);
        pn.positionZ.setValueAtTime(z0, t);
        pn.positionZ.linearRampToValueAtTime(z1, t + ramp);
      } else if (pn.setPosition) {
        pn.setPosition(x0, y0, z0);
      }
      node = pn;
    } else {
      var p = ctx.createStereoPanner();
      p.pan.setValueAtTime(clamp(pan, -1, 1), t);
      node = p;
    }
    src.connect(g);
    g.connect(node);
    node.connect(G.gull);
    if (G.revSend) {
      var s = ctx.createGain();
      s.gain.value = LEVEL.revGull;
      g.connect(s);
      s.connect(G.revSend);
    }
    src.start(t);
    state.counters.gulls++;
  }

  /* 退水：浪头过去之后，水从沙上退回海里 */
  function playWash(G, t, gain, pan, rnd) {
    if (!G || !G.buffers || !G.buffers.wash || !G.buffers.wash.length) return;
    var ctx = G.ctx;
    rnd = rnd || Math.random;
    var buf = pickNoRepeat(G.buffers.wash, "wash", rnd);
    var src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = 0.9 + rnd() * 0.2;
    var g = ctx.createGain();
    g.gain.value = gain;
    var p = ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    src.connect(g);
    g.connect(p);
    p.connect(G.sea);
    if (G.revSend) {
      var s = ctx.createGain();
      s.gain.value = LEVEL.revSwell * 0.8;
      g.connect(s);
      s.connect(G.revSend);
    }
    src.start(t);
    state.counters.washes = (state.counters.washes || 0) + 1;
  }

  /* ------------------------------------------------------------------ *
   * 浪的「计划」：纯函数（不碰 AudioContext），这样能单测随机性
   *   真实海面不是等间隔的「滴滴」：总是三五道一组，一组比一组高，
   *   然后歇一会儿再来。plan 在组内推进 build，出组后随机起新组。
   * ------------------------------------------------------------------ */
  function makeSwellPlan() {
    return { left: 0, build: 1, pan: 0, lastDelay: 6 };
  }

  function planSwell(plan, sea, rnd) {
    rnd = rnd || Math.random;
    var inSet = plan.left > 0;
    var near;
    if (inSet) {
      plan.left--;
      plan.build = Math.min(1.3, plan.build + 0.09 + rnd() * 0.12);
      near = rnd() < 0.68;
    } else {
      plan.build = 0.6 + rnd() * 0.22;
      plan.pan = (rnd() * 2 - 1) * 0.6;
      /* 34%：起一组 2–5 道 */
      if (rnd() < 0.34) plan.left = 1 + ((rnd() * 4) | 0);
      near = rnd() < 0.48;
    }
    var gain = (near ? 1.0 : 0.6) * (0.5 + 0.5 * sea) * plan.build * (0.74 + rnd() * 0.42);
    var pan0 = inSet ? plan.pan * 0.9 : plan.pan;
    var pan1 = -pan0 * (0.3 + rnd() * 0.6);
    var step = {
      near: near,
      gain: gain,
      pan0: pan0,
      pan1: pan1,
      follow: null,
      wash: null,
      delay: 0,
    };
    /* 同一组的余波：跟一道更小的，慢半拍、挪到另一边 */
    if (rnd() < (near ? 0.5 : 0.32)) {
      step.follow = { at: 0.9 + rnd() * 1.7, gain: gain * (0.3 + rnd() * 0.24), pan: -pan1 * (0.5 + rnd() * 0.6), near: rnd() < 0.3 };
    }
    if (rnd() < (near ? 0.62 : 0.42)) {
      step.wash = { at: 1.5 + rnd() * 2.2, gain: gain * (0.16 + rnd() * 0.14), pan: pan1 * 0.8 };
    }
    var base = clamp(13.0 - 7.2 * sea, 4.6, 13.0);
    var delay;
    if (inSet || plan.left > 0) {
      delay = base * (0.4 + rnd() * 0.3);
    } else {
      delay = base * (0.85 + rnd() * 0.55);
      /* 平潮：偶尔真的安静一会儿（真实海面有「歇一口气」的时候） */
      if (rnd() < 0.15) delay *= 1.5 + rnd() * 0.7;
    }
    step.delay = delay;
    plan.lastDelay = delay;
    return step;
  }

  function applySwellStep(G, t, step, amb, rnd) {
    if (!G || amb <= 0.02) return;
    playSwell(G, t, step.gain * amb, { pan0: step.pan0, pan1: step.pan1, near: step.near, rnd: rnd });
    if (step.follow) {
      playSwell(G, t + step.follow.at, step.follow.gain * amb, { pan0: step.follow.pan, pan1: -step.follow.pan * 0.4, near: step.follow.near, rnd: rnd });
    }
    if (step.wash) {
      playWash(G, t + step.wash.at, step.wash.gain * amb, step.wash.pan, rnd);
    }
  }

  /* 拟音表：name → (G, t, detail) */
  var CUES = {
    approach: function (G, t) {
      /* 镜头压下来的那一下：布被压得轻轻一响，几乎听不见，但缺了会「空」 */
      playOneShot(G, "relight", t, 0.16, 0, 0.8);
    },
    fly: function (G, t) {
      playOneShot(G, "whoosh", t, 0.5, -0.15, 1.0);
    },
    cut: function (G, t) {
      /* 一刀落下：闷响 + 一口气吹灭十九支蜡烛 + 三个妈烛的小口 */
      playOneShot(G, "thump", t, 0.75, 0, 1.0);
      playOneShot(G, "puff", t + 0.02, 0.85, 0, 1.0);
      playOneShot(G, "puff", t + 0.07, 0.34, -0.3, 1.12);
      playOneShot(G, "puff", t + 0.11, 0.26, 0.35, 0.9);
    },
    slice: function (G, t) {
      /* 刀划过布 —— 0.42s 的湿刮擦，尾音交给 tear */
      playOneShot(G, "slice", t, 0.72, 0, 1.0);
      playOneShot(G, "tear", t + 0.05, 0.55, 0, 1.0);
    },
    crumb: function (G, t) {
      playOneShot(G, "crumbs", t, 0.5, 0.1, 1.0);
    },
    open: function (G, t) {
      /* 布全裂开：一口气涌上来（浪 + 风一起），这是全场最大的一声 */
      playSwell(G, t, 0.95, 0.05, 0.92);
      playSwell(G, t + 0.55, 0.55, -0.4, 1.05);
      state.ambTarget = 1.0;
    },
    stitch: function (G, t) {
      /* 缝回封面：烛火重亮 + 布退回去 */
      playOneShot(G, "relight", t + 0.05, 0.55, 0, 1.0);
      playOneShot(G, "whoosh", t + 0.02, 0.22, 0.2, 0.78);
      state.ambTarget = 0.3;
    },
  };

  function playOneShot(G, name, t, gain, pan, rate) {
    if (!G || !G.buffers || !G.buffers[name]) return;
    var ctx = G.ctx;
    var src = ctx.createBufferSource();
    src.buffer = G.buffers[name];
    src.playbackRate.value = rate || 1;
    var g = ctx.createGain();
    /* 每个cue自己可以被音量调；gain 传进来就是峰值 */
    g.gain.value = gain;
    var p = ctx.createStereoPanner();
    p.pan.value = clamp(pan || 0, -1, 1);
    src.connect(g); g.connect(p); p.connect(G.foley);
    src.start(Math.max(t, ctx.currentTime));
    return src;
  }

  /* ------------------------------------------------------------------ *
   * 音乐（<audio> 元素；file:// 下没法接进 WebAudio）
   * ------------------------------------------------------------------ */
  function initMusic() {
    if (typeof document === "undefined") return;
    var m = state.music;
    if (m.el) return;
    var el = document.createElement("audio");
    el.loop = true;
    el.preload = "auto";
    el.volume = 0;
    el.setAttribute("playsinline", "");
    el.style.display = "none";
    var i = 0;
    function tryNext() {
      if (i >= MUSIC_SRC.length) { m.available = false; return; }
      m.tried++;
      el.src = encodeURI(MUSIC_SRC[i++]);
      try { el.load(); } catch (e) { /* 旧浏览器 */ }
    }
    el.addEventListener("error", tryNext);
    el.addEventListener("canplaythrough", function () {
      if (!m.available) m.available = true;
      /* 解锁那一刻 play() 可能早于解码完成（当时代码里还是上一个失败的 src），
         那次会被拒；等能放了再要一次，别指望每帧轮询。 */
      if (!m.playing && !state.muted) startMusic();
    });
    el.addEventListener("playing", function () { m.playing = true; });
    el.addEventListener("pause", function () { m.playing = false; });
    m.el = el;
    tryNext();
    if (document.body) document.body.appendChild(el);
    else document.addEventListener("DOMContentLoaded", function () { document.body.appendChild(el); }, { once: true });
  }

  function startMusic() {
    var m = state.music;
    if (!m.el) return;
    if (state.muted) return;
    var p = m.el.play();
    if (p && p.catch) p.catch(function () { /* 没有文件 / 被拒：安静跳过 */ });
  }

  /* ------------------------------------------------------------------ *
   * 静音
   * ------------------------------------------------------------------ */
  function readStoredMute() {
    try {
      var v = window.localStorage.getItem(STORE_MUTE);
      return v === "1";
    } catch (e) { return false; }
  }
  function writeStoredMute(v) {
    try { window.localStorage.setItem(STORE_MUTE, v ? "1" : "0"); } catch (e) { /* 隐私模式 */ }
  }

  function applyMute(instant) {
    var G = state.G;
    var target = state.muted || !state.visible ? 0 : 1;
    if (G) {
      if (instant) G.master.gain.value = target;
      else {
        var now = G.ctx.currentTime;
        G.master.gain.cancelScheduledValues(now);
        G.master.gain.setTargetAtTime(target, now, 0.09);
      }
    }
    if (state.music.el) {
      /* 音乐不走 master（它不在 WebAudio 里），单独一条 */
      state.music.target = state.muted ? 0 : musicLevel();
    }
  }

  function setMuted(v, opts) {
    state.muted = v === true;
    if (!opts || opts.persist !== false) writeStoredMute(state.muted);
    applyMute(false);
    if (!state.muted && state.ctx && state.ctx.state === "suspended") {
      try { state.ctx.resume(); } catch (e) { /* 忽略 */ }
    }
    return state.muted;
  }

  function toggleMute() { return setMuted(!state.muted); }

  /* ------------------------------------------------------------------ *
   * 音乐音量：跟着环境走（封面 0.3×，长廊 0.18×），并给拟音让路
   * ------------------------------------------------------------------ */
  function musicLevel() {
    if (!state.music.available) return 0;
    if (state.ambTarget > 0.7) return LEVEL.musicGallery;
    return LEVEL.music * clamp(state.ambTarget / 0.35, 0, 1);
  }

  /* ------------------------------------------------------------------ *
   * 启动
   * ------------------------------------------------------------------ */
  function init(opts) {
    if (state.inited) return;
    state.inited = true;
    opts = opts || {};
    if (typeof location !== "undefined" && /(?:^|[?&])audio=preview(?:&|$)/.test(location.search || "")) {
      state.preview = true;
    }
    if (typeof location !== "undefined" && /(?:^|[?&])audio=0(?:&|$)/.test(location.search || "")) {
      state.muted = true;
    } else {
      state.muted = readStoredMute();
    }
    if (opts.muted === true) state.muted = true;

    if (!state.preview) {
      initMusic();
      armGesture();
      armKeys();
      armVisibility();
      startBake();
    }
  }

  /* 第一次用户手势：建 AudioContext（浏览器要求手势里建/恢复才能出声） */
  function armGesture() {
    if (typeof window === "undefined") return;
    function onGesture() {
      window.removeEventListener("pointerdown", onGesture, true);
      window.removeEventListener("keydown", onGesture, true);
      window.removeEventListener("touchstart", onGesture, true);
      unlock();
    }
    window.addEventListener("pointerdown", onGesture, true);
    window.addEventListener("keydown", onGesture, true);
    window.addEventListener("touchstart", onGesture, true);
  }

  function armKeys() {
    if (typeof window === "undefined") return;
    window.addEventListener("keydown", function (e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      var t = e.target;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "m" || e.key === "M") {
        var now = toggleMute();
        if (now) flashHint("静音 · 再按 M 打开");
        else flashHint("声音已打开");
      }
    });
  }

  /* M 键没有界面按钮，所以给一句一闪而过的提示：不给反馈，用户会以为没生效 */
  var hintEl = null, hintTimer = 0;
  function flashHint(text) {
    if (typeof document === "undefined") return;
    if (!hintEl) {
      hintEl = document.createElement("div");
      hintEl.setAttribute("aria-live", "polite");
      hintEl.style.cssText = [
        "position:fixed", "left:50%", "bottom:26px", "transform:translateX(-50%)",
        "padding:8px 14px", "border-radius:999px", "z-index:2147483000",
        "font:500 12px/1.4 ui-sans-serif,-apple-system,'Segoe UI',sans-serif",
        "letter-spacing:.04em", "color:#f3f0e8", "background:rgba(18,22,26,.72)",
        "border:1px solid rgba(255,255,255,.14)", "backdrop-filter:blur(6px)",
        "pointer-events:none", "opacity:0", "transition:opacity .18s ease",
      ].join(";");
      document.body.appendChild(hintEl);
    }
    hintEl.textContent = text;
    hintEl.style.opacity = "1";
    clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { if (hintEl) hintEl.style.opacity = "0"; }, 1400);
  }

  function armVisibility() {
    if (typeof document === "undefined") return;
    document.addEventListener("visibilitychange", function () {
      state.visible = !document.hidden;
      if (!state.visible) {
        applyMute(false);
      } else {
        if (state.ctx && state.ctx.state === "suspended" && !state.muted) {
          try { state.ctx.resume(); } catch (e) { /* 忽略 */ }
        }
        applyMute(false);
        /* 回来时把浪的排程往前推，别一次补十阵 */
        if (state.ctx) state.nextSwell = Math.max(state.nextSwell, state.ctx.currentTime + 0.4);
      }
    });
  }

  function unlock() {
    if (state.ctx) {
      if (state.ctx.state === "suspended") {
        try { state.ctx.resume(); } catch (e) { /* 忽略 */ }
      }
      return;
    }
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var ctx;
    try {
      ctx = new AC({ latencyHint: "playback" });
    } catch (e) {
      try { ctx = new AC(); } catch (e2) { return; }
    }
    state.ctx = ctx;
    var G = buildGraph(ctx);
    state.G = G;
    G.master.gain.setValueAtTime(0, ctx.currentTime);
    G.master.gain.setTargetAtTime(state.muted || !state.visible ? 0 : 1, ctx.currentTime, 0.25);
    /* 环境声从「几乎没有」开始：封面是一个安静的屋子 */
    state.ambTarget = 0.22;
    G.amb.gain.setTargetAtTime(0, ctx.currentTime, 0.2);
    if (state.assets) installBuffers(ctx, G, state.assets);
    /* 真实海鸥样本：解在后台，同步返回。解码完之前 playGull 用合成的那几段。 */
    loadSampleGulls();
    state.nextSwell = ctx.currentTime + 1.2;
    state.nextGull = ctx.currentTime + 6 + Math.random() * 8;
    startMusic();
  }

  /* ------------------------------------------------------------------ *
   * 烘焙（分片）
   * ------------------------------------------------------------------ */
  function startBake() {
    var steps = bakeSteps();
    var layers = {}, surf = [], gull = [], wash = [];
    var i = 0;
    var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    function step() {
      var budgetEnd = (typeof performance !== "undefined" ? performance.now() : Date.now()) + 7;
      while (i < steps.length) {
        var r = steps[i++]();
        if (r.name === "surf") surf.push(r);
        else if (r.name === "gull") gull.push(r);
        else if (r.name === "wash") wash.push(r);
        else layers[r.name] = r;
        state.counters.bakeSteps = i;
        if ((typeof performance !== "undefined" ? performance.now() : Date.now()) > budgetEnd) break;
      }
      if (i < steps.length) {
        scheduleIdle(step);
      } else {
        state.assets = { rate: BAKE_RATE, layers: layers, surf: surf, gull: gull, wash: wash };
        state.counters.bakeMs = Math.round((typeof performance !== "undefined" ? performance.now() : Date.now()) - t0);
        state.ready = true;
        if (state.ctx && state.G && !state.G.buffers) installBuffers(state.ctx, state.G, state.assets);
        if (state.ctx) {
          state.nextSwell = state.ctx.currentTime + 0.6;
          state.nextGull = state.ctx.currentTime + 5 + Math.random() * 7;
        }
      }
    }
    scheduleIdle(step);
  }

  /* 空闲档：先试 requestIdleCallback，但它一开始「排队等超时」（海面永远占着
     帧、等不到真空闲）就切 setTimeout(0)。实测：20 步全按 rIC 的 400ms 超时落地
     = 10.1s 才烘完，加载屏卡 9.9s；切到 setTimeout 后 ≈1.8s。烘焙期间的顿挫藏在
     加载屏后面，看不见；加载屏揭得太晚才是看得见的毛病。 */
  var idleLag = 0;
  function scheduleIdle(fn) {
    var t0 = (typeof performance !== "undefined" ? performance.now() : Date.now());
    function run() {
      var lag = (typeof performance !== "undefined" ? performance.now() : Date.now()) - t0;
      if (lag > 55) idleLag++;
      else if (idleLag > 0) idleLag--;
      fn();
    }
    if (idleLag < 3 && typeof window !== "undefined" && typeof window.requestIdleCallback === "function") {
      window.requestIdleCallback(run, { timeout: 80 });
    } else {
      setTimeout(run, 0);
    }
  }

  /* ------------------------------------------------------------------ *
   * 每帧
   * ------------------------------------------------------------------ */
  function update(dt, env, app) {
    if (!state.ready && !state.assets) return;
    state.t += dt;
    state.counters.frames = (state.counters.frames || 0) + 1;
    var G = state.G;
    var ctx = state.ctx;

    /* 即便没有图，也把目标值算好：解锁那一刻不至于从 0 突然弹起 */
    var sea = clamp(env && env.seaState != null ? env.seaState : 0.3, 0, 0.85);
    var wind = clamp(env && env.wind != null ? env.wind : 0.25, 0, 1);
    var gust = clamp(env && env.gust != null ? env.gust : 0.5, 0, 1);
    var night = !!(env && env.isNight);
    var elev = env && env.sunElevation != null ? env.sunElevation : 20;

    /* 环境总音量由「长廊打开到什么程度」决定，而不是靠某个 cue 记状态：
       app.js 的 state.gate 是唯一真相（0 = 封面合着，1 = 已在长廊里）。
       只认 cue 的话，用户滚回封面、或者用 ?cutat 调试直接跳进去，音量都会错。 */
    if (app && app.gate != null) {
      state.ambTarget = 0.22 + 0.78 * smoothstep(0.02, 0.92, clamp(app.gate, 0, 1));
    }

    var mix = state.mix;
    /* 底噪：海越涌越厚，低频越压得住；滤波器跟着海况开一点 */
    mix.sea = 0.55 + 0.85 * sea;
    mix.wind = 0.03 + 0.5 * wind * (0.55 + 0.45 * gust);
    mix.windFreq = 380 + 1150 * wind * (0.6 + 0.4 * gust);
    mix.bedFreq = 1500 + 1800 * sea;

    /* 环境总音量（封面 0.22 → 长廊 1.0），阻尼过去 */
    mix.amb = damp(mix.amb, state.ambTarget, 0.9, dt);

    /* duck：有拟音时音乐让路 */
    state.duck = damp(state.duck, 0, 1.6, dt);

    if (!G || !ctx) {
      /* 还没解锁：只推进音乐目标（音乐也还没 start），别的等手势 */
      return;
    }
    if (ctx.state !== "running") return;

    var now = ctx.currentTime;

    /* --- 环境图 --- */
    G.amb.gain.setTargetAtTime(mix.amb, now, 0.12);
    G.bedGain.gain.setTargetAtTime(mix.amb > 0.001 ? 0.42 * mix.sea : 0, now, 0.2);
    G.bedFilter.frequency.setTargetAtTime(mix.bedFreq, now, 0.3);
    G.windGain.gain.setTargetAtTime(mix.amb > 0.001 ? mix.wind : 0, now, 0.25);
    G.windFilter.frequency.setTargetAtTime(mix.windFreq, now, 0.4);

    /* --- 浪：提前 0.35s 排程，别在帧边界上卡 --- */
    var ahead = now + 0.35;
    if (state.nextSwell < now - 1.0) {
      state.nextSwell = now + 0.2;   // 页面切走过：别补播
      state.swellPlan = null;
    }
    if (!state.swellPlan) state.swellPlan = makeSwellPlan();
    var guard = 0;
    while (state.nextSwell < ahead && guard++ < 8) {
      var t = state.nextSwell;
      if (mix.amb > 0.02) {
        var step = planSwell(state.swellPlan, sea, Math.random);
        applySwellStep(G, t, step, mix.amb, Math.random);
      } else {
        /* 封面闭着的时候也要推进时间轴，否则一打开会补播一串 */
        state.nextSwell = t + 6;
        continue;
      }
      state.nextSwell = t + state.swellPlan.lastDelay;
    }

    /* --- 海鸥：白天、长廊里、偶尔一声 --- */
    if (state.nextGull < now - 1.0) state.nextGull = now + 3;
    if (state.nextGull < ahead) {
      var gt = state.nextGull;
      var dayOk = elev > -3 && !night;
      if (mix.amb > 0.35 && dayOk && Math.random() < 0.55) {
        playGull(G, gt, 0.16 + Math.random() * 0.16, (Math.random() * 2 - 1) * 0.75);
        /* 海鸥很少单声：隔 0.4–0.9s 再应一声 */
        if (Math.random() < 0.5) playGull(G, gt + 0.45 + Math.random() * 0.5, 0.1 + Math.random() * 0.1, (Math.random() * 2 - 1) * 0.8);
      }
      /* 间隔：14–36s，海况越差越少（下雨天海鸥不叫） */
      state.nextGull = gt + (14 + Math.random() * 22) * (1.4 - 0.6 * sea);
    }

    /* --- 音乐：元素音量单独阻尼 --- */
    var m = state.music;
    if (m.el) {
      var mTarget = state.muted || !state.visible ? 0 : musicLevel() * (1 - 0.45 * state.duck);
      m.target = mTarget;
      m.el.volume = clamp(damp(m.el.volume, mTarget, 1.1, dt), 0, 1);
      if (mTarget > 0.001 && m.el.paused && m.available && !m.blocked) {
        var pr = m.el.play();
        if (pr && pr.catch) pr.catch(function () { m.blocked = true; });
      }
    }
  }

  function cue(name, detail) {
    var fn = CUES[name];
    if (!fn) return false;
    state.counters.cues[name] = (state.counters.cues[name] || 0) + 1;
    /* 拟音一响，音乐让一半 */
    state.duck = 1;
    if (!state.G || !state.ctx || state.ctx.state !== "running" || !state.G.buffers) return false;
    try {
      fn(state.G, state.ctx.currentTime + 0.02, detail || {});
    } catch (e) {
      if (typeof console !== "undefined" && console.warn) console.warn("[audio] cue failed:", name, e);
      return false;
    }
    return true;
  }

  /* ------------------------------------------------------------------ *
   * 离线渲染（给别人听的验证通道）
   *   spec: { seconds, rate, script, env, master }
   *   script: 'ambient' | 'opening' | 'layers'
   * ------------------------------------------------------------------ */
  /* 同一时刻只许有一个离屏上下文活着。Chrome 单页面只给 6 个 OfflineAudioContext，
     而 close() 是异步的：上一条还没关完就开下一条，攒到第 5、6 条时 startRendering()
     就再也不 resolve（实测 space / ambient60 轮流超时，单跑却都是几百毫秒）。
     所以这里串成一条链：前一次的 close 落定之后才建下一个。 */
  var renderPending = Promise.resolve();

  function renderPreview(spec) {
    var p = renderPending.then(function () { return renderOne(spec); });
    /* 链上只留「完成」信号，不把错误往下传 —— 一次超时不该拖死后面的渲染 */
    renderPending = p.then(function () { return null; }, function () { return null; });
    return p;
  }

  /* 关掉一个离屏上下文，但**不无限等**：Chrome 实测有 close() 的 promise
     不 resolve 的情况（此时若在链上 await，下一次渲染根本不会开始，验证脚本
     就看到一条 inner-timeout）。这里 2s 封顶，正常情况 close 是毫秒级。 */
  function closeCtx(ctx) {
    return new Promise(function (res) {
      var done = false;
      function fin() { if (!done) { done = true; res(); } }
      var cp = null;
      try { if (ctx.close) cp = ctx.close(); } catch (e) { return fin(); }
      if (cp && typeof cp.then === "function") cp.then(fin, fin);
      else return fin();
      setTimeout(fin, 2000);
    });
  }

  function renderOne(spec) {
    spec = spec || {};
    var seconds = clamp(spec.seconds || 12, 0.5, 60);
    var rate = spec.rate || BAKE_RATE;
    var A = state.assets || bakeAll();
    var OC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OC) return Promise.reject(new Error("OfflineAudioContext unavailable"));
    var ctx = new OC(2, Math.round(seconds * rate), rate);
    var G = buildGraph(ctx);
    installBuffers(ctx, G, A);
    G.master.gain.setValueAtTime(spec.master == null ? 1 : spec.master, 0);
    G.amb.gain.setValueAtTime(0, 0);
    G.bedGain.gain.setValueAtTime(0, 0);
    G.windGain.gain.setValueAtTime(0, 0);

    var env = spec.env || { seaState: 0.38, wind: 0.34, gust: 0.6, sunElevation: 12, isNight: false };
    var script = spec.script || "ambient";
    var meta = { script: script, seconds: seconds, rate: rate, cues: [] };

    /* 环境声的离线推演：和 update() 同一套映射，只是时间轴上一次性排完 */
    function ramps(t0, t1, amb0, amb1, sea) {
      G.amb.gain.setValueAtTime(amb0, t0);
      if (amb1 !== amb0) G.amb.gain.linearRampToValueAtTime(amb1, t1);
      G.bedGain.gain.setValueAtTime(0.42 * (0.55 + 0.85 * sea), t0);
      G.bedFilter.frequency.setValueAtTime(1500 + 1800 * sea, t0);
      G.windGain.gain.setValueAtTime(0.03 + 0.5 * env.wind * (0.55 + 0.45 * env.gust), t0);
      G.windFilter.frequency.setValueAtTime(380 + 1150 * env.wind, t0);
    }

    function scheduleSwells(t0, t1, amb, sea, seed) {
      var rnd = mulberry32(seed == null ? 0xabc1 : seed);
      var plan = makeSwellPlan();
      var t = t0 + 0.35;
      while (t < t1) {
        var step = planSwell(plan, sea, rnd);
        applySwellStep(G, t, step, amb, rnd);
        t += step.delay;
      }
    }

    if (script === "ambient") {
      ramps(0, 0.9, 0.22, 1.0, env.seaState);
      scheduleSwells(0, seconds, 1.0, env.seaState);
      var grnd = mulberry32(0x5e11);
      for (var gt = 4 + grnd() * 6; gt < seconds - 1.2; gt += 12 + grnd() * 14) {
        playGull(G, gt, 0.2 + grnd() * 0.12, (grnd() * 2 - 1) * 0.7);
        meta.cues.push({ at: gt, name: "gull" });
      }
    } else if (script === "opening") {
      /* 与 cakegate.js 的常量对齐：APPROACH 1.05s、FLY 1.0s（0.525 起）、
         CUT 2.6s（HOLD 0.28 之后才开始裂）、SLICE 占 CUT 的 16% */
      var click = 0.15;
      var cutAt = 1.95;
      ramps(0, 0.2, 0, 0.22, env.seaState);
      ramps(click, click + 0.8, 0.22, 0.3, env.seaState);
      scheduleSwells(0, seconds, 0.3, env.seaState);
      CUES.approach(G, click + 0.02);
      CUES.fly(G, click + 0.525);
      meta.cues.push({ at: click + 0.525, name: "fly" });
      CUES.cut(G, cutAt);
      meta.cues.push({ at: cutAt, name: "cut" });
      scheduleSwellAt(G, cutAt + 0.1, 0.5, 0.1, env.seaState);
      CUES.slice(G, cutAt + 0.28);
      meta.cues.push({ at: cutAt + 0.28, name: "slice" });
      CUES.crumb(G, cutAt + 0.28 + 0.16 * 2.6 * 0.5);
      CUES.open(G, cutAt + 0.28 + 2.6);
      meta.cues.push({ at: cutAt + 0.28 + 2.6, name: "open" });
      ramps(cutAt + 0.2, cutAt + 0.6, 0.3, 0.62, env.seaState);
      ramps(cutAt + 0.28 + 2.6, cutAt + 0.28 + 3.2, 0.62, 1.0, env.seaState);
      scheduleSwells(0, seconds, 1.0, env.seaState);
      var g2 = mulberry32(0x77aa);
      for (var gt2 = 7 + g2() * 5; gt2 < seconds - 1.2; gt2 += 14 + g2() * 16) {
        playGull(G, gt2, 0.18 + g2() * 0.1, (g2() * 2 - 1) * 0.7);
      }
    } else if (script === "layers") {
      /* 一层一层摆出来，方便对照听 */
      var names = ["bed", "wind", "surf", "wash", "whoosh", "slice", "tear", "puff", "thump", "crumbs", "relight"];
      var slot = 2.4;
      G.amb.gain.setValueAtTime(1, 0);
      G.bedGain.gain.setValueAtTime(0, 0);
      G.windGain.gain.setValueAtTime(0, 0);
      G.foley.gain.value = 1;
      for (var k = 0; k < names.length; k++) {
        var at = 0.2 + k * slot;
        var nm = names[k];
        if (nm === "bed") {
          G.bedGain.gain.setValueAtTime(0.42, at);
          G.bedGain.gain.setValueAtTime(0, at + slot - 0.3);
        } else if (nm === "wind") {
          G.windGain.gain.setValueAtTime(0.4, at);
          G.windGain.gain.setValueAtTime(0, at + slot - 0.3);
        } else if (nm === "surf") {
          var lr = mulberry32(0x5150);
          playSwell(G, at, 0.9, { pan0: -0.8, pan1: 0.7, near: true, rnd: lr });
          playSwell(G, at + 1.1, 0.5, { pan0: 0.6, pan1: -0.5, near: false, rnd: lr });
        } else if (nm === "wash") {
          playWash(G, at, 0.8, -0.3);
        } else {
          playOneShot(G, nm, at, 0.9, 0, 1);
        }
        meta.cues.push({ at: at, name: nm });
      }
    } else if (script === "space") {
      /* 只测空间：左右各一道浪、一声从右飞到左的鸥、一点底噪 */
      var sr = mulberry32(0x5aced);
      G.amb.gain.setValueAtTime(1, 0);
      G.bedGain.gain.setValueAtTime(0.42, 0);
      G.windGain.gain.setValueAtTime(0.06, 0);
      G.bedFilter.frequency.setValueAtTime(1500 + 1800 * env.seaState, 0);
      playSwell(G, 0.6, 0.9, { pan0: -0.95, pan1: -0.8, near: true, rnd: sr });
      meta.cues.push({ at: 0.6, name: "swell-left" });
      playSwell(G, 3.2, 0.9, { pan0: 0.95, pan1: 0.8, near: true, rnd: sr });
      meta.cues.push({ at: 3.2, name: "swell-right" });
      playGull(G, 6.0, 0.55, 0.9);
      meta.cues.push({ at: 6.0, name: "gull-right" });
      playGull(G, 8.6, 0.55, -0.9);
      meta.cues.push({ at: 8.6, name: "gull-left" });
      playWash(G, 10.4, 0.6, 0.5, sr);
      meta.cues.push({ at: 10.4, name: "wash" });
    }

    var done = ctx.startRendering().then(function (rendered) {
      var chans = [rendered.getChannelData(0), rendered.getChannelData(1)];
      var peak = 0, sum = 0, sq = 0, n = 0;
      for (var c = 0; c < chans.length; c++) {
        var d = chans[c];
        for (var i = 0; i < d.length; i++) {
          var v = d[i];
          var a = v < 0 ? -v : v;
          if (a > peak) peak = a;
          sum += v; sq += v * v; n++;
        }
      }
      var wav = encodeWav(chans, rate);
      meta.peak = +peak.toFixed(4);
      meta.dc = +(sum / n).toFixed(6);
      meta.rms = +Math.sqrt(sq / n).toFixed(4);
      /* 立体感指标：L/R 相关系数（越低越宽）+ 侧/中能量比。
         这两个数比「听起来宽不宽」可靠，验证脚本靠它们判回归。 */
      var sl = chans[0], srr = chans[1];
      var dot = 0, el = 0, er = 0;
      for (var q = 0; q < sl.length; q++) {
        dot += sl[q] * srr[q];
        el += sl[q] * sl[q];
        er += srr[q] * srr[q];
      }
      var denom = Math.sqrt(el * er) || 1;
      meta.corr = +(dot / denom).toFixed(3);
      var midE = 0, sideE = 0;
      for (var q2 = 0; q2 < sl.length; q2++) {
        var m2 = (sl[q2] + srr[q2]) * 0.5, s2 = (sl[q2] - srr[q2]) * 0.5;
        midE += m2 * m2;
        sideE += s2 * s2;
      }
      meta.side = +(sideE / (midE + sideE || 1)).toFixed(3);
      meta.wavBytes = wav.length;
      return { base64: toBase64(wav), meta: meta };
    });
    /* 等 close 落定（最多 2s）再 resolve：调用方拿到的「完成」应当是上下文
       已经关掉的完成，否则下一条渲染又会撞上数量上限（见 renderPreview 注释）。 */
    return done.then(function (res) {
      return closeCtx(ctx).then(function () { return res; });
    }, function (err) {
      return closeCtx(ctx).then(function () { throw err; });
    });
  }

  function scheduleSwellAt(G, t, gain, pan, sea) {
    playSwell(G, t, gain, { pan0: pan, pan1: pan * 0.6, near: Math.random() < 0.5 });
  }

  /* ------------------------------------------------------------------ *
   * 调试
   * ------------------------------------------------------------------ */
  function debugState() {
    var G = state.G;
    var m = state.music;
    return {
      version: VERSION,
      inited: state.inited,
      ready: state.ready,
      ctxState: state.ctx ? state.ctx.state : "none",
      sampleRate: state.ctx ? state.ctx.sampleRate : 0,
      muted: state.muted,
      visible: state.visible,
      ambTarget: +state.ambTarget.toFixed(3),
      t: +state.t.toFixed(2),
      amb: +state.mix.amb.toFixed(3),
      sea: +state.mix.sea.toFixed(3),
      wind: +state.mix.wind.toFixed(3),
      windFreq: Math.round(state.mix.windFreq),
      duck: +state.duck.toFixed(3),
      bedGain: G && G.bedGain ? +G.bedGain.gain.value.toFixed(3) : null,
      windGain: G && G.windGain ? +G.windGain.gain.value.toFixed(3) : null,
      master: G && G.master ? +G.master.gain.value.toFixed(3) : null,
      surfBuffers: G && G.buffers ? G.buffers.surf.length : 0,
      surface: G && G.surfNear ? { near: G.surfNear.length, far: G.surfFar.length } : null,
      wash: G && G.buffers && G.buffers.wash ? G.buffers.wash.length : 0,
      reverb: !!(G && G.conv && G.conv.buffer),
      /* 循环层的**循环长度**（秒）。这是「会不会被听出转圈」的唯一决定量：
         任何循环 buffer 的包络自相关在「正好等于循环长度」的滞后上必然接近 1
         （等于信号和自己比），所以拿自相关去判「有没有周期性」永远会命中它 ——
         量出来的是循环长度本身，不是听感。听感的判据是「这个长度有多长」：
         4.5s 会被耳朵锁住，13.7s 抓不住。验证脚本靠这两个数盯着别缩回去。 */
      loops: state.assets ? {
        bed: +((state.assets.layers.bed.chans[0].length) / state.assets.rate).toFixed(2),
        wind: +((state.assets.layers.wind.chans[0].length) / state.assets.rate).toFixed(2),
      } : null,
      swellPlan: state.swellPlan ? { left: state.swellPlan.left, build: +state.swellPlan.build.toFixed(2) } : null,
      gullSource: state.gullSource,
      gullSamples: state.gullBuffers ? state.gullBuffers.length : 0,
      counters: {
        swells: state.counters.swells,
        gulls: state.counters.gulls,
        cues: state.counters.cues,
        frames: state.counters.frames || 0,
        bakeMs: state.counters.bakeMs,
        bakeSteps: state.counters.bakeSteps,
      },
      music: {
        available: m.available,
        playing: m.playing,
        volume: m.el ? +m.el.volume.toFixed(3) : 0,
        src: m.el ? (m.el.getAttribute("src") || "").split("/").pop() : "",
        tried: m.tried,
        blocked: !!m.blocked,
      },
    };
  }

  /* ------------------------------------------------------------------ *
   * 导出
   * ------------------------------------------------------------------ */
  var TideAudio = {
    version: VERSION,
    init: init,
    unlock: unlock,
    update: update,
    cue: cue,
    setMuted: setMuted,
    toggleMute: toggleMute,
    isMuted: function () { return state.muted; },
    isReady: function () { return state.ready; },
    debugState: debugState,
    renderPreview: renderPreview,
    /* 测试钩子：Node 里跑烘焙 / 编码，不走浏览器 */
    _test: {
      BAKE_RATE: BAKE_RATE,
      bakeAll: bakeAll,
      bakeStepFns: bakeSteps,
      encodeWav: encodeWav,
      toBase64: toBase64,
      /* 计划器是纯函数，Node 里可以直接跑几千次验随机性 */
      planSwell: planSwell,
      makeSwellPlan: makeSwellPlan,
      bakeReverbIR: bakeReverbIR,
    },
  };

  if (typeof window !== "undefined") window.TideAudio = TideAudio;
  if (typeof globalThis !== "undefined" && !globalThis.TideAudio) globalThis.TideAudio = TideAudio;
})();
