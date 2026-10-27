# TIDELINE — 交接文档

> 写给下一个对话（代号：**女儿**）。
> 你接手的不是从零开始的项目，是一个**已经能跑、已经过目验**的站点。
> 站点规则（技术红线 / 两档画质 / 日月行为）在 `SITE-RULES.md`；工作区规范与跨仓库时间线在仓库外面（工作区根 `AGENTS.md`、`docs/WORKLOG.md`）。
> 读完这份文档你就能直接上手，不需要重新考古一遍前面几万字的上下文。

> **⚠️ 2026-10-21 晚 · 计划重定，先读 `TODO.md`。**
> FULL **不做云**（只做光景：日出日落、色温、过渡）；LITE **要做云**且风格化（动画电影感）。
> **云的开发全部搬进实验室并无限期暂停**，等用户说「启动」。旧址 `_wip/` 已整体丢失。

---

## 0. 三十秒速览

- **项目**：`E:\DeepSeekplay\GIFT` —— 3D 明信片环廊展示站，名字 **TIDELINE**。
- **技术栈**：纯静态 HTML/CSS/JS，**没有构建步骤**（唯一例外：海面渲染器的离线打包）。
- **海面**：从 `d-dev0101/open-sea-skin`（MIT）**原样搬过来**的 three.js TSL/WebGPU 渲染器，
  用 esbuild 打成本地 IIFE（`js/sea.bundle.js`），**不走任何 CDN**。
- **分支**：工作树在 `feat/soft-clouds`；`main` 停在 `d490965`（只含日月轨迹）；`feat/volumetric-clouds` 保留已废止的体素云。
- **当前主线**：FULL 的光景系统（日出日落 / 色温 / 过渡平滑），见 `TODO.md` §2。

---

## 1. 绝对不能破坏的铁律

1. **双击 `index.html` 必须能跑**（`file://` 协议）。
   → 不能用 ES module（会被 CORS 拦死）；不能运行时拉 CDN；所有脚本都是 `<script defer src="...">` 传统脚本。
   → 所以三位一体的 three.js 必须打成 IIFE 才能用。
2. **海面渲染器必须是原版搬运，不是重新实现。**
   用户原话："我指的是抄那个海洋的渲染" / "需要包的话你给他打包不就行了吗" / "是啊，就是让你抄啊"。
   你如果又手写一版 Gerstner 波，方向就错了 —— **原版就在本地，去打包它**。
3. **明信片横竖切换必须是刚体旋转**：容器与内容相对静止、一起旋转，**不形变、不拉伸**。
4. **门只开不关**。开屏是一道单向门：往回滚会被环形走廊夹住，也**没有任何按钮**可点 ——
   2026-10-23 用户要求「进入海洋长廊后就不能返回」，左上角 TIDELINE 品牌按钮的返回行为已删除
   （`returnToCover()` / `state.returningToCover` / 光标提示 `COVER` 一并拿掉，品牌只剩一个 `div`）。
   `wrapCorridorScroll()` 因此只剩 `introHidden` 一道闸。
5. **沉浸模式**：去掉周围交互提示，只保留作为内容的文字与画面。
6. **LITE 模式**：给弱机用，保留光照与交互、降低精度与更新率。
   用户后来追加：**LITE 要回到最初那个"线条海面"**（Canvas-2D 手绘风）。
7. **云 / 雨的过渡是故意做阻尼延迟的**（滑杆 → 目标值 → 阻尼跟随；长按召云是 ramp 爬升）。
   用户专门提醒过："你自己验证的时候不要自我怀疑……因为延迟的问题而钻牛角尖觉得修改没生效。"
   → 验证时**直接置位状态**，不要盯着滑杆等它自己爬。
8. 用户的中文反馈往往很短且口语化，但每句都是需求。别过度解释，直接改、直接给证据。
9. **长廊本身（明信片卡片）不许被打穿**：`.postcard` 是长廊卡片的类名（`css/styles.css:955`，
   `position: absolute; inset: 0` 撑满 `.postcard-slot`）。封面 / 开屏 / 任何新道具若要复用这个
   类名，样式必须收在自己的作用域里（现例：`.prop--postcard .postcard …`）。用户为这条发过火：
   「你把里面的这个长廊的明信片展示搞坏了」。

---

## 2. 文件地图（全部在 `E:\DeepSeekplay\GIFT`）

```
GIFT/
├── index.html                 页面结构（唯一入口，file:// 直接打开）
├── README.md / THIRD-PARTY-NOTICES.md
├── css/styles.css             全部样式（地平线变量 --horizon: 26%）
├── js/                        页面加载的 7 个脚本（文件名不变，勿再散放回根目录）
│   ├── clouds.js              【已停止加载 · 冻结】体积云（WebGL2 零依赖；仍是 sync-kernel.mjs 的注入目标，勿删勿改名）
│   ├── weather.js             天气/时间系统 + 2D 云画布
│   ├── sea.bundle.js          esbuild 产物（原版海面，IIFE 全局 OpenSea）
│   ├── ocean.js               手写 WebGL2 后备海面
│   ├── audio-assets.js        海鸥录音 base64（生成的，见 docs/AUDIO.md；勿手改）
│   ├── audio.js               声音引擎（IIFE 全局 TideAudio；海浪/海风/海鸥/开屏拟音/音乐）
│   ├── cakegate.js            开屏蛋糕动画状态机（动作点里调 TideAudio.cue）
│   ├── app.js                 主逻辑
│   └── sea-entry.js           bundle 构建源，页面不加载
├── assets/                    明信片图 + 内嵌字体 + 月球贴图（进仓库）
│   └── audio/music/           背景音乐投放目录（音频 gitignore，只留 README）
├── docs/                      站点文档：HANDOFF / SITE-RULES / AUDIO / TODO
└── 1/ 2/ 3/                   原始素材（已 gitignore，不发布；本地保留）
```

