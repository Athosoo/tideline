# 声音系统

> 站点只有五种声音：**海浪、海风、偶尔的海鸥、开屏那一刀的拟音、一首背景音乐**。
> 没有雨、没有雷、没有别的。
>
> 这份文档是**结论**（稳定的行为、参数、接口）。过程记录、实测数字、走过的歧路在
> 工作区根的 `_wip/NOTES-audio.md`（不进仓库）。代码在 `js/audio.js` + `js/audio-assets.js`。
>
> 归到哪份文档：**行为与参数**写这里；**站点技术红线**写 `SITE-RULES.md`；
> **文件地图/架构**写 `HANDOFF.md`；**第三方素材署名**写 `THIRD-PARTY-NOTICES.md`。

---

## 1. 有哪些声音

| 声音 | 来源 | 什么时候响 |
| --- | --- | --- |
| 海浪·底噪 | **程序化合成**，13.7s 无缝循环 `bed` | 一直垫底；`seaState` 越大低频越厚 |
| 海浪·拍岸 | **程序化合成**，6 段一次性（近岸 3 段 / 远处 3 段） | 按「计划」随机排程，一次 1–3 道成群；`seaState` 越大越密、越近 |
| 海浪·退水 | **程序化合成**，2 段一次性（2.6s / 3.2s） | 跟在拍岸后面 1.5–3.7 秒，水面从沙上退回去 |
| 海风 | **程序化合成**，9.7s 无缝循环 | 一直有；`wind` 与 `gust` 越大越亮、越响 |
| 海鸥 | **真实录音样本**（4 段，xeno-canto，base64 内嵌） | 随机，约 12–50 秒一次（海况越大越频繁），一次 1–3 声，HRTF 从一侧飞到另一侧 |
| 开屏拟音 | **程序化合成**，7 段 | 点蛋糕 → 刀出鞘 / 划过 / 切开 / 布撕裂 / 蜡烛吹灭，逐帧对准 `cakegate.js` 的相位 |
| 背景音乐 | **使用者自己的文件**（不放仓库；mp3 / ogg 都行） | 从页面第一次交互起循环播放；开屏时让路，进画廊后降低 |

合计 **24 段**：20 段程序化烘焙（bed、wind、混响 IR、6 段拍岸、2 段退水、7 段拟音、
2 段合成海鸥兜底）+ 4 段海鸥录音。

**没有的**：雨声、雷声、闪电、城市底噪、人声旁白。需求就是「去掉风雨雷电之后只剩这些」（2026-10-26 用户确认）。

---

## 2. 为什么一半合成、一半采样

站点是 `file://` 双击打开、无构建、无 CDN 的静态站（铁律见 `SITE-RULES.md`）。在这条约束下：

- **本地文件读不到字节**：`fetch` / `XHR` 对本地 `.wav` 一律失败（`Failed to fetch`）。
  所以「放几个 wav 进去、`fetch` 再播」这条路根本不存在。
- **`<audio>` 能放，但接不进 WebAudio**：把本地 `<audio>` 连到 `MediaElementAudioSourceNode`
  再进分析器，测出来 `rms 0` / `peak 0` —— `file://` 的 origin 是 `null`，媒体被当成跨域，出来是静音。
  所以音乐**只能**靠 `audio.volume` 做 ducking，不能加滤波、不能接分析器。
- **`AudioWorklet` 用不了**：`addModule()` 要走模块加载，`file://` 下被拒。

于是：

- 需要**无限、无缝、随天气实时变化**的（浪、风）→ 程序化合成。
- 需要**真实质感、短、偶发**的（海鸥）→ 短样本 **base64 内嵌进 `.js`**，
  由 `decodeAudioData` 还原（这条路可行且极快：132 KB 的 wav 解码 6 ms）。
- 需要**精确对齐动画相位**的（开屏拟音）→ 程序化合成，时间轴直接照抄 `cakegate.js` 的常量。
- **有版权、体积大、只放一首**的（背景音乐）→ 只能由使用者本地放文件，用 `<audio loop>` 播。

