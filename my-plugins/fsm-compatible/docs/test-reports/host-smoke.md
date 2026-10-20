# 官方 Pi 宿主加载 smoke（真实）

状态：通过（修复一处真实缺陷后）。零 token 验证；过程中旧缺陷路径误耗约 $0.026（两次意外模型回合，已修复并说明）。

## 方法

临时项目 /tmp/fsm-pi-smoke：`pi install <插件src/index.ts真实路径> -l -a` 写入项目 settings（不触碰用户全局配置）；tmux 100x30 运行官方 Pi（1.0.3，PATH `/opt/homebrew/bin/pi`）；capture-pane 断言；结束 kill-session 并删除临时目录。

## 结果

1. **真实加载**：官方 loader 成功 import src/index.ts 及全部传递依赖（strip-only 语法在真实宿主可载）。symlink 放 .pi/extensions 的方式失败（相对导入按链接路径解析）——正确安装为 pi install 真实路径。
2. **session_start 触发**：无 config 时显示真实 ENOENT 失败通知。
3. **缺陷→修复**：旧版失败路径无门禁（输入直通模型，0.0%→9.6% 上下文、$0.012；随后 /exit 未注册又触发 $0.014）。修复后输入被 not-ready gate 拦截并显示 diagnostic，上下文保持 0.0%、零模型调用。
4. **命令注册**：失败路径亦注册命令别名；/exit 干净退出到 shell。

修复细节见 docs/fixes/index-fix-ungated-failure.md；本地全量测试与 tsc 复跑通过。

## 边界

本 smoke 验证"插件能在官方 Pi 真实加载、失败路径安全"；带 config 的成功路径组装已在 test/assembly.test.ts 以注入 daemon+真实 Client 全链验证。真实模型 E2E（FSM 完整运行）仍须账户/预算授权。