| 文件 | 大小 | 作用 |
|---|---|---|
| `index.html` | 42 KB | 结构 + 大气层元素；脚本顺序 **js/weather.js → js/sea.bundle.js → js/ocean.js → js/audio-assets.js → js/audio.js → js/cakegate.js → js/app.js**（`js/clouds.js` 已不再加载） |
| `js/app.js` | 104 KB (~2320 行) | 主逻辑：环廊、卡片、聚焦、开门、天气接线、海面后端调度、质量档 |
| `css/styles.css` | 74 KB | 全部样式；地平线对齐变量 `--horizon: 26%` |
| `js/weather.js` | 29 KB | 天气/时间系统：晴雨云、风、闪电、月相；含 2D 云画布绘制 |
| `js/audio.js` | 95 KB (~2230 行) | 声音引擎：5 类声音 / 24 段素材（20 段程序化烘焙 + 4 段海鸥录音）；混响、退水、随机排程、HRTF 海鸥；**行为与参数见 `docs/AUDIO.md`** |
| `js/audio-assets.js` | 105 KB | 4 段 xeno-canto 海鸥录音（base64 内嵌，CC BY 4.0，署名见 `THIRD-PARTY-NOTICES.md` §5） |
| `js/cakegate.js` | 56 KB | 开屏蛋糕动画状态机；时间轴常量 `APPROACH/FLY/CUT/HOLD/SLICE` 也是拟音的对齐基准 |
| `js/sea-entry.js` | 14 KB | **bundle 的构建源**，页面不加载它。原版海面 + TIDELINE 的调色/天气接线 |
| `js/sea.bundle.js` | 790 KB | esbuild 产物，页面真正加载的是它（IIFE，全局 `OpenSea`） |
| `js/ocean.js` | 33 KB | **手写 WebGL2 后备海面**（`?nogl=1` 可强制跳过） |
| `1/ 2/ 3/` | — | 用户的原始素材，**不要动**；已加入 `.gitignore` 并从 git 取消跟踪（本地保留，不随仓库发布） |
| `assets/` | 232 KB | 明信片图、字体、月球贴图 |
| `README.md` | 15 KB | 项目文档：渲染器来源、云盖、调色、三级回落、LITE 对照表 |

---

## 3. 架构：海面是三级回落，不是一套

页面启动时 `startSea()`（js/app.js:978）依次尝试：

| 级别 | 主体 | 触发条件 | 备注 |
|---|---|---|---|
| ① 原版引擎 | `js/sea.bundle.js` → `OpenSea.createSea()` | 默认 | 成功时给 `<body>` 加 `has-sea-bundle` 类 |
| ② 手写 WebGL2 | `js/ocean.js` → `window.Ocean` | 引擎失败 / `?nogl=1` | 极坐标网格 + FBM 细节 |
| ③ Canvas-2D | `WaterPainter`（js/app.js:964） | ① ② 都不可用 | **"最初的线条海面"** —— LITE 要回到的就是它 |

关键变量（js/app.js:960–962）：`waterPainter` / `glOcean` / `seaEngine`，同一时刻只有一个在画。

**`has-sea-bundle` 这个类是开关**：引擎接管时它负责隐藏 2D 海、`sky-wash`、`shore-glow`、
以及 **2D 云画布**（css/styles.css 里的 `body.has-sea-bundle` 规则组）。引擎没起来时 2D 云画布自然接管。
→ **做 LITE 线条海面时，LITE 路径不能加这个类**，否则云会消失。

### 3.1 引擎给的接口（`OpenSea.createSea({canvas,width,height,segments})`）

```
setSea(v)                       // 浪高 0.25..1.75
setTime(t)                      // 累积时间（state.waterTime）
setSky(zenith, horizon)         // 天顶 / 地平线颜色
setWater(deep, shallow)         // 深水 / 浅水颜色
setLight(sunDir, sunColor, sunI, ...)  // 太阳方向与强度
setWeather({cloudCover, stormy, flash, cloudDetail})
resize(w, h)
setQuality({ scale })
render()
dispose()
```

### 3.2 每帧接线：`applySeaFrame()`（js/app.js:1046）

调色板来自 `SEA_PALETTE`（js/app.js:1010）＋ `seaPaletteFor(weather)`（js/app.js:1021）。

> ⚠️ **调色板必须给"参考风"的线性值**（暗蓝天顶 + 亮地平线）。
> 如果你把 CSS 那种偏白的 sRGB 天色直接喂给引擎，**海面会被洗成平的**。
> 引擎把颜色当线性值处理，这是踩过的坑。

太阳方向由 CSS 里那个太阳圆盘的位置反推（带一点抬高：`9 + cssElev * 1.7`）。

> ⚠️ **太阳的视觉外观与海面取光走两套来源，别混用**：海面读 `weather.sunX/sunY` 与
> `state.sky.sun`（`ocean.js:680`、`app.js:922`）；画面上那颗日盘的颜色/光晕读
> `SUN_LOOK`（`js/weather.js:260`，按高度角查表）。日盘尺寸是常数（`weather.js:315`），
> 因为真实太阳视直径恒定，变大的是光晕 `--sun-bloom-scale`。