---

## 3. 架构

```
js/audio.js              声音引擎（IIFE，全局 TideAudio，约 82 KB / 2000 行）
js/audio-assets.js       4 段海鸥录音的 base64（生成的，勿手改，约 105 KB）
assets/audio/music/      背景音乐投放目录（音频文件 gitignore，只留 README）
```

### 3.1 音频图

```
                 ┌─ bedGain ─ bedFilter ─┐
                 │                       ├──────────────┐
wind buffer ─────┼─ windGain ─ windFilter ─(stereoWiden)┤
                 │                       │              │
surf/wash/鸥/拟音 one-shots ─ panner/HRTF ─────────────┤
                 │                       │              ├── amb ──┬── master ── limiter ── destination
                 └─ revBed / revWind / revSwell(+/far) ─┤         │
                                    (send)              │         └── 分析器（验证用）
                                       └── conv ─ revLow ┘
music (<audio>) ──────────────────────────────────────────────────┘   ← 只能改 .volume，见 §2
```

- `master` 是**总开关**：静音、页面不可见时拉到 0。
- `limiter` 是 `DynamicsCompressorNode`，防开屏那一刀削波。
- `amb` 是环境总线：音量由**长廊打开程度**决定（见 §4.1）。
- **混响**（`conv`）是 `ConvolverNode`，IR 程序化生成（见 §3.6）；`revLow` 是湿声的低通，
  免得混响把高频糊上去。

### 3.2 烘焙（合成 buffer）

合成噪声比想象中贵（几百万次随机 + 二阶滤波）。它**绝不能落在首帧** ——
开屏那 1–2 秒已经要付加载屏和 WebGPU 管线的账。

做法：分片，每片约 7 ms，藏在加载屏与封面阅读期里。**分片调度器自适应**：

- 先用 `requestIdleCallback`（超时 80 ms）；
- 每片记录实际滞后，`lag > 55 ms` 记一次 `idleLag`；
- `idleLag >= 3` 说明主线程根本没有空闲（海面 rAF 一直占着），改走 `setTimeout(run, 0)`。

> 这条是踩出来的：早先只用 `requestIdleCallback({timeout: 400})` + 每步之间插一次，
> 结果每一步都等满 400 ms 超时，20 步 = **10.1 s**，把加载屏拖到 9.9 s。
> 改完 `bakeMs` 从 10.1 s 掉到 **1.1 s**。

采样率 `BAKE_RATE = 32000`：环境噪声没有 16 kHz 以上的内容，拟音的高频也够用；
比 44.1 k 省 27% 的烘焙时间与内存。20 步在前台浏览器里合计约 **1.0–1.2 s**
（Node 里离线烘约 1.9 s，差异是浏览器的 JIT 更热）。

### 3.3 循环层：长度是「听不出转圈」决定的

`bed` **13.7 s**、`wind` **9.7 s**，都不是整数秒，也都不跟浪的常见周期成倍数。

为什么较真：**4.5 s 的 bed 会被耳朵听出来**——它整段是一个闭环，内部的慢起伏
又刚好落在 2～4 秒这个「人耳能锁住」的尺度上，听感就是「这段背景在转圈」。
换成 13.7 s 之后，60 秒里只装 4 个循环，人耳抓不住。

> **量这件事的时候踩过一个坑，记在这里免得再踩**：用「包络自相关在 20 s 内找最强峰」
> 去判有没有转圈是**错的** —— 任何循环 buffer 在「滞后 = 循环长度」上必然接近 1
> （那一段信号就是它自己），量到的只是循环长度本身。把 bed 单独铺满 60 s 实测：
> 13.7 s 处 strength **0.773**，而这个数恰好等于该滞后下的重叠帧比例（926/1200）；
> 把 bed 的慢起伏整个删掉，数字一位都不变。所以正确的判据是两层：
> **①循环长度 ≥ 8 s**（量原因），**②1.5–8 s 这段耳朵区间里没有强峰**（量结果）。
> `audio_smoke.mjs --long` 现在就是这么判的；`debugState().loops` 直接报循环长度。

