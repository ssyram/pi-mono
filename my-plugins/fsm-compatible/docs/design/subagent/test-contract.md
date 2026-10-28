# HC SubAgent：固定实现与单元测试接口

状态：主线程定稿，2026-10-23。本文件只固定本轮已获授权的 HC 合同及实现接缝；不证明实现已完成或测试已通过。

规范优先级：HC 固定源码 `e81af70d789a33d67a25e158604e9bd6c9325bfd` → 本轮 architecture/detailed-design → 本接口。若冲突，报告主线程，不按旧实现修正期望。源证索引为 `../../research/hc-subagent-contract-20261023.md`。

所有下列路径相对插件根；测试从 `test/` 用 `../src/...` 导入。不要求 barrel，不能为测试加入模型工具或备用运行器。

## 1. 共享类型：`src/subagents/hc-agent-types.ts`

```ts
export type HcAgentToolName = "agent" | "agent_list" | "agent_send" | "agent_stop";
export type HcAgentRelation = "self" | "parent" | "child" | "sibling";
export type HcAgentStatus = "running" | "idle";
export interface HcAgentModel { providerID: string; modelID: string }
export interface HcAgentWorkdir {
  path: string;
  source: "generated_git_worktree" | "generated_empty_workspace" | "provided_cwd";
  enforced: false;
  note?: string;
}
export interface HcAgentSession {
  session_id: string;
  parent_id: string | undefined;
  name: string | undefined;
  agent_type: string | undefined;
  title: string;
  time_created: number;
  workdir: HcAgentWorkdir | undefined;
  status: "busy" | "retry" | "idle";
}
export interface HcAgentMember extends Omit<HcAgentSession, "status"> {
  depth: number;
  relation: HcAgentRelation;
  status: HcAgentStatus;
}
export interface HcAgentMessage {
  target: string;
  sender: string;
  sender_name: string | undefined;
  sender_agent: string | undefined;
  body: string;
}
export interface HcToolOutput {
  title: string;
  metadata: Record<string, unknown>;
  output: string;
}
export interface HcAgentStarted {
  parentSessionId: string;
  sessionId: string;
  agentType: string;
  description: string;
  name?: string;
  workdir: HcAgentWorkdir;
  model: HcAgentModel;
}
export interface HcStopOutcome {
  stopped: string[];
  failed: { session_id: string; reason: string }[];
}
```

这些是 HC 可观测字段的内部投影，不是第二套持久状态。宿主 handle、sessionFile、provider registry、variant、notify、描述等保存在运行时记录，不从这个快照重建或猜测。

## 2. 字段和消息：`src/subagents/hc-agent-message.ts`

```ts
export function escapeAgentField(value: string): string;
export function renderAgentMessage(message: HcAgentMessage): string;
```

`escapeAgentField` 顺序替换反斜杠、CR、LF、TAB、`[`、`]`，编码分别为 `\\`、`\r`、`\n`、`\t`、`\[`、`\]`。

`renderAgentMessage` 对 name/type 使用上述编码；type 缺省 `agent`。name truthy 时 who=`name (agent, sender)`，否则 `agent (sender)`。正文为四段用换行拼接：

1. `[Agent message from ${who}]`
2. `To reply, use agent_send(target="${sender}", message="<your reply>").`
3. 空行。
4. 原始 body，不转义、不 trim。

源：HC `agent-management/inbox.ts:37-71`。测试应覆盖转义、无名称、body 保持，不借助生产 formatter 生成预期。

## 3. 邻域与寻址：`src/subagents/hc-agent-tree.ts`

```ts
export function agentNeighborhood(caller: string, sessions: readonly HcAgentSession[]): HcAgentMember[];
export function resolveAgentTarget(input: {
  caller: string;
  value: string;
  scope: "neighbor" | "child";
  sessions: readonly HcAgentSession[];
}): string;
export function planAgentStop(caller: string, target: string, sessions: readonly HcAgentSession[]): HcAgentSession[][];
```

前提：sessions 来自真实存储，ID 唯一、parent 链无环；不要求输入已排序。不新增循环恢复、租约或超时策略。

- neighborhood：self、parent、直属 children、同父 siblings；不含孙辈或无关根。按 relation 的上述顺序、time_created、session_id 排序。depth 沿真实父链，根为 0。busy/retry→running，其余 idle。caller 不存在抛 `HcAgentDomainError`。
- resolve：`value.startsWith("ses")` 时直接返回 value，不在此处查存在性或限制树；调用者后续查目标。短名查邻域；neighbor 排除 self，child 仅直属 child。仅一个同名成功，零或多个失败；匹配 ID 顺序来自邻域。
- planStop：目标不存在为 AgentNotFound，非直属为 NotAChild。返回 target 及全部后代，按 depth 降序分组。组内顺序不承诺，不按 running 过滤。没有 cancel、dispose、文件删除或 FSM 调用副作用。

源：HC `agent-management/tree.ts`、`lifecycle.ts:401-441`。测试同层用集合比较，不新增稳定全序要求。

## 4. 域错误：`src/subagents/hc-agent-errors.ts`

导出 `HcAgentDomainError extends Error`；具有只读 `tag: string`。具体构造参数属于实现私有；树函数抛出的 `.message` 必须与 HC 源码相同。测试不依赖私有构造器。

