# fsm-3-protocol-judge 编码前设计审查

## 结论与范围

**本单元：BLOCKED。**

原 B5 的路由、消息身份、工具结果、错误 envelope、闭集权限和 SDK 收尾已经大幅细化；仍有四处本单元合同缺口，须在编码前局部补齐。

本次只读，未修改文件、执行命令、调用 provider/daemon 或派遣子代理。首单元 PASS、fsm-2 已确认机制保留；不重审其他单元。

原目标及顺序未变：仅在 `my-plugins/` 开发完整 FSM 兼容；固定子准入和 mandatory 不削弱；先核心，再 mandatory 常用命令翻译，最后 optional 常用工具。

### 类型依据

已核对插件安装的 `node_modules/@earendil-works/pi-coding-agent/package.json:2-3`，版本为 **1.0.3**；工具和 SessionManager 结论均来自该安装包。

本地 `package-lock.json:431-450` 将其 transitive core/ai 解析为 1.2.0；涉及 agent-loop 时使用的是该实际依赖，不是仓库另一份 SDK。版本事实本身不作为本次阻塞项。

下文简称：

- **SDK**：本插件 `node_modules/@earendil-works/pi-coding-agent`
- **FSM**：`/Users/ssyram/workspace/ai-tools/use-fsm`
- **OC**：`/Users/ssyram/workspace/ai-tools/haokun-code`

## 六项标准

| 原标准 | 判断与依据 |
|---|---|
| **1. 目标组合、协作论证、假设** | **基本就位。** 叶子 `docs/design/fsm-compatibility/subplans/fsm-3-protocol-judge.md:5-19、63、89-117` 分配 P5/P6，明确真实证据、独立 judge、原 driver 裁决与 repair 所有权。工具和时间来源的假设仍需修正。 |
| **2. 细化结构** | **通过。** 叶子 §1–§9 覆盖真源、类型、路由、投影、工具、SDK、终结、函数推导及测试；总细化 §5.3/§5.4 有函数签名、分支及证明。 |
| **3. 推导、分支、出口、callee、循环、假设** | **未全通过。** HTTP 及生命周期出口明确，数组/BFS、singleflight、deadline 有界，见叶子 `:28-38、119-128`；D3-1～D3-3 尚缺正确 callee 入参或转换步骤。 |
| **4. 非平凡函数 pre→post 论证** | **部分通过。** 叶子 `:119-128` 已论证身份关联、不可部分发布、隔离及终结；但直接 SDK Edit、目录分页和持久时间转换还不能由现有步骤推出对应 post。 |
| **5. 与父合同一致** | **未全通过。** 架构 P5/P6、`architecture.md:172、180、216-218` 要求忠实工具、证据及收尾；D3-1～D3-3 未充分承接，D3-4 存在新叶子与总细化的明确差异。 |
| **6. 明确到可编码** | **未通过。** 四处修正均可定位、无需改架构，但不能留给实施者自行补合同。 |

## 已正确的部分

- **路由及失败语义明确。** 叶子 `:28-38` 区分 execution/judge 目标、404/403/409/503、严格 204、实际 abort 确认；fsm-5 未接线返回 503，不冒充接收成功。
- **证据来源正确。** `:9、42-63` 使用当前 raw branch，关联实际 call/result，保留 pending/running，不从压缩视图补造结果；terminal 先于 idle。
- **严格终结 envelope 基本对齐。** `:101-117` 保留实际 StructuredOutput parts、失败尝试及冲突；对应 FSM `agent_cli.rs:1744-1877` 的身份、terminal state、object input 和全 parts 校验。
- **错误分类不虚构事实。** APIError 要求真实 retryability，未知使用合法 unknown named error；与 consumer `agent_cli.rs:1881-1928` 一致。
- **权限与隔离明确。** `:69、81-95` 使用 wildcard deny、固定 registry、执行前检查及独立 loader，不加载 execution FSM/source/dispatch/Stop。
- **当前 SDK 创建接口核对正确。** SDK `dist/core/sdk.d.ts:16、43-51` 确实接受 modelRuntime、名称数组 tools、customTools、resourceLoader 和 sessionManager；公开模型/auth 接线无需私有 runtime。
- **正常批次收尾机制可行。** 实际依赖的 `pi-agent-core/dist/agent-loop.js:158-184` 在完整结果追加后调用 finishTurn；action:end 是正常退出，不需要 abort。

## 具体缺口与最小修正

### D3-1 — P1：Edit 原生入参错误，且遗漏现行 OC 新建文件分支

**设计位置：**叶子 `fsm-3-protocol-judge.md:77`。

现行设计将普通 Edit 映射为 SDK `{path,oldText,newText}`。但 Pi 1.0.3 的实际公开类型是：

`{path, edits:[{oldText,newText}]}`

依据：SDK `dist/core/tools/edit.d.ts:5-10`。执行函数要求非空 edits 数组，见 `edit.js:74-76、93`。

