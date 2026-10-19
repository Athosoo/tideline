// ---------------------------------------------------------------------------
//  BUILD SOURCE for sea.bundle.js — not loaded by the page.
//
//  Run from this folder (GIFT/js):
//  npx esbuild sea-entry.js --bundle --format=iife --global-name=OpenSea \
//      --minify --outfile=sea.bundle.js
//
//  Needs the reference package's vendor folder next to this file (GIFT/js/vendor):
//    three.webgpu.js / three.tsl.js / three.core.js
//    addons/tsl/display/BloomNode.js
//    (from open-sea-skin's native-dist/vendor)
// ----------------------------------------------------------------------------

// ============================================================================
//  TIDELINE · open-sea port
//  The ocean renderer from d-dev0101/open-sea-skin (MIT, Copyright (c) 2026
//  Open Sea Skin contributors), used unmodified in substance: same Gerstner
//  swell, same TSL node material, same bloom pipeline, same camera framing.
//  Only the wiring changed — palette and weather come from TIDELINE, the sky
//  dome is drawn by the same renderer so the horizon has no seam.
// ============================================================================
import * as THREE from './vendor/three.webgpu.js';
import {
  Fn, pass, uniform, float, vec2, vec3, vec4, If,
  sin, cos, dot, cross, normalize, mix, pow, max, clamp, fract, floor,
  smoothstep, distance, reflect,
  positionLocal, positionWorld, cameraPosition,
} from './vendor/three.tsl.js';
import { bloom } from './vendor/addons/tsl/display/BloomNode.js';

// ── shared uniforms ─────────────────────────────────────────────────────────
const uTime = uniform(0);
const uSea = uniform(0.925);
const uSunDir = uniform(new THREE.Vector3(0, 0.5, -0.87));
const uSunColor = uniform(new THREE.Vector3(1, 1, 1));
const uHorizonColor = uniform(new THREE.Vector3(1, 1, 1));
const uZenithColor = uniform(new THREE.Vector3(1, 1, 1));
const uDeepColor = uniform(new THREE.Vector3(1, 1, 1));
const uShallowColor = uniform(new THREE.Vector3(1, 1, 1));
const uCloudCover = uniform(0.25);
const uStormy = uniform(0.0);
const uFlash = uniform(0.0);
const uCloudDetail = uniform(1.0);

// ── Gerstner swell (verbatim) ───────────────────────────────────────────────
const GERSTNER_DEFS = [
  { dir: [1.0, 0.0], wavelength: 60.0, steepness: 0.12 },
  { dir: [0.6, 0.8], wavelength: 31.0, steepness: 0.12 },
  { dir: [-0.7, 0.7], wavelength: 18.0, steepness: 0.09 },
  { dir: [0.3, -0.95], wavelength: 9.5, steepness: 0.07 },
  { dir: [-0.35, -0.94], wavelength: 5.0, steepness: 0.05 },
].map((w) => {
  const len = Math.hypot(w.dir[0], w.dir[1]);
  const dx = w.dir[0] / len;
  const dy = w.dir[1] / len;
  const k = (Math.PI * 2) / w.wavelength;
  const c = Math.sqrt(9.8 * k);
  return { dx, dy, k, c, a0: w.steepness / k };
});

const wavePosition = Fn(([xz, time, sea]) => {
  let x = xz.x;
  let y = float(0);
  let z = xz.y;
  for (const w of GERSTNER_DEFS) {
    const dir = vec2(w.dx, w.dy);
    const f = float(w.k).mul(dir.dot(xz).sub(time.mul(float(w.c))));
    const a = float(w.a0).mul(sea);
    x = x.add(a.mul(dir.x).mul(cos(f)));
    y = y.add(a.mul(sin(f)));
    z = z.add(a.mul(dir.y).mul(cos(f)));
  }
  return vec3(x, y, z);
});