固定测试错误正文：

- `No Agent found for session ${session_id}.`
- `Session ${target} is not a direct child of this Agent. You can only stop Agents you spawned yourself.`
- `No Agent named "${value}" is addressable from here.`
- `The name "${value}" matches ${matches.length} Agents (${matches.join(", ")}). Use a session_id instead.`

其余 type/name/depth/workdir 错误按 HC `schema.ts:117-200`，不额外加前缀。模型工具将已知域错误映成 metadata={}、output=message 的普通结果；不是 isError=true。非域异常保留原失败分类。

## 5. 工具回执：`src/subagents/hc-agent-output.ts`

```ts
export function formatAgentStarted(info: HcAgentStarted): HcToolOutput;
export function formatAgentList(members: readonly HcAgentMember[]): HcToolOutput;
export function formatAgentAccepted(titleTarget: string, targetSessionId: string): HcToolOutput;
export function formatAgentStopped(titleTarget: string, outcome: HcStopOutcome): HcToolOutput;
```

精确字符串、空行、可选行、metadata 取 HC `tool/agent.ts:170-207,232-266,309-329,355-381`；正文模板已收录 Sol 源码调研。不得生成 JSON 正文、自动名字、额外状态或省略 footer。

- Started title=description；metadata={parentSessionId,sessionId,model}。name/note 仅 truthy 时出现，不用 child title 代替 description。
- List title=`agents`；metadata={count}。保留传入成员顺序；name/type/title 转义，workdir 原样。七列 TSV、空行和原 footer。
- Accepted title 保留调用的 target（可能为短名）；metadata.target 与正文使用解析得到的 SID。说明仅 accepted，不等待处理/回复。
- Stopped title 保留 target；metadata.stopped/failed 为数组长度。仅 failed 非空时增加 Failed 区块，始终保留可恢复的 suffix。

## 6. 模型与深度

`src/subagents/hc-agent-model.ts`：

```ts
export function selectAgentModel(caller: HcAgentModel, pinned?: HcAgentModel): HcAgentModel;
```

返回 pinned（若定义），否则 caller；不查 Nico 默认模型、不读取 env。caller 是实际调用 assistant turn 的模型，不是任意 session 最近设置。variant 的源语义由运行时另外处理，单测不扩写本签名。

`src/subagents/hc-agent-toolset.ts`：

```ts
export const HC_AGENT_TOOL_NAMES: readonly HcAgentToolName[];
export function availableAgentTools(depth: number, limit?: number): HcAgentToolName[];
```

顺序为 agent/list/send/stop，默认 limit=3；depth>=limit 只保留 list/send，低于则四个。此函数只处理深度，普通权限/FSM 过滤仍由各自边界执行，不加 Nico 默认深度或恢复门禁。

## 7. 简单单测范围与执行

独立 Sol 本轮写 4–6 个短文件即可：消息转义、精确回执、邻域/寻址/stop plan、模型/深度。可在单文件中组合同概念用例；每文件不超过 200 代码行。无需为了数量覆盖每个 runtime 分支。

测试不运行真实 LLM、FSM daemon、tmux、provider API，不复制完整 HC 工程，不写生产源码，不放宽 HC 字符串。`Accepted` 的文字/同步返回合同可以单测；实际消费、续行、门禁和父通知的全链路留给独立真实 HC/Pi 同脚本实验，不用简单单测冒充它。

隔离目录 `my-plugins/.runtime/fsm-compatible-unit-tests-20261023` 的 src 可链接到插件 src，test 使用最终位置的相对导入。先写断言；生产模块就绪后用已有 Vitest 对具体文件实际运行。若实现不符，保留失败，向主线程报告。主线程在双方完成后原样接入插件 test/。


## 对偶状态（2026-10-28）

14/14 套剧本 Pi 对偶全 PASS：v2×3（reference/idle-resume/soft-review）、v3×3（semantic-stop/semantic-wait/native-agents）、v4×4（domain-errors/creation-rejections/header-escaping/unnamed-cancellation）、fuzz×4（gate/variable/depth/name）。v3/v4/fuzz 均经稳定性复跑。

运行方式（仓库根）：

```sh
node my-plugins/fsm-compatible/scripts/dual/run-plot.mjs --plot=my-plugins/hc-fsm-reference/plots/reference.json          # v2
node my-plugins/fsm-compatible/scripts/dual/run-plot.mjs --plot=my-plugins/hc-fsm-reference/v3/plots/semantic-stop.json  # v3
node my-plugins/fsm-compatible/scripts/dual/run-plot.mjs --plot=my-plugins/hc-fsm-reference/v4/plots/domain-errors.json # v4（daemon 数据目录 <run>/f）
node my-plugins/fsm-compatible/scripts/dual/run-plot.mjs --plot=my-plugins/hc-fsm-reference/fuzz/suite/plots/gate-boundaries.json  # fuzz（复用 v2 引擎）
```

退出后看 `<run>/outcome.json`（finalMessage/failure）；证据在 `/tmp/fsm-dual/<id>/`。新差异面先对照 dual-legitimate-differences.md 第 3b 节，未命中按其第 4 节流程。