> ⚠️ **两个已经踩过的坑（2026-10-22，别再踩）**：
> 1. **`mix-blend-mode` 会被层叠上下文吃掉**：`.celestial` 自带 `transform`（视差）和
>    `z-index: 1`，两者都会建立层叠上下文，于是写在内层 `.celestial-bloom` / `.celestial-disc`
>    上的 `mix-blend-mode: screen` 只跟内层兄弟混合，整个太阳组最后按 `normal` 合成 ——
>    日盘变成一块不透明贴片（这就是「太阳不耀眼」的真正原因）。混合模式必须写在**组**上：
>    `.celestial { mix-blend-mode: screen }`（`GIFT/css/styles.css:721`），
>    月亮单独回退 `.celestial.is-moon { mix-blend-mode: normal }`（`styles.css:725`）。
> 2. **可见的天空不归 `weather.js` 管**：默认路径下天空是 WebGL 引擎用
>    `SEA_PALETTE`（`GIFT/js/app.js:1132`，线性光，引擎自己 tone-map）画的，
>    `body.has-sea-bundle` 下 `.sky-wash` / `.light-glow` / `.shore-glow` 都被 `display:none`
>    （`styles.css:2902-2904`）。所以 `--sky-*` / `--sun-halo` 改了页面不会变
>    （实测：`P.day.top` 改纯蓝，渲染像素 (640,8) 仍是 (205,210,215)）。
>    想让白天天空更蓝 → 改 `SEA_PALETTE.day`。

> ⚠️ **月亮高度是太阳高度取反**（`js/weather.js` 的 `visualElev`：
> 夜里 `clamp(-sunElevationRaw, 0, 74)`）。任何「月亮升到多高」的判断都必须先取反，
> 直接拿 `state.sunElevationRaw` 算会恒得负数 —— 旧的 `--moon-path` 光带就踩过这个坑（该层 2026-10-24 已删）。

> ⚠️ **夜里的海面是「暗底 + 一条月光路」，不是均匀提亮**：这条路现在是**纯引擎**的 ——
> `SEA_PALETTE.night.sunI` 抬到 1.55 之后 specular 自己就能连成带颗粒的波光，方向跟随
> `weather.sunX/sunY`。2026-10-24 已删掉叠在上面的那条 CSS 三角形光带，**别再补回来**：
> 那层是贴死的渐变、不随波浪走，用户要求「海面真正响应，做不到就不做」。
> 水体颜色（`deep` / `shallow`）不要跟着提亮，否则整片海会变成黄昏色。

> ⚠️ **「波光跟不跟日月走」要分三层看**（2026-10-23 用户追问「是否是技术做不到」——
> **做得到，而且引擎层一直跟着**，卡住观感的是另外两层）：
> ① 引擎层：`js/app.js` 的 `applySeaFrame()` 把 `weather.sunX/sunY` 换算成光方向交给
>    `setLight`，再进 `js/sea-entry.js` 的 `uSunDir`；平水面高光点的横坐标恒等于 `2*sunX-1`，
>    也就是永远落在盘的正下方。这条线不要动。
> ② 曾经还有一层 CSS 静态假光（三角形光带 + 贴底反光）：贴底那团写死 `at 50% 101%`、不跟波浪走，
>    是「假」的根源。2026-10-24 已整层删除 —— 用户要的是海面真正响应，做不到就不做。
> ③ Canvas-2D 后备层：`WaterPainter.draw` 的 `shimmers` 横坐标原来只由随机数与场景漂移决定，
>    与光方向完全无关；现在以 `sunX * width` 为带心散开，并按横向偏移给每道亮纹倾角。
> 改动后跑 `node _wip/verify/moon_path.mjs`：它静态断言假光层（html / css / js 里的 `moon-path`）
> 已彻底消失、引擎接线还在，再把 `applySun` 搬进沙箱扫一整夜，并用 60fps 位移流验证夜里每帧都在动
> （单帧最大 0.32px、无重复台阶）。

### 3.3 质量档：`QUALITY_PRESETS`（js/app.js:265）

`full` / `lite` 两套，含 `dprCap`、`waterFps`、`cloudFps`、`fbmOctaves`，
以及引擎旋钮 `oceanRings / oceanSegments / oceanOctaves / oceanDetailRadius / oceanFoam / oceanGlitter / oceanChop`。
`oceanChop`：full 3.6 / lite 1.8；`oceanDetailRadius`：140 / 70。
`applyQuality()`（js/app.js:359）里对引擎下发 `setQuality({scale: lite ? 0.75 : 1})`。
另有 AUTO 探测（js/app.js:426，低于 45 fps 自动落 lite）。

### 3.4 环廊几何 / 地平线

- 地平线在视口 **26%** 处（引擎 fov 55°、俯角 13.2° 算出来的夹角）。
  CSS 用 `--horizon: 26%`；`js/weather.js` 里对应常量是 `horizonY = 25.2`。
  **动地平线要三处一起动**，否则云和海会错位。
- 环廊滚动：`getScrollMax()` / `updateScrollMetrics()`（1153/1157），
  **双向环形包裹**在 `wrapCorridorScroll()`（1188）。往回滚靠它才不会误触关门。
- 卡片渲染：`buildCards()`（517）、`applyCardTransforms()`（1331）、
  聚焦刚体旋转：`focusTiltTransform()`（1447）/ `readFocusSpin()`（1458）/ `syncCardAnglesToFocus()`（1487）。
- 开门/关门：`openPostcard()`（1726）/ `closePostcard()`（1865）。**没有关门路径** —— 开屏是单向门，
  台布不会再缝上；`stitch()`（`js/cakegate.js:866`）留着当状态机兜底，界面已无入口。
