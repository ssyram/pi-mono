# fsm-5-watch-install 当前运行依据

状态：设计READY（run a5d0587a，三句钉死已入叶子）；实现完成含组装smoke与安装计划；实施后独立contract对照尚未运行，未结算PASS。

## 实现（均在my-plugins/fsm-compatible）

- gate-moves（hook二分原样/ask-start|ask-end|main-tool-start/main-only/best-effort）+ permission-gate顺带移gate（修复release误用ask-start的实现bug）；AskUserQuestion工具（真实dialog、waitState、ask-end release、无UI不伪装）；AdvisoryQueue+drainOnce（严格204、idle投递、真实branch证据consumed、failed可观察、旧owner不转投）；promptAsync真实接线；helper新增/gate/suppress|/release。
- fsm-4残留清零：排队项段起signal/deadline复查；launch级容量/deadline/取消用例；修复握手超时行永久占容（ChildRuns.forget）。
- recoverRuntime（身份确认→重跑prepare→source-auth刷新，不重放）；runtime-config（含注入requester/scope接缝）；根组装openOwnedRuntime（桥随机密码listen→通道→投影/双门禁/ask/drain→delegation总线→全prepared才ready；失败路径gate逆序+资源逆序回收——修复了失败不回收桥的挂起）+ index.ts插件入口。
- planInstallation静态计划（缺二进制/依赖/配置给具体blocker；piConfig建议显式"never edits ~/.pi"；wire2校验声明；真实模型需账户/预算授权）。

## 命令与结果

npm run test:admission 22、test:runtime 37、test:protocol 15、test:judge 16、test:gates 4、test:children 11、test:watch 7、assembly 3——合计115项 + tsc 0。组装smoke用注入daemon+真实fake-mcp Client+faux模型源全链ready→工具执行→逆序回收；无真实provider/网络/token。

## 过程缺陷与修正

release reason误用（修）；AdvisoryQueue参数属性再犯（修）；failAll清空快照（改为原地标记）；组装失败不回收桥资源挂进程（补catch逆序回收）；fake daemon未回显注册URL（改为回显）；monkey-patch模块命名空间不可行（改配置注入接缝）。

## 未完边界

fsm-5实施对照未运行（下一步）；SA真实子进程集成与真实模型E2E属安装后运行验证，须账户/预算明确；P10 mandatory命令翻译随后。无staging/commit。
