# TIDELINE · 待办（Backlog）

> 工作区级待办，不放进公开仓库。
>
> **⚠️ 2026-10-21 晚 · 计划整体重定。本文是唯一现行计划。**
> 旧计划（体素云实装 / 体素云画质攻坚 / 程序化风雨雷电声景）已整体归档到
> `_wip/archive/TODO-2026-10-21-parked.md`，**只作踩坑史，不要再按它开工**。

---

## 0. 产品定位（最高优先级，任何改动先过这一条）

**这是送女友的生日礼物。站点只该有海和天。**

- FULL：**没有云**。没有云、没有雨、没有雷电。
- 界面上**不允许**出现「云量 / 雨 / 雷电」这类滑块。只留 **TIME + AUTO/RESET**
  （`GIFT/index.html:122-128` 已达成）。
- 两档**同级**，不是「主力 + 降级版」：FULL 是一套完整的光，LITE 是另一套完整的画。

---

## 1. 两档的最终定义（2026-10-21 用户拍板）

| 档 | 内容 | 状态 |
|---|---|---|
| **FULL** | 无云的海与天，靠**光**取胜：日出日落的时刻、色温、太阳高度真实且连续，光景丰富自然、过渡平滑 | **当前主线** |
| **LITE** | **要有云**，但不要云量/雨/雷电调节；整幅画面自己设计，**风格化、动画电影感**（宫崎骏参考） | 风格规格已写（§3），**代码按用户要求无限期暂停** |

分档在 `GIFT/js/app.js` 的 `QUALITY_PRESETS`（app.js:440 附近）与 `body.is-lite`
（`GIFT/css/styles.css:2553` 起）落地；`applyQuality()` 在 app.js:498 下发。

---

## 2. FULL 主线：光景系统　`[进行中]`

### 2.1 已达成（已提交：`04e9495`，`main` 与 `feat/soft-clouds` 均已推送）

- 雨 / 雷 / 云量 / 风 四类滑块、`#rainCanvas`、`#lightningFlash`、`#cloudCanvas`
  全部从 `GIFT/index.html` 删除；天气面板只剩 TIME + AUTO/RESET。
- `GIFT/js/weather.js` 收缩为「时刻 / 日 / 月 / 风」共 429 行；调色板 `P` 去掉 `storm`；
  `counters` 去掉 `updateRain` / `rainCleared`；`weather.js:294` 注明
  `--cloud-dark / --wind / --storm / --cloud-cover / --rain` 已无 CSS 消费。
- 体素云层已从站点移除（`920dd6f`），`GIFT/js/clouds.js` 不再被 `index.html` 加载
  （页面只加载 `weather.js → sea.bundle.js → ocean.js → app.js`，`GIFT/index.html:63-66`）。
- 未提交差异：`css/styles.css` `index.html` `js/app.js` `js/weather.js`，**+48 / −415**。

- **日盘去卡通化第二轮（2026-10-22）**：定位到「能看到轮廓 + 不耀眼」的两个真因。
  ① **`mix-blend-mode` 被隔离**（决定性）：`.celestial` 自己带 `transform`（视差）与 `z-index: 1`，
  两者都会建立层叠上下文，于是写在内层 `.celestial-bloom` / `.celestial-disc` 上的
  `mix-blend-mode: screen` 只能和内层兄弟节点混合，整个太阳组最后按 `normal` 合成 ——
  日盘变成一块**不透明贴片**，再亮也透不出光。修法：混合模式提到**组**上
  （`.celestial { mix-blend-mode: screen }`，`GIFT/css/styles.css:721`），组内一律 normal；
  月亮例外（`.celestial.is-moon { mix-blend-mode: normal }`，`styles.css:725`），
  否则月面贴图会被加亮洗白。
  ② 圆盘渐变里有一段约 14% 宽的等高 alpha 平台 → 就是人眼看到的「边缘」。
  `GIFT/css/styles.css:768-774` 改为 `0 / 14 / 40 / 52 / 68 / 100%` 单调下降、外缘 alpha = 0。
  另外：光晕原本 alpha 0.92，把天空对比度全吃掉了；现在 `haloA`（`GIFT/js/weather.js:364`）
  正午 0.26 → 贴地 0.46，并往白偏（`weather.js:369`）；`SUN_LOOK` 每档新增 `hs`
  （halo spread，`weather.js:261-268`：正午 15% 紧、贴地 58% 散）让光晕贴着日盘走；
  月亮换成满月贴图 `assets/moon/full-moon.webp`（NASA/GSFC，公有领域，见
  `THIRD-PARTY-NOTICES.md` §4），旧的「按时刻算假月相」暗斑已删。