const waveNormal = Fn(([xz, time, sea]) => {
  let tx = float(1), ty = float(0), tz = float(0);
  let bx = float(0), by = float(0), bz = float(1);
  for (const w of GERSTNER_DEFS) {
    const dir = vec2(w.dx, w.dy);
    const f = float(w.k).mul(dir.dot(xz).sub(time.mul(float(w.c))));
    const a = float(w.a0).mul(sea);
    const s = sin(f);
    const co = cos(f);
    const ak = a.mul(float(w.k));
    const aks = ak.mul(s);
    const akc = ak.mul(co);
    tx = tx.sub(aks.mul(dir.x).mul(dir.x));
    ty = ty.add(akc.mul(dir.x));
    tz = tz.sub(aks.mul(dir.x).mul(dir.y));
    bx = bx.sub(aks.mul(dir.x).mul(dir.y));
    by = by.add(akc.mul(dir.y));
    bz = bz.sub(aks.mul(dir.y).mul(dir.y));
  }
  return normalize(cross(vec3(bx, by, bz), vec3(tx, ty, tz)));
});

const waveCrest = Fn(([xz, time, sea]) => {
  let crest = float(0);
  for (const w of GERSTNER_DEFS) {
    const f = float(w.k).mul(vec2(w.dx, w.dy).dot(xz).sub(time.mul(float(w.c))));
    crest = crest.add(float(w.a0).mul(sea).mul(sin(f)));
  }
  return crest;
});

// ── procedural gradient noise + FBM (verbatim) ──────────────────────────────
const hash2 = Fn(([p]) => {
  const q = p.sub(floor(p.div(289)).mul(289));
  const a = sin(q.dot(vec2(127.1, 311.7))).mul(43758.5453);
  const b = sin(q.dot(vec2(269.5, 183.3))).mul(43758.5453);
  return vec2(fract(a).mul(2).sub(1), fract(b).mul(2).sub(1));
});

const gradNoise = Fn(([p]) => {
  const i = floor(p);
  const f = fract(p);
  const u = f.mul(f).mul(f.mul(f.mul(6).sub(15)).add(10));
  const g00 = hash2(i);
  const g10 = hash2(i.add(vec2(1, 0)));
  const g01 = hash2(i.add(vec2(0, 1)));
  const g11 = hash2(i.add(vec2(1, 1)));
  const n00 = g00.dot(f);
  const n10 = g10.dot(f.sub(vec2(1, 0)));
  const n01 = g01.dot(f.sub(vec2(0, 1)));
  const n11 = g11.dot(f.sub(vec2(1, 1)));
  return mix(mix(n00, n10, u.x), mix(n01, n11, u.x), u.y);
});

const fbm = Fn(([p]) => {
  const o1 = gradNoise(p);
  const o2 = gradNoise(p.mul(2.04).add(vec2(17.3, 9.1))).mul(0.5);
  const o3 = gradNoise(p.mul(4.11).add(vec2(42.7, 28.6))).mul(0.25);
  return o1.add(o2).add(o3);
});

const detailHeight = Fn(([xz, time]) => {
  const driftA = vec2(time.mul(0.55), time.mul(0.32));
  const driftB = vec2(time.mul(-0.4), time.mul(0.5));
  return fbm(xz.mul(0.85).add(driftA)).add(fbm(xz.mul(2.1).add(driftB)).mul(0.45));
});