另一条：循环层**不许自己「呼吸」**。早先 bed 有一条 `0.78 + 0.22*sin(...)`
的包络乘在整段上（低频、超低频一起被调制），等于给底噪加了个 2 秒的心跳。
现在只在**中频**上叠 3 / 5 / 8 个周期的慢起伏（周期 4.6 / 2.7 / 1.7 s，接缝严格对齐），
低频与超低频恒定 —— 真正的一涨一落交给浪自己（每次都是新排程的）。

循环 buffer 用 `AudioBufferSourceNode` + `loop=true` 播，靠 `gain` / `filter.frequency` 实时调制：

- `sea`（海况，0–0.85）→ `mix.sea = 0.55 + 0.85*sea`、`bedFreq = 1500 + 1800*sea`。
- `wind` / `gust` → `mix.wind = 0.03 + 0.5*wind*(0.55+0.45*gust)`、
  `windFreq = 380 + 1150*wind*(0.6+0.4*gust)`。

### 3.4 浪：随机排程，不是定时器

浪不是「每 N 秒响一声」，而是 `planSwell()` 每一步现算（纯函数，不碰 AudioContext，
所以能在 Node 里单测）。规则：

- **成组**：34% 的起拍会连出 2–5 道（`plan.left`），组内每道比上一道高
  （`build += 0.09 + rnd*0.12`，上限 1.3），组内 68% 是近岸。
- **间隔**：基值 `base = clamp(13 - 7.2*sea, 4.6, 13)` 秒。组内随机取 `0.4–0.7 base`；
  出组后取 `0.85–1.4 base`，另有 **15%** 概率再乘 1.5–2.2 —— 真实海面有「歇一口气」的时候。
- **声像**：每组的中心声像 `pan0 = (rnd*2-1)*0.6`，组内沿用 0.9 倍；
  同一个 step 内部从 `pan0` 划到 `-pan0*(0.3~0.9)`，所以**一道浪自己也在移动**。
- **余波**（`follow`）：近岸 50% / 远处 32% 概率跟一道更小的，慢 0.9–2.6 s、挪到另一边。
- **退水**（`wash`）：近岸 62% / 远处 42% 概率，在 1.5–3.7 s 后响，音量约为浪的 16–30%。

实测（`_wip/verify/audio_random_test.mjs`，sea=0.42，5000 步）：

| 指标 | 实测 | 为什么是这个判据 |
| --- | --- | --- |
| 间隔 std / mean | 4.22 s / 7.96 s | std > 0.8 s 才算「不是节拍器」 |
| 间隔 p10 / p90 | 4.46 / 13.04 s（比值 2.92） | 有长有短；比值 < 1.8 听感就均匀了 |
| 增益 std / mean | 0.378；连续相同 0% | 每道浪大小不一样 |
| `|pan| > 0.3` 占比 | 48%（左 50%） | 真的分布在两边，不是中间一坨 |
| 起组概率 | 34%；平均 3.6 道/组 | —— |
| 10 分钟推演 | 87 道浪，平均间隔 6.90 s，12 连击指纹窗口重复 **0** 次 | 不重复的直接证据 |

排程**提前 0.35 s 落到 WebAudio 时间轴**，不被帧边界卡住；页面切走回来时
（`nextSwell < now - 1`）不补播，避免一口气砸出十次浪。

### 3.5 退水（backwash）

浪碎了之后水从沙上退回去：一条带通噪声，中心频率从 `hi` 往下扫到 `lo`
（`sweepFilter`，指数滑），包络「起得比浪慢、收得比浪长」。没有这一层，
浪会「来了就不走」，听着像循环音效而不是海。

### 3.6 混响