- **天空到底是谁画的（2026-10-22 实测，务必记住）**：默认路径下可见的天空**不是**
  `weather.js` 的调色板，也不是 CSS `.atmosphere`，而是 WebGL 引擎用
  `GIFT/js/app.js:1132` 的 `SEA_PALETTE`（线性光，交给引擎 tone-map）画的。
  证据：把 `P.day.top` 改成纯蓝后，渲染像素 (640,8) 仍是 (205,210,215)，一模一样。
  `body.has-sea-bundle` 下 `.sky-wash` / `.light-glow` / `.shore-glow` 全被隐藏
  （`GIFT/css/styles.css:2902-2904`），海面画布盖满全屏。
  结论：**`--sky-*` 与 `--sun-halo` 在默认路径下改了也不生效**，页面上唯一可见的太阳元素
  是 `.celestial` 本身（所以 ① 那个混合模式 bug 才是「不耀眼」的病根）。
  真想让白天天空更蓝，要改 `SEA_PALETTE.day`（`GIFT/js/app.js:1132`），不是 `weather.js`。
- **日盘重做（2026-10-22）**：删掉两圈假边缘（`.celestial-glow::before` 实线 / `::after` 虚线，
  它们才是「能看到轮廓」的真凶），圆盘与光晕改成外缘 alpha = 0 的径向渐变；
  外观改为按**太阳高度角**查表（`SUN_LOOK` `GIFT/js/weather.js:260`、`lookFor()` `weather.js:274`）：
  色温白热→金黄→橙红、光晕张开度 `--sun-bloom-scale`（2.60 → 0.94）、
  折射压扁 `--sun-flatten`（0.82 → 1.00）；视直径恒定（`weather.js:315`）。
  月亮走真实贴图：保留清晰边缘（`GIFT/css/styles.css:748`），方向与太阳一致。
  另加 `?t=17.6` 直接跳到指定时刻，便于对照不同高度角。
- **满月与月光小路（2026-10-22，已达成）**：
  - 月面贴图重做成 256×256 / 5.5 KB（原 512×512 / 68 KB）：模糊去细节、压缩动态范围把
    月海暗部抬起来、加一层柔光、冷银偏色。用户在 100px 显示尺寸下判定「细节和暗部太多」，
    这版是去细节后的结果（处理步骤写进 `THIRD-PARTY-NOTICES.md` §4）。
  - 月面 alpha 不再乘 `dim`：普通混合下 alpha < 1 等于把月面往夜空里掺，满月会发灰发透。
    夜间 `discA` 直接给满（`js/weather.js` 的 `applySun`）。
  - `--sun-bloom` 从三停点改成四停点（`--sun-bloom-3` = 0.20×），三段线性衰减会在
    日/月周围画出一圈看得见的「光环」；加密后实测最大亮度跳变只有 2.7–3.3/px（基线 0.67/px）。
  - 新增 `.moon-path`（`css/styles.css`）：夜色海面从月亮铺到底部中央的银白反光带。
    形状用 `conic-gradient` 从月盘位置张开 ±24°（真实成因是波面把月光反射进眼睛，几何上就是
    一个从光源张开的锥形）+ 月下立柱 + 贴底的大水洼；11 个停点是必须的，少了会露出笔直的光柱边。
    浓度变量 `--moon-path` 由 `applySun` 写：`clamp(-rawElev / 6, 0, 1) × (0.55 + 0.45 × moonIn)`
    ——这套模型里月亮高度是太阳高度取反，用 `rawElev` 直接算会恒为 0（踩过）。
  - 夜色海面调色板（`GIFT/js/app.js` 的 `SEA_PALETTE.night`）把直射 `sunI` 从 0.55 抬到 1.55、
    色相推到银蓝：直射太弱时反射高光凑不成一条路，只剩几个孤立亮点。水体本身维持暗色
    （`deep` / `shallow` 不动），亮的只该是光路。