// ── analytic sky (verbatim + TIDELINE cloud/storm gating) ───────────────────
const skyColor = Fn(([dir, cloudMask]) => {
  const d = normalize(dir);
  const up = clamp(d.y, -0.15, 1);
  const col = mix(uHorizonColor, uZenithColor, pow(max(up, 0), 0.42)).toVar();

  col.assign(mix(col, uDeepColor.mul(1.4).add(uHorizonColor.mul(0.25)), smoothstep(0, -0.15, d.y)));

  const s = max(dot(d, uSunDir), 0);
  col.addAssign(uSunColor.mul(pow(s, 10)).mul(0.18));
  col.addAssign(uSunColor.mul(smoothstep(0.9994, 0.9998, s)).mul(30));

  // ── cloud deck ──────────────────────────────────────────────────────────
  // The reference only painted a thin low band, which read as grey haze on the
  // horizon. Weather you can feel needs a deck: it covers the whole sky above
  // the haze, has two layers drifting at different speeds for parallax, is lit
  // along its top and dark underneath, turns its sunlit side towards the
  // light, darkens in a storm and lights up when lightning fires.
  const deck = smoothstep(0.012, 0.10, d.y);
  If(deck.mul(cloudMask).greaterThan(0.002), () => {
    const proj = d.xz.div(d.y.add(0.16));
    const p1 = proj.mul(2.4).add(vec2(uTime.mul(0.0050), uTime.mul(0.0026)));
    const p2 = proj.mul(6.0).add(vec2(uTime.mul(-0.0090), uTime.mul(0.0044)));
    const n1 = fbm(p1);
    const n2 = fbm(p2).mul(uCloudDetail.mul(0.68));
    const field = n1.add(n2);

    // Coverage keeps its structure at every setting: the threshold never drops
    // far enough to swallow the whole field, so a solid overcast is still made
    // of shapes with edges rather than one flat wash.
    const lo = mix(0.78, 0.02, uCloudCover);
    const cover = smoothstep(lo, lo.add(0.34), field).mul(deck);

    // Lit along the top, heavy underneath: the dark base sitting on the horizon
    // is what gives a storm its weight.
    const facing = clamp(dot(d, uSunDir).mul(0.5).add(0.5), 0, 1);
    const high = clamp(d.y.mul(2.4), 0, 1);
    const baseCol = vec3(0.22, 0.25, 0.30).mul(mix(float(0.5), float(1.0), high));
    const litCol = uSunColor.mul(mix(0.45, 1.05, facing));
    const cloudColor = mix(baseCol, litCol, high.mul(0.85).add(0.06))
      .mul(mix(float(1), float(0.35), uStormy));
    col.assign(mix(col, cloudColor, cover.mul(0.95)));

    // lightning lights the deck from the inside
    col.addAssign(uSunColor.mul(uFlash).mul(cover.mul(0.9).add(0.12)));
  });

  return col;
});

// ── ocean material (verbatim + lightning) ───────────────────────────────────
const DETAIL_RADIUS = 140;

const oceanColor = Fn(() => {
  const P = positionWorld;
  const xz = P.xz;
  const time = uTime;
  const sea = uSea;
  const dist = distance(P, cameraPosition);

  const N0 = waveNormal(xz, time, sea);
  const N = N0.toVar();
  const crest = waveCrest(xz, time, sea);
  const V = normalize(cameraPosition.sub(P));

  const spec = vec3(0).toVar();
  const foam = float(0).toVar();

  If(dist.lessThan(DETAIL_RADIUS), () => {
    const e = float(0.1);
    const h0 = detailHeight(xz, time);
    const hx = detailHeight(xz.add(vec2(e, 0)), time);
    const hz = detailHeight(xz.add(vec2(0, e)), time);
    const detailScale = float(1.5).mul(sea.mul(0.6).add(0.4));
    N.assign(normalize(N.add(vec3(h0.sub(hx), 0, h0.sub(hz)).mul(detailScale))));

    const H = normalize(uSunDir.add(V));
    const ndh = max(dot(N, H), 0);
    const sparkleNoise = clamp(fbm(xz.mul(0.3).add(vec2(time.mul(-0.07), time.mul(0.05)))).mul(0.5).add(0.5), 0, 1);
    spec.assign(uSunColor.mul(pow(ndh, 500).mul(mix(0.4, 3.4, sparkleNoise)).add(pow(ndh, 48).mul(0.12))));

    const foamNoise = clamp(fbm(xz.mul(1.1).add(vec2(time.mul(0.22), time.mul(0.14)))).mul(0.5).add(0.5), 0, 1);
    foam.assign(smoothstep(0.5, 0.95, foamNoise).mul(smoothstep(1.0, 2.0, crest)).mul(0.85));
  });

  const col = mix(uDeepColor, uShallowColor, clamp(crest.mul(0.35).add(0.45), 0, 1)).toVar();
  const sss = pow(max(dot(V, uSunDir), 0), 3).mul(max(crest, 0)).mul(0.18);
  col.addAssign(uShallowColor.mul(uSunColor).mul(sss));

  const R = reflect(V.negate(), N).toVar();
  R.y.assign(max(R.y, 0.04));
  const fresnel = float(0.02).add(float(0.98).mul(pow(float(1).sub(max(dot(N, V), 0)), 5)));
  col.assign(mix(col, skyColor(R.normalize(), fresnel.greaterThan(0.25)), fresnel));

  col.addAssign(spec);
  col.assign(mix(col, vec3(0.82, 0.88, 0.90), foam));
  col.addAssign(uSunColor.mul(uFlash).mul(1.6));

  const horizonFade = smoothstep(150, 290, dist);
  col.assign(mix(col, uHorizonColor, horizonFade));

  return vec4(col, 1);
});

