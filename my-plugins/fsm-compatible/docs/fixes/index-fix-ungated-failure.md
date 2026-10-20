# index.ts 失败路径未装 not-ready 门禁（真实宿主 smoke 发现）

## 现象

临时项目经 `pi install` 在官方 Pi 宿主加载插件：无 `fsm-compatible.config.json` 时，session_start 失败通知正常显示，但随后用户输入 `hi` 直接触发真实模型回合（未拦截）。旧行为下缺 config 的会话完全无门禁运行。

## 根因

index.ts 的 catch 只 notify；not-ready gate 仅在 openOwnedRuntime 成功路径内部安装。loadConfig 在 openOwnedRuntime 之前抛出时，没有任何 gate 存在。registerCommandAliases 也在 loadConfig 之后，失败时命令同样缺失（旧进程中 /exit 被当普通文本再次触发模型回合，共误耗 $0.026）。

## 修复

index.ts 重排：session_start 一开始即 registerCommandAliases（命令仅消费公开 API，安全）；catch 中以独立 RootHealth（永不 commit）安装 not-ready gate，diagnostic 携带真实错误；成功路径不变（openOwnedRuntime 自带 gate/health）。附带发现：经 symlink 放入 .pi/extensions 的加载方式因相对导入按链接路径解析而失败，正确安装方式为 `pi install <真实路径> -l`（README 已更新）。

## 验证（官方 Pi 1.0.3 宿主，tmux）

修复后：插件真实加载→缺 config 失败通知（ENOENT 原文）→输入 `hi` 被 gate 拦截并显示 `Error: fsm-compatible runtime not ready: ENOENT...`，上下文保持 0.0%、零模型调用→`/exit` 注册且干净退出到 shell。全量本地测试与 tsc 复跑通过。

## 教训

失败路径与成功路径必须同等设计门禁；"配置缺失"是最常见的第一运行状态，不能让插件在无门禁下静默放行。已记 .pi/AI-learning.md。