- 主循环：`animate()`（2123）——先画 `seaEngine`，再画卡片。
- 缩放/尺寸：`handleResize()`（1947）负责把引擎一起 `resize()`。
- 沉浸模式：`setImmersive()`（2218）。

---

## 4. 已经做完的（别重做）

- **站点主体**：环廊、浮空明信片、随机位置与倾角、双面卡片带厚度、滚动驱动相机、
  开门式入场、点击放大、翻转、点外部返回。
- **无限环廊**：7 张卡（03 是用户那张 150×100 的像素风景卡，04–07 是占位），
  前进滚到底连续绕回开头，**双向**都成立。
- **横竖刚体旋转**：聚焦时 `-90°` 旋转整个容器（`.focus-spin`），不做宽高形变，
  背面 `rotateX(180deg)`（验证过矩阵 `matrix(0,-1,1,0,0,0)`）。
- **天气/时间系统**：系统时间 + 实时天气、动画化变化、**可拖动的日月**（水平拖动即改时刻，
  跟手 1:1，右缘 = 东、左缘 = 西）、**双击日月切昼夜 = 1 秒快进半天**（不是原地换图）。
  **顶部 WEATHER 控件已整块删除**（2026-10-23 用户两次要求：先删 TIME 滑杆，再删那条
  WEATHER 药丸和它展开的 AUTO / RESET 面板）—— 页面右上角现在没有任何时间控件。
  云量/风雨/雷电滑杆本来就在 `SITE-RULES.md` §2 里禁止，「长按日/月召云」那条路径也早已不存在。
- **LITE 开关**（弱机模式）。
- **关门途径收敛**：只有品牌按钮能关门；往回滚不再触发。
- **沉浸模式**。
- **原版海面接入**：`js/sea-entry.js` + `js/sea.bundle.js`，三级回落，AUTO 质量探测。
- **云盖（刚做完，`87e8f07`）**：原版天空只在仰角 2°–35° 画了一条低云带，
  而我们的相机只看得到仰角 ~14° 以内，于是永远只看到那条带子的下缘 —— 一层灰雾。
  改成**覆盖整个天顶的云盖**：两层不同速度 FBM 做视差、云顶受光、云底压暗、
  迎光侧发亮、风暴压黑、闪电从内部点亮、底部淡出到地平线雾色（交界无硬边）。
  同时把 CSS 那个 2D 云画布重新锚到 26% 地平线，之前它覆盖到视口 58%，**压在海面上**，
  就是你当时看到的那条"突兀的硬边"。
  验证：云量 8% / 50% / 95% → 天空亮度均值 **192 / 189 / 165**。
- **开屏掉帧（`bcae247` / `3c2ba98` / `5f6a444` / `358c61d`）**：台布不透明地盖着时，
  海面和长廊都在画看不见的像素。四处改动：① 海面 canvas 的 rect 每个视口只量一次，
  不再每帧 `getBoundingClientRect`（那是采样剖析的第一名，自耗时 1441.8ms）；
  ② 布缝还闭着时跳过长廊的 `updateScrollState` / `applyCardTransforms`
   （`CakeGate.isSealed()` 判定，`?noparkcorr=1` 可关）；③ 缝闭着时摘掉
   `.cloth` 的 `clip-path`（`.is-whole`）；④ 把布的十几个静态子层各自提成合成层
   （`.cloth > * { will-change: transform }`），clip 变成合成期掩膜而不是每帧重栅格化。
  cut 相位 38.2 → 27.1ms/帧、p90 66.8 → 34、fly 46.8 → 41.1、封面静置 60fps 不掉帧。
- **蜡烛别每帧改尺寸（`a5fdac4`）**：推近那一秒原来每帧写 38 支蜡烛的 `left/top/height`
  和两个火焰尺寸，`invalidationTracking` 里 `Style changed @SPAN.candle` 1938 次。
  每写一次就重排蜡烛行、并重栅格化 76 个带两层 blur 阴影的伪元素。现在位置/压扁/火焰收缩
  全部走合成器：位置 = 一个 `translate3d`，烛身压扁 = 同一条 transform 里的 `scaleY(chs)`，
  火焰 = 伪元素的 `scale: var(--flame-sx) var(--flame-sy)`（父级 `scaleY` 会连坐伪元素，
  纵向因此要乘 `1/chs`；与父矩阵相乘后净效果是缩小，栅格不用重做），光晕只抵消纵向压扁
  以保持屏幕上 46px。fly 36–44 → 23–25ms/帧、p90 83 → 33–50，aim 稳定 16.7ms 零掉帧。
  **教训**：`width/height/left/top` 每帧写一次就是一次布局 + 一次重栅格；
  能用 `transform`/`scale`/`translate` 表达的动画，就永远不要碰几何属性。
  `?cake=aim` 可把镜头冻结在俯视姿态，截静态帧做像素比对最省事。