// ── renderer / scene / camera (reference layout, no orbit controls) ─────────
function setVec(target, value) {
  if (!value) return;
  if (Array.isArray(value)) target.set(value[0], value[1], value[2]);
  else target.set(value.x, value.y, value.z);
}

export async function createSea(options) {
  const canvas = options.canvas;
  const state = { ready: false, scale: options.scale || 1 };

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: false,
    powerPreference: 'high-performance',
    alpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setSize(options.width, options.height, false);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x05070a);

  const camera = new THREE.PerspectiveCamera(55, options.width / Math.max(1, options.height), 0.5, 8000);
  camera.position.set(0, 5.5, 17);
  camera.lookAt(0, 1.5, 0);

  // their geometry, verbatim
  const oceanGeometry = new THREE.PlaneGeometry(420, 420, options.segments || 256, options.segments || 256);
  oceanGeometry.rotateX(-Math.PI / 2);

  const oceanMaterial = new THREE.MeshBasicNodeMaterial();
  oceanMaterial.positionNode = wavePosition(positionLocal.xz, uTime, uSea);
  oceanMaterial.colorNode = oceanColor();

  const ocean = new THREE.Mesh(oceanGeometry, oceanMaterial);
  ocean.frustumCulled = false;
  scene.add(ocean);

  // their sky dome, so the far plane edge dissolves into the horizon
  const skyMaterial = new THREE.MeshBasicNodeMaterial();
  skyMaterial.colorNode = skyColor(normalize(positionWorld), float(1));
  skyMaterial.side = THREE.BackSide;
  skyMaterial.depthWrite = false;
  const sky = new THREE.Mesh(new THREE.SphereGeometry(4000, 48, 24), skyMaterial);
  sky.renderOrder = -1;
  sky.frustumCulled = false;
  scene.add(sky);

  const post = new THREE.PostProcessing(renderer);
  const scenePass = pass(scene, camera);
  const sceneColor = scenePass.getTextureNode('output');
  post.outputNode = sceneColor.add(bloom(sceneColor, 0.32, 0.3, 0.9));

  await renderer.init();

  state.ready = true;
  state.backend = renderer.backend && renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl2';

  return {
    get ready() { return state.ready; },
    get backend() { return state.backend; },
    setSea(value) { uSea.value = value; },
    setTime(value) { uTime.value = value; },
    setSky(zenith, horizon) { setVec(uZenithColor.value, zenith); setVec(uHorizonColor.value, horizon); },
    setWater(deep, shallow) { setVec(uDeepColor.value, deep); setVec(uShallowColor.value, shallow); },
    setLight(dir, color) { setVec(uSunDir.value, dir); setVec(uSunColor.value, color); },
    setWeather(weather) {
      if (weather.cloud != null) uCloudCover.value = weather.cloud;
      if (weather.stormy != null) uStormy.value = weather.stormy;
      if (weather.flash != null) uFlash.value = weather.flash;
      if (weather.cloudDetail != null) uCloudDetail.value = weather.cloudDetail;
    },
    resize(width, height) {
      camera.aspect = width / Math.max(1, height);
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    },
    setQuality(quality) {
      const pr = Math.min(window.devicePixelRatio || 1, 1.5) * (quality && quality.scale ? quality.scale : 1);
      renderer.setPixelRatio(pr);
    },
    render() {
      post.render();
    },
    dispose() {
      oceanGeometry.dispose();
      sky.geometry.dispose();
      renderer.dispose();
    },
  };
}
