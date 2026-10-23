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
4. **往回滚动永远不能关门**。关门只有一条路径：左上角 TIDELINE 品牌按钮 → `returnToCover()`。
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
├── js/                        页面加载的 6 个脚本（文件名不变，勿再散放回根目录）
│   ├── clouds.js              【已停止加载 · 冻结】体积云（WebGL2 零依赖；仍是 sync-kernel.mjs 的注入目标，勿删勿改名）
│   ├── weather.js             天气/时间系统 + 2D 云画布
│   ├── sea.bundle.js          esbuild 产物（原版海面，IIFE 全局 OpenSea）
│   ├── ocean.js               手写 WebGL2 后备海面
│   ├── app.js                 主逻辑
│   └── sea-entry.js           bundle 构建源，页面不加载
├── assets/                    明信片图 + 内嵌字体（进仓库）
└── 1/ 2/ 3/                   原始素材（已 gitignore，不发布；本地保留）
```

| 文件 | 大小 | 作用 |
|---|---|---|
| `index.html` | 24 KB | 结构 + 大气层元素；脚本顺序 **js/weather.js → js/sea.bundle.js → js/ocean.js → js/app.js**（`js/clouds.js` 已不再加载） |
| `js/app.js` | 84 KB (~2320 行) | 主逻辑：环廊、卡片、聚焦、开门、天气接线、海面后端调度、质量档 |
| `css/styles.css` | 74 KB | 全部样式；地平线对齐变量 `--horizon: 26%` |
| `js/weather.js` | 29 KB | 天气/时间系统：晴雨云、风、闪电、月相；含 2D 云画布绘制 |
| `js/sea-entry.js` | 14 KB | **bundle 的构建源**，页面不加载它。原版海面 + TIDELINE 的调色/天气接线 |
| `js/sea.bundle.js` | 790 KB | esbuild 产物，页面真正加载的是它（IIFE，全局 `OpenSea`） |
| `js/ocean.js` | 33 KB | **手写 WebGL2 后备海面**（`?nogl=1` 可强制跳过） |
| `1/ 2/ 3/` | — | 用户的原始素材，**不要动**；已加入 `.gitignore` 并从 git 取消跟踪（本地保留，不随仓库发布） |
| `assets/` | 232 KB | 明信片图、字体 |
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
> 直接拿 `state.sunElevationRaw` 算会恒得负数 —— `--moon-path` 就踩过这个坑，光带永远不出现。

> ⚠️ **夜里的海面是「暗底 + 一条月光路」，不是均匀提亮**：亮的那条由两层叠出来 ——
> 引擎的真实高光（`SEA_PALETTE.night.sunI`，跟随 `weather.sunX/sunY` 的方向）打底，
> CSS 静态层 `.moon-path`（`css/styles.css`）补形状与浓度。只画引擎一层会灰、只画 CSS 一层会假。
> 水体颜色（`deep` / `shallow`）不要跟着提亮，否则整片海会变成黄昏色。

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
- 开门/关门：`openPostcard()`（1550）/ `closePostcard()`（1693）/ `returnToCover()`（1421，**唯一关门路径**）。
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
- **天气/时间系统**：系统时间 + 实时天气、动画化变化、可拖动的太阳、点太阳 → 月亮/夜晚、
  长按日/月召云（连续模拟，停在任意档）、顶部滑杆（云量、风雨、时间、闪电）。
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
| 日月弧线 | `x = 50 - 38 * cos(theta)`，**两段同号：日月都东升西落**（屏幕左缘 = 东、右缘 = 西），进度由 `dayWindow()` 的真实日出/日落归一化。改 x 的振幅 38 必须同步改 `applyDrag` 的反解（同为 `Math.acos(-cx)`），否则拖动会差几十分钟 |
| 日月交接 | 日月共用同一个 DOM 元素，`rawElev = -0.5` 那一帧 x 从 88% 跳到 12%（太阳西沉、月亮东升，天文事实不是 bug）。要看不见就得让两侧都淡到 0：光球 `sunDisc`/`moonIn` 用 2° / 2.5° 窗口，天光 `skyVis` 用 6° 窗口（窗口太陡会像「啪」地关灯，`sun_smoke.mjs` 会报 0.5° 跳变）。月面淡入淡出靠 `--sun-disc-opacity`（贴图不透明，`--sun-core-*` 的 alpha 管不到它） |
| 月亮高度 | 是太阳高度取反再减 0.5（`isNight` 阈值）。夜里直接拿 `sunElevationRaw` 算会恒得负值 |
| 抓图 | 用 `_wip/verify/shoot.sh`（每次新建 profile、绝对 Windows 路径）；沿用旧 profile 会撞锁静默失败 |
| 类名复用打穿长廊 | 静物那轮（`GIFT@54667a6`）给封面道具写的是**裸选择器** `.postcard` / `.postcard::after` / `.postcard-divider` / `.postcard-line(--a..e)` / `.postcard-stamp` / `.postcard-postmark` / `.postcard-seal`，而长廊卡片自己也挂 `.postcard`。它们在文件末尾、特异性相同，于是把长廊的 `position: absolute; inset: 0` 盖成 `position: relative; aspect-ratio: 1.55` —— 七张竖版卡（槽位 238×357）塌成 238×153 的纸背，还叠上封面的米色渐变与横纹。修法：这 12 条全部前缀 `.prop--postcard`（`css/styles.css:3692-3756`）。**新增任何道具/组件样式前，先 `Select-String '^\.类名'` 看这个类名是否已被别处占用**；共用类名必须靠父级作用域隔离 |

### 6.2 git 习惯

- 仓库 `E:\DeepSeekplay\GIFT`，remote `ssh://git@github.com/Athosoo/tideline.git`，ssh 可用。
  身份是全局的（Athos：`Athos <3672324408@qq.com>`）。
- 分支：`main` 是当前交付物（2026-10-22 已快进到 `7edd107`），日常在 `feat/soft-clouds` 上做，
  做完 `git merge --ff-only` 进 `main` 并把两条都推上去。GitHub Pages **未部署**（404）。
- **每完成一步就提交一次**，提交信息写清"改了什么 + 为什么"（看 `7edd107`、`806de56` 的风格）。
- `.gitignore` 已经处理：系统/编辑器垃圾、`_qa*/`、`*.log`。
- `.gitattributes`：`* text=auto eol=lf`、二进制标记、`sea.bundle.js -diff linguist-generated`。

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

