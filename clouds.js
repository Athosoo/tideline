/* =========================================================
   TIDELINE · TideClouds — 体积云层（零依赖 / 非模块 / WebGL2）
   ---------------------------------------------------------
   三段式管线（CONTRACT §2）：
     CLOUD pass     -> cloudTex  = vec4(inScatter.rgb, transmittance.a)
     ACCUM pass     -> RGBA16F ping-pong，acc = mix(accPrev, cur, uBlend)
     COMPOSITE pass -> 全分辨率直接画到画布：
                       outColor = vec4(inScatter, 1.0 - T)，预乘混合
   天空渐变由页面 CSS 提供，这里只画云。

   kernel（GLSL）位于下面的 CLOUD-KERNEL 标记区，由
   _lab/tools/sync-kernel.mjs 注入；标记区之外是本文件自己的宿主代码与 main()。
   ========================================================= */
(function () {
  "use strict";

  var DEG2RAD = Math.PI / 180;
  var VFOV_DEG = 58;            /* CONTRACT §5 */
  var BAND_H = 0.26;            /* 画布只覆盖视口顶部 26% */
  var CAM_HEIGHT = 6;           /* 相机海拔 6 m */
  var DEFAULT_HORIZON_Y = 0.252;
  var WORLD_MAX_DIST = 28000;   /* kernel v2：15 km 外仍要看得见 */
  var AERIAL_K = 1.6e-5;        /* 比 lab 的 2.4e-5 小，否则远处云被霾吃掉 */
  var FRAME_MS = 1000 / 60;

  /* CONTRACT §5: vfov 58°，pitch 由地平线在视口的高度比决定。
     返回 mat3 列序 = (right, up, back)；up = cross(right, fwd)，up.y > 0。 */
  function makeBasis(horizonY) {
    var pitch = (horizonY - 0.5) * VFOV_DEG * DEG2RAD;
    var fwd = [0, Math.sin(pitch), -Math.cos(pitch)];
    var right = [1, 0, 0];
    var up = [
      right[1] * fwd[2] - right[2] * fwd[1],
      right[2] * fwd[0] - right[0] * fwd[2],
      right[0] * fwd[1] - right[1] * fwd[0]
    ];
    var back = [-fwd[0], -fwd[1], -fwd[2]];
    return {
      pitch: pitch,
      fwd: fwd,
      right: right,
      up: up,
      m: new Float32Array([
        right[0], right[1], right[2],
        up[0], up[1], up[2],
        back[0], back[1], back[2]
      ])
    };
  }

  function clampNum(v, lo, hi, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.min(hi, Math.max(lo, v));
  }

  /* ---------- GLSL sources ---------- */

  var VS_SRC = [
    "#version 300 es",
    "precision highp float;",
    "const vec2 P[3] = vec2[3](vec2(-1.0,-1.0), vec2(3.0,-1.0), vec2(-1.0,3.0));",
    "void main(){ gl_Position = vec4(P[gl_VertexID], 0.0, 1.0); }"
  ].join("\n");

  var HEADER_SRC = [
    "#version 300 es",
    "precision highp float;",
    "precision highp sampler3D;",
    "out vec4 fragColor;"
  ].join("\n");

  /* =====================================================================
     CLOUD KERNEL —— 下面是唯一由 sync-kernel.mjs 覆盖的区域。
     占位 kernel 是可编译、可见的单次散射版本；真 kernel 会替换它。
     kernel 内不定义 main()。
     ===================================================================== */
  var CLOUD_KERNEL = String.raw`
// >>> CLOUD-KERNEL:BEGIN
/* ===========================================================================
   CLOUD-KERNEL v2  ·  前端「灵活体积云」唯一真相来源
   ---------------------------------------------------------------------------
   由 _lab/tools/sync-kernel.mjs 注入到 lab 与 ship 的 CLOUD-KERNEL 标记区。
   不要直接编辑注入后的副本。

   理论骨架（参数化 / 可分级的近似映射）：
     密度   = 高度剖面(云型) × 天气覆盖(艺术输入) × 形状噪声 × 细节噪声
     光照   = 单次散射 + 4 阶指数和多重散射近似（贡献度 A / 遮蔽度 B 两个旋钮）
     积分   = 粗探针预步进（低分辨率探针 → 只在非空区加密采样）
              + 距离自适应步长 + 预算自适应 + 提前跳出
     介质   = Beer-Lambert 消光 + Henyey-Greenstein 双叶相位函数

   宿主负责：#version / precision / out 变量 / main()。
   本文件负责：全部 uniform 声明（宿主不得重复声明）。
   =========================================================================== */

uniform vec2  uRes;
uniform float uTime;
uniform float uJitter;
uniform vec3  uCamPos;
uniform mat3  uCamBasis;
uniform float uFovTan;
uniform float uAspect;

uniform sampler3D uNoise;
uniform sampler3D uWorley;
uniform float uNoiseLo,  uNoiseHi;
uniform float uWorleyLo, uWorleyHi;

uniform vec2  uSeedXZ;      // 噪声域偏移：把「哪朵云在你头顶」变成艺术参数
uniform float uCoverage;    // 0..1  天空被覆盖的比例（艺术输入）
uniform float uType;        // 0 层云 .. 1 积云 .. 2 积雨云
uniform float uDensityMul;  // 密度倍率
uniform float uDetail;      // 0..1 细节噪声振幅
uniform float uBase, uTop;  // 云底 / 云顶海拔（米）
uniform float uMaxDist;     // 最远追踪距离（米）
uniform float uWind;        // 漂移速度 m/s

uniform vec3  uSunDir;      // 指向太阳的单位向量
uniform vec3  uSunColor;    // 太阳辐亮度（含艺术增益，宿主负责量级）
uniform vec3  uSkyTop, uSkyHorizon, uHazeColor;
uniform float uSkyScale;    // 天空/环境光整体缩放（昼夜）

uniform float uAerial, uAerialK;   // 空气透视开关 / 密度 1/m
uniform float uMSContrib;          // 多重散射「贡献度」 A
uniform float uMSOccl;             // 多重散射「遮蔽度」 B
uniform float uPowder;             // 粉化（边缘透光）强度
uniform float uPhaseG, uPhaseMix;  // HG 双叶参数
uniform float uAmbScale;           // 环境光倍率

uniform int   uSteps, uLightSteps;
uniform float uStoreLdr;
uniform float uDebug;

const float PI      = 3.14159265359;
const float R_EARTH = 6371000.0;
const float EXT_PER_DENSITY = 0.0012;   // 归一化密度 1.0 对应的消光系数 (1/m)

/* 调试输出（lab 用，ship 忽略） */
float gDbgShape, gDbgCover, gDbgBody, gDbgSteps, gDbgSkips;

float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 raySphere(vec3 ro, vec3 rd, float r){
  vec3 oc = ro - vec3(0.0, -R_EARTH, 0.0);
  float b = dot(oc, rd);
  float c = dot(oc, oc) - r * r;
  float h = b * b - c;
  if (h < 0.0) return vec2(-1.0, -1.0);
  h = sqrt(h);
  return vec2(-b - h, -b + h);
}

/* 把噪声重标定到 0..1：数组的 p5/p95 由 CPU 侧实测传入，阈值因此可以跨噪声设置复现 */
float nrm(float v, float lo, float hi){
  return clamp((v - lo) / max(hi - lo, 1e-5), 0.0, 1.0);
}

/* ── 高度剖面：同一条公式派生三种云型 ──────────────────────────────────────
   层云 = 薄的均匀板；积云 = 圆顶；积雨云 = 塔状 + 顶部砧状展开。            */
float heightProfile(float h, float type){
  float bot   = smoothstep(0.0, 0.055, h);
  float slab  = 1.0 - smoothstep(0.45, 0.92, h);
  float dome  = 1.0 - smoothstep(0.26, 0.78, h);
  float tower = 1.0 - smoothstep(0.50, 0.90, h);
  float lo = mix(slab, dome, clamp(type, 0.0, 1.0));
  float hi = mix(dome, tower, clamp(type - 1.0, 0.0, 1.0));
  float p  = mix(lo, hi, step(1.0, type));
  float anvil = smoothstep(0.62, 0.97, h) * (1.0 - smoothstep(0.975, 1.0, h));
  p = max(p, anvil * clamp(type - 1.0, 0.0, 1.0));
  return bot * clamp(p, 0.0, 1.0);
}

float hgPhase(float c, float g){
  float g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
/* 双叶 HG 的凸组合：权重和为 1，所以整个球面的积分仍然守恒 */
float phaseFn(float mu){
  float g = uPhaseG;
  float m = clamp(uPhaseMix * 0.5 + 0.5, 0.0, 1.0);
  return mix(hgPhase(mu, g), hgPhase(mu, -g * 0.45), m);
}

/* 粗探针只取天气覆盖（1 次采样，且天气场与高度无关） */
float coverAt(vec3 p){
  vec3 q = p + vec3(uSeedXZ.x, 0.0, uSeedXZ.y) - vec3(uWind, 0.0, uWind * 0.35) * uTime;
  float w = texture(uNoise, vec3(q.xz * 0.0000625, 0.37)).r;
  w = nrm(w, uNoiseLo, uNoiseHi);
  float th = 1.0 - clamp(uCoverage, 0.0, 1.0);
  float c = smoothstep(th - 0.10, th + 0.10, w);
  return c * c;
}

/* ── 完整密度 ──────────────────────────────────────────────────────────────
   高度剖面放在最前面：剖面为 0 的空域直接 return，省掉 6 次 3D 采样。
   这就是最便宜也最有效的一级空域跳过。                                     */
float cloudDensity(vec3 p, out float h01){
  h01 = (p.y - uBase) / max(uTop - uBase, 1.0);
  float prof = heightProfile(h01, uType);
  if (prof <= 5e-4) return 0.0;

  vec3 q = p + vec3(uSeedXZ.x, 0.0, uSeedXZ.y) - vec3(uWind, 0.0, uWind * 0.35) * uTime;

  float weather = nrm(texture(uNoise, vec3(q.xz * 0.0000625, 0.37)).r, uNoiseLo, uNoiseHi);
  float th = 1.0 - clamp(uCoverage, 0.0, 1.0);
  float cover = smoothstep(th - 0.10, th + 0.10, weather);
  cover *= cover;
  if (cover <= 5e-4) return 0.0;

  float shape  = nrm(texture(uNoise, q * 0.000090).r, uNoiseLo, uNoiseHi);
  float shape2 = nrm(texture(uNoise, q * 0.000260 + vec3(0.31, 0.17, 0.53)).r, uNoiseLo, uNoiseHi);
  float detail = nrm(texture(uNoise, q * 0.000580 + vec3(0.63, 0.19, 0.41)).r, uNoiseLo, uNoiseHi);
  float puff   = nrm(texture(uWorley, q * 0.000105).r, uWorleyLo, uWorleyHi);
  float puff2  = nrm(texture(uWorley, q * 0.000370 + vec3(0.19, 0.61, 0.43)).r, uWorleyLo, uWorleyHi);

  float body = shape * 0.30 + shape2 * 0.16 + (puff * 0.66 + puff2 * 0.34) * 0.54;
  body += (detail - 0.5) * (0.28 + 0.75 * uDetail);
  body = smoothstep(0.40, 0.56, body);

  gDbgShape = shape; gDbgCover = cover; gDbgBody = body;
  return body * cover * prof * uDensityMul;
}

/* 只算密度的光照版：跳过覆盖度以外的调试量 */
float densityLite(vec3 p){ float h; return cloudDensity(p, h); }

/* ── 多重散射：4 阶指数和 ──────────────────────────────────────────────────
   tau 是沿太阳方向的光学厚度。第 o 阶散射走一条更短/更少遮挡的路径，
   因此消光按 b^o 收缩、能量按 a^o 衰减；除以权重和 → tau=0 时总量恰好为 1，
   不会凭空造能量，而 tau→∞ 时残余的 (1/Σa^o) 正是「云内部依然亮」的来源。
     a = uMSContrib 艺术旋钮「贡献度」，b = uMSOccl「遮蔽度」。            */
float multiScatterT(float tau, out float directT, out float msShare){
  float a = clamp(uMSContrib, 0.0, 0.98);
  float b = clamp(uMSOccl,    0.05, 1.0);
  float w = 1.0, e = 1.0, sum = 0.0, norm = 0.0;
  for (int o = 0; o < 4; o++){
    float t = exp(-e * tau);
    if (o == 0) directT = t;
    sum += w * t;
    norm += w;
    w *= a; e *= b;
  }
  /* 0 阶 = 纯单次散射，它的能量占比就是「剩下多少光来自高次散射」 */
  msShare = 1.0 - 1.0 / max(norm, 1.0);
  return sum / max(norm, 1e-4);
}

/* 沿太阳方向积分光学厚度（Beer-Lambert）。空域提前跳出。 */
float lightTau(vec3 p, float sigmaE, int n){
  float ls = max((uTop - uBase) / float(n), 40.0);
  float tau = 0.0;
  for (int j = 0; j < 16; j++){
    if (j >= n) break;
    vec3 lp = p + uSunDir * (float(j) + 0.5) * ls;
    if (lp.y < uBase - 300.0) break;
    tau += densityLite(lp) * ls * sigmaE;
  }
  return tau;
}

/* ── 主追踪 ────────────────────────────────────────────────────────────────
   返回 vec4(预乘内散射 rgb, 透射率 a)。
   两段式：外层按 probeCell 粗走，只有探针命中才在格内细追 —— 即「预步进」，
   把采样点从空白空气搬到云体上，而不是均匀地浪费掉。                      */
vec4 marchClouds(vec3 ro, vec3 rd, out float outDist){
  outDist = 0.0;
  float trans = 1.0;
  vec3 acc = vec3(0.0);
  gDbgSteps = 0.0; gDbgSkips = 0.0;
  /* 只有「相机在云底之下 + 向下看」才必然无云；相机在云层之上时向下看应该看得见云 */
  if (rd.y <= 0.0 && ro.y < uBase) return vec4(acc, trans);

  vec2 outer = raySphere(ro, rd, R_EARTH + uTop);
  if (outer.y < 0.0) return vec4(acc, trans);
  float t0 = max(outer.x, 0.0);
  float t1 = min(outer.y, t0 + uMaxDist);
  /* 云区 = 在云顶球之内、且在云底球之外。相机在云底之下时射线是「先出云底球」，
     相机在云层之上时射线是「先进云底球」——两种情形切法相反。 */
  float rIn = R_EARTH + uBase;
  float dc  = length(ro - vec3(0.0, -R_EARTH, 0.0));
  vec2 inner = raySphere(ro, rd, rIn);
  if (dc < rIn) {
    if (inner.y > t0) t0 = max(t0, inner.y);
  } else if (inner.x > 0.0) {
    t1 = min(t1, inner.x);
  }
  if (t1 <= t0) return vec4(acc, trans);

  float shell     = max(uTop - uBase, 1.0);
  float probeCell = max(shell * 0.55, 120.0);
  float sigmaE    = EXT_PER_DENSITY * uDensityMul;
  float mu        = dot(rd, uSunDir);
  float phase     = phaseFn(mu);

  /* 抖动只作用于「格内相位」，格边界保持逐帧稳定，累积才不会糊 */
  float jit = hash12(gl_FragCoord.xy + vec2(uJitter * 71.7, uJitter * 131.3));

  float tCur    = t0;          // 当前粗格起点（确定性）
  float cellEnd = t0;
  float fineDt  = 0.0;
  float fineT   = 0.0;
  int   stepsLeft = uSteps;
  int   skipGuard = 0;
  float wsum = 0.0, dSum = 0.0, maxD = 0.0;

  vec3 haze = uHazeColor * (0.72 + 0.28 * clamp(uSunDir.y * 3.0, 0.0, 1.0));

  for (int i = 0; i < 512; i++){
    if (stepsLeft <= 0 || tCur >= t1) break;

    if (fineDt <= 0.0){
      /* ── 粗探针：1 次采样判断这一格值不值得细追 ── */
      vec3 pp = ro + rd * tCur;
      float hh = (pp.y - uBase) / shell;
      if (coverAt(pp) * heightProfile(hh, uType) < 0.015){
        tCur += probeCell;
        gDbgSkips += 1.0;
        if (++skipGuard > 128) break;
        continue;
      }
      skipGuard = 0;
      cellEnd = min(tCur + probeCell, t1);
      float remain = max(t1 - tCur, 1.0);
      float share  = clamp(probeCell / remain, 0.0, 1.0);
      /* 距离自适应步长：近处细（结构看得见），远处粗（投影只剩几个像素） */
      float dtAdapt = clamp(tCur * 0.018, 70.0, 420.0);
      int nAdapt  = int(ceil((cellEnd - tCur) / dtAdapt));
      int nBudget = int(clamp(float(stepsLeft) * share * 1.7, 3.0, 16.0));
      int n = clamp(min(nAdapt, nBudget), 3, 16);
      fineDt = (cellEnd - tCur) / float(n);
      fineT  = tCur + jit * fineDt;
    }

    if (uDebug > 4.5){
      /* 高度剖面切片 + 抖动可视化：用来确认剖面和探针格的行为 */
      return vec4(heightProfile((ro.y + rd.y * fineT - uBase) / shell, uType),
                  hash12(gl_FragCoord.xy), 0.0, 1.0);
    }

    vec3  p = ro + rd * fineT;
    float h01;
    float d = cloudDensity(p, h01);
    gDbgSteps += 1.0;
    dSum += d; maxD = max(maxD, d);

    if (d > 0.002){
      float sigma = d * sigmaE;
      float a = 1.0 - exp(-sigma * fineDt);

      float directT, msShare;
      float Tms = multiScatterT(lightTau(p, sigmaE, uLightSteps), directT, msShare);

      /* 高次散射在云里被打散成近乎各向同性：把相位函数往 1/4π 拉，
         这才能让「背光面依然是亮的」——纯单次散射的云永远像石头。 */
      float phaseEff = mix(phase, 0.07957747, clamp(msShare, 0.0, 1.0) * 0.85);

      /* 粉化：低密度边缘在顺光侧变薄发亮，逆光侧保留 —— 云的「通透感」 */
      float powder = 1.0 - exp(-d * 8.0);
      float lit = clamp(0.45 + 0.55 * mu, 0.0, 1.0);
      float shade = mix(1.0, mix(powder, 1.0, lit), clamp(uPowder, 0.0, 1.0));

      vec3 sun  = uSunColor * (phaseEff * Tms * shade);
      vec3 amb  = mix(uSkyHorizon, uSkyTop, clamp(h01, 0.0, 1.0))
                * (0.26 + 0.62 * Tms) * uSkyScale * uAmbScale;
      vec3 col  = sun + amb;

      if (uAerial > 0.5){
        float aer = 1.0 - exp(-fineT * uAerialK);
        col = mix(col, haze, clamp(aer, 0.0, 0.96));
      }

      acc   += col * a * trans;
      trans *= (1.0 - a);
      outDist += fineT * a;
      wsum  += a;
      if (trans < 0.01) break;
    }

    stepsLeft--;
    fineT += fineDt;
    if (fineT >= cellEnd - 1e-3){ fineDt = 0.0; tCur = cellEnd; }
  }

  if (wsum > 0.0) outDist /= wsum; else outDist = t0 + (t1 - t0) * 0.4;

  if (uDebug > 5.5) return vec4(vec3(gDbgSteps / float(max(uSteps, 1))), 1.0);
  if (uDebug > 2.5) return vec4(clamp(dSum * 2.0, 0.0, 1.0), maxD, clamp(1.0 - trans, 0.0, 1.0), 1.0);
  if (uDebug > 0.5) return vec4(gDbgShape, gDbgCover, gDbgBody, 1.0);
  return vec4(acc, trans);
}

/* 天空：与云共用同一套 palette，云的霾色才有地方对齐 */
vec3 skyColor(vec3 rd){
  float y = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(uSkyHorizon, uSkyTop, pow(y, 0.48)) * uSkyScale;
  float s = max(dot(rd, uSunDir), 0.0);
  c += uSunColor * pow(s, 10.0) * 0.020;
  c += uSunColor * smoothstep(0.99955, 0.99985, s) * 2.4;
  return c;
}
// <<< CLOUD-KERNEL:END
`;

  /* ---------- 宿主自己的 main()：写在 kernel 标记区之外 ---------- */

  /* CLOUD pass：画布内 (u, vc) -> 视口比例 (u, v = vc * BAND_H) -> 方向。 */
  var CLOUD_MAIN_SRC = String.raw`
const float BAND_H = 0.26;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  float vc = 1.0 - uv.y;                 /* 画布内自上而下 0..1 */
  float v = vc * BAND_H;                 /* CONTRACT §5：v 是视口比例 */
  float sx = (uv.x - 0.5) * 2.0 * uAspect * uFovTan;
  float sy = (0.5 - v) * 2.0 * uFovTan;
  /* uCamBasis 的列 = (right, up, back)，-back 即 fwd */
  vec3 rd = normalize(uCamBasis * vec3(sx, sy, -1.0));
  float dist;
  vec4 cl = marchClouds(uCamPos, rd, dist);
  if (uStoreLdr > 0.5) cl = sqrt(max(cl, vec4(0.0)));   /* RGBA8 回退：sqrt 编码 */
  fragColor = cl;                        /* vec4(inScatter.rgb, transmittance) */
}
`;

  /* COMPOSITE pass：只输出云（天空由 CSS 提供），预乘 alpha = 1 - T。 */
  var COMPOSITE_MAIN_SRC = String.raw`
uniform sampler2D uCloudTex;
uniform vec2 uOutRes;

void main() {
  vec4 c = texture(uCloudTex, gl_FragCoord.xy / uOutRes);
  if (uStoreLdr > 0.5) c = vec4(c.rgb * c.rgb, c.a * c.a);
  vec3 col = max(c.rgb, vec3(0.0));
  col = col / (col + vec3(0.88)) * 1.10;
  col = pow(max(col, vec3(0.0)), vec3(1.0 / 2.2));
  fragColor = vec4(col, clamp(1.0 - c.a, 0.0, 1.0));
}
`;

  var ACCUM_MAIN_SRC = String.raw`
uniform sampler2D uPrev;
uniform sampler2D uCur;
uniform vec2 uRes;
uniform float uBlend;

void main() {
  vec2 uv = gl_FragCoord.xy / uRes;
  fragColor = mix(texture(uPrev, uv), texture(uCur, uv), uBlend);
}
`;

  var CLOUD_FS_SRC = HEADER_SRC + "\n" + CLOUD_KERNEL + "\n" + CLOUD_MAIN_SRC;
  var COMPOSITE_FS_SRC = HEADER_SRC + "\n" + CLOUD_KERNEL + "\n" + COMPOSITE_MAIN_SRC;
  var ACCUM_FS_SRC = HEADER_SRC + "\n" + ACCUM_MAIN_SRC;

  /* =====================================================================
     3D 噪声纹理：buildNoise / buildWorley 从 _lab/clouds/index.html 原样抄录
     （FBM 64³ 4 octave / Worley 32³ period 5）。
     下面两个 verbatim 函数是算法真相来源；真正的运行时生成使用分帧切片版本
     noiseSliceZ / worleySliceZ（同一套公式、同样的参数），每帧最多 ~8 ms。
     ===================================================================== */
  function buildNoise(size, octaves) {
    const data = new Uint8Array(size * size * size);
    const hash = (x, y, z) => {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const fade = (t) => t * t * (3 - 2 * t);
    const mix = (a, b, t) => a + (b - a) * t;
    const wrap = (v, p) => ((v % p) + p) % p;
    const noise = (x, y, z, p) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
      const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
      const at = (dx, dy, dz) => hash(wrap(xi + dx, p), wrap(yi + dy, p), wrap(zi + dz, p));
      const x00 = mix(at(0,0,0), at(1,0,0), xf), x10 = mix(at(0,1,0), at(1,1,0), xf);
      const x01 = mix(at(0,0,1), at(1,0,1), xf), x11 = mix(at(0,1,1), at(1,1,1), xf);
      return mix(mix(x00, x10, yf), mix(x01, x11, yf), zf);
    };
    const weights = [0.50, 0.26, 0.15, 0.09];
    let i = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let n = 0, amp = 0;
      for (let o = 0; o < octaves; o++) {
        const p = 4 << o;
        n += noise(x / size * p, y / size * p, z / size * p, p) * weights[o];
        amp += weights[o];
      }
      data[i++] = Math.max(0, Math.min(255, Math.round((n / amp) * 255)));
    }
    return data;
  }

  function buildWorley(size, period) {
    const data = new Uint8Array(size * size * size);
    const hash = (x, y, z) => {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const wrap = (v, p) => ((v % p) + p) % p;
    let i = 0;
    for (let z = 0; z < size; z++) for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x / size * period, py = y / size * period, pz = z / size * period;
      const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
      let best = 1e9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const wx = wrap(cx, period), wy = wrap(cy, period), wz = wrap(cz, period);
        const fx = cx + 0.15 + 0.70 * hash(wx, wy, wz);
        const fy = cy + 0.15 + 0.70 * hash(wx + 37, wy + 91, wz + 13);
        const fz = cz + 0.15 + 0.70 * hash(wx + 71, wy + 23, wz + 57);
        const dd = (fx - px) * (fx - px) + (fy - py) * (fy - py) + (fz - pz) * (fz - pz);
        if (dd < best) best = dd;
      }
      data[i++] = Math.max(0, Math.min(255, Math.round((1 - Math.min(1, Math.sqrt(best))) * 255)));
    }
    return data;
  }

  /* 单 z 切片版本：公式与上面 verbatim 函数逐字一致，只是把 z 循环拆出来分帧跑。 */
  function noiseSliceZ(data, size, octaves, z) {
    const hash = (x, y, zz) => {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(zz, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const fade = (t) => t * t * (3 - 2 * t);
    const mix = (a, b, t) => a + (b - a) * t;
    const wrap = (v, p) => ((v % p) + p) % p;
    const noise = (x, y, zz, p) => {
      const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(zz);
      const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
      const at = (dx, dy, dz) => hash(wrap(xi + dx, p), wrap(yi + dy, p), wrap(zi + dz, p));
      const x00 = mix(at(0,0,0), at(1,0,0), xf), x10 = mix(at(0,1,0), at(1,1,0), xf);
      const x01 = mix(at(0,0,1), at(1,0,1), xf), x11 = mix(at(0,1,1), at(1,1,1), xf);
      return mix(mix(x00, x10, yf), mix(x01, x11, yf), zf);
    };
    const weights = [0.50, 0.26, 0.15, 0.09];
    let i = z * size * size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      let n = 0, amp = 0;
      for (let o = 0; o < octaves; o++) {
        const p = 4 << o;
        n += noise(x / size * p, y / size * p, z / size * p, p) * weights[o];
        amp += weights[o];
      }
      data[i++] = Math.max(0, Math.min(255, Math.round((n / amp) * 255)));
    }
  }

  function worleySliceZ(data, size, period, z) {
    const hash = (x, y, zz) => {
      let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(zz, 1274126177);
      h = Math.imul(h ^ (h >>> 13), 1274126177);
      return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
    };
    const wrap = (v, p) => ((v % p) + p) % p;
    let i = z * size * size;
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const px = x / size * period, py = y / size * period, pz = z / size * period;
      const xi = Math.floor(px), yi = Math.floor(py), zi = Math.floor(pz);
      let best = 1e9;
      for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const cx = xi + dx, cy = yi + dy, cz = zi + dz;
        const wx = wrap(cx, period), wy = wrap(cy, period), wz = wrap(cz, period);
        const fx = cx + 0.15 + 0.70 * hash(wx, wy, wz);
        const fy = cy + 0.15 + 0.70 * hash(wx + 37, wy + 91, wz + 13);
        const fz = cz + 0.15 + 0.70 * hash(wx + 71, wy + 23, wz + 57);
        const dd = (fx - px) * (fx - px) + (fy - py) * (fy - py) + (fz - pz) * (fz - pz);
        if (dd < best) best = dd;
      }
      data[i++] = Math.max(0, Math.min(255, Math.round((1 - Math.min(1, Math.sqrt(best))) * 255)));
    }
  }

  /* p5 / p95（0..1）：kernel 用它把噪声标定到 0..1。 */
  function percentileRange(data) {
    const hist = new Float64Array(256);
    for (let i = 0; i < data.length; i++) hist[data[i]] += 1;
    const total = data.length;
    const loCount = total * 0.05, hiCount = total * 0.95;
    let acc = 0, lo = 0, hi = 255, haveLo = false;
    for (let v = 0; v < 256; v++) {
      acc += hist[v];
      if (!haveLo && acc >= loCount) { lo = v; haveLo = true; }
      if (acc >= hiCount) { hi = v; break; }
    }
    return [lo / 255, hi / 255];
  }

  /* ---------- GL 小工具 ---------- */

  function compileShader(gl, type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      if (window.console && console.error) console.error("[TideClouds] shader compile failed:\n" + log);
      return null;
    }
    return sh;
  }

  function buildProgram(gl, vsSrc, fsSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
    if (!vs) return null;
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
    if (!fs) { gl.deleteShader(vs); return null; }
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(prog);
      gl.deleteProgram(prog);
      if (window.console && console.error) console.error("[TideClouds] program link failed:\n" + log);
      return null;
    }
    return prog;
  }

  function locations(gl, prog, names) {
    const out = {};
    for (let i = 0; i < names.length; i++) out[names[i]] = gl.getUniformLocation(prog, names[i]);
    return out;
  }

  /* ---------- 实例 ---------- */

  function create(canvas, opts) {
    if (!canvas || typeof canvas.getContext !== "function") return null;
    if (typeof window.WebGL2RenderingContext === "undefined") return null;

    var gl = null;
    try {
      gl = canvas.getContext("webgl2", {
        alpha: true,
        antialias: false,
        depth: false,
        stencil: false,
        premultipliedAlpha: true,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance"
      });
    } catch (error) { gl = null; }
    if (!gl) return null;

    var options = opts || {};
    var floatExt = gl.getExtension("EXT_color_buffer_float") || gl.getExtension("EXT_color_buffer_half_float");

    var state = {
      ready: false,
      disposed: false,
      paused: !!options.paused,
      budgetMs: typeof options.budgetMs === "number" && isFinite(options.budgetMs) ? Math.max(0, options.budgetMs) : 6,
      autoScale: true,
      renderScale: clampNum(options.renderScale, 0.35, 1, 0.75),
      steps: Math.round(clampNum(options.steps, 20, 96, 48)),
      lightSteps: Math.round(clampNum(options.lightSteps, 1, 10, 5)),
      accumulate: options.accumulate !== false,
      ldr: false,
      time: 0,
      lastNow: 0,
      jitterIndex: 0,
      blendReset: true,
      cssW: 0, cssH: 0, dpr: 1,
      cloudW: 0, cloudH: 0,
      viewW: Math.max(1, window.innerWidth || 1280),
      viewH: Math.max(1, window.innerHeight || 800),
      noiseLo: 0.05, noiseHi: 0.95, worleyLo: 0.05, worleyHi: 0.95,
      ms: 0, avgMs: 0, fps: 0,
      emaCost: 0, emaInterval: 0, trend: 0,
      params: {
        coverage: 0.35, storm: 0.1, wind: 18, sunX: 0.5, sunY: 0.2,
        night: 0, haze: 0.6, sunColor: [1, 0.9, 0.76],
        skyTop: [0.07, 0.20, 0.42], skyHorizon: [0.52, 0.68, 0.82],
        hazeColor: [0.52, 0.68, 0.82], sunElevation: 20,
        flash: 0, seedX: 0, seedZ: 0,
        horizonY: DEFAULT_HORIZON_Y
      },
      basis: makeBasis(DEFAULT_HORIZON_Y)
    };
    state.autoScale = state.budgetMs > 0;

    /* ---------- programs ---------- */
    var progCloud = buildProgram(gl, VS_SRC, CLOUD_FS_SRC);
    var progAccum = buildProgram(gl, VS_SRC, ACCUM_FS_SRC);
    var progComposite = buildProgram(gl, VS_SRC, COMPOSITE_FS_SRC);
    if (!progCloud || !progAccum || !progComposite) {
      if (progCloud) gl.deleteProgram(progCloud);
      if (progAccum) gl.deleteProgram(progAccum);
      if (progComposite) gl.deleteProgram(progComposite);
      return null;
    }

    var U = {
      cloud: locations(gl, progCloud, [
        "uRes", "uTime", "uJitter", "uCamPos", "uCamBasis", "uFovTan", "uAspect",
        "uNoise", "uWorley", "uNoiseLo", "uNoiseHi", "uWorleyLo", "uWorleyHi",
        "uSeedXZ", "uCoverage", "uType", "uDensityMul", "uDetail", "uBase", "uTop",
        "uMaxDist", "uWind", "uSunDir", "uSunColor",
        "uSkyTop", "uSkyHorizon", "uHazeColor", "uSkyScale", "uAmbScale",
        "uAerial", "uAerialK",
        "uMSContrib", "uMSOccl", "uPowder", "uPhaseG", "uPhaseMix",
        "uSteps", "uLightSteps", "uStoreLdr", "uDebug"
      ]),
      accum: locations(gl, progAccum, ["uPrev", "uCur", "uRes", "uBlend"]),
      comp: locations(gl, progComposite, ["uCloudTex", "uOutRes", "uStoreLdr"])
    };
    gl.useProgram(progCloud);
    gl.uniform1i(U.cloud.uNoise, 0);
    gl.uniform1i(U.cloud.uWorley, 1);
    gl.useProgram(progAccum);
    gl.uniform1i(U.accum.uPrev, 0);
    gl.uniform1i(U.accum.uCur, 1);
    gl.useProgram(progComposite);
    gl.uniform1i(U.comp.uCloudTex, 0);

    var vao = gl.createVertexArray();
    gl.bindVertexArray(vao);

    /* ---------- 3D noise textures ---------- */
    var NOISE_SIZE = 64, NOISE_OCTAVES = 4, WORLEY_SIZE = 32, WORLEY_PERIOD = 5;
    var texNoise = gl.createTexture();
    var texWorley = gl.createTexture();

    function initVolumeTexture(tex) {
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.REPEAT);
    }
    initVolumeTexture(texNoise);
    initVolumeTexture(texWorley);

    function uploadVolume(tex, size, data) {
      gl.bindTexture(gl.TEXTURE_3D, tex);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
      gl.texImage3D(gl.TEXTURE_3D, 0, gl.R8, size, size, size, 0, gl.RED, gl.UNSIGNED_BYTE, data);
      gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
    }

    if (gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) < NOISE_SIZE) {
      gl.deleteTexture(texNoise); gl.deleteTexture(texWorley);
      gl.deleteProgram(progCloud); gl.deleteProgram(progAccum); gl.deleteProgram(progComposite);
      return null;
    }

    /* ---------- render targets（RGBA16F 优先，失败退回 RGBA8 + 关累积） ---------- */
    var cloudTarget = null, accA = null, accB = null, accRead = null, accWrite = null;

    function allocTarget(w, h, useFloat) {
      var tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, useFloat ? gl.RGBA16F : gl.RGBA8, w, h, 0, gl.RGBA,
        useFloat ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE, null);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      var fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
      var ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) { gl.deleteFramebuffer(fb); gl.deleteTexture(tex); return null; }
      return { tex: tex, fb: fb, w: w, h: h };
    }

    function freeTarget(t) {
      if (!t) return;
      gl.deleteFramebuffer(t.fb);
      gl.deleteTexture(t.tex);
    }

    var probeTarget = floatExt ? allocTarget(4, 4, true) : null;
    if (probeTarget) freeTarget(probeTarget);
    else state.ldr = true;
    if (state.ldr) state.accumulate = false;

    function allocateTargets() {
      freeTarget(cloudTarget); freeTarget(accA); freeTarget(accB);
      cloudTarget = accA = accB = accRead = accWrite = null;
      state.cloudW = Math.max(1, Math.round(state.cssW * state.renderScale));
      state.cloudH = Math.max(1, Math.round(state.cssH * state.renderScale));
      cloudTarget = allocTarget(state.cloudW, state.cloudH, !state.ldr);
      if (!cloudTarget && !state.ldr) {
        state.ldr = true;
        state.accumulate = false;
        cloudTarget = allocTarget(state.cloudW, state.cloudH, false);
      }
      if (!cloudTarget) return false;
      if (state.accumulate) {
        accA = allocTarget(state.cloudW, state.cloudH, true);
        accB = allocTarget(state.cloudW, state.cloudH, true);
        if (!accA || !accB) {
          freeTarget(accA); freeTarget(accB);
          accA = accB = null;
          state.accumulate = false;
        } else {
          accRead = accA;
          accWrite = accB;
        }
      }
      state.blendReset = true;
      return true;
    }

    function resize(cssW, cssH, dpr) {
      var w = Number(cssW), h = Number(cssH);
      if (!(w > 0.5) || !(h > 0.5)) {
        var rect = canvas.getBoundingClientRect();
        w = rect.width > 0.5 ? rect.width : (window.innerWidth || 1280);
        h = rect.height > 0.5 ? rect.height : ((window.innerHeight || 800) * BAND_H);
      }
      state.cssW = w;
      state.cssH = h;
      state.dpr = clampNum(dpr, 0.5, 2, window.devicePixelRatio || 1);
      state.viewW = Math.max(1, window.innerWidth || w);
      state.viewH = Math.max(1, window.innerHeight || h / BAND_H);
      var bw = Math.max(1, Math.round(w * state.dpr));
      var bh = Math.max(1, Math.round(h * state.dpr));
      if (canvas.width !== bw) canvas.width = bw;
      if (canvas.height !== bh) canvas.height = bh;
      return allocateTargets();
    }


    function ensureSize() {
      var rect = canvas.getBoundingClientRect();
      if (rect.width > 0.5 && rect.height > 0.5 &&
          (Math.abs(rect.width - state.cssW) > 0.5 || Math.abs(rect.height - state.cssH) > 0.5)) {
        resize(rect.width, rect.height, window.devicePixelRatio || 1);
      }
    }

    function onContextLost(event) { event.preventDefault(); state.ready = false; }
    canvas.addEventListener("webglcontextlost", onContextLost, false);

    /* ---------- 分帧噪声生成：每帧最多 ~8 ms，期间 render() 什么都不画 ---------- */
    var noiseData = new Uint8Array(NOISE_SIZE * NOISE_SIZE * NOISE_SIZE);
    var worleyData = new Uint8Array(WORLEY_SIZE * WORLEY_SIZE * WORLEY_SIZE);
    var tasks = [];
    var ti;
    for (ti = 0; ti < NOISE_SIZE; ti++) tasks.push({ kind: 0, z: ti });
    for (ti = 0; ti < WORLEY_SIZE; ti++) tasks.push({ kind: 1, z: ti });
    var taskIndex = 0;
    var genHandle = 0;
    var genUsesRaf = typeof window.requestAnimationFrame === "function";

    function stopGeneration() {
      if (!genHandle) return;
      if (genUsesRaf) window.cancelAnimationFrame(genHandle);
      else window.clearTimeout(genHandle);
      genHandle = 0;
    }

    function scheduleGeneration() {
      if (state.disposed || genHandle) return;
      if (genUsesRaf) genHandle = window.requestAnimationFrame(processSlices);
      else genHandle = window.setTimeout(processSlices, 16);
    }

    function processSlices() {
      genHandle = 0;
      if (state.disposed) return;
      var sliceStart = performance.now();
      while (taskIndex < tasks.length && performance.now() - sliceStart < 8) {
        var task = tasks[taskIndex++];
        if (task.kind === 0) noiseSliceZ(noiseData, NOISE_SIZE, NOISE_OCTAVES, task.z);
        else worleySliceZ(worleyData, WORLEY_SIZE, WORLEY_PERIOD, task.z);
      }
      if (taskIndex >= tasks.length) {
        var np = percentileRange(noiseData);
        var wp = percentileRange(worleyData);
        state.noiseLo = np[0];
        state.noiseHi = np[1];
        state.worleyLo = wp[0];
        state.worleyHi = wp[1];
        uploadVolume(texNoise, NOISE_SIZE, noiseData);
        uploadVolume(texWorley, WORLEY_SIZE, worleyData);
        state.ready = true;
        return;
      }
      scheduleGeneration();
    }

    /* ---------- 参数 ---------- */
    function readColor(src, fallback, limit) {
      if (!src || src.length < 3) return null;
      return [
        clampNum(src[0], 0, limit, fallback[0]),
        clampNum(src[1], 0, limit, fallback[1]),
        clampNum(src[2], 0, limit, fallback[2])
      ];
    }
    function colorDiff(a, b) {
      return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
    }

    /* CONTRACT §4 + kernel v2 新增字段。全部可选，缺省 = 不改变。 */
    function setParams(p) {
      if (!p || state.disposed) return;
      var q = state.params;
      var changed = false;
      var horizonChanged = false;
      var v, c;

      if (typeof p.coverage === "number") { v = clampNum(p.coverage, 0, 1, q.coverage); if (Math.abs(v - q.coverage) > 1e-4) changed = true; q.coverage = v; }
      if (typeof p.storm === "number") { v = clampNum(p.storm, 0, 1, q.storm); if (Math.abs(v - q.storm) > 1e-4) changed = true; q.storm = v; }
      if (typeof p.wind === "number") { v = clampNum(p.wind, 0, 120, q.wind); if (Math.abs(v - q.wind) > 1e-3) changed = true; q.wind = v; }
      if (typeof p.sunX === "number") { v = clampNum(p.sunX, -0.5, 1.5, q.sunX); if (Math.abs(v - q.sunX) > 1e-4) changed = true; q.sunX = v; }
      if (typeof p.sunY === "number") { v = clampNum(p.sunY, -0.5, 1.5, q.sunY); if (Math.abs(v - q.sunY) > 1e-4) changed = true; q.sunY = v; }
      if (typeof p.night === "number") { v = clampNum(p.night, 0, 1, q.night); if (Math.abs(v - q.night) > 1e-3) changed = true; q.night = v; }
      if (typeof p.haze === "number") { q.haze = clampNum(p.haze, 0, 2, q.haze); }
      if (typeof p.sunElevation === "number") { q.sunElevation = clampNum(p.sunElevation, -90, 90, q.sunElevation); }
      if (typeof p.flash === "number") { q.flash = clampNum(p.flash, 0, 1, q.flash); }
      if (typeof p.seedX === "number") { v = clampNum(p.seedX, -50000, 50000, q.seedX); if (Math.abs(v - q.seedX) > 1e-3) changed = true; q.seedX = v; }
      if (typeof p.seedZ === "number") { v = clampNum(p.seedZ, -50000, 50000, q.seedZ); if (Math.abs(v - q.seedZ) > 1e-3) changed = true; q.seedZ = v; }
      if (typeof p.horizonY === "number") {
        v = clampNum(p.horizonY, 0.05, 0.95, q.horizonY);
        if (Math.abs(v - q.horizonY) > 1e-5) { q.horizonY = v; horizonChanged = true; }
      }
      c = readColor(p.sunColor, q.sunColor, 2);
      if (c) { if (colorDiff(c, q.sunColor) > 2e-3) changed = true; q.sunColor = c; }
      c = readColor(p.skyTop, q.skyTop, 2);
      if (c) { if (colorDiff(c, q.skyTop) > 2e-3) changed = true; q.skyTop = c; }
      c = readColor(p.skyHorizon, q.skyHorizon, 2);
      if (c) { if (colorDiff(c, q.skyHorizon) > 2e-3) changed = true; q.skyHorizon = c; }
      c = readColor(p.hazeColor, q.hazeColor, 2);
      if (c) { if (colorDiff(c, q.hazeColor) > 2e-3) changed = true; q.hazeColor = c; }

      if (typeof p.paused === "boolean") state.paused = p.paused;
      if (horizonChanged) state.basis = makeBasis(q.horizonY);
      if (changed) state.blendReset = true;
    }

    function derivedParams() {
      var q = state.params;
      var storm = clampNum(q.storm, 0, 1, 0);
      var cov = clampNum(q.coverage, 0, 1, 0.3);
      var type = 1;
      if (storm < 0.30 && cov > 0.52) type = 0;
      else if (storm > 0.55) type = 2;
      var base, top, density, detail;
      /* 站点可见仰角只有 0°~15°：云底 900~1400 m、云顶 3000~4000 m */
      if (type === 0) { base = 900; top = 3000; density = 0.9; detail = 0.35; }
      else if (type === 1) { base = 1100; top = 3400; density = 1.2; detail = 0.6; }
      else { base = 1400; top = 4000; density = 2.0; detail = 0.75; }
      return {
        type: type,
        base: base,
        top: top + cov * 150,
        density: density * (0.85 + cov * 0.25),
        detail: clampNum(detail + (cov - 0.5) * 0.2, 0, 1),
        msc: clampNum(0.55 + storm * 0.3, 0.3, 0.95),
        mso: clampNum(0.85 + storm * 0.15, 0.3, 1.2),
        powder: clampNum(0.65 + storm * 0.25, 0, 2)
      };
    }

    function screenDir(u01, v01) {
      var fovTan = Math.tan(VFOV_DEG * 0.5 * DEG2RAD);
      var aspect = state.viewW / Math.max(1, state.viewH);
      var sx = (clampNum(u01, -1, 2, 0.5) - 0.5) * 2 * aspect * fovTan;
      var sy = (0.5 - clampNum(v01, -1, 2, 0.5)) * 2 * fovTan;
      var b = state.basis;
      var x = b.fwd[0] + sx * b.right[0] + sy * b.up[0];
      var y = b.fwd[1] + sx * b.right[1] + sy * b.up[1];
      var z = b.fwd[2] + sx * b.right[2] + sy * b.up[2];
      var len = Math.sqrt(x * x + y * y + z * z) || 1;
      return [x / len, y / len, z / len];
    }

    function jitterValue() {
      state.jitterIndex = (state.jitterIndex + 1) % 65536;
      var n = state.jitterIndex, inv = 0, f = 0.5;
      while (n > 0) {
        if (n & 1) inv += f;
        n >>= 1;
        f *= 0.5;
      }
      return inv;
    }

    /* ---------- 每帧设置 kernel 契约里的全部 uniform ---------- */
    function setCloudUniforms() {
      var c = U.cloud;
      var q = state.params;
      var d = derivedParams();
      var sunDir = screenDir(q.sunX, q.sunY);
      var night = clampNum(q.night, 0, 1, 0);
      var storm = clampNum(q.storm, 0, 1, 0);
      /* kernel 要的是「含艺术增益的辐亮度」：白天 ~11，夜间乘 ~0.06 */
      var sunGain = 11.0 * (1.0 - night * 0.94);
      var skyScale = (1.0 - night * 0.45) * (1.0 - storm * 0.12);

      gl.uniform2f(c.uRes, state.cloudW, state.cloudH);
      gl.uniform1f(c.uTime, state.time);
      gl.uniform1f(c.uJitter, jitterValue());
      gl.uniform3f(c.uCamPos, 0, CAM_HEIGHT, 0);
      gl.uniformMatrix3fv(c.uCamBasis, false, state.basis.m);
      gl.uniform1f(c.uFovTan, Math.tan(VFOV_DEG * 0.5 * DEG2RAD));
      gl.uniform1f(c.uAspect, state.viewW / Math.max(1, state.viewH));
      gl.uniform1f(c.uNoiseLo, state.noiseLo);
      gl.uniform1f(c.uNoiseHi, state.noiseHi);
      gl.uniform1f(c.uWorleyLo, state.worleyLo);
      gl.uniform1f(c.uWorleyHi, state.worleyHi);
      gl.uniform2f(c.uSeedXZ, clampNum(q.seedX, -50000, 50000, 0), clampNum(q.seedZ, -50000, 50000, 0));
      gl.uniform1f(c.uCoverage, clampNum(q.coverage, 0, 1, 0.3));
      gl.uniform1f(c.uType, d.type);
      gl.uniform1f(c.uDensityMul, d.density);
      gl.uniform1f(c.uDetail, d.detail);
      gl.uniform1f(c.uBase, d.base);
      gl.uniform1f(c.uTop, d.top);
      gl.uniform1f(c.uMaxDist, WORLD_MAX_DIST);
      gl.uniform1f(c.uWind, clampNum(q.wind, 0, 120, 18));
      gl.uniform3f(c.uSunDir, sunDir[0], sunDir[1], sunDir[2]);
      gl.uniform3f(c.uSunColor, q.sunColor[0] * sunGain, q.sunColor[1] * sunGain, q.sunColor[2] * sunGain);
      gl.uniform3f(c.uSkyTop, q.skyTop[0], q.skyTop[1], q.skyTop[2]);
      gl.uniform3f(c.uSkyHorizon, q.skyHorizon[0], q.skyHorizon[1], q.skyHorizon[2]);
      gl.uniform3f(c.uHazeColor, q.hazeColor[0], q.hazeColor[1], q.hazeColor[2]);
      gl.uniform1f(c.uSkyScale, skyScale);
      /* 站点天空很亮（奶油色），环境光要跟着抬，否则云的背光面会发灰发闷 */
      gl.uniform1f(c.uAmbScale, 1.7 + storm * 0.2);
      gl.uniform1f(c.uAerial, 1);
      gl.uniform1f(c.uAerialK, AERIAL_K);
      gl.uniform1f(c.uMSContrib, d.msc);
      gl.uniform1f(c.uMSOccl, d.mso);
      gl.uniform1f(c.uPowder, d.powder);
      gl.uniform1f(c.uPhaseG, 0.62);
      gl.uniform1f(c.uPhaseMix, 0.45);
      gl.uniform1i(c.uSteps, state.steps);
      gl.uniform1i(c.uLightSteps, state.lightSteps);
      gl.uniform1f(c.uStoreLdr, state.ldr ? 1 : 0);
      gl.uniform1f(c.uDebug, 0);
    }

    /* ---------- 三段式管线 ---------- */
    function drawFrame() {
      gl.bindVertexArray(vao);

      /* 1) CLOUD pass -> cloudTex = vec4(inScatter, T) */
      gl.bindFramebuffer(gl.FRAMEBUFFER, cloudTarget.fb);
      gl.viewport(0, 0, state.cloudW, state.cloudH);
      gl.disable(gl.BLEND);
      gl.useProgram(progCloud);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_3D, texNoise);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_3D, texWorley);
      setCloudUniforms();
      gl.drawArrays(gl.TRIANGLES, 0, 3);

      /* 2) ACCUM pass：RGBA16F ping-pong */
      var compositeTex = cloudTarget.tex;
      if (state.accumulate && accRead && accWrite) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, accWrite.fb);
        gl.viewport(0, 0, state.cloudW, state.cloudH);
        gl.useProgram(progAccum);
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_2D, accRead.tex);
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, cloudTarget.tex);
        gl.uniform2f(U.accum.uRes, state.cloudW, state.cloudH);
        /* 累积是这套方案的核心：uBlend≈0.12 → 约 8 帧收敛掉单帧条带。
           参数/分辨率变化时 blendReset 置 1，立刻接受新画面。 */
        var blend = state.blendReset ? 1.0 : 0.12;
        gl.uniform1f(U.accum.uBlend, blend);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        var swap = accRead;
        accRead = accWrite;
        accWrite = swap;
        compositeTex = accRead.tex;
      }
      state.blendReset = false;

      /* 3) COMPOSITE pass：只输出云，预乘混合 */
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(progComposite);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, compositeTex);
      gl.uniform2f(U.comp.uOutRes, canvas.width, canvas.height);
      gl.uniform1f(U.comp.uStoreLdr, state.ldr ? 1 : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.disable(gl.BLEND);
      gl.bindVertexArray(null);
    }

    /* ---------- 自动性能预算 ---------- */
    function applyAutoStep(dir) {
      var scaleChanged = false;
      if (dir < 0) {
        if (state.renderScale > 0.3501) {
          state.renderScale = Math.max(0.35, state.renderScale * 0.9);
          scaleChanged = true;
        } else if (state.steps > 20) {
          state.steps = Math.max(20, state.steps - 8);
        }
      } else if (state.renderScale < 0.9999) {
        state.renderScale = Math.min(1, state.renderScale * 1.1);
        scaleChanged = true;
      } else if (state.steps < 96) {
        state.steps = Math.min(96, state.steps + 8);
      }
      if (scaleChanged) allocateTargets();
      state.blendReset = true;
    }

    function perfSample(cpuMs, intervalMs) {
      if (!(intervalMs > 0) || !isFinite(intervalMs)) intervalMs = FRAME_MS;
      /* 云自己的 CPU 提交耗时 + 超出 60 fps 节拍的溢出，作为“实测帧耗时” */
      var overflow = Math.max(0, intervalMs - FRAME_MS);
      var cost = cpuMs + overflow;
      state.ms = cost;
      state.emaCost = state.emaCost > 0 ? state.emaCost + (cost - state.emaCost) * 0.1 : cost;
      state.emaInterval = state.emaInterval > 0 ? state.emaInterval + (intervalMs - state.emaInterval) * 0.1 : intervalMs;
      state.avgMs = state.emaCost;
      state.fps = state.emaInterval > 0 ? 1000 / state.emaInterval : 0;
      if (!state.autoScale || state.budgetMs <= 0) return;
      var hi = state.budgetMs * 1.15, lo = state.budgetMs * 0.7;
      if (state.emaCost > hi) {
        if (state.trend < 0) state.trend = 0;
        state.trend += 1;
      } else if (state.emaCost < lo) {
        if (state.trend > 0) state.trend = 0;
        state.trend -= 1;
      } else {
        state.trend = 0;
      }
      /* 迟滞：连续 24 帧同向才动作 */
      if (state.trend >= 24) { applyAutoStep(-1); state.trend = 0; }
      else if (state.trend <= -24) { applyAutoStep(1); state.trend = 0; }
    }

    function render(nowMs) {
      if (state.disposed || !state.ready || !cloudTarget) return;   /* 生成期间什么都不画 */
      if (document.hidden) return;                                 /* 后台不渲染 */
      ensureSize();
      if (!cloudTarget) return;
      var now = (typeof nowMs === "number" && isFinite(nowMs)) ? nowMs : performance.now();
      if (!state.lastNow) state.lastNow = now;
      var interval = now - state.lastNow;
      state.lastNow = now;
      if (!(interval > 0) || interval > 500) interval = FRAME_MS;
      if (!state.paused) state.time += Math.min(interval / 1000, 0.1);   /* paused 时不推进 uTime */
      var t0 = performance.now();
      drawFrame();
      perfSample(performance.now() - t0, interval);
    }

    function setQuality(quality) {
      if (!quality || state.disposed) return;
      if (typeof quality.renderScale === "number") {
        var s = clampNum(quality.renderScale, 0.35, 1, state.renderScale);
        if (Math.abs(s - state.renderScale) > 1e-6) {
          state.renderScale = s;
          allocateTargets();
          state.blendReset = true;
        }
      }
      if (typeof quality.steps === "number") {
        var st = Math.round(clampNum(quality.steps, 20, 96, state.steps));
        if (st !== state.steps) { state.steps = st; state.blendReset = true; }
      }
      if (typeof quality.lightSteps === "number") {
        var ls = Math.round(clampNum(quality.lightSteps, 1, 10, state.lightSteps));
        if (ls !== state.lightSteps) { state.lightSteps = ls; state.blendReset = true; }
      }
      if (typeof quality.accumulate === "boolean") {
        var acc = quality.accumulate && !state.ldr;
        if (acc !== state.accumulate) {
          state.accumulate = acc;
          if (acc) allocateTargets();
        }
      }
      if (typeof quality.budgetMs === "number" && isFinite(quality.budgetMs)) {
        state.budgetMs = Math.max(0, quality.budgetMs);
        state.autoScale = state.budgetMs > 0;
      }
    }

    function stats() {
      return {
        ms: state.ms,
        fps: state.fps,
        scale: state.renderScale,
        steps: state.steps,
        avgMs: state.avgMs,
        autoScale: state.autoScale
      };
    }

    function dispose() {
      if (state.disposed) return;
      state.disposed = true;
      stopGeneration();
      canvas.removeEventListener("webglcontextlost", onContextLost, false);
      freeTarget(cloudTarget); freeTarget(accA); freeTarget(accB);
      cloudTarget = accA = accB = accRead = accWrite = null;
      gl.deleteTexture(texNoise);
      gl.deleteTexture(texWorley);
      gl.deleteProgram(progCloud);
      gl.deleteProgram(progAccum);
      gl.deleteProgram(progComposite);
      gl.deleteVertexArray(vao);
      noiseData = worleyData = null;
      tasks = [];
      var lose = gl.getExtension("WEBGL_lose_context");
      if (lose) lose.loseContext();
      gl = null;
      if (canvas.parentNode) canvas.parentNode.removeChild(canvas);
    }

    var rect0 = canvas.getBoundingClientRect();
    resize(rect0.width, rect0.height, window.devicePixelRatio || 1);
    scheduleGeneration();

    return {
      setParams: setParams,
      setQuality: setQuality,
      resize: resize,
      render: render,
      stats: stats,
      dispose: dispose
    };
  }

  window.TideClouds = {
    create: create
  };
})();