- **声音系统（`js/audio.js` + `js/audio-assets.js`）**：五类声音——海浪、海风、
  偶发海鸥、开屏拟音、背景音乐。浪与风是程序化合成的循环 buffer（跟着 `Weather.state`
  的 `seaState`/`wind`/`gust` 实时变），拍岸不是定时器而是**随机排程**（`planSwell`：
  45% 概率起一组 2–4 道、组内逐道变高、15% 概率「歇一口气」），跟在后面的还有
  **退水层**；开屏拟音按 `cakegate.js` 的时间轴常量逐拍对齐；海鸥是 4 段 xeno-canto
  真实录音（base64 内嵌，CC BY 4.0），用 **HRTF 3D 声源「飞过」**；背景音乐由使用者
  自己放 `assets/audio/music/`（有版权，不进仓库；`1-05. Minecraft.mp3/.ogg` 都认）。
  **大小起伏**由两层慢变量给：「海况档位」`surge`（离散 OU 游走 + 浪起时的临时 bump，
  5–14 s 换档，0.20–1.40）与「底板跟着刚有没有浪退」`bedBreath/windBreath`；
  离线渲染 `bakeAmbientTimeline()` 与线上 `update()` **同构**（否则量着绿、耳朵还是平）。
  **M 键静音**，`?audio=0` 一开始就静音。烘焙分片藏在加载屏与封面阅读期，不占首帧。
  实测（`_wip/shots/audio/s33`，42/42 通过）：烘焙 **1036 ms**；`gate` 0→1 时
  `amb` **0.22→0.82**；`ambient` 混音 L/R 相关 **0.316**、侧能量 **34.4%**
  （`space` 段 0.062 / 46.9%）；两段 60 s 的 1 s 窗 RMS p90/p10 **3.03 / 4.06**、
  安静占比 0.08 / 0.18；M 键 `master` 0.996→0.004 且落地 `localStorage`。
  **行为、参数、接口、验证、已知限制全部在 `docs/AUDIO.md`** —— 改声音先读它。

---

## 5. 待办（按用户指定的顺序）

### 任务 B · 风与雨作用于海面

改 `js/sea-entry.js`，然后重建 bundle。要做的事：

1. **风**：新增 `uWind`（方向 + 强度）。毛细浪顺着风向**拉长**、沿风向放大；
   风速提升时白冠/泡沫增多；加一层顺风的水面条纹（streak）。
2. **雨**：新增 `uRain`。雨滴在水面砸出**涟漪场** —— 世界坐标播种、环半径随时间扩张、
   扰动法线；再叠一层粗糙微法线表示雨幕；大雨时加水汽。
3. **风暴联动**：水体压暗，闪电**同时**点亮海面和云盖（`uFlash` 已经在用，扩到海面明暗）。

改完必须重建：

```bash
cd /e/DeepSeekplay/GIFT
VENDOR=/c/Users/18316/.dsh/profiles/desktop/node_modules/open-sea-skin/native-dist/vendor
cp -r "$VENDOR" ./js/vendor     # 必须放 js/ 下：js/sea-entry.js 的 import 是 ./vendor/...
npx esbuild js/sea-entry.js --bundle --format=iife --global-name=OpenSea --minify --outfile=js/sea.bundle.js
rm -rf ./js/vendor
```

> ⚠️ **`vendor/` 没有提交进 git**（965 KB 的 three.js 三件套，重建时可临时拷回来）。
> 它就是上面那个本地包 `open-sea-skin/native-dist/vendor`，里面有：
> `three.webgpu.js` / `three.tsl.js` / `three.core.js` / `addons/tsl/display/BloomNode.js`。
> 仓库里没有就别乱找，直接照抄这条命令。

### 任务 C · LITE 改回最初的线条海面

- LITE 时**不要走引擎**，走 Canvas-2D 的 `WaterPainter`（js/app.js:964）—— 也就是最初那个线条海面。
- 注意：这条路径**不能加 `has-sea-bundle`**，2D 云画布要留在场上显示云。
- 目前 LITE 只是给引擎降精度（`setQuality({scale: 0.75})`），要改成后端切换。
  顺手检查 `applyQuality()`（359）、`handleResize()`（1947）、`animate()`（2123）三处的分支。

### 可选补测

- 风暴 + 闪电状态下的云盖截图（之前那次失败是抓图工具抖，不是产品问题）。

---

## 6. 怎么验证（照这个来，别自己发明）

用户要的是**看得到的证据**，不是"我改好了"。固定套路：

1. **起 CDP 无头浏览器**（Node 24 自带全局 `WebSocket`，不用装包）：
   ```
   CHROME="/c/Program Files/Google/Chrome/Application/chrome.exe"
"$CHROME" --headless=new --enable-unsafe-swiftshader --use-angle=swiftshader \
          --allow-file-access-from-files --remote-debugging-port=9222 file:///E:/DeepSeekplay/GIFT/index.html
   ```
2. **抓海面截图不用 `Page.captureScreenshot`** —— 在这个重负载合成下它会回 "Unable to capture screenshot"。改成在页面里 `render()` 之后**立刻** `canvas.toDataURL()` 把像素捞出来。
3. **测纹理细节**用 PIL 高通标准差（`GaussianBlur(3)` 后取 std），别用肉眼或平均亮度判断"有没有变平"。
4. **必须断言"当前真正在跑的是哪个后端"** 和关键 uniform 的实际取值。
   > 血的教训：有次 shader 编译报错静默回落到 Canvas-2D，我连测几轮数字一模一样，
   > 还以为是"改动没生效"在钻牛角尖。**先证明你测的东西真的在跑，再讨论数字。**
5. **验证延迟/阻尼类改动时直接置位状态**（绕开滑杆与 ramp），别等它自己爬上来。
6. **收尾清理**：临时目录（`_qa*/` 已 gitignore）、临时 Chrome profile、本地静态服务器全部删掉。
   上一轮就是因为留了一堆临时垃圾，用户才要在关对话前问"清理干净了吗"。
