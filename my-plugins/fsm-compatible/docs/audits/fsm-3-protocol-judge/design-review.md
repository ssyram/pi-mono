核对完成。四处一手依据（SDK `edit.d.ts`、公开 `withFileMutationQueue`、`agent_cli.rs:1832-1877`、persisted `ToolResultMessage` 类型）均已验证。无写入工具可用，按运行时约定将完整报告作为最终响应返回，由运行时持久化到绑定输出路径。

```markdown
# fsm-3-protocol-judge 设计限定确认（D3-1～D3-4 闭合复核）

## 结论与范围

**本单元：READY。**

本次只读复核原 BLOCKED 报告（design-review-initial.md）四处缺口的修订是否闭合，以及是否引入直接同合同回归。不重开全面审查、不重审已通过的首单元/fsm-2、不新增审查目标、不要求 provider 测试/OS sandbox/GUI/optional 工具。未修改文件、未执行命令、未调用 provider/daemon、未派子代理。

## Review

### D3-1 Edit 分支 — Closed

修订位置 `docs/design/fsm-compatibility/subplans/fsm-3-protocol-judge.md` §5（工具表 edit 行 + Edit分支 段）逐点核对：

- 原生入参：`oldString非空且replaceAll=false：SDK edit原生{path,edits:[{oldText:oldString,newText:newString}]}；不依赖legacy prepareArguments`。一手验证 SDK `dist/core/tools/edit.d.ts:5-10` 确为 `{path, edits:[{oldText,newText}]}`，与引用一致。
- 空 oldString：`oldString为空时…在该queue内检查目标：目标已存在（含目录/已有symlink）拒绝，未存在才mkdir父目录递归并writeFile(...,{flag:"wx"})`；并补充 `wx` 在检查后遭其它写者创建时仍拒绝。与处置决定一致。
- 部分失败副作用：`父目录的创建是此Edit分支的明确副作用，创建失败可能留下已创建目录，必须报告失败、不假称回滚或成功`。
- replaceAll：同一公开 queue 内读取原文件、全部非重叠匹配、零匹配失败、一次写回，保留 BOM/换行；取消检查点明确。
- queue 归属：`SDK执行自身withFileMutationQueue，不外层再取得同一queue造成死锁`。一手验证 `withFileMutationQueue` 为 SDK 公开导出（`core/tools/index.d.ts:3`、`core/sdk.d.ts:71`，签名 `(filePath, fn)`，`core/tools/file-mutation-queue.d.ts:5`），且 SDK edit execute 自身在 queue 内（`core/tools/edit.js:95`）——普通分支不外层取 queue、空 oldString 分支由桥使用公开 queue，两者不冲突。
- 权限不放宽：`不新增write/apply_patch别名`，deny 闭集保留。

无回归：Edit 创建分支仍归属已授权 Edit，未暴露 write 名义或新工具。

### D3-2 目录 Read — Closed

修订位置同文件 §5（read 表行 + 目录Read分支段）逐点核对：

- `fs.readdir(path,{withFileTypes:true})获取实际完整项`；`directory加"/"，symlink用目标stat判断是否directory（坏链按实际名字保留）`。
- `按OC的a.localeCompare(b)排序`；`offset=输入offset||1、limit=输入limit??2000、start=offset-1→items.slice(start,start+limit)`；`limit=0合法返回空窗口，超出末尾为空`。
- `不在SDK ls已截断文本上分页；offset=2/limit=1必须取得第二项`——原缺口（SDK ls 无 offset、默认 500、先字节截断）已显式消解。
- `details保存offset/entries/totalEntries/truncated`，截断时保留真实窗口、不据截断数据重算总数。

expectations §5 已同步同一规则。无回归：仍是 `read` 工具的受控分支，未新增工具名。

### D3-3 时间归一化 — Closed

修订位置同文件 §2 与 §4 逐点核对：

- §2：`SessionHeader/SessionEntryBase.timestamp实际为ISO字符串：先Date.parse→验证非负安全整数→用new Date(ms).toISOString()===原字符串确认…canonical ISO形状/真实日历值；非法字符串/数值拒绝，不用当前时间补造历史。rawBranch/header保留原字符串，转换另存归一化值`。
- `message/event数值时间必须是非负安全整数毫秒`——独立验证，与持久 ISO 字符串路径分离；`message.timestamp存在但非法时拒绝；仅确实不存在时可用归一化owning entry时间`。
- §4 各映射行已同步：user entry `time.created=归一化entry毫秒`；assistant `通过整数检查的message.timestamp；缺该字段才用归一化entry毫秒`；result `time.end=归一化实际result entry毫秒`；completed 为归一化值 max 且不在执行中补写。
- §7 终结表已同步：`归一化实际assistant/结果持久化毫秒，completed非负安全整数`。
- 全部 max/created/updated/completed/start/end 运算限定使用归一化值；wire 无 ISO 残留路径。

expectations §2 已同步（roundtrip、独立数值验证、非法不 fallback、raw 保留原串、wire 全归一化毫秒）。无回归：不改写历史 raw 记录。

### D3-4 capture 收尾 — Closed（附一条 P2 报告项）

修订位置 `docs/design/fsm-compatibility/detailed-design.md` §5.4 逐点核对：

- `captureStructuredOutput`（:179）：`有效追加本turn真实toolCallId/已验证object/时间到成功列表`；`不同capture保留两份实际parts，交原driver判conflict/repair，不选择一个覆盖另一个`——真实列表追加、冲突不覆盖，与叶子 §7 `相同完成对象可重复，不同完成对象保留两个实际captures` 一致。
- `finishJudgeTurn`（:181/183）：`先await原callback`；`原error/length/aborted不成功`；`本正常完整批次至少有一条validcapture且无终结error→action:end，包含多个不同成功capture的conflict批次，否则返回原decision`；`conflict实际parts交原driver判定和repair，不留给桥继续模型回合消解`；`无新continuation，abort不作为正常结束`。与叶子 :107 及 expectations §6/§7（`至少一条有效capture的正常turn可end，conflict也作为真实材料返回`）完全同步。
- consumer 一手验证：`use-fsm crates/server/src/agent_cli.rs:1832-1877` 确认两个不同 completed StructuredOutput → `conflicting` → `NormalIncomplete(JudgeError::MissingStructuredOutput{ConflictingStructuredOutputs})`，且 conflict 判定在循环后做出、其余 parts 仍被校验——设计与原 driver 的 repair 所有权吻合，桥不消解冲突是正确归属。

**Finding（P2，报告项，不影响闭合）**：`detailed-design.md:179` 写 capture 返回 `真实tool result+terminate:true`，而 `:183` 与叶子 :107 写 `没有写不存在的tool_result.terminate字段`/`不能从tool_result hook返回不存在的terminate字段`。两手均一手核实后并不实质矛盾——`terminate` 是 `pi-agent-core/dist/types.d.ts` `AgentToolResult` 上的真实批级早终止 hint（`agent-loop.js:466`：全部 result `terminate===true` 才早终止；`:167` `hasMoreToolCalls=!terminate`；`:166` 每批次后调用 `finishTurn`，`decision.action==="end"` 直接结束），而持久化的 `pi-ai` `ToolResultMessage`（`types.d.ts:409-423`）确实没有 terminate 字段、OC wire part 也不应有。但三处文本用同一个 "terminate" 指称两个不同对象且未加区分，":183" 的“不存在”字面不准确，实施者可能误读为 capture 不该返回 terminate:true。最小修正：在 §5.4 或叶子 §7 加一句限定——`terminate:true` 是 execute 返回值上被 agent-loop 在持久化前消费的批级 hint；持久化 tool_result part/wire 无 terminate 字段。机制行为（含 conflict 批次经 wrapper end 而非依赖单工具 terminate）当前已自洽，不构成闭合缺口。

## 六项标准对应状态（仅就本次复核范围）

D3-1～D3-3 补齐了标准 3/4/6 所缺的 callee 入参与转换步骤；D3-4 同步了标准 5 的总细化与叶子/expectations 差异；四处均可定位到可编码粒度（标准 6）。原报告“已正确部分”（路由、证据来源、权限隔离、错误分类、SDK 创建接口、finishTurn 机制）未被本次修订触碰或削弱。

## 放行边界

- 本轮未独立运行任何测试/类型检查；原报告的 runtime/admission 测试结论仍未独立复跑，不作为本单元证据。
- fsm-3 仍无生产代码；本确认仅针对设计合同。实施后仍需原合同对照与直接测试。
- 根 ready 仍须 child/gates/Watcher 真实接线，不在本单元范围。

- **Correct：**D3-1～D3-4 修订点全部在指定位置闭合，expectations §2/5/7 同步，无直接同合同回归。
- **Fixed：**无；本轮只读。
- **Finding：**P2×1（detailed-design.md:179 与 :183/叶子:107 的 "terminate" 指称未区分，见上），报告项，不阻塞。
- **Merge verdict：OK；本单元 READY。**
```