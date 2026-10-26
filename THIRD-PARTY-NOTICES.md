# 第三方组件与许可（Third-Party Notices）

本项目 **TIDELINE** 包含或改编了以下第三方开源代码。按各自许可证的要求，版权声明与许可全文如下。

---

## 1. open-sea-skin

- **上游**：<https://github.com/d-dev0101/open-sea-skin>
- **使用位置**：
  - `js/sea.bundle.js` —— 本项目用 esbuild 把它原版的 `ocean.js` 与 three.js 模块打成的 IIFE（构建源见 `js/sea-entry.js`）。
  - `js/ocean.js` —— 自写 WebGL2 回落海面中移植的波形模型、涌浪参数与深水色散关系。
  - `js/sea-entry.js` / `js/app.js` —— 取自它的 DAY / DUSK 调色板。
- **改动说明**：海面渲染本体未改写；本项目的改动集中在调色板插值、天气/时间接线与天空云盖。
- **许可证**：MIT

```text
MIT License

Copyright (c) 2026 Open Sea Skin contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

---

## 2. three.js

- **上游**：<https://github.com/mrdoob/three.js>
- **使用位置**：`js/sea.bundle.js` 内的 WebGPU / TSL 构建（`three.webgpu.js`、`three.tsl.js`、`three.core.js`、`addons/tsl/display/BloomNode.js`）。
- **许可证**：MIT

```text
The MIT License

Copyright (c) 2010-2025 three.js authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
```

---

## 3. 字体

| 字体 | 许可证 |
| --- | --- |
| Cormorant Garamond | SIL Open Font License 1.1 |
| Manrope | SIL Open Font License 1.1 |

两者均已转换为 woff2 内嵌在 `assets/fonts/`，随页面离线分发。

---

## 4. 月球贴图

- **来源**：NASA / Goddard Space Flight Center Scientific Visualization Studio 的月球可视化影像（`GSFC_20171208_Archive_e000868`），经 <https://images-assets.nasa.gov/image/GSFC_20171208_Archive_e000868/collection.json> 获取。
- **使用位置**：`assets/moon/full-moon.webp`（256×256，由该影像的预览图裁切、缩小并转码为 WebP），在 `css/styles.css` 里作为 `.celestial.is-moon .celestial-disc` 的背景贴图。
- **改动说明**：除等比缩放与格式转码外，还做了这些处理——轻微高斯模糊（抹掉缩到 100px 显示尺寸后会碎成噪点的环形山细节）、压缩动态范围（`0.55 + 0.46 × 原值`，把月海暗部抬起来）、一层低强度柔光叠加、乘一个冷银偏色（R 0.965 / G 0.985 / B 1.03），最后加圆形 alpha 羽化边。结果是同一张月球影像的「去细节」重绘，月面地理格局（雨海、静海、第谷辐射纹）仍对应真实月球。
- **许可证**：公有领域（U.S. Government Work，不受版权保护）。依据 NASA 媒体使用指南 <https://www.nasa.gov/nasa-brand-center/images-and-media/>，NASA 素材可用于非商业与商业用途，无需授权，但不得暗示 NASA 为本项目背书。

---

## 5. 海鸥叫声样本（4 段，xeno-canto，CC BY 4.0）

- **来源**：<https://xeno-canto.org>，四段野生海鸥录音。逐条署名：

| # | 物种 | 录音者 | 地点 / 日期 | xeno-canto 编号 |
| --- | --- | --- | --- | --- |
| 1 | European Herring Gull（`Larus argentatus`） | Hugo Leclerc | Ouessant, France / 2021-05-14 | [XC670094](https://xeno-canto.org/670094) |
| 2 | Mediterranean Gull（`Ichthyaetus melanocephalus`） | Noé Ferrari | France / 2025-04-06 | [XC1094934](https://xeno-canto.org/1094934) |
| 3 | Mediterranean Gull（`Ichthyaetus melanocephalus`） | Noé Ferrari | France / 2025-04-06 | [XC1091846](https://xeno-canto.org/1091846) |
| 4 | Mediterranean Gull（`Ichthyaetus melanocephalus`） | Noé Ferrari | France / 2025-04-06 | [XC1091830](https://xeno-canto.org/1091830) |

- **使用位置**：`js/audio-assets.js`（base64 内嵌，约 100 KB），运行时由 `decodeAudioData` 还原，由 `js/audio.js` 随机挑一段、随机移调播放，作为「时不时」的海鸥叫。
- **改动说明**：只做**剪切**——从原始长录音里截出单次叫声事件、去掉前后静音与其它鸟叫；未做变调、未做混响、未做降噪重编码以外的处理（统一转为 MP3）。剪切属 CC BY 4.0 允许的改编，已在此声明。
- **许可证**：Creative Commons Attribution 4.0 International（CC BY 4.0），全文 <https://creativecommons.org/licenses/by/4.0/>。
  **署名要求**：使用时必须保留上表的录音者姓名、来源链接与许可证标识——三者都写在
  `js/audio-assets.js` 每个条目的 `credit` 字段里，并随页面一起分发。
- **重新生成**：`node _wip/verify/build_audio_assets.mjs`（源文件与许可证证据在 `_wip/audio-src/`，含 `LICENSES.md` / `MANIFEST.json`；`_wip/` 不进仓库，缺源文件时不重跑，现有 `js/audio-assets.js` 已自足）。

---

## 6. 程序化合成的声音（无第三方素材）

海浪、海风、以及开屏那一刀的全套拟音（刀划布、撕拉、切、吹灭蜡烛）**全部在运行时由
`js/audio.js` 用噪声与滤波合成**，不含任何采样素材，因此没有第三方权利。

- 合成参数、频谱目标与验证方法见 `docs/AUDIO.md`。
- 背景音乐由使用者自行提供（C418 等第三方曲目**有版权，不随仓库分发**），
  放 `assets/audio/music/` 目录，该目录下的音频文件已被 `.gitignore` 排除。