7. **声音改动走 `docs/AUDIO.md` §6 的四道**：`audio_bake_test.mjs`（Node 里跑烘焙 + FFT，
   不启浏览器，最快）→ `audio_random_test.mjs`（纯 Node 跑 5000 步 `planSwell`，验随机性是
   真的随机：间隔 std、声像分布、10 分钟指纹重复 0 次）→ `audio_smoke.mjs`
   （真 Chrome + CDP，验 `gate` 曲线、海鸥样本、M 键、静音、立体声指标、烘焙耗时；
   加 `--long` 再验 60 s 环境声的循环周期性）→ `renderPreview` 导 WAV 用
   `audio_analyze.py` 看频谱 / 直接听。
   声音是听感问题，脚本只能证明「没坏」，最终判据还是耳朵。

### 6.1 已知的技术深坑（省你几个小时）

| 坑 | 真相 |
|---|---|
| shader 静默失效 | Chrome 会把 `uniform vec4 uWave[5]` 扁平化，必须**逐个**取 location。曾经 5 个 Gerstner 波只有 1 个是活的 |
| 画布全黑 | GL 错误 1282：`ELEMENT_ARRAY_BUFFER` 必须在**绑定 VAO 之后**绑 |
| `'N0' : undeclared identifier` | 删 `vec3 N0 = N;` 会连带炸掉后面的引用，加回来 |
| 改完没变化 | 先看有没有回落后端；再看是不是阻尼/ramp 还没爬到位 |
| 大 heredoc 截断 | 约 8 KB 会截断；写大文件要分块 `cat >> file` 追加 |
| 反斜杠塌缩 | heredoc 里 `\` 会变成 `\`；写脚本优先落地成文件再执行 |
| `ops_replace` | 会裁掉 pattern 第一行的前导空白 —— pattern 别以空格开头 |
| 三种颜色空间 | CSS 的 sRGB 天色喂给引擎会把海洗平；引擎要参考风的线性值 |
| 时间不只是时钟 | 时间在自动流动，`SECONDS_PER_HOUR = 5`（5 秒 = 1 小时，2 分钟一昼夜）：`js/weather.js:20`。别把它改回 `dt / 3600` |
| 日月弧线 | `x = 50 + 38 * cos(theta)`，**两段同号：日月都从右缘升起、往左缘落下**（屏幕右缘 = 东、左缘 = 西；2026-10-23 用户定稿，此前方向是反的），进度由 `dayWindow()` 的真实日出/日落归一化。改 x 的振幅 38 必须同步改 `applyDrag` 的反解（同为 `Math.acos(cx)`），否则拖动会差几十分钟 |
| 日月交接 | 日月共用同一个 DOM 元素，`rawElev = -0.5` 那一帧 x 从 12% 跳到 88%（太阳在左缘落下、月亮在右缘升起，天文事实不是 bug）。要看不见就得让两侧都淡到 0：光球 `sunDisc`/`moonIn` 用 2° / 2.5° 窗口，天光 `skyVis` 用 6° 窗口（窗口太陡会像「啪」地关灯，`sun_smoke.mjs` 会报 0.5° 跳变）。月面淡入淡出靠 `--sun-disc-opacity`（贴图不透明，`--sun-core-*` 的 alpha 管不到它） |
| 月亮高度 | 是太阳高度取反再减 0.5（`isNight` 阈值）。夜里直接拿 `sunElevationRaw` 算会恒得负值 |
| 拖完时间不走 | `initCelestial` 的 `finish()` 末尾必须**无条件**写回 `state.manualTime = false; state.autoTime = true;`（拖动过程中才允许 `manualTime = true`）。2026-10-23 的 bug 就是 `applyDrag` 把 `manualTime` 置真之后再没人收回，表冻住了 —— `_wip/verify/celestial_flow.mjs` 专测这条 |
| 双击/单击判定 | 不用 `dblclick`（触屏不可靠），在 `pointerup` 里自己数：`DBL_TAP_MS = 350` / `DBL_TAP_PX = 28`。**单击必须什么都不做**，否则误触就把表挪走 |
| 切昼夜必须「走」过去 | 用户 2026-10-23：转换昼夜不能原地变，要在 1 秒内让日/月来到对方的位置。所以 `toggleDayNight()` 只写 `state.warpHours = Math.min(24, state.warpHours + 12)` + `env.lastNow = 0`，真正的推进在 `update()`：`const step = Math.min(state.warpHours, clockDt * WARP_HOURS_PER_SEC)`（= 12 小时/秒），递减到 0 为止，期间**跳过**常规自动流逝、`applySky()` 每帧都跑（90 ms 节流会让天色跳）。**别改回「直接把 timeTarget 设成 0 / 12」** —— 那就是用户否掉的原地换图。`env.lastNow = 0` 不能省：双击两次点击之间隔了 100~350 ms，会被乘以 12 变成第一帧窜出 1~4 小时 |
| 日月抖动 / 一顿一顿 | 两个成因都治了（2026-10-23 第三条反馈）：①`js/app.js:2313` 把 `dt` 夹在 0.05 s，帧一长就丢时间、时针速度抖，所以 `update()` 里另算 `clockDt = clamp((now - env.lastNow)/1000, 0, 0.25)`；②`5 秒 = 1 小时`时日月一秒只挪 1~2 px，光栅化会吸到整像素上。2026-10-23 试过 `left/top 0.28s linear` 过渡，只把它抹成「一顿一顿」；2026-10-24 改成位移只走 `translate`：`.celestial` 的 `left/top` 归零、带 `translate: 74vw 11vh` 初值，`applySun` 每帧写 `el.style.translate`（px、合成器浮点、亚像素连续），**位移一点过渡都不要**。改这两处要同步跑 `celestial_flow.mjs` |
| 顶部 WEATHER 控件已删 | 2026-10-23 用户第二次要求：「我说的删掉的按钮是 weather 那一个控件」。`#weatherBar` 的 HTML、`.weather-bar*` 的全部 CSS、`initPanel()` / `syncPanel()` / `timeLabel()` / `conditionLabel()` / `env.sliders` / `env.weatherBar` 两处 `setVar` 全删了。**别再把它加回来**（连 AUTO / RESET 都不要），也没了「回真实时间」的入口。右上角那个小圆圈是自定义光标 `.cursor-ring`，不是按钮，别删 |
| 抓图 | 用 `_wip/verify/shoot.sh`（每次新建 profile、绝对 Windows 路径）；沿用旧 profile 会撞锁静默失败。**但本沙箱根本起不了浏览器**：headless Chrome 报 crashpad `crash server failed to launch` 后自杀、headless Edge 报 `FATAL mojo platform_channel ... 拒绝访问`，所以这里的交互改动只能给脚本证据（见 `WORKLOG.md` 2026-10-22 那两条的「未验」说明） |
| 类名复用打穿长廊 | 静物那轮（`GIFT@54667a6`）给封面道具写的是**裸选择器** `.postcard` / `.postcard::after` / `.postcard-divider` / `.postcard-line(--a..e)` / `.postcard-stamp` / `.postcard-postmark` / `.postcard-seal`，而长廊卡片自己也挂 `.postcard`。它们在文件末尾、特异性相同，于是把长廊的 `position: absolute; inset: 0` 盖成 `position: relative; aspect-ratio: 1.55` —— 七张竖版卡（槽位 238×357）塌成 238×153 的纸背，还叠上封面的米色渐变与横纹。修法：这 12 条全部前缀 `.prop--postcard`（`css/styles.css:3692-3756`）。**新增任何道具/组件样式前，先 `Select-String '^\.类名'` 看这个类名是否已被别处占用**；共用类名必须靠父级作用域隔离 |
| 银器画成磨砂塑料 | SVG 渐变默认 `objectBoundingBox`，0→100% 是摊在整个元素盒子上的：细长柄只吃到中间一档，钢就发平。金属件必须 `gradientUnits="userSpaceOnUse"` 并按每一件自己的 y 范围铺，且剖面要有四段（亮边 → 暗带 → 反射光 → 暗轮廓）；匙/叉的「内凹」要明显比柄暗，否则缩略时认不出是餐具（小叉曾因此像一支银笔，2026-10-23 换成勺时一并改掉） |
| `file://` 下音频三条死路 | ① `fetch`/`XHR` 读本地 wav 一律 `Failed to fetch`；② 本地 `<audio>` 能播，但接 `MediaElementAudioSourceNode` 进 WebAudio 出来是**静音**（origin 为 `null`，被判跨域），所以音乐只能改 `.volume`、不能滤波/分析；③ `AudioWorklet.addModule()` 被拒。结论：环境声只能程序化合成、样本只能 base64 内嵌 `<script>`、音乐只能是本地 `<audio>`。详见 `docs/AUDIO.md` §2 |
| 声音烘焙绝不能落在首帧 | 合成噪声要几百万次随机 + 二阶滤波，实测首版同步烘一次 2.2 秒。开屏那 1–2 秒本就在付加载屏和 WebGPU 管线的账，再叠烘焙必掉帧。必须 `setTimeout` 分片（每片 ~7 ms）藏进加载屏与封面阅读期 |
| `requestIdleCallback` 在不停重绘的页面上等于 `setTimeout(400)` | 海面 rAF 永不空闲，`rIC({timeout:400})` 每片都等满 400 ms 超时：20 片 = **10.1 s** 首屏白等（实测 bakeMs 10101）。修法：记实际滞后，`lag > 55ms` 累计 3 次后判定「这页不会有空闲」，此后改 `setTimeout(run, 0)`，超时降到 80 ms。改完 **1010 ms** |
| 离线渲染串行会静默挂死 | `OfflineAudioContext` 不 `close()` 时 Chrome 单页上限 6 个，第 5~6 段 `startRendering()` 永不 resolve（CDP 卡满 60 s 超时）。每次渲染完必须 `ctx.close()`。`audio_smoke.mjs` 还每段包了页内 20 s `Promise.race` 护栏，避免一段挂死带走整轮 |
| 循环 buffer 的「呼吸」会被听成转圈 | `bakeBed` 的原版用 `0.78 + 0.22*sin(...)` 调制**整段**包络（含低频），2.1 s 一拍、4.5 s 一循环 —— 循环太短且内部有节奏，听感就是背景在转圈。修法：循环长度拉到 **13.7 s**，节拍只调制**中频**（低频与超低频恒定，一涨一落交给随机排程的浪），且节拍取「以循环长度为周期的整数谐波」（3 条，周期 4.6/2.7/1.7 s，相位按声道错开）。同类陷阱：`bakeWind` 的 `wander` 相位必须按 L 算，否则接缝处根本对不上（旧代码注释还谎称是周期性的） |
| 用包络自相关判「有没有转圈」是错的 | 任何循环 buffer 在**滞后 = 循环长度**处必然接近 1（那一段信号就是它自己）。bed 单独铺 60 s 实测：13.7 s 处 strength **0.773**，恰好等于该滞后的重叠帧比例 926/1200；把 bed 的慢起伏整个删掉，数字一位不变 —— 量到的是循环长度，不是听感。**正确判据是两层**：①循环长度 ≥ 8 s（`debugState().loops`，量原因）②1.5–8 s 耳朵区间内无强峰（量结果）。2026-10-26 因此改过 `audio_smoke.mjs --long` 的判据 |
| 限幅器会把「大小起伏」压平 | `DynamicsCompressor` 参数搞狠了（旧值 `−4 dB / knee 0 / 20:1`）等于给整条环境声上了个天花板：所有大浪的峰被削到同一高度，实测 60 s 峰高 CV 只有 **0.167**，听感就是「平的」。现在是 **−1.5 dB / knee 4 / 6:1**（只兜底防削波），峰高 CV 提到 **0.60**。改声音动态前先看 `limiter` 参数 |
| 慢变量只许「围绕基准游走」 | 用 `max()` 棘轮（「浪起就把档位顶上去并按住几秒」）或乘子均值 > 1（`0.72+rnd*0.62`）时，60 s 内必然顶到上限并钉死：实测 1 s 窗 RMS 的 p10 只比中位数低 **3 dB**，整段听着「中等偏响」。正解是离散 OU（`prev*exp((rnd-0.5)*0.8)` + 向 0.70 回归）+ 到期落回的 bump |
| 离线渲染 ≠ 线上渲染 | `renderPreview` 早前只排浪、不跑档位，于是「量起伏」量的是另一个东西 —— 验证全绿、上线还是平。现在统一走 `bakeAmbientTimeline()`（先排浪，再用同一套 `nextSurge`/bump/activity 推 0.25 s 档位曲线）。**改任何慢变量逻辑，必须同时改离线那条路径** |