海边不是房间，是一条开阔的岸线：IR 长 **2.6 s**，程序化生成 ——

- 双指数包络（先按扩散场掉、尾巴再慢一点），否则尾巴像「关门」；
- 低通 5.2 kHz / 高通 170 Hz；
- 7 个**稀疏早期反射**（11/17/23/31/44/58/77 ms），左右错开 11%、带符号 ——
  纯噪声扩散没有方向感。

送出量分层（`LEVEL.rev*`）：bed 0.10、wind 0.08、近岸浪 0.20、**远处浪 0.46**、
海鸥 0.34。远处的浪直达声小、混响大，这才是距离感。

### 3.7 立体感：三种手段叠起来

单声道混音再宽的 panner 也只是「中间一团左右晃」，所以分三层做：

1. **源本身去相关**：bed / wind 的左右声道用不同种子生成，再做 `stereoWiden`
   （左右两条 0.019 / 0.024 Hz 的反相 LFO 轻微推拉增益）。
2. **每个事件有位置**：浪的 `pan0 → pan1` 内部滑动；海鸥用 **HRTF 的 `PannerNode`**
   从一侧飞到另一侧（`distanceModel: inverse`，20–40 m 外）。
3. **混响兜底**：湿声本身是立体声 IR，把声场撑开。

实测（`ambient` 14 s 混音）：L/R 相关系数 **0.065**，侧能量 **46.8%**
（60 s 那段 0.103 / 44.9%；`space` 段 0.059 / 47.1%）。
（早先的固定 StereoPanner 版本是 corr≈1.0、side≈0 —— 一听就是单声道。）

### 3.8 海鸥

4 段真实录音（base64 内嵌，`decodeAudioData` 还原）。播放时：

- `playbackRate` 0.94–1.07 随机（同一段录音不会听出是同一只鸟）；
- **不重复抽取**（`pickNoRepeat`）—— 4 段轮着用；
- HRTF 3D 声源做「飞过」：x 从 `±(5~12)` 划到反方向，y 从 3.5–7.5 抬到更高，z 向远处漂；
- 间隔 `(14 + rnd*22) * (1.4 - 0.6*sea)` 秒，一次 1–3 声。

---

## 4. 行为约定

### 4.1 开门才响

环境总音量由**长廊打开程度**决定，不是由某个 cue 记状态：

```js
state.ambTarget = 0.22 + 0.78 * smoothstep(0.02, 0.92, gate);   // gate = app.state.gate
```

`app.js` 的 `state.gate` 是唯一真相（0 = 封面合着，1 = 已在长廊里）。
只认 cue 的话，用户滚回封面、或用 `?cutat` 调试直接跳进去，音量都会错。

封面期仍然有 0.22 的底声（远处的海），不是全静音 —— 全静音会让开屏那一刀显得突兀。

### 4.2 首次交互才建图

浏览器自动播放策略要求用户手势。`init()` 时只准备状态，真正的 `AudioContext`
在第一次 `pointerdown` / `keydown` / `wheel` 里创建并 `resume()`。
（实测：手势内建图，`state=running`，分析器 `rms 0.213`。）

### 4.3 静音与页面可见性

| 操作 | 行为 |
| --- | --- |
| 按 **M** | 在「静音 / 有声」之间切换，选择存 `localStorage["tideline.audio.muted.v1"]` |
| 网址加 `?audio=0` | 一开始就静音（调试/录屏用） |
| 标签页切走（`visibilitychange`） | `master` 拉到 0，回来恢复；`nextGull` / `nextSwell` 顺延，不补播 |

### 4.4 音乐

音乐**只能**改 `audio.volume`（§2 的原因）：

- 从**页面第一次交互**起播放（`<audio loop>`，`playsinline`），不是从加载完就播。
- 音量：封面 / 开屏 `LEVEL.music = 0.30`；进画廊（`ambTarget > 0.7`）`musicGallery = 0.24`；
  有拟音时再让路（`state.duck`，最多压 45%）。