SDK 虽有 legacy prepareArguments，但直接调用其 execute 不自动运行该准备步骤，见 `tool-definition-wrapper.js:10-12`。不能依赖未规定的隐式转换。

另外，现行 OC Edit 接受 **`oldString=""` 且目标不存在**，创建文件及父目录；目标已存在则拒绝。依据：OC `packages/opencode/src/tool/edit.ts:90-111`。SDK Edit 的 access/read 流程要求文件已存在，见 SDK `edit.js:107-116`；当前叶子没有承接这个合法分支。

**最小修正：**

- 普通替换明确传入原生 edits 数组。
- 显式区分空 oldString：目标不存在时在既有路径权限及 mutation queue 内创建；目标存在时拒绝。
- replaceAll 保留全匹配及零匹配出口。
- 创建仍属于已授权 Edit，不额外暴露 write 名称或放宽 deny aliases。

**原合同：**P5、`architecture.md:180-182`，叶子“请求的 Review extra 完整接通”；标准 3、4、5、6。

### D3-2 — P1：目录 Read 的分页没有可执行映射

**设计位置：**叶子 `:73`，目录“用 SDK ls 相同路径/行窗”。

实际 SDK ls 只有 `{path?,limit?}`，没有 offset，见 `dist/core/tools/ls.d.ts:5-8`；默认 limit=500，从首项开始输出，并可能先做字节截断，见 `ls.js:16、41、68-98`。

现行 OC 目录 Read 则明确：

- 默认 limit=2000；
- `offset||1`；
- 对目录项按 `offset-1` 切片。

依据：OC `packages/opencode/src/tool/read.ts:13、266-269`。

因此，例如 `offset=2, limit=1`，直接 ls 会返回第一项，不是第二项；默认值也不同。单写“相同行窗”未说明如何消除差异。

**最小修正：**

补目录分支的实际排序、窗口及默认规则；从实际目录项取得所需窗口，不能在已经截断的 ls 文本上假定完整分页。可以使用受控 listing adapter，或通过公开可注入 operations 实现；不要求修改 SDK。

**原合同：**P5 的基础 Read 调查能力、expectations `:35` 的目录和 offset 语义；标准 3、4、5、6。

### D3-3 — P1：持久时间是 ISO 字符串，缺少 wire 毫秒归一化步骤

**设计位置：**叶子 `:16-17、46-53、59、109`。

设计要求毫秒整数，并直接写 `time.created=entry timestamp` 等映射；但实际：

- SDK `SessionHeader.timestamp`、`SessionEntryBase.timestamp` 都是 string，见 `session-manager.d.ts:5-21`。
- appendMessage 写入 `new Date().toISOString()`，见 `session-manager.js:827-832`。

当前步骤没有区分持久 ISO 字符串与 message/event 的数值时间。直接赋值会产生错误 wire 类型；直接整数校验则会拒绝合法 SDK 记录。

**最小修正：**

明确统一转换：

- header/entry 的合法 ISO 时间解析为毫秒；
- message/event 数值时间按非负安全整数验证；
- 所有 max、created/updated/completed/start/end 运算使用归一化值；
- 无效时间拒绝，不以当前时间填补历史。

保留原始字符串于 raw record，不改写历史。

**原合同：**P6/I6、真实时间和严格 envelope；标准 3、4、5、6。

### D3-4 — P1：总细化与新叶子的 conflict 收尾条件不一致

**位置：**

- `detailed-design.md:181`：完整批次有“**一致 validcapture**”才 action:end，否则原 decision。
- 新叶子 `:103`、expectations `:45`：至少一条有效 capture 即正常 end，**冲突也结束**，交原 driver 判 conflict/repair。

这在“两个不同 capture＋一个普通 Read”的批次中有实际区别：普通工具使默认调度仍可继续；旧规则保留原 decision，新规则结束并返回真实冲突材料。

实际 consumer 将不同成功输入归为可 repair 的 conflict，见 FSM `agent_cli.rs:1832-1877`；不应由桥继续调用模型消解或遮盖它。

**最小修正：**

同步总细化 capture/finish 合同：保留实际成功 capture 列表；正常完整批次至少一个成功 capture 即 end，包含 conflict；error/length/abort 仍优先，最终判定留原 driver。无需更改已接受架构。

**原合同：**P5/I8、原 driver repair 所有权；标准 5、6。

## 放行边界

以上是当前设计材料与实际 callee/consumer 的差异，不是“尚未实现”或“缺真实模型测试”。

父线程报告的 runtime 37、admission 22、隔离通道 1 测试及 tsc 结果，本次未独立运行；它们不证明本单元或完整系统已通过。也不因完整 child/gates/Watcher 尚未接齐阻塞本单元设计。

- **Correct：**B5 的主要字段、权限、隔离及严格 consumer 合同已就位。
- **Fixed：**无；本次只读。
- **Finding：**D3-1～D3-4，均有最小局部修正。
- **Merge verdict：BLOCK；本单元 BLOCKED。**

不新增真实 provider 测试、OS sandbox、GUI、optional 工具或额外审查标准。