### 6.2 git 习惯

- 仓库 `E:\DeepSeekplay\GIFT`，remote `ssh://git@github.com/Athosoo/tideline.git`，ssh 可用。
  身份是全局的（Athos：`Athos <3672324408@qq.com>`）。
- 分支：`main` 是当前交付物，日常在 `feat/<主题>` 上做，做完 ff 进 `main` 并把两条都推上去。
  GitHub Pages **未部署**（404）。**git 规矩只有一份**：工作区根 `GIT_CONVENTIONS.md`
  （提交信息格式、分支模型、worktree、落地流程、绝不入库）；本文件不重复抄。
  → `E:\DeepSeekplay\GIT_CONVENTIONS.md`
- **每完成一步就提交一次**（比根文档的「小而频繁」更硬，用户 2026-10-22 要求过），
  提交信息：中文祈使句标题 + 空行 + 为什么。
- `.gitignore` 已经处理：系统/编辑器垃圾、`_qa*/`、`*.log`。
- `.gitattributes`：`* text=auto eol=lf`、二进制标记、`sea.bundle.js -diff linguist-generated`。

### 6.3 测开屏帧率（2026-10 那轮的做法，可复用）

`_wip/perf/` 下的探针（gitignore 区，删了不影响站点）：`phase.mjs`（按
`CakeGate.debug().phase` 分组统计帧时长，`PATCH=<js>` 注入任意表达式做 A/B）、
`steady.mjs`（静置后采 4s，附带 `Performance.getMetrics` 的 layout/style/script）、
`snap.mjs`（`SECOND=<ms>` 支持二次点击后定时截图）、`sharp.mjs`（同一帧里运行时
加/删一条 CSS 再比高通 std，用来判"画质有没有变糊"）、`trace.mjs` / `loaf.mjs` /
`rectprobe.mjs`。

