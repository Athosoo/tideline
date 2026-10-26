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
| 海浪 | **程序化合成**（噪声 + 二阶滤波烘焙成循环 buffer） | 一直是底噪；`seaState` 越大，低频越厚、涌浪越密 |
| 海风 | **程序化合成** | 一直有；`wind` 与 `gust` 越大越亮、越响 |
| 海鸥 | **真实录音样本**（4 段，xeno-canto） | 随机，约 12–50 秒一次（海况越大越频繁），一次 1–3 声 |
| 开屏拟音 | **程序化合成** | 点蛋糕 → 刀出鞘 / 划过 / 切开 / 布撕裂 / 蜡烛吹灭，逐帧对准 `cakegate.js` 的相位 |
| 背景音乐 | **使用者自己的文件**（不放仓库） | 从页面第一次交互起循环播放；开屏时让路，进画廊后降低 |

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
js/audio.js              声音引擎（IIFE，全局 TideAudio，约 61 KB）
js/audio-assets.js       4 段海鸥录音的 base64（生成的，勿手改，约 105 KB）
assets/audio/music/      背景音乐投放目录（音频文件 gitignore，只留 README）
```

### 3.1 音频图

```
                 ┌─ bedGain ─ bedFilter ─┐        （海底噪，循环 buffer）
surf buffers ────┤                       ├── amb ──┐
                 └─ surf(one-shot) ──────┘         │
wind buffer ───── windGain ─ windFilter ────────────┤
gull sample ───── gullGain ─ panner ────────────────┼── master ── limiter ── destination
foley one-shots ─ foleyGain ────────────────────────┤
music (<audio>) ────────────────────────────────────┘   ← 只能改 .volume，见 §2
```

- `master` 是**总开关**：静音、页面不可见时拉到 0。
- `limiter` 是 `DynamicsCompressorNode`，防开屏那一刀削波。
- 环境总线 `amb` 的音量由**长廊打开程度**决定（见 §4.1）。

### 3.2 烘焙（合成 buffer）

合成噪声比想象中贵（几百万次随机 + 二阶滤波）。它**绝不能落在首帧** ——
开屏那 1–2 秒已经要付加载屏和 WebGPU 管线的账。

做法：`setTimeout` 分片，每片约 7 ms，藏在加载屏与封面阅读期里。分片之间检查
`state.ready` 与总时长预算，超时就让出主线程。用户第一次点蛋糕时通常已经烘完。

采样率 `BAKE_RATE = 32000`：环境噪声没有 16 kHz 以上的内容，拟音的高频也够用；
比 44.1 k 省 27% 的烘焙时间与内存。

### 3.3 浪与风是「循环 buffer + 实时调制」

总共烘 **14 段**：海底噪 `bed`、风 `wind` 各一段无缝循环 buffer；涌浪是**四段**
一次性拍岸声（3.6 / 3.9 / 4.5 / 4.8 秒，各自的 `peakAt`、亮度、泡沫量不同）；
其余是开屏拟音与两段合成海鸥兜底。

循环 buffer 用 `AudioBufferSourceNode` + `loop=true` 播，靠 `gain` / `filter.frequency` 实时调制：

- `sea`（海况，0–0.85）→ `mix.sea = 0.55 + 0.85*sea`、`bedFreq = 1500 + 1800*sea`。
- `wind` / `gust` → `mix.wind = 0.03 + 0.5*wind*(0.55+0.45*gust)`、
  `windFreq = 380 + 1150*wind*(0.6+0.4*gust)`。
- **涌浪（一次一次拍岸）**不是在 buffer 里，而是按 `period = clamp(13 - 7.2*sea, 4.6, 13)` 秒
  排程一次性播放，提前 0.35 秒排进 WebAudio 时间轴 —— 这样不会被帧边界卡住。
  页面切走过（`nextSwell < now - 1`）就不补播，避免回来时一口气砸出十次浪。

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

### 4.4 音乐 ducking

音乐**只能**改 `audio.volume`（§2 的原因）：

- 封面 / 开屏：`LEVEL.music = 0.30`，有拟音时再让路（`state.duck`）。
- 进画廊（`ambTarget > 0.7`）：`LEVEL.musicGallery = 0.18`，更靠后。
- 文件缺失 / 加载失败：静默跳过，**站点完全正常**（不报错、不等待）。
- 依次尝试 `music.mp3` / `music.m4a` / `music.ogg` / `music.wav`，只放一个即可。

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

---

## 6. 怎么验证（改完必须跑）

**1）烘焙的频谱与波形**（不启浏览器，最快的一道）

```bash
node _wip/verify/audio_bake_test.mjs
```

用 `vm` 在 Node 里载入 `js/audio.js`，跑烘焙 + FFT，检查：

- 底噪低频占优（实测 > 0.9）；
- 风是宽频嘶声、循环接缝不突跳（`seam/mean` 应很小）；
- whoosh 的频谱质心先升后落；
- 四段 surf 的 crest factor 在 3.6–4.6。

**2）端到端**（真浏览器、真交互，最慢但最像真的）

```bash
node _wip/verify/audio_smoke.mjs --tag <tag>
```

带界面 Chrome（窗口挪出屏外）+ CDP，`file://` 真站逐项验证：

