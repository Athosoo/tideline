# 背景音乐放这里

站点会按顺序尝试这四个文件名（见 `js/audio.js` 的 `MUSIC_SRC`）：

```
assets/audio/music/music.mp3
assets/audio/music/music.m4a
assets/audio/music/music.ogg
assets/audio/music/music.wav
```

任选一个格式、命名为 `music.*` 即可，**只放一首**。

- 没有文件时站点完全正常，只是静音（不报错、不等待）。
- 曲子**不随仓库发布**：本目录的音频文件已被 `.gitignore` 排除，只留本 README。
- 版权原因：C418 的曲子不能提交进仓库，只能本地放。
- 播放方式：`<audio loop>`，音量由站点做 ducking（开屏时降低、进入画廊更低）。
- 想临时关掉全部声音：按键盘 **M**，或网址后面加 `?audio=0`。