- **测帧率绝对不能带 swiftshader**。`--use-angle=swiftshader` 让这个页面退化成 0.1fps
  （WebGL 全软件光栅、一个 53s 长任务），rAF 几乎不触发。测截图才需要它。
  默认真实 GPU 下同一页面 42fps。
- **噪声极大**：同一份代码 cut 的 avg 在 22.7–45.9 之间跳，fly 在 30.9–66.1。
  一个配置至少配对/交错跑 2 轮，只信方向一致的差值，别信单次数字。
- **`idle` 相位 100–300ms 是加载瞬态**（WebGPU 编译、贴图上传），不是封面动画慢；
  静置后单独量封面是稳定 16.7ms、slow25=0。
- 判断"是不是 GPU 拖的"看 `loaf.mjs`：`scripts` 为空、`style` 只有几 ms 而帧 dur 400ms+，
  就是纯渲染/合成侧。
- 想知道"这一层值多少钱"就用 `PATCH` 当场删掉它（`remove()` 元素 / 塞 `<style>`），
  别改代码再来回 stash —— 这轮就是靠这个定位到 `.cloth` 子层的。
- **`git stash pop` 报 "No stash entries found" 不一定是灾难**：如果改动已经提交，
  `git stash push <file>` 本来就没东西可存（老版本 git 退出码仍是 0），
  pop 自然找不到。先 `git status` 确认，别急着修。

---

## 7. 这一路的经验（前一个对话踩出来的）

1. **用户说"抄"就是抄**。我一开始自己手写海面，被连着纠正三次，最后老老实实把原版打成了 bundle。
2. **不要自我怀疑**。延迟是设计的一部分，验证请置位状态。
3. **先找根因再动手**。云那次的真凶有两个（相机视野装不下原版云带 + 2D 云画布压在海面上），
   只修一个都不对。
4. **交付前必须清理现场**。
5. 用户说话简短、口语、常带感叹号，但每句都是明确需求；不要过度解释，直接给结果和证据。
6. 用户会要求"保留 / 别动"某些东西（`1/ 2/ 3/` 原始素材、字体），那些是真不许动的。

---

## 8. 接手后建议的第一句话

> "我读完交接了。海面是原版 bundle + 三级回落，工作区干净，`87e8f07` 是云的提交。
> 按顺序来：先做 **B 风雨作用于海面**（改 `js/sea-entry.js` → 重建 bundle → 验证 → 提交），
> 再把 **LITE 切回 Canvas-2D 线条海面**。需要我现在开始 B 吗？"