- **时间自然流动（2026-10-22，已达成）**：用户要求「每过 5 秒等效 1 小时 → 两分钟一次日月循环」。
  - `js/weather.js:20` 新增 `SECONDS_PER_HOUR = 5`，`update()` 里的推进从 `dt / 3600`（真实速度）
    改成 `dt / SECONDS_PER_HOUR`。实测 10 秒 = 2.003 小时、120 秒整圈。
  - **日月轨迹补了两处逻辑缺口**（时间流起来以后每 2 分钟都会看见一次，所以必须修）：
    - 弧线两段同号 `x = 50 - 38 * cos(theta)`：**日月同向，都东升西落**（屏幕左缘 = 东、
      右缘 = 西）。月亮不因为「反日」倒着走 —— 满月只是与太阳相隔 12 小时，太阳在西边落下时
      它才刚从东边升起（2026-10-22 用户纠正过一版反向的实现）。
    - 交接那一次换位该怎么藏：日月共用同一个 DOM 元素，`rawElev = -0.5` 那一刻它的 x 必须从
      88% 跳到 12%（太阳西沉、月亮东升，这是天文事实）。做法是**两侧都淡到 0**——光球用
      2°/2.5° 窗口（`sunDisc` / `moonIn`），天光（日晕、炫光、月晕）用 6° 窗口（`skyVis`），
      交接点上日面和月面都不亮，换位就看不见。天光窗口不能跟着光球一起用 2°，否则 2 分钟
      一天的节奏下看起来是「啪」地关灯（`sun_smoke.mjs` 会以 0.5° 步长抓这个跳变）。
    - 月面的淡入淡出只能靠元素级 `opacity`（`--sun-disc-opacity`，写在 `.celestial.is-moon
      .celestial-disc` 上）：贴图本身不透明，`--sun-core-*` 的 alpha 只管得住兜底下层渐变。
    - 弧线进度改由真实的日出/日落时刻归一化（新增 `dayWindow(doy, latitude)`，时角公式
      `cos H0 = -tan(lat)tan(decl)`），不再写死 6..18。写死的话日盘会在画面边缘空转 0.36 小时
      （本纬度 10 月），换算成 2 分钟一天就是每次日出前卡住约 2 秒。
    - 月亮高度 `clamp(-rawElev - 0.5, 0, 74)`：减 0.5 是 `isNight` 的翻转阈值本身，不减的话
      交接瞬间日盘凭空上跳半个度（约 4px）。
  - 交互：拖动时间滑杆/拖动日月 = 暂停（`manualTime`）；轻点日月 = 跳到正午/午夜但**继续流动**；
    `AUTO` = 恢复流动（不再偷偷跳回真实时钟，那是 `RESET` 的活）；`RESET` = 回到此刻真实时间并继续流。
    `?t=17.6` 仍然强制冻结在该时刻（截图对照用）。
  - 数值证据：`_wip/verify/time_smoke.mjs`（60fps 推演 135 秒）——单帧最大横移 0.036%、纵移
    0.093%（≈0.7px），日夜交接处横移 0.002%、拖动反解误差 0.0000 小时，全部通过。
  - 抓图：`?t=17.5 / 18.2 / 0 / 5.6 / 6.5` 五张（`_wip/shots/arc/`）确认日落点与月升点重合、
    月光路随月亮左右移动。

### 2.2 现状弱点（逐条有据，直接对应「光景丰富自然 / 过渡平滑」）

