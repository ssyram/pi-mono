# 当前交付状态 — 有界修复与 task 设置迁移已落地

目的仍是 loop 特殊 schedule 生效期间阻止 Boulder，不是完成一份审查报告。源码已接线；当前 Pi 加载版本、真实 TUI/用户验收未知，未提交。

## 当前文档权威

- [principles.md](principles.md)：用户目的、裁决与范围。
- [design.md](design.md)：全功能 P/M/R。
- [function-contracts.md](function-contracts.md)：branch/OR/聚合算法与 Result。
- [service-contracts.md](service-contracts.md)：同步协议、失败与诊断。
- [integration-contracts.md](integration-contracts.md)：实际 command/event/timer/service/completion 捕获、session/lifecycle、函数级合同。
- [integration-complete.md](integration-complete.md)：逐文件接线与操作说明；不把文件名当成验收结论。
- [integration-plan.md](integration-plan.md)：接线检查点；旧的未来计划已转为当前责任。

## 本轮修正

- `/task` 回调不再依靠 Pi command catch；自身捕获 getTasks/human操作/widget/输出失败。诊断及错误描述失败不再次抛。
- service reply、scheduler、countdown、loop bridge 的诊断与 timer 回调有 owning catch。completion 原 provider 的异步委托在 try 内 await。
- OMP binding 只允许当前可访问 context；loop runtime 按 cwd/manager/sessionID；初始绑定次序由 ready 通知补偿；branch refresh 与 once afterRun 重新同步。
- tool schema 显式含 inhibitBoulder，非法非boolean标记拒绝；shared定义读不到不伪造false；--no-boulder不吞prompt文字，补全只在合法选项位置提示。

## 证据状态

## CCA4 回程与当前修复

CCA4 已接受 A_DONE 并退出，监护取消、专属 tmux 停止、共享 daemon 保留。实际 fn509/external159，manifest565定义/152外部，不能作为正确性证明；最终覆盖账误将实际挂载函数列为不可达，未闭合全部函数本体覆盖。原报告未改写成新源码认证。

父级合并重复项，修 widget/诊断/renderer 边界、single-live-wait、Date 时间戳、补全隔离/转义，并将 poller reschedule 改为失败值。另直接复现并修复恢复失败后旧任务误放行：新 admission reader 返回 unavailable，不抛、不假空；task 始终先获豁免。首次创建/启动、错误输入重试、branch/history 恢复失败与重试四项通过。

当前直接运行：OMP task/Boulder 188/188；独立抑制127/127；compaction28/28；loop改动相关18/18。task、协议、compaction、loop专项类型检查通过。当前 SDK 入口检查仍因 built API 缺 agent_settled 失败；根 check 因其他工作历史快照的非精确依赖而停止；完整 loop 新增 session-persistence 测试尚因官方 AI 数据缺件未加载。没有把这些边界说成全绿。

用户已取消独立应急 off 方案，task 的 gate/show 设置统一直接依赖 my-settings，key 为 `omp-task:no-task-no-tool` / `omp-task:show`。默认session；--persistent额外local，--global额外global，可组合。旧task.json/widget-state日志退出。新真实服务测试证明坏local文件与坏任务历史同时存在时session off仍可生效；文件失败明确警告，session失败不假称成功。当前迁移回归OMP相关191/191、my-settings63/63，task专项类型及19文件scoped Biome通过。根/SDK/live边界仍保留；完整新合同见 [settings](../task-system/settings.md)，原修复裁定见 [CCA4 findings](../task-system/cca4-findings.md)。未 reload/commit/live验收。

## CCA4 启动前历史运行

以下是当时源码的实际命令，不认证当前所有插件：

- `node --experimental-strip-types --test test/boulder-inhibition/*.test.ts`（OMP目录）：125/125。
- `node --experimental-strip-types --import ./test/ts-resolve-hook.mjs --test test/boulder-*.test.ts test/task-command.test.ts test/task-system-human-completion.test.ts test/task-boulder-boundary.test.ts`（OMP目录）：63/63，含本轮命令、timer、补全异常回归。
- `node --experimental-strip-types --import ../oh-my-pi-v2/test/ts-resolve-hook.mjs --test test/*.test.ts`（loop目录）：130/130，含启动顺序、同cwd换session、branch刷新、schema和once归零。
- 独立 `boulder-inhibition/tsconfig.json` TypeScript检查 exit 0；根 `npm run check` exit 0（不覆盖全部插件源）。测试loader在Node26输出module.register弃用提示，不是功能失败；未因此扩大改造。

旧 `_cca_analysis/`、`_cca_analysis.run1/` 对应当时Standalone源版本，本轮新增入口/补全不在其覆盖结论内。原增量cca3（36文件、304定义/115外部）已在用户确认扩大为完整task系统后移交；冻结图没有被边跑边改，root已abort且task-owned服务/监护停止，checkpoint保留，不标COMPLETED。当前为 `boulder-ts-cca4`：root `ses_ecb040554ffeYDMKB7uqxk3xuO`，4220，模型 `tmp-haokun/glm-5.3-flash`；冒烟OK后正式prompt HTTP 204。74目标文件预检565定义/152外部，含旧loop协作；146份引用callee只作context。当前完整合同与修复责任见 [task full pass](../task-system/cca-full-pass.md)，快照 `~/cca-runs/boulder-ts-cca4/`，source hash/回执在 `~/.local/share/boulder-ts-cca4/`。没有修改旧CCA产物；当前流程终态与覆盖/修复边界见上节。以上历史运行不替代真实reload/TUI与用户验收，也不冒充整仓全部插件测试。

不追加审查，不默认提交或reload。最后仍需用户依据实际功能结果验收；公共边界不外抛的结论须明确源版本、函数范围和正常资源/SDK条件。