- **文件名不用改**：`MUSIC_SRC` 先认 `assets/audio/music/1-05. Minecraft.mp3` → `.ogg`
  （用户放下的成品，两个格式各一份），其后才是 `music.m4a / music.ogg / music.mp3` 的通用退路。
  能解哪个用哪个，`canplaythrough` 成功后才 `play()`；被自动播放策略挡住就等下一次手势。
- 文件缺失 / 加载失败：静默跳过，**站点完全正常**（不报错、不等待）。

---

## 5. 接口

```js
TideAudio.init({})                    // app.js 启动时调一次（在 Weather.init 之后）
TideAudio.update(dt, env, app)        // 每帧；env = Weather.state，app = app.state
TideAudio.cue(name, detail)           // cakegate.js 的动作点
TideAudio.setMuted(b) / toggleMute() / isMuted()
TideAudio.debugState()                // 给验证脚本读的完整快照
TideAudio.renderPreview(spec)         // 离线渲染一段混音为 WAV（base64），用来听
```

**接线位置**（改代码时别接错）：

- `js/app.js`：`startSea()` 之后、`Weather.init()` **之后** 调 `TideAudio.init({})`
  （耳朵要读 `Weather.state` 的 `seaState` / `wind`）。
- `js/app.js` 帧循环：`CakeGate.update(dt, gate)` 之后调 `TideAudio.update(dt, Weather.state, state)`。
- `js/cakegate.js`：动作点调 `TideAudio.cue(name)`（刀出鞘 / 划过 / 切开 / 布裂 / 烛灭）。

`renderPreview` 一次只跑一个渲染：`OfflineAudioContext` 在 Chrome 里单页面只给 6 个，
而 `close()` 是异步的，所以内部串成一条链，**上一次 close 落定之后**才建下一个上下文。
（不串的后果：验证脚本连着渲染第 4、5 段时 `startRendering()` 永远不 resolve。）

---

## 6. 怎么验证（改完必须跑）

**1）烘焙的频谱与波形**（不启浏览器，最快的一道）

```bash
node _wip/verify/audio_bake_test.mjs
```

用 `vm` 在 Node 里载入 `js/audio.js`，跑烘焙 + FFT，检查：

- 底噪低频占优（实测 0.968）；
- 风是宽频嘶声（质心 2409 Hz vs bed 645 Hz）、循环接缝不突跳（`seam/mean` < 8）；
- whoosh 的频谱质心先升后落；
- 6 段 surf 的 crest factor 在 3.6–4.6。

**2）浪的随机性**（纯 Node，不打浏览器）

```bash
node _wip/verify/audio_random_test.mjs
```

5000 步 `planSwell` 的统计：间隔 std、p10/p90 比、增益离散度、声像分布、
起组概率、10 分钟推演的「12 连击指纹」重复次数（要求 0）。判据与实测见 §3.4 表。

**3）端到端**（真浏览器、真交互，最慢但最像真的）

```bash
node _wip/verify/audio_smoke.mjs --tag <tag>          # 常规
node _wip/verify/audio_smoke.mjs --tag <tag> --long   # 加 60s ambient，测循环周期性
```

带界面 Chrome（窗口挪出屏外）+ CDP，`file://` 真站逐项验证：

- 首次手势后 `AudioContext` 进入 `running`；
- 烘焙耗时 `bakeMs`（要求 ≤ 2.5 s）；
- 开屏全程 `gate` 曲线与 `amb` 跟随（实测 gate 0→1 时 amb **0.329→0.816**，
  目标曲线 0.22→1.0 —— 环境声是阻尼跟随的，到 1.0 要再等一会儿）；