| # | 弱点 | 位置 | 后果 |
|---|---|---|---|
| 1 | 只有 **3 组关键帧** `day/dusk/night`，靠 `dayness`、`duskness` 两个标量混合 | `GIFT/js/weather.js:75-91`、`resolvePalette()` `weather.js:145-157` | 日出与日落对称同色；没有黄金时刻、没有蓝调时刻；一天只有「亮/橙/黑」三段 |
| 2 | 颜色在 **gamma 空间直接 lerp** | `mix()` `weather.js:72`；`resolvePalette()` 全程用它 | 冷暖交界发灰发脏，这正是「过渡不自然」的主因 |
| 3 | 天空渐变**色标位置写死** 0 / 22 / 39 / 47 / 53 / 70 / 100% | `GIFT/css/styles.css:666-673` | 色带不随太阳高度移动；太阳贴地平线时天空还是正午的分层，有 banding |
| 4 | `.sky-wash` 两个高光位置写死 `18% 17%` / `73% 5%` | `styles.css:676-683` | 与太阳方位无关的天光，方向感错乱 |
| 5 | 日盘内圈暖色写死 `rgba(255,214,160,0.9) 78%` | `styles.css:740` | 正午太阳也偏橙，正午不够「白而不曝」 |
| 6 | 日盘尺寸是线性斜坡 `120 + (1-elev/60)*140`，夹 120..280 | `weather.js:254-256` | 高度角变化时尺寸变化过快，且不压扁、不变色 |
| 7 | **可见天空由引擎画**：`SEA_PALETTE` 写死 day/dusk/night 三组，按 `sunElevation` 线性混 | `GIFT/js/app.js:1132`、`seaPaletteFor()` `app.js:1146` | 与 `weather.js` 的调色板是**两套真相**；改 CSS 那套天色不变（本轮实测），白天偏灰蓝 |
| 7 | `applySky()` 每 **90 ms** 才跑一次 | `weather.js:232` | 拖动时间滑杆时天色阶梯跳变，手感不连续 |
| 8 | 真实天文解算已有（`solarPosition()` `weather.js:130-138`，纬 26.05），但**日出/日落时刻从未被显示或利用** | `weather.js:130-138`、`conditionLabel()` `weather.js:314-316` 只输出 `CLEAR` / `CLEAR NIGHT` | 「天空能体现日出日落的时刻」这条没落地 |
| 9 | 月相用 `mod(timeOfDay/12,1)`，与真实月龄无关 | `weather.js:289` | 月亮形态是钟表函数，不是天体 |

> **已修**：#5（内圈暖色写死）、#6（尺寸线性斜坡、不压扁不变色）—— 见 §2.1 最后一条。
> #1 #2 #3 #4 #7 #8 #9 仍待办。

### 2.3 P0 动作（按顺序做，每步都要截图证据）

**a. 调色板从 3 段扩到 8 段**
- 按**太阳高度角**切关键帧，每段一组完整色：`top / mid / horizon / seaFar / seaNear / seaDeep / sun / glow`，
  新增 `warm`（地平线暖带强度）+ `warmHue`（暖带色相）。
- 建议档位：`-18°（蓝调结束）/ -12° / -6°（蓝调时刻）/ -2° / +2°（黄金时刻）/ +8° / +25° / +55°（正午）`。
- 落点：`GIFT/js/weather.js:75-91` 的 `P` 与 `resolvePalette()`（weather.js:145-157）。

**b. 换到线性光空间混合**
- 加 `srgbToLinear()` / `linearToSrgb()`，`mix()` 只在 linear 里插值，输出前转回 sRGB。
- 这是「过渡平滑」最关键的一步，成本可忽略（8 色 × 8 档，每帧几十次运算）。
- 落点：`GIFT/js/weather.js:72` 的 `mix()` 与 `resolvePalette()`。

**c. 天空渐变色标改为太阳高度驱动**
- 新增 CSS 变量 `--sky-stop-top / --sky-stop-mid / --sky-stop-horizon`，在 `applySky()` 里随高度写出。
- `.atmosphere` 的 `linear-gradient` 用这些变量替换写死的 22% / 39% / 47%（`styles.css:666-673`）。
- 注意 `--horizon` 是 26%、`weather.js` 里 `horizonY = 25.2`，**动色标不能破坏地平线对齐**。

**d. 太阳方位驱动的天光**
- `.sky-wash` 的两个高光改成 `at calc(var(--sun-x) ± k%) var(--sun-y)`（`styles.css:676-683`），
  强度用 `--warm` 控制，使晨昏天光跟着太阳方位走。

**e. 日盘按高度角查表**　`[已达成 2026-10-22]`
- 已落地：`SUN_LOOK`（`weather.js:260`）8 档（−4 / −1 / +2 / +6 / +14 / +26 / +45 / +70°），
  每档给 `core / a / a1 / bloom / ba / spread / flat`，`lookFor()`（`weather.js:274`）
  用 `smooth()` 在相邻档之间插值。
- **与原文相左的一处（以现实为准）**：原文写「低角度**变大**且压扁」，但真实的太阳视直径
  恒定（约 0.53°），变大的是光晕。所以尺寸固定 170px、由 `spread` 撑光晕，只保留压扁
  （`--sun-flatten`，地平线处 0.82，接近真实折射值 0.85）。
