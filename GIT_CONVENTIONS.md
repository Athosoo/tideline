# Git 规范 · tideline（站点仓库，短卡）

```yaml
status: settled
strict: true
language: zh
framework: github-flow   # main 可跑 + feat/<主题> 短命分支
```

> 这是**短卡**：只写这个仓库特有的硬规则。git 的机制全文 —— worktree 怎么开、落地流程、
> 事故恢复、提交前三问 —— 在工作区根 `docs/GIT.md`，这里不重复抄。
> 两处说法不一致时以 `docs/GIT.md` 为准，并**顺手把这份改掉**，不要留第二份真相。

## 1. 三条硬规则

1. **`main` 永远可跑。** 判断标准不是测试通过，而是**双击 `GIFT/index.html` 能出画面**
   （`file://`，不许 ES module / fetch / CDN）。合并前没在本机双击过 = 没验过。
2. **一个提交只做一件事。**
3. **证据先于提交。** 改性能给数值，改视觉给截图，改行为给复跑脚本。

## 2. 分支

- 只有 `main` 和 `feat/<主题>`（纯修复用 `fix/<主题>`）。从 `main` 切，一个主题一条，**不复用**。
- 不建 `develop` / `release` / `hotfix`：单人项目里它们只会变成另一棵要同步的树。
- 落地：`git rebase main` → `git -C /e/DeepSeekplay/GIFT merge --ff-only feat/<主题>`。
  ff 失败说明 `main` 前进了，回去 rebase；**不许 `--no-ff`、不许 `--force`**。
- 合完**两条分支都推**（远端那条是备份兼索引，`git log feat/<主题>` 能看出某个改动在哪）；
  本地删不删随意，删远端前先 `git branch --merged main` 确认它已被包含。

## 3. 提交信息

一句**中文**祈使句（≤72 字符，句末不加句号）→ 空行 → **为什么** → 按文件列点。

> 以工作区根 `GIT_CONVENTIONS.md` 为准（`strict: true` / `language: zh`）：**标题只写中文**，
> 英文标题不合规。历史提交大多是英文，那是旧规矩，不要再照着写。

- 标题写**做了什么**，正文写**为什么**（带数字、被否掉的替代方案、代价）。
- **不加** Conventional Commits 的 `type:` 前缀：这个仓库没有自动发版流水线，
  前缀只会让标题变长；要分类就用「按文件列点」。
- 文档提交同样格式（中文标题、正文中文可以）。
- 不 `--amend` 已推送的提交；不在 `main` 上先提交再「整理」。

## 4. 并行

这个仓库可能**同时**被另一条会话使用（真实发生过）。动手前先 `git -C /e/DeepSeekplay/GIFT status -sb`。

```bash
git -C /e/DeepSeekplay/GIFT worktree add /e/DeepSeekplay/_wt/<name> -b feat/<name> main
```

必须带 `-C .../GIFT`（在根目录建出来的是工作区根仓库的检出）。**绝不** `checkout` / `reset` /
`stash` 别人正在用的树；看到不认识的改动就另开 worktree，不要「顺手收拾」。

## 5. 绝不入库

`_wip/`（只有 `_wip/verify/` 例外）、凭据（`GH_TOKEN` 只在 Windows 用户级环境变量，
绝不 echo / 提交）、无许可的第三方代码、抓帧 png、`GIFT/__shot.html` 这类临时宿主。
生成物例外：`js/sea.bundle.js` 属于交付物，改 `js/sea-entry.js` 后必须重建并一起提交。

## 6. 提交前自检

1. `git status -s` 里有没有 profile / 截图 / 临时宿主残留？
2. `git diff --cached --stat` 的改动范围，和提交信息说的是一回事吗？
3. 这条提交单独拿出来，能解释「为什么」吗？

## 参考

- 工作区根 `docs/GIT.md` —— 全文（worktree、事故恢复、收尾清单）
- 工作区根 `AGENTS.md` §5 —— 短规则
- `_lab/GIT_CONVENTIONS.md` —— 实验室仓库，分支模型不同（长期 `lab/<name>`）
