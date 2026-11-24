# 外部接线隔离环境实测记录（2026-11-06）

环境：/tmp/tz-wire（PI_CODING_AGENT_DIR=agent，独立 HOME），插件副本开发 E1/E2；
Mock E3 控制 + E4 new-api（mock-backend.mjs，fake-qt 实现 E3 init 契约）；
真实 Pi 1.4.0 TUI（tmux，证据 final-capture.txt、mock.log）。

通过项：
1. /add-login my-zai throttle-zai：new-providers 声明来源、服务后加载经 READY 补登记、
   交互输入上游 KEY、自动登录链（init→ensure→addKey→token→凭据入 auth.json）。
2. /login my-zai：原生登录同链通过（"Saved API key for GLM pool (my-zai)"）。
3. 重启恢复：pi --model my-zai/glm-5.3 直接可用（基线目录来自官方元数据，无需缓存/登录）。
4. 真实对话：回复 mock-ok；mock 网关收到 Bearer sk-gateway-e2e（网关令牌，非上游 KEY）。
5. /provider-usage my-zai：外部认领成功，显示 "5h: ≈33.3% used ≈1/3 account-equivalent" 池明细。
6. footer 实时显示 "(5h ≈33.3%, week ≈53.3%)"（E2 external-first，未回退内置查询）。

过程修复（接线/集成暴露）：
- plugin-config loadPluginConfig / throttle-zai-extension 未解包 BackendResult（两处，repo 已同步修复）。
- provider-profiles 扩展目录构建时漏传 new-providers 声明（沙箱修复：先取原始声明建目录）。
- /add-login 候选应实时读 catalog.ids()，不能注册时快照。

未覆盖：真实 quota-throttle E3（Rust）与新 API（E4）；多 Pi 并发；OAuth 来源；tmux 会话恢复分支。
