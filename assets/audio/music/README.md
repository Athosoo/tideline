# 背景音乐放这里

站点按顺序尝试这五个文件名（见 `js/audio.js` 的 `MUSIC_SRC`；前一个解不开就自动换下一个）：

```
assets/audio/music/1-05. Minecraft.ogg
assets/audio/music/1-05. Minecraft.mp3
assets/audio/music/music.m4a
assets/audio/music/music.ogg
assets/audio/music/music.mp3
```

**只放一首**（各格式留一份也行，播放器会挑第一个能解的）。

- 没有文件时站点完全正常，只是静音（不报错、不等待）。
- **哪些进仓库**：默认整目录被 `.gitignore` 排除，只有一个例外 ——
  `1-05. Minecraft.ogg`（2.5 MB）在仓库里，因为线上 Pages 要能听见音乐；
  `1-05. Minecraft.mp3`（6.3 MB）仍只在本地当兜底。
- **顺序是 ogg 先、mp3 后**：线上没有 mp3，先试它就是一次 404，慢网下这条 404 会排在
  一堆 js/图片后面，音乐要分钟级才响。ogg 排第一两边都只发一次请求。
- **版权**：C418 的曲子有版权，这里只是私人礼物、非商业使用，未取得分发许可；
  线上 Pages 是公开地址，等于把这一首公开托管了 —— 换曲子时优先换成无版权曲目
  （见 `THIRD-PARTY-NOTICES.md` §7）。
- 播放方式：`<audio loop>`，音量由站点做 ducking（开屏时降低、进入画廊更低）。
- 想临时关掉全部声音：按键盘 **M**，或网址后面加 `?audio=0`。