- 另外：光晕用 `transform: scale()` 而不是 `filter: blur()`（跟太阳移动的大元素逐帧模糊太贵；
  轮廓既然已经渐变到 0，也不需要 blur 去软化边缘）。

**f. `applySky()` 取消 90 ms 节流**
- 有了 `setVar` 的值缓存（`weather.js:51-61`），值不变时不碰 DOM，每帧调用成本可忽略；
  改成每帧跑，拖动时天色连续。要保留 `?noattr=1` / `?nocache=1` 诊断开关可复测。

**g. 顶栏显示真实日出/日落时刻**
- 由 `solarPosition()` 反解 `elevation = 0` 的时角，得到当天日出/日落；
- 顶栏文案：`CLIMATE · 17:42 · CLEAR` → 追加 `↑06:12 ↓17:48`（`weather.js:314-326`）。

**h. 海面联动**
- `--sea-far / --sea-near / --sea-deep` 跟着 8 段光景走；低角度时长掠射光靠 `state.sunY`
  推导光向（现已可用，见 `js/app.js` `applySeaFrame()` app.js:1046 附近）。
- 调色板必须给**线性值**：CSS 那种偏白的 sRGB 天色直接喂引擎会把海面洗平（`HANDOFF.md` §3.2 的坑）。

### 2.4 验收（做不到就不算完）

1. 从 00:00 连续拖到 24:00，至少抓 24 张帧图，**没有 banding、没有色阶跳变**。
2. 黄金时刻（太阳 ±4°）有明确暖橙 + 长掠射光；蓝调时刻（−4°～−8°）有青紫，且与日出侧不对称。
3. 正午天空「白而不曝」，日盘不偏橙。
4. 顶栏日出/日落时刻与当地天文时刻误差 ≤ 2 分钟。
5. 拖动时间滑杆时天色**逐帧连续**，无阶梯。
6. 抓图命令：`node _lab/tools/siteshot.mjs "<url>" "<out.png>" @<steps.json> 1280,800`
   （无头 Chrome 必须带 `--use-angle=swiftshader --enable-unsafe-swiftshader`，路径用正斜杠绝对路径）。

> **抓图可行性（2026-10-22 更新，覆盖上面这段旧结论）**：本沙箱**可以**抓图 ——
> `chrome.exe --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 --window-size=1280,800 --virtual-time-budget=7000 --screenshot=E:/DeepSeekplay/_wip/shots/x.png "file:///E:/DeepSeekplay/GIFT/index.html?t=12"`
> 早期失败的是旧参数组合（`--use-angle=swiftshader` / 没加 `--headless=new`）。
> **但抓不到海面场景**：直接抓 `index.html` 得到的是开场纸页（Between the tides），
> 开场靠**滚动**关闭（`updateScrollState()` `GIFT/js/app.js:1377`，`gateRaw` 用 `introPx*0.92` 归一），
> 而随手 `scrollTo` 会落到走廊的纸面空挡（纯 `#ece5d8`）—— 已实测 `scrollTo(780 / 820 / 900)` 全是纸面。
> 要拍海面 + 卡片只能：手动滚到卡片位再抓，或点开卡片进聚焦视图
> （`openPostcard()` `GIFT/js/app.js:1696`，**没有挂到 window**，注入脚本点不到）。
> 已拿到的有效样张：`_wip/shots/final-12.png`（正午白盘无轮廓）、`final-23.png`（满月带月海）。

---

## 3. LITE：动画电影的一帧　`[设计已定 · 代码暂停]`

### 3.1 风格规格（参考宫崎骏，落到可执行条款）

> 外网当前不可用（`curl` 探测返回 000），以下是按动画美术规律写死的规格；
> 若你有具体参考图，以图为准，我再修这份规格。

**天空**
- 高饱和**垂直分层**：天顶深蓝 → 中段饱和青 → 地平线暖白/淡黄，层与层之间是「平涂色块 + 窄过渡带」，
  不是摄影式的连续渐变。
- 天空颜色比真实更**纯**、更亮，饱和度整体上抬约 10–15%。

