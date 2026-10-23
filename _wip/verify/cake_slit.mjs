// 数值桩：这一刀的时间轴 + 台布上那条缝什么时候才准出现、宽多少。
// 抄的是 js/cakegate.js 的常量与公式（改那边要同步改这里）。
const clamp = (v, l, h) => (v < l ? l : v > h ? h : v);
const easeInOut = (u) => { u = clamp(u, 0, 1); return u < 0.5 ? 4*u*u*u : 1 - Math.pow(-2*u + 2, 3)/2; };

const CUT = 2.6, HOLD = 0.28, SLICE = 0.16, PAD = 12;
const W = 1440, H = 900;
const cs = Math.min(Math.max(W * 0.34, 320), 500);   // --cs = clamp(320, 34vw, 500)
const gapMax = Math.min(cs * 0.12, 64);

function frame(p) {
  const split = easeInOut(clamp((p - SLICE) / 0.42, 0, 1));
  const splitB = easeInOut(clamp((p - SLICE - 0.03) / 0.42, 0, 1));
  const dz = clamp((p - 0.34) / 0.66, 0, 1);
  const dive = clamp(dz * dz * (1.15 - 0.15 * dz), 0, 1);
  const gapNow = Math.max(split, splitB) * gapMax;
  const base = (gapNow + dive * 220) * (1 + dive * 2.25) / (1 + dive * 0.5);
  const slit = base > 0.5 ? base + PAD : 0;          // <=0 就是「布上不许有缝」
  // 屏幕上两半各让开多远（= 半条缝的宽度，缝应该略宽于它）
  const half = (gapNow + dive * 220) * (1 + dive * 2.25);
  const slitOnScreen = slit * (1 + dive * 0.5);
  return { p, split, dive, half, slit, slack: slitOnScreen - half };
}

const rows = [];
for (const p of [0, 0.05, 0.1, 0.16, 0.17, 0.2, 0.3, 0.4, 0.5, 0.7, 0.9, 1]) {
  const f = frame(p);
  rows.push(`p=${p.toFixed(2)} 让开=${f.split.toFixed(2)} 下潜=${f.dive.toFixed(2)} 两半=${f.half.toFixed(0).padStart(4)} 缝半宽=${f.slit.toFixed(0).padStart(4)} 余量=${f.slack.toFixed(0).padStart(4)}`);
}
console.log(`cs=${cs.toFixed(0)} gapMax=${gapMax.toFixed(1)} pad=${PAD}`);
console.log(rows.join('\n'));

const rest = frame(0), sliceEnd = frame(SLICE);
const fails = [];
if (rest.slit !== 0) fails.push('静置时布上还有缝（封面自己先裂了）');
if (sliceEnd.split !== 0) fails.push('还没划完两半就开始让开');
for (let i = 1; i <= 200; i++) {
  const f = frame(i / 200);
  if (f.slit !== 0 && f.slack <= 0) fails.push(`p=${f.p.toFixed(2)} 缝比让开的距离窄，会露布丝`);
}
const firstOn = (() => { for (let i = 0; i <= 1000; i++) { const f = frame(i / 1000); if (f.slit > 0) return f.p; } return null; })();
console.log(`\n静置：缝=${rest.slit}（必须 0）  划完那一刻：让开=${sliceEnd.split}（必须 0）`);
console.log(`缝第一次出现：p=${firstOn} → ${(HOLD + firstOn * CUT).toFixed(2)}s（刀划完 SLICE=${SLICE} 之后才该有）`);

const tipMin = Math.max(150, cs * 0.58);
console.log(`刀程 ${(tipMin * 2 + cs * 0.16).toFixed(0)}px：入口距圆心 ${tipMin.toFixed(0)}，终点落在圆心另一侧 ${(tipMin + cs * 0.16).toFixed(0)}`);
console.log(`全长 ${(HOLD + CUT).toFixed(2)}s：HOLD ${HOLD}s（只有一道亮缝）→ 划过 ${(SLICE * CUT).toFixed(2)}s → 让开 ${(0.42 * CUT).toFixed(2)}s → 下潜`);

if (fails.length) { console.error('\n✗ ' + fails.slice(0, 5).join('\n✗ ')); process.exit(1); }
console.log('\n✓ 静置无缝、划完才裂、缝始终比让开的距离宽');