- 首次手势后 `AudioContext` 进入 `running`；
- 烘焙耗时、`bakeMs`；
- 开屏全程 `gate` 曲线与 `amb` 跟随（gate 0→1 时 amb 0.22→1.0）；
- 海鸥是否用上样本（`gullSource === "sample"`）；
- M 键静音 / 恢复、`localStorage` 落地；
- 四段预览混音的 `rms` / `peak` / DC（应不削波、无直流）；
- 页面不可见时的暂停与恢复。

结果落 `_wip/shots/audio/<tag>/report.json`。

**3）听**（耳朵才是最终判据）

`renderPreview({ name, seconds })` 导出 WAV（`_wip/shots/audio/<tag>/*.wav`），
用 `python _wip/verify/audio_analyze.py <wav> --out x.json --png y.png` 看频谱图，
或直接双击听。

> 本机**没有 ffmpeg**。不要写依赖 ffmpeg 的验证脚本。

---

## 7. 已知限制（别再撞）

| 限制 | 原因 | 后果 |
| --- | --- | --- |
| 音乐不能滤波 / 不能接分析器 | 本地 `<audio>` 接 WebAudio 出来是静音（origin null） | 只能 `volume` ducking |
| 不能用 `AudioWorklet` | `file://` 下 `addModule()` 失败 | 只能是 `AudioBufferSource` + LFO |
| 不能 `fetch` 音频 | 本地文件读不到字节 | 样本必须 base64 内嵌 |
| 首帧不能烘焙 | 开屏本就最贵 | 必须分片、藏进加载期 |
| 背景音乐不进仓库 | C418 等有版权 | 由使用者本地放 `assets/audio/music/` |

---

## 8. 想调什么，改哪里

| 想改 | 位置（`js/audio.js`） |
| --- | --- |
| 各层基准音量 | `LEVEL = { sea, wind, gull, foley, music, musicGallery }` |
| 音乐文件名 | `MUSIC_SRC` |
| 海鸥间隔 | `update()` 里 `state.nextGull = gt + (14 + Math.random()*22) * (1.4 - 0.6*sea)` |
| 涌浪周期 | `period = clamp(13 - 7.2*sea, 4.6, 13)` |
| 风/海的滤波器跟随 | `mix.windFreq` / `mix.bedFreq` |
| 开门音量曲线 | `state.ambTarget = 0.22 + 0.78*smoothstep(0.02, 0.92, gate)` |
| 开屏拟音时间轴 | 对应 `cakegate.js` 的 `APPROACH` / `FLY` / `CUT` / `HOLD` / `SLICE` 常量 |

改完**跑 §6 的两道验证**，并把新数字补进 `_wip/NOTES-audio.md`。