- 海鸥是否用上样本（`gullSource === "sample"`）；
- M 键静音 / 恢复、`localStorage` 落地；
- 两个音乐文件都能解码（页面里各自 `new Audio()` 试解）；
- 预览混音的 `rms` / `peak` / DC / **L/R 相关** / 侧能量（`corr < 0.95` 且 `side > 0.05`）；
- `--long` 额外判两件事（见 §3.3 的坑）：**循环长度 ≥ 8 s**（`debugState().loops`），
  以及 **1.5–8 s 耳朵区间内包络自相关没有强峰**（strength < 0.3）；
  循环长度那一带的峰只打印、不判 —— 任何循环 buffer 在那里都接近 1。

结果落 `_wip/shots/audio/<tag>/report.json`。

**4）听**（耳朵才是最终判据）

`renderPreview()` 导出 WAV（`_wip/shots/audio/<tag>/*.wav`），
用 `python _wip/verify/audio_analyze.py <wav> --out x.json --png y.png` 看频谱图与
周期性判定，或直接双击听。

> 本机**没有 ffmpeg**。不要写依赖 ffmpeg 的验证脚本。

---

## 7. 已知限制（别再撞）

| 限制 | 原因 | 后果 |
| --- | --- | --- |
| 音乐不能滤波 / 不能接分析器 | 本地 `<audio>` 接 WebAudio 出来是静音（origin null） | 只能 `volume` ducking |
| 不能用 `AudioWorklet` | `file://` 下 `addModule()` 失败 | 只能是 `AudioBufferSource` + LFO |
| 不能 `fetch` 音频 | 本地文件读不到字节 | 样本必须 base64 内嵌 |
| 首帧不能烘焙 | 开屏本就最贵 | 必须分片、藏进加载期 |
| 烘焙分片不能只靠 `requestIdleCallback` | 海面 rAF 永不让出空闲帧，每步都等满超时 | 必须自适应降级到 `setTimeout`（否则 20 步 10 s） |
| 离屏渲染要串行 | Chrome 单页只给 6 个 `OfflineAudioContext`，`close()` 又是异步的 | 连续渲染第 4、5 段会卡死 `startRendering()` |
| 循环 buffer 的长度不能拍脑袋 | 长度 = 人耳能听出的「转圈」周期 | 4.5 s 会被锁住；13.7 s 抓不住。**别用「自相关在 20 s 内找最强峰」去判** —— 它在滞后 = 循环长度处恒接近 1，量的是循环长度本身 |
| 背景音乐不进仓库 | C418 等有版权 | 由使用者本地放 `assets/audio/music/` |

---

## 8. 想调什么，改哪里

| 想改 | 位置（`js/audio.js`） |
| --- | --- |
| 各层基准音量 | `LEVEL = { sea, wind, gull, foley, music, musicGallery, rev* }` |
| 混响送出量（哪层更「远」） | `LEVEL.revBed / revWind / revSwell / revSwellFar / revGull` |
| 音乐文件名 | `MUSIC_SRC` |
| 循环长度（bed / wind） | `bakeBed` 的 `LEN`、`bakeWind` 的 `LEN`（**改完跑 `--long` 看周期性**） |
| 浪的节奏 / 成组概率 / 余波 / 退水 | `planSwell()` 里的常数（**改完跑 `audio_random_test.mjs`**） |
| 拍岸样本的性格 | `bakeSteps()` 里 6 个 `bakeSurf` 的 `{dur, bright, dark, foam, sub, tailPow, tag}` |
| 海鸥间隔 | `update()` 里 `state.nextGull = gt + (14 + rnd*22) * (1.4 - 0.6*sea)` |
| 风/海的滤波器跟随 | `mix.windFreq` / `mix.bedFreq` |
| 开门音量曲线 | `state.ambTarget = 0.22 + 0.78*smoothstep(0.02, 0.92, gate)` |
| 开屏拟音时间轴 | 对应 `cakegate.js` 的 `APPROACH` / `FLY` / `CUT` / `HOLD` / `SLICE` 常量 |

改完**跑 §6 的四道验证**，并把新数字补进 `_wip/NOTES-audio.md`。
