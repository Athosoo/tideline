// 数值桩：切开这一刀的时间轴与「缝比缝口宽」的余量。
// 抄的是 js/cakegate.js 的常量与公式（改那边要同步改这里）。
const clamp = (v, l, h) => (v < l ? l : v > h ? h : v);
const easeInOut = (u) => { u = clamp(u, 0, 1); return u < 0.5 ? 4*u*u*u : 1 - Math.pow(-2*u + 2, 3)/2; };

const CUT = 2.6, HOLD = 0.28, SLICE = 0.16;
const W = 1440, H = 900;
const cakeSize = Math.min(Math.max(W * 0.34, 320), 500);   // --cs = clamp(320, 34vw, 500)
const gapMax = Math.min(cakeSize * 0.12, 64);

let worst = Infinity, worstAt = 0;
const rows = [];
for (let i = 0; i <= 20; i++) {
  const p = i / 20;
  const split = easeInOut(clamp((p - SLICE) / 0.42, 0, 1));
  const dz = clamp((p - 0.34) / 0.66, 0, 1);
  const dive = clamp(dz * dz * (1.15 - 0.15 * dz), 0, 1);
  const gap = split * gapMax;
  const halfScreen = (gap + dive * 220) * (1 + dive * 2.25);        // 半块在屏幕上的位移
  const slitScreen = ((gap + dive * 220) * (1 + dive * 2.25)) / (1 + dive * 0.5) * (1 + dive * 0.5) + 6 * (1 + dive * 0.5);
  const slack = slitScreen - halfScreen;                            // >0 = 布丝压在蛋糕身下面
  if (p > 0.02 && p < 0.98 && slack < worst) { worst = slack; worstAt = p; }
  rows.push(`p=${p.toFixed(2)} split=${split.toFixed(2)} dive=${dive.toFixed(2)} 两半=${halfScreen.toFixed(0)} 缝=${slitScreen.toFixed(0)} 余量=${slack.toFixed(1)}`);
}

console.log(rows.join('\n'));
console.log(`\n最小余量 ${worst.toFixed(1)}px @ p=${worstAt}（必须 > 0）`);

const corner = Math.hypot(W / 2, H / 2);
const endSlit = (gapMax + 220) * 3.25 + 9;
console.log(`dive=1 缝半宽 ${endSlit.toFixed(0)}px vs 屏幕对角半长 ${corner.toFixed(0)}px → ${endSlit > corner ? '布已被缝整个吃掉 ✓' : '还差 ' + (corner - endSlit).toFixed(0) + 'px ✗'}`);

const tipMin = Math.max(150, cakeSize * 0.58);
// 刀尖从入口（距圆心 dist）沿「刀尖→圆心」推 sliceLen = 2*dist + size*0.16，
// 终点落在圆心另一侧 dist + size*0.16 处，比盘沿（半径 size/2）更外。
console.log(`刀程 ${(tipMin * 2 + cakeSize * 0.16).toFixed(0)}px：入口距圆心 ${tipMin.toFixed(0)}，终点落在圆心另一侧 ${(tipMin + cakeSize * 0.16).toFixed(0)}（盘沿半径 ${(cakeSize / 2).toFixed(0)}，越过 ${(tipMin + cakeSize * 0.16 - cakeSize / 2).toFixed(0)}px）`);
console.log(`全长 ${(HOLD + CUT).toFixed(2)}s：HOLD ${HOLD}s → 划过 ${(SLICE * CUT).toFixed(2)}s → 让开 ${(0.42 * CUT).toFixed(2)}s`);

if (!(worst > 0)) { console.error('缝比缝口窄了，布会从缝里露出来'); process.exit(1); }