**云（LITE 的核心资产）**
- 大朵**积云塔**：轮廓清晰、外缘干净，接近「剪影 + 平涂」；内部允许 2～3 个柔和过渡带，不做写实体积。
- **亮边（rim light）**：受光侧一条明确的亮边；云顶亮、云底暗，暗部偏蓝紫而不是灰。
- **空气透视**：越远越偏青紫、对比越低，近处云块饱和度最高。
- 云量不做滑杆，但内部要有**缓慢演化**（形状漂移 + 生长/消散），周期以分钟计，不要循环可见。

**光**
- 太阳位置感必须强：云边亮边方向、海面光路、云影方向三者一致。
- 允许一处**丁达尔光柱**（体积光）作为视觉高点，但要薄、要少。

**整体**
- 明信片、边框、UI 与天空同一套语言：细线、平涂、无渐变噪点，与线稿海（`WaterPainter`，app.js:964 附近）同源。
- 颜色只用有限的 2–3 个色阶每材质，禁止写实光照。

### 3.2 技术约束（不可违反）

- 纯 **Canvas2D**，**零 3D 采样**，`file://` 双击可跑，不许 `fetch`/CDN/ES module。
- 与 FULL 切换时，视觉上应是「换了一套画」，不是「变糊了」。
- 目标文件名已定：`GIFT/js/cloud-line.js`（FULL 若将来恢复云，用 `GIFT/js/cloud-plates.js`）。

### 3.3 暂停点（用户 2026-10-21 指令）

- **云的开发全部搬进实验室，现在无限期暂停，等用户以后启动。**
- 本档只保留本文档里的风格规格，**不写任何站点代码**。

---

## 4. 实验室：云的开发场地（已暂停）

- `_lab/cloud/`：体素云实验室（`kernel.glsl` 20.7 KB、`index.html` 75 KB、`shots/`、`ref/`）
  → **冻结，不再推进**。`kernel.glsl` 仍是 GLSL 唯一真相来源，`_lab/tools/sync-kernel.mjs` 负责注入。
- LITE 的 Canvas2D 云实验目录建议另开 `_lab/cloud2d/`，与体素云隔离（**待用户点头再建**）。
- 重启条件：用户明确说「启动云的开发」。在此之前不新增实验、不跑长任务、不动 `kernel.glsl`。
- `_lab/` 是独立仓库（`_lab/.git`），在 `_lab/` 目录里单独提交。

---

## 5. 杂项清理　`[低优先]`

- 根目录 `NUL`（34 字节，内容是 GBK 报错「目录名或卷标语法不正确。」）→ 某次错误重定向的垃圾，可删。
- `GIFT/js/clouds.js`（60 KB）本分支已不被加载，但它是 `sync-kernel.mjs` 的注入目标
  → **先留着，别删**，在 `HANDOFF.md` 标注「未加载 · 冻结」。
- `_lab/cloud/shots/` 下未被任何 md/glsl 引用的 png 可清（json 是测量记录，永远不删）。

---

## 6. 待用户确认

1. FULL 光景这套 P0 现在就开工，还是先只留计划？
2. 顶栏要不要显示日出/日落时刻（§2.3-g），还是保持只有 `CLIMATE · 17:42 · CLEAR`？
3. 当前 4 个文件的删除集（+48 / −415）要不要先提交——提交后站点处于「无云」中间态。
4. LITE 的宫崎骏参考图能否给一两张（无外网，我只能按文字规格走）。
5. `_lab/cloud2d/` 这个新目录名是否可行。

---

## 附：与旧计划的关系

| 旧计划 | 现在 |
|---|---|
| 体素云实装（旧 §3） | 废止。代码在分支 `feat/volumetric-clouds`（`30a159a`，ahead 14）保留 |
| 体素云画质攻坚（旧 §4） | 废止。`_lab/cloud/` 冻结 |
| 画质分档重定义（旧 §5） | 被本文 §1 取代 |
| 程序化声景 + HRTF（旧 §1） | 未开始；范围收缩为「海面底噪 + 风 + 离散事件（浪拍、海鸥）」，雨/雷两层取消 |
| 日月轨迹在屏内（旧 §2） | 已完成（分支 `main` 的 `d490965`） |
| 性能攻坚 / 聚焦残影（旧 §6/§7） | 已修，**仍待真机确认**：`?bench=1` vs `&nocardfx=1` / `&nocardmove=1`；残影需真机截图 |
