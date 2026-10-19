/* ============================================================================
   TIDELINE · ocean.js  —  realtime 3D sea surface (WebGL2, no dependencies)

   The wave model is ported from d-dev0101/open-sea-skin
   (MIT License, Copyright (c) 2026 Open Sea Skin contributors):
   five Gerstner swells with deep-water dispersion, analytic normals, an FBM
   chop normal, Fresnel sky reflection, sun glitter, crest foam and a horizon
   haze, all evaluated on the GPU every frame.

   What is different here: the sea is only the *lower* band of the page (the
   sky, sun, clouds and rain stay in the existing CSS/canvas atmosphere), the
   palette comes from weather.js instead of a private table, and the light can
   be the moon. Everything the shader draws is driven by Weather.state, so the
   sun you drag across the sky also drags its reflection across the water.

   Classic script, no modules, works from file://. If WebGL2 is missing the
   caller falls back to the Canvas-2D painter.
   ========================================================================= */
(function () {
  "use strict";

  // ── scene constants ------------------------------------------------------
  const HORIZON = 0.30;     // eye level inside the canvas (fraction from top)
  // The reference camera, unchanged: 55° vertical lens, eye 5.5 m above the
  // water, and — the part that actually makes the look — a high horizon, so
  // most of the frame is water seen at a working angle rather than a smear at
  // grazing incidence.  TIDELINE's CSS horizon is pinned to the same 34%.
  const VFOV_HALF = Math.tan((55 * Math.PI) / 360);
  const EYE = 5.5;
  const RING_A = 60;        // polar mesh: linear part of the radius ramp
  const RING_B = 4940;      //           ... and the far part (A + B = 5000 m)
  const DETAIL_OCTAVES = 3;

  // Five swells, straight from open-sea-skin: wavelength, steepness, heading.
  const WAVES = [
    { dx: 1.0, dy: 0.0, len: 60.0, steep: 0.12 },
    { dx: 0.6, dy: 0.8, len: 31.0, steep: 0.12 },
    { dx: -0.7, dy: 0.7, len: 18.0, steep: 0.09 },
    { dx: 0.3, dy: -0.95, len: 9.5, steep: 0.07 },
    { dx: -0.35, dy: -0.94, len: 5.0, steep: 0.05 },
  ].map((w) => {
    const len = Math.hypot(w.dx, w.dy);
    const k = (Math.PI * 2) / w.len;
    return {
      dx: w.dx / len,
      dy: w.dy / len,
      k,
      c: Math.sqrt(9.8 * k),
      a0: w.steep / k,
    };
  });

  const VERT_SRC = `#version 300 es
precision highp float;

in vec2 aGrid;              // x: 0..1 radius ramp, y: 0..1 heading
uniform float uTime;
uniform float uSea;
uniform float uEye;
uniform float uRingA;
uniform float uRingB;
uniform vec4 uWave[5];      // (dx, dy, k, c)
uniform float uAmp[5];
uniform vec2 uDrift;
uniform mat4 uProj;

out vec3 vWorld;
out vec2 vXZ;
out float vDist;
out float vCrest;

void main() {
  float t = aGrid.x;
  float ang = aGrid.y * 6.283185307179586;
  float r = uRingA * t + uRingB * pow(t, 6.0);
  vec2 grid = vec2(cos(ang), sin(ang)) * r;
  // Wind drifts the whole wave field downwind; the grid itself stays put.
  vec2 xz = grid - uDrift;

  vec3 p = vec3(grid.x, 0.0, grid.y);
  float crest = 0.0;
  for (int i = 0; i < 5; i++) {
    vec2 d = uWave[i].xy;
    float a = uAmp[i] * uSea;
    float f = uWave[i].z * (dot(d, xz) - uWave[i].w * uTime);
    float s = sin(f);
    float co = cos(f);
    p.x += a * d.x * co;
    p.y += a * s;
    p.z += a * d.y * co;
    crest += a * s;
  }

  vXZ = xz;
  vWorld = p;
  vCrest = crest;
  vDist = length(p - vec3(0.0, uEye, 0.0));
  gl_Position = uProj * vec4(p.x, p.y - uEye, p.z, 1.0);
}
`;

  const FRAG_SRC = `#version 300 es
precision highp float;

in vec3 vWorld;
in vec2 vXZ;
in float vDist;
in float vCrest;

uniform vec3 uCamera;
uniform float uTime;
uniform float uSea;
uniform float uRain;
uniform float uWind;
uniform float uStorm;
uniform float uCloud;
uniform float uStormy;
uniform float uFlash;
uniform float uMoon;
uniform float uLightGain;
uniform float uDetailRadius;
uniform float uOctaves;
uniform float uFoamOn;
uniform float uGlitterOn;
uniform float uExposure;
uniform float uChopStrength;
uniform vec2 uDrift;
uniform float uEye;

uniform vec3 uSkyTop;
uniform vec3 uSkyHorizon;
uniform vec3 uHazeColor;      // sRGB palette horizon, so the sea meets the CSS sky
uniform vec3 uDeep;
uniform vec3 uShallow;
uniform vec3 uSunColor;
uniform vec3 uSunDir;
uniform vec3 uFlashColor;

uniform vec4 uWave[5];
uniform float uAmp[5];

out vec4 fragColor;

vec3 waveNormal(vec2 xz) {
  float tx = 1.0, ty = 0.0, tz = 0.0;
  float bx = 0.0, by = 0.0, bz = 1.0;
  for (int i = 0; i < 5; i++) {
    vec2 d = uWave[i].xy;
    float a = uAmp[i] * uSea;
    float f = uWave[i].z * (dot(d, xz) - uWave[i].w * uTime);
    float s = sin(f);
    float co = cos(f);
    float aks = a * uWave[i].z * s;
    float akc = a * uWave[i].z * co;
    tx -= aks * d.x * d.x;
    ty += akc * d.x;
    tz -= aks * d.x * d.y;
    bx -= aks * d.x * d.y;
    by += akc * d.y;
    bz -= aks * d.y * d.y;
  }
  return normalize(cross(vec3(bx, by, bz), vec3(tx, ty, tz)));
}

float hash1(vec2 p) {
  vec2 q = p - floor(p / 289.0) * 289.0;
  return fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
}

vec2 hash2(vec2 p) {
  vec2 q = p - floor(p / 289.0) * 289.0;
  float a = fract(sin(dot(q, vec2(127.1, 311.7))) * 43758.5453);
  float b = fract(sin(dot(q, vec2(269.5, 183.3))) * 43758.5453);
  return vec2(a * 2.0 - 1.0, b * 2.0 - 1.0);
}

float gradNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  float n00 = dot(hash2(i), f);
  float n10 = dot(hash2(i + vec2(1.0, 0.0)), f - vec2(1.0, 0.0));
  float n01 = dot(hash2(i + vec2(0.0, 1.0)), f - vec2(0.0, 1.0));
  float n11 = dot(hash2(i + vec2(1.0, 1.0)), f - vec2(1.0, 1.0));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
}

float fbm(vec2 p) {
  float v = gradNoise(p);
  v += 0.5 * gradNoise(p * 2.04 + vec2(17.3, 9.1));
  if (uOctaves > 2.5) v += 0.25 * gradNoise(p * 4.11 + vec2(42.7, 28.6));
  return v;
}

float detailHeight(vec2 xz, float t) {
  float chop = 1.0 + uRain * 1.4 + uWind * 0.5;
  vec2 driftA = vec2(t * 0.55, t * 0.32);
  vec2 driftB = vec2(t * -0.4, t * 0.5);
  return fbm(xz * 0.85 + driftA) + fbm(xz * 2.1 * chop + driftB) * (0.45 + uRain * 0.35);
}

// Rain dimples: one drop per cell, an expanding ring whose slope is folded
// back into the normal. Only paid for while it is actually raining.
vec2 rainRipple(vec2 xz, float t) {
  vec2 q = xz * 1.5;
  vec2 cell = floor(q);
  vec2 f = q - cell - 0.5;
  float phase = fract(t * 0.8 + hash1(cell));
  float d = length(f);
  float ring = sin((d - phase * 0.7) * 30.0) * exp(-abs(d - phase * 0.7) * 10.0) * (1.0 - phase);
  return normalize(f + vec2(1e-4)) * ring;
}

vec3 skyColor(vec3 dir, float cloudMask) {
  vec3 d = normalize(dir);
  float up = clamp(d.y, -0.15, 1.0);
  vec3 col = mix(uSkyHorizon, uSkyTop, pow(max(up, 0.0), 0.42));
  col = mix(col, uDeep * 1.4 + uSkyHorizon * 0.25, smoothstep(0.0, -0.15, d.y));

  float s = max(dot(d, uSunDir), 0.0);
  col += uSunColor * pow(s, 10.0) * 0.45;
  col += uSunColor * smoothstep(0.9994, 0.9998, s) * 30.0;

  float band = smoothstep(0.03, 0.16, d.y) * smoothstep(0.6, 0.22, d.y);
  // Clear skies cost nothing: the cloud FBM is skipped outright.
  float amount = band * cloudMask * step(0.15, uCloud);
  if (amount > 0.001) {
    vec2 proj = d.xz / (d.y + 0.18) * 0.55;
    float n = clamp(fbm(proj + vec2(uTime * 0.006, uTime * 0.003)) * 0.5 + 0.5, 0.0, 1.0);
    float lo = mix(0.80, 0.28, uCloud);
    float cover = band * smoothstep(lo, min(1.0, lo + 0.3), n);
    vec3 cloud = mix(vec3(0.92, 0.90, 0.87), uSunColor * 0.5, 0.45);
    cloud *= mix(1.0, 0.34, uStormy);
    col = mix(col, cloud, cover * 0.6 * cloudMask);
  }
  return col;
}

vec3 aces(vec3 x) {
  return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0);
}

vec3 toSrgb(vec3 c) {
  vec3 lo = c * 12.92;
  vec3 hi = 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666)) - 0.055;
  return mix(lo, hi, step(vec3(0.0031308), c));
}

void main() {
  vec3 P = vWorld;
  vec3 V = normalize(uCamera - P);
  float dist = vDist;
  vec3 N = waveNormal(vXZ);
  vec3 N0 = N;                 // swell normal, before the chop is added
  float crest = vCrest;

  vec3 spec = vec3(0.0);
  float foam = 0.0;
  float chopBody = 1.0;

  // ── capillary chop ──────────────────────────────────────────────────────
  // The reference implementation verbatim: an FBM height field sampled by
  // finite difference gives the detail normal, and the same noise fields feed
  // the sparkle and the foam. Wind and rain only scale the result, so the
  // surface answers the weather without changing its character.
  float detailFade = 1.0 - smoothstep(uDetailRadius * 0.20, uDetailRadius * 0.70, dist);
  if (detailFade > 0.002) {
    // Coarsen the chop with distance: the same trick a mip chain does, which
    // stops far, grazing water from turning into a comb of aliased spikes.
    float lod = 1.0 / (1.0 + dist * 0.012);
    // Grazing incidence squashes the surface along the view axis by roughly
    // eye/dist, which is exactly what turns round chop into long radial
    // threads. Pre-stretch the noise along that axis by the same factor and
    // the grain comes back round on screen.
    float aniso = clamp(uEye / max(dist, 1.0), 0.04, 1.0);
    vec2 dxz = vec2(vXZ.x, vXZ.y * aniso) * lod;
    float e = 0.1 * lod;
    float h0 = detailHeight(dxz, uTime);
    float hx = detailHeight(dxz + vec2(e, 0.0), uTime);
    float hz = detailHeight(dxz + vec2(0.0, e), uTime);
    float detailScale = 1.5 * (uSea * 0.6 + 0.4) * uChopStrength * (1.0 + uRain * 0.9 + uWind * 0.35) * detailFade;
    vec2 slope = vec2(h0 - hx, h0 - hz) * detailScale;
    N = normalize(N + vec3(slope.x, 0.0, slope.y));

    // Capillary shading on the water body itself. At these angles the body is
    // almost all of the colour (the Fresnel term is a few per cent), so this is
    // where the chop has to show — the reference gets the same read from a sky
    // with a dark zenith, which our pale palette does not have.
    vec2 cs = clamp(slope * 0.55, vec2(-1.0), vec2(1.0));
    float chopShade = clamp(0.5 + 0.5 * (cs.x * 0.55 + cs.y * 0.85), 0.0, 1.0);
    chopBody = mix(1.0, 0.58 + 0.84 * chopShade, detailFade);

    // The glitter is taken from the *swell* normal, not the chopped one: with
    // a strong chop the tight lobe otherwise fires on every facet and the
    // whole surface turns into one radial smear. The chop still shows up —
    // through the reflection and through the body relief below.
    vec3 H = normalize(uSunDir + V);
    float ndh = max(dot(N0, H), 0.0);
    if (uGlitterOn > 0.5) {
      float sparkleNoise = clamp(fbm(vXZ * 0.3 + vec2(uTime * -0.07, uTime * 0.05)) * 0.5 + 0.5, 0.0, 1.0);
      float tight = mix(500.0, 220.0, uMoon);
      // The reference gains are dialled back a little: our sun sits low in the
      // sky band by design, and a low sun otherwise blows the whole mid-field
      // into one white band instead of a path.
      spec = uSunColor * (pow(ndh, tight) * mix(0.22, 1.15, sparkleNoise) + pow(ndh, 48.0) * 0.045);
    } else {
      spec = uSunColor * pow(ndh, 60.0) * 0.25;
    }

    if (uFoamOn > 0.5) {
      float foamNoise = clamp(fbm(dxz * 1.1 + vec2(uTime * 0.22, uTime * 0.14)) * 0.5 + 0.5, 0.0, 1.0);
      foam = smoothstep(0.42, 0.86, foamNoise) * smoothstep(0.45, 1.35, crest) * (0.9 + uStorm * 0.3);
    }
  }

  // Rain: expanding dimples on top of the chop, and a rougher micro-normal.
  // Both are gated to the near field, where a raindrop is actually resolvable.
  if (uRain > 0.05) {
    vec2 ripple = rainRipple(vXZ, uTime);
    N = normalize(N + vec3(ripple.x, 0.0, ripple.y) * (uRain * 1.6 * detailFade));
  }

  // Whitecaps on big swells keep reading past the detail radius, so the far
  // sea is not a smooth band of haze.
  foam = clamp(foam + smoothstep(1.35, 2.3, crest) * clamp(uSea * 0.45, 0.0, 1.0) * 0.45, 0.0, 0.95);

  // ── water body, reflection, foam (reference formulas) ───────────────────
  vec3 col = mix(uDeep, uShallow, clamp(crest * 0.35 + 0.45, 0.0, 1.0));

  // Body relief. The reference can lean on the sky reflection because its sky
  // runs from a dark zenith to a bright horizon; ours is a pale wash, and at
  // the angles where the water body dominates (the whole near field) a mirror
  // of that wash is a flat sheet. So the chop and swell slopes light the body
  // directly here — the same information, carried by the water instead.
  float relief = clamp(dot(N, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
  float reliefFade = 1.0 - smoothstep(25.0, 110.0, dist);
  col *= mix(1.0, 0.72 + 0.56 * relief, reliefFade);
  col *= chopBody;

  // backlit crest glow
  float sss = pow(max(dot(V, uSunDir), 0.0), 3.0) * max(crest, 0.0) * 0.18;
  col += uShallow * uSunColor * sss;

  // Fresnel sky reflection; clouds are only paid for where the reflection
  // actually matters.
  vec3 R = reflect(-V, N);
  R.y = max(R.y, 0.04);
  float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
  // A pale, nearly uniform sky: flatten the reflected gradient a little so the
  // swell shows as water rather than as hard light/dark bands.
  col = mix(col, mix(skyColor(R, fres > 0.25 ? 1.0 : 0.0), uSkyHorizon, 0.28), fres);

  col += spec;
  col = mix(col, vec3(0.82, 0.88, 0.90), foam);

  // lightning lights the whole surface, crests first
  col += uFlashColor * uFlash * (1.3 + 0.7 * max(N.y, 0.0));

  // horizon haze, then the same filmic curve the reference uses
  float horizonFade = smoothstep(150.0, 290.0, dist);
  col = mix(col, uSkyHorizon, horizonFade);

  col = toSrgb(aces(col * uExposure));

  // The CSS sky behind this canvas is not tone-mapped, so the last stretch of
  // the haze is pulled onto the palette's own horizon colour to keep the two
  // screens from showing a seam.
  col = mix(col, uHazeColor, smoothstep(240.0, 700.0, dist) * 0.85);

  fragColor = vec4(col, 1.0);
}
`;

  // ── small helpers --------------------------------------------------------
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerpNum = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
  const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));

  function linear3(src, out) {
    out[0] = srgbToLinear(src[0]);
    out[1] = srgbToLinear(src[1]);
    out[2] = srgbToLinear(src[2]);
    return out;
  }

  function srgb3(src, out) {
    out[0] = src[0];
    out[1] = src[1];
    out[2] = src[2];
    return out;
  }

  // Asymmetric perspective: the eye level sits HORIZON down the canvas, so the
  // 3D horizon lands exactly on the CSS horizon line at 47.8% of the viewport.
  // The horizontal half-angle is fixed and the vertical follows the canvas
  // aspect, i.e. a normal lens pointed at a wide strip of sea.
  function frustum(out, aspect, bottom, top, near, far) {
    const n0 = 1 - 2 * HORIZON;
    const vHalf = VFOV_HALF;
    const halfWidth = vHalf * Math.max(0.05, aspect);
    const b = -vHalf * (1 + n0);
    const t = vHalf * (1 - n0);
    const l = -halfWidth;
    const r = halfWidth;
    out[0] = (2 * near) / (r - l);
    out[1] = 0; out[2] = 0; out[3] = 0;
    out[4] = 0;
    out[5] = (2 * near) / (t - b);
    out[6] = 0; out[7] = 0;
    out[8] = (r + l) / (r - l);
    out[9] = (t + b) / (t - b);
    out[10] = -(far + near) / (far - near);
    out[11] = -1;
    out[12] = 0; out[13] = 0;
    out[14] = -(2 * far * near) / (far - near);
    out[15] = 0;
    return out;
  }

  function compileShader(gl, type, src) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const log = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error("shader: " + log);
    }
    return shader;
  }

  function buildProgram(gl, vertSrc, fragSrc) {
    const vs = compileShader(gl, gl.VERTEX_SHADER, vertSrc);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragSrc);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const log = gl.getProgramInfoLog(program);
      gl.deleteProgram(program);
      throw new Error("program: " + log);
    }
    const uniforms = {};
    const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i += 1) {
      const info = gl.getActiveUniform(program, i);
      if (!info) continue;
      const name = info.name.replace("[0]", "");
      uniforms[name] = gl.getUniformLocation(program, info.name);
    }
    // Drivers are free to flatten a uniform array into per-element uniforms
    // (Chrome does), in which case a single uniform4fv would only fill the
    // first wave. Address every element explicitly instead.
    const waves = [];
    const amps = [];
    for (let i = 0; i < 5; i += 1) {
      waves.push(gl.getUniformLocation(program, "uWave[" + i + "]"));
      amps.push(gl.getUniformLocation(program, "uAmp[" + i + "]"));
    }
    return { program, uniforms, waves, amps };
  }

  // Polar mesh: rings crowd the camera and stretch to the horizon, so the near
  // water gets sub-metre triangles without paying for them out at 5 km.
  function buildMesh(gl, rings, segments) {
    const verts = new Float32Array((rings + 1) * (segments + 1) * 2);
    let v = 0;
    for (let i = 0; i <= rings; i += 1) {
      for (let j = 0; j <= segments; j += 1) {
        verts[v] = i / rings;
        verts[v + 1] = j / segments;
        v += 2;
      }
    }
    const quads = rings * segments;
    const indices = new Uint32Array(quads * 6);
    let k = 0;
    for (let i = 0; i < rings; i += 1) {
      for (let j = 0; j < segments; j += 1) {
        const a = i * (segments + 1) + j;
        const b = a + 1;
        const c = a + segments + 1;
        const d = c + 1;
        indices[k] = a; indices[k + 1] = c; indices[k + 2] = b;
        indices[k + 3] = b; indices[k + 4] = c; indices[k + 5] = d;
        k += 6;
      }
    }
    return { verts, indices };
  }


  // ── the renderer ---------------------------------------------------------
  const scratch = {
    deep: [0, 0, 0],
    shallow: [0, 0, 0],
    skyTop: [0, 0, 0],
    skyHorizon: [0, 0, 0],
    haze: [0, 0, 0],
    sun: [0, 0, 0],
    waves: new Float32Array(20),
    amps: new Float32Array(5),
    proj: new Float32Array(16),
  };

  const Ocean = {
    active: false,
    available: false,
    reason: "",
    canvas: null,
    gl: null,
    program: null,
    uniforms: null,
    vao: null,
    buffers: null,
    indexCount: 0,
    rings: 0,
    segments: 0,
    scale: 1,
    aspect: 1,
    frames: 0,
    frameTime: 0,
    quality: null,
    time: 0,
    lastReason: "",

    init(canvas, options) {
      if (Ocean.active) return true;
      if (!canvas || typeof WebGL2RenderingContext === "undefined") {
        Ocean.reason = "no webgl2 api";
        return false;
      }
      if (/[?&]nogl=1/.test(window.location.search)) {
        Ocean.reason = "disabled by query";
        return false;
      }

      const attrs = {
        alpha: true,
        antialias: false,
        depth: true,
        stencil: false,
        premultipliedAlpha: false,
        preserveDrawingBuffer: false,
        powerPreference: "high-performance",
        failIfMajorPerformanceCaveat: false,
      };

      // Probe on a throwaway canvas first: a canvas that has ever handed out a
      // WebGL context can never give the 2D painter one, so the fallback path
      // has to stay untouched until the shaders are known to build.
      const probe = document.createElement("canvas");
      probe.width = 8;
      probe.height = 8;
      const probeGl = probe.getContext("webgl2", attrs);
      if (!probeGl) {
        Ocean.reason = "no webgl2 context";
        return false;
      }
      try {
        const built = buildProgram(probeGl, VERT_SRC, FRAG_SRC);
        probeGl.deleteProgram(built.program);
      } catch (err) {
        Ocean.reason = "shader: " + (err && err.message ? err.message : err);
        return false;
      }

      let gl = null;
      try {
        gl = canvas.getContext("webgl2", attrs);
      } catch (err) {
        gl = null;
      }
      if (!gl) {
        Ocean.reason = "context refused";
        return false;
      }

      try {
        const built = buildProgram(gl, VERT_SRC, FRAG_SRC);
        const verts = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, verts);
        const vao = gl.createVertexArray();
        gl.bindVertexArray(vao);
        const loc = gl.getAttribLocation(built.program, "aGrid");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        const index = gl.createBuffer();
        gl.bindVertexArray(null);

        gl.disable(gl.CULL_FACE);
        gl.disable(gl.BLEND);
        gl.enable(gl.DEPTH_TEST);
        gl.depthFunc(gl.LEQUAL);
        gl.clearColor(0, 0, 0, 0);

        Ocean.canvas = canvas;
        Ocean.gl = gl;
        Ocean.program = built.program;
        Ocean.uniforms = built.uniforms;
        Ocean.vao = vao;
        Ocean.buffers = { verts, index };
        Ocean.waveLocations = built.waves;
        Ocean.ampLocations = built.amps;
        Ocean.available = true;
        Ocean.active = true;
      } catch (err) {
        Ocean.reason = "init: " + (err && err.message ? err.message : err);
        Ocean.active = false;
        return false;
      }

      Ocean.setQuality(options && options.quality);
      Ocean.resize();
      return true;
    },
    setQuality(next) {
      if (!next || !Ocean.gl) return;
      Ocean.quality = next;
      const rings = Math.max(24, Math.round((next.oceanRings || 192) * 1));
      const segments = Math.max(24, Math.round(next.oceanSegments || 192));
      if (rings !== Ocean.rings || segments !== Ocean.segments) {
        Ocean.rings = rings;
        Ocean.segments = segments;
        const gl = Ocean.gl;
        const mesh = buildMesh(gl, rings, segments);
        Ocean.indexCount = mesh.indices.length;
        // The element-array binding is part of vertex-array state, so the VAO
        // has to be bound while the index buffer is attached or drawElements
        // runs with no indices at all.
        gl.bindVertexArray(Ocean.vao);
        gl.bindBuffer(gl.ARRAY_BUFFER, Ocean.buffers.verts);
        gl.bufferData(gl.ARRAY_BUFFER, mesh.verts, gl.STATIC_DRAW);
        const loc = gl.getAttribLocation(Ocean.program, "aGrid");
        gl.enableVertexAttribArray(loc);
        gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, Ocean.buffers.index);
        gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, mesh.indices, gl.STATIC_DRAW);
        gl.bindVertexArray(null);
      }
      // The surface detail sits at, and below, the pixel scale: rendering it at
      // full resolution turns capillary chop into threads, while a slightly
      // reduced buffer lets it resolve as the even grain the reference shows.
      Ocean.scale = 0.62;
      Ocean.resize();
    },

    resize() {
      const gl = Ocean.gl;
      const canvas = Ocean.canvas;
      if (!gl || !canvas) return;
      const rect = canvas.getBoundingClientRect();
      const cssW = Math.max(1, rect.width || canvas.clientWidth || 1);
      const cssH = Math.max(1, rect.height || canvas.clientHeight || 1);
      const cap = Math.min(Ocean.quality && Ocean.quality.dprCap ? Ocean.quality.dprCap : 2, 1.5);
      const dpr = Math.min(window.devicePixelRatio || 1, cap) * Ocean.scale;
      const w = Math.max(2, Math.round(cssW * dpr));
      const h = Math.max(2, Math.round(cssH * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      Ocean.aspect = w / h;
      gl.viewport(0, 0, w, h);
      frustum(scratch.proj, Ocean.aspect, 0, 0, 0.1, 9000);
    },

    // Palette + light for this frame, straight out of weather.js.
    applyLight(weather) {
      const gl = Ocean.gl;
      const u = Ocean.uniforms;
      const sky = (weather && weather.sky) || null;
      const top = (sky && sky.top) || [0.97, 0.94, 0.88];
      const horizon = (sky && sky.horizon) || [0.87, 0.92, 0.86];
      const seaDeep = (sky && sky.seaDeep) || [0.1, 0.44, 0.48];
      const seaFar = (sky && sky.seaFar) || [0.45, 0.76, 0.75];
      const sunPal = (sky && sky.sun) || [1, 0.97, 0.86];
      const night = weather && weather.isNight ? 1 : 0;
      const ambient = clamp(weather && weather.ambient != null ? weather.ambient : 1, 0, 1.4);
      const overcast = clamp((weather && weather.overcast) || 0, 0, 1);
      const stormy = clamp((weather && weather.storminess) || 0, 0, 1);
      const rain = clamp((weather && weather.rain) || 0, 0, 1);
      const wind = clamp((weather && weather.wind) || 0, 0, 1);
      const storm = clamp((weather && weather.storm) || 0, 0, 1);
      const cloud = clamp((weather && weather.cloudCover) || 0, 0, 1);
      const flash = clamp((weather && weather.flash) || 0, 0, 1);
      // open-sea-skin runs 0.25..1.75 across its wave slider; the weather
      // system's seaState is a 0..1 blend of wind, rain and storm, and the
      // lower half of that range reads as glass, so stretch it.
      const sea = 0.55 + clamp((weather && weather.seaState) || 0, 0, 1) * 1.3;

      const gain = (night ? 0.34 : 1.5) * (1 - overcast * 0.45) * (0.55 + ambient * 0.45);
      linear3(top, scratch.skyTop);
      linear3(horizon, scratch.skyHorizon);
      // The palette was mixed for a flat, painted sea over a pale sky. A lit 3D
      // surface needs a deeper body — and a *sky to reflect that has some
      // gradient in it*. The horizon end stays exactly the palette's (that is
      // what the CSS sky meets), while the zenith end is pulled towards a real
      // clear-sky blue, which is what makes the swell read instead of melting
      // into one flat sheet.
      linear3(seaDeep, scratch.deep);
      linear3(seaFar, scratch.shallow);
      for (let i = 0; i < 3; i += 1) {
        scratch.deep[i] *= 0.5;
        scratch.shallow[i] *= 0.58;
      }
      // The reference raises its sea on a sky with real depth: a dark blue
      // zenith over a bright horizon. Five per cent of it is what makes a chop
      // normal visible at all — a flat sky reflects the same colour whatever
      // the surface does. The horizon end stays the palette's, so the water
      // still meets the CSS sky exactly.
      const sunUp = clamp((weather && weather.sunElevation != null ? weather.sunElevation : 20) / 25, 0, 1);
      const nightMix = weather && weather.isNight ? 1 : 0;
      scratch.skyTop[0] = lerpNum(0.055, 0.09, sunUp) * (1 - nightMix * 0.7);
      scratch.skyTop[1] = lerpNum(0.10, 0.22, sunUp) * (1 - nightMix * 0.7);
      scratch.skyTop[2] = lerpNum(0.20, 0.45, sunUp) * (1 - nightMix * 0.6);
      srgb3(horizon, scratch.haze);
      scratch.sun[0] = srgbToLinear(sunPal[0]) * gain;
      scratch.sun[1] = srgbToLinear(sunPal[1]) * gain;
      scratch.sun[2] = srgbToLinear(sunPal[2]) * gain;

      // The sun/moon direction is read back off the CSS disc, so the glitter
      // path always points at the light the viewer can see and drag.
      const rect = Ocean.canvas.getBoundingClientRect();
      const vh = Math.max(1, window.innerHeight);
      const topF = rect.top / vh;
      const heightF = Math.max(0.0001, (rect.bottom - rect.top) / vh);
      const cy = (((weather && weather.sunY) || 0.32) - topF) / heightF;
      const n0 = 1 - 2 * HORIZON;
      let yView = VFOV_HALF * (1 - 2 * cy - n0);
      if (!(yView > 0.02)) yView = 0.02;
      // The sun disc is a layout element that has to stay inside the sky band,
      // so its screen height under-reads a real sun. Lift the *light* to a
      // plausible elevation — the azimuth, which is the part the eye checks
      // against the glitter, is untouched.
      const cssElev = (Math.atan(yView) * 180) / Math.PI;
      yView = Math.tan(((8 + cssElev * 1.6) * Math.PI) / 180);
      const xView = (((weather && weather.sunX) || 0.7) * 2 - 1) * VFOV_HALF * Math.max(0.05, Ocean.aspect);
      const len = Math.hypot(xView, yView, 1) || 1;

      for (let i = 0; i < WAVES.length; i += 1) {
        const w = WAVES[i];
        scratch.waves[i * 4] = w.dx;
        scratch.waves[i * 4 + 1] = w.dy;
        scratch.waves[i * 4 + 2] = w.k;
        scratch.waves[i * 4 + 3] = w.c;
        scratch.amps[i] = w.a0;
      }

      gl.useProgram(Ocean.program);
      const set1 = (name, value) => { if (u[name]) gl.uniform1f(u[name], value); };
      const set3 = (name, value) => { if (u[name]) gl.uniform3f(u[name], value[0], value[1], value[2]); };

      set1("uSea", sea);
      set1("uRain", rain);
      set1("uWind", wind);
      set1("uStorm", storm);
      set1("uCloud", cloud);
      set1("uStormy", Math.max(stormy, overcast * 0.6));
      set1("uFlash", flash);
      set1("uMoon", night);
      set1("uLightGain", ambient);
      set1("uEye", EYE);
      set1("uRingA", RING_A);
      set1("uRingB", RING_B);
      set1("uExposure", 1.18 + night * 0.35);
      set1("uOctaves", (Ocean.quality && Ocean.quality.oceanOctaves) || DETAIL_OCTAVES);
      set1("uDetailRadius", (Ocean.quality && Ocean.quality.oceanDetailRadius) || 150);
      set1("uFoamOn", Ocean.quality && Ocean.quality.oceanFoam === false ? 0 : 1);
      set1("uGlitterOn", Ocean.quality && Ocean.quality.oceanGlitter === false ? 0 : 1);
      set1("uChopStrength", (Ocean.quality && Ocean.quality.oceanChop) || 3.6);

      // Wind pushes the whole wave field downwind — direction and strength come
      // straight from the weather panel, so the swell swings with the wind.
      const windDir = (((weather && weather.windDirection) || 240) + 180) * (Math.PI / 180);
      const drift = wind * 0.9 * Ocean.time;
      if (u.uDrift) gl.uniform2f(u.uDrift, Math.cos(windDir) * drift, Math.sin(windDir) * drift);

      set3("uCamera", [0, EYE, 0]);
      set3("uSkyTop", scratch.skyTop);
      set3("uSkyHorizon", scratch.skyHorizon);
      set3("uHazeColor", scratch.haze);
      set3("uDeep", scratch.deep);
      set3("uShallow", scratch.shallow);
      set3("uSunColor", scratch.sun);
      set3("uSunDir", [xView / len, yView / len, -1 / len]);
      set3("uFlashColor", [0.82, 0.88, 1.0]);
      const waveLoc = Ocean.waveLocations || [];
      const ampLoc = Ocean.ampLocations || [];
      for (let i = 0; i < WAVES.length; i += 1) {
        if (waveLoc[i]) gl.uniform4f(waveLoc[i], scratch.waves[i * 4], scratch.waves[i * 4 + 1], scratch.waves[i * 4 + 2], scratch.waves[i * 4 + 3]);
        if (ampLoc[i]) gl.uniform1f(ampLoc[i], scratch.amps[i]);
      }
      if (u.uProj) gl.uniformMatrix4fv(u.uProj, false, scratch.proj);
    },

    draw(time, scene, weather, dt) {
      const gl = Ocean.gl;
      if (!gl || !Ocean.active || !Ocean.indexCount) return;
      Ocean.time = time;
      const u = Ocean.uniforms;
      Ocean.applyLight(weather);
      if (u.uTime) gl.uniform1f(u.uTime, time);

      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.useProgram(Ocean.program);
      gl.bindVertexArray(Ocean.vao);
      gl.drawElements(gl.TRIANGLES, Ocean.indexCount, gl.UNSIGNED_INT, 0);
      gl.bindVertexArray(null);

      // Adaptive resolution, only when the app is not already frame-capping us.
      if (dt > 0 && Ocean.quality && !Ocean.quality.waterFps) {
        Ocean.frames += 1;
        Ocean.frameTime += dt;
        if (Ocean.frameTime > 2) {
          const fps = Ocean.frames / Ocean.frameTime;
          let scale = Ocean.scale;
          if (fps < 42 && scale > 0.45) scale = Math.max(0.45, scale * 0.92);
          else if (fps > 56 && scale < 0.85) scale = Math.min(0.85, scale * 1.04);
          Ocean.frames = 0;
          Ocean.frameTime = 0;
          if (Math.abs(scale - Ocean.scale) > 0.001) {
            Ocean.scale = scale;
            Ocean.resize();
          }
        }
      }
    },

    dispose() {
      const gl = Ocean.gl;
      if (gl) {
        if (Ocean.program) gl.deleteProgram(Ocean.program);
        if (Ocean.buffers) {
          gl.deleteBuffer(Ocean.buffers.verts);
          gl.deleteBuffer(Ocean.buffers.index);
        }
        if (Ocean.vao) gl.deleteVertexArray(Ocean.vao);
      }
      Ocean.active = false;
      Ocean.gl = null;
    },
  };

  window.Ocean = Ocean;
})();
