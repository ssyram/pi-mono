# A方案运行依据与交付状态

状态：官方目录同步已实际可用，用户已亲验确认可用；严格证明状态PARTIAL，见failure-paths.md。未提交git，不改Pi核心/账号配置/默认模型，不启用旧外部发现模块。

## 实际结果

- 根npm run check：修复后再次exit0，2777文件No fixes applied；此根检查不宣称覆盖插件所有独立tsconfig。
- 6个定向测试文件41/41、exit0：unit/owner/refresh/loader、wire-merge Fuzz、lifecycle Fuzz（主会话19:28实际运行）。
- 既有受影响4文件23/23、exit0：add-login、extension-isolation、extension-registration、extension-side-effects（主会话19:30实际运行）。未运行整个仓库或声称所有旧suite通过。
- wire/merge Fuzz：seed20261117，共10,500案例；原日志test/fuzz/results/pp-fuzz-wire-2.log。
- lifecycle：原256×32混合序列保留，增加16×32正常序列；固定seed由PP_FUZZ_SEED可重放。重启断言按合法源身份而非旧内存是否观察过；恢复计数不再mtime业务时钟。这些是样本证据，不是全称证明。
- 网络：seed20261117，host128/128、Docker128/128，exit0；test/network/results/{host-run,docker-run}.log。镜像node:24.11.1-bookworm-slim，digest sha256:48abc13a19400ca3985071e287bd405a1d99306770eb81d61202fb6b65cf0b57。internal网络/只读必要挂载/非特权限制，仅本地mock；报告自有容器网络已清理。TLS、IPv6、多容器拓扑未覆盖。

## 真实Pi1.6.0试用

tmux会话pp-official-a-check保持供用户试用。

1. 首次普通/model zai-001-g-l/glm-5.4已选中；显示context1.0M。
2. Shift+Tab（tmux BTab）实际循环max→low→high→max，不出现off/minimal/medium/xhigh。
3. low档真实请求“只回复OK”成功，413输入/42输出，响应后仍1.0M。
4. 新进程窗口fresh-tools以 --model zai-001-g-l/glm-5.4:low 启动成功，验证缓存在初始解析前恢复；未通过setModel补救。
5. 真实调用read读取/tmp/pp-official-acceptance.txt，返回PP_OFFICIAL_CATALOG_TOOL_CHECK_OK；1.6k输入/71输出，响应后1.0M。该文件只含测试标记无秘密。

账号保持原凭据；未更改全局默认。测试采用仅Profiles扩展、只读工具和临时无持久会话，避免其它扩展干扰。完整持久会话--continue/历史恢复未宣称通过；fresh进程启动不冒充所有resume。

启动期间openai-codex官方目录有timeout警告，旧模型保留；它没有阻止本次GLM调用。tmux extended-keys关闭警告未阻止本次BTab档位切换，未修改用户tmux配置。

## 用户亲验

可连接：tmux attach -t pp-official-a-check，fresh-tools窗口可继续真实对话。用户也可自己新启动Pi使用原Profile挑选glm-5.4；未要求改type为不存在的zai-coding-plan。

用户亲验：用户已亲自实测并确认“确实可以用”（原话）。这闭合了可用性验收；不等于接受全部鲁棒性/全路径证明，后者仍按failure-paths.md保留PARTIAL及未覆盖边界。
