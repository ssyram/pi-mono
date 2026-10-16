# 叶子 D — 函数级合同与独立测试接口

本文件是独立算法层的共同合同，按 [D.root](design.md) 分配的 contract 展开；服务及诊断另见 [service-contracts.md](service-contracts.md)，实际外围捕获/lifecycle/补全见 [integration-contracts.md](integration-contracts.md)。测试作者只读四份业务文档及自己已写测试，不读实现或其他既有 tests；使用 node:test、node:assert/strict，直接 .ts imports。全部函数位于 `my-plugins/oh-my-pi-v2/boulder-inhibition/`。源码无需宿主实例或 SDK runtime imports。

## 1. protocol.ts：持久协议及 OMP 内部端口（无函数）

```ts
export const BOULDER_INHIBIT_ENTRY_TYPE = "OMPv2InhibitBoulder";
export interface BoulderInhibitSignal { type: string; value: boolean }
export interface BoulderEntryLike { type: string; customType?: string; data?: unknown }
export interface BoulderInhibitionSnapshot {
  states: BoulderInhibitSignal[];
  blockers: string[];
  inhibited: boolean;
}
export interface BoulderBranchReader { getBranch(): readonly BoulderEntryLike[] }
export interface BoulderInhibitionPort extends BoulderBranchReader {
  appendEntry(customType: string, data: BoulderInhibitSignal): void;
}
export interface BoulderInhibitionEffects {
  cancelWait(): void;
  reportInfo(text: string): void;
}
```

type 不变量：非空、无空白、大小写敏感。states 每个 type 唯一且只含解码后的 type/value；blockers 恰为 states 中 true 的来源；inhibited iff blockers 非空。数组顺序是最新有效来源记录倒序出现的顺序。port 拥有 session/branch 选择，库不持有 session。所有端口同步；返回的 branch 是有限、稠密、根→叶数组，调用期间不变。append 成功后 read-your-write；异常可能已经落盘，库不声称回滚。effects 不启动模型。

## 2. 解码与 branch 归约

### parse-signal.ts：parseBoulderInhibitSignal(data: unknown): BoulderInhibitSignal | undefined

caller：read、服务 set handler。Requires：未知输入按普通数据对象解释。流程：非 object/null/array→undefined；type 非 string、空或含空白→undefined；value 非 boolean→undefined；否则只复制 type/value 到新对象，忽略额外字段。

Ensures：返回 signal iff 输入满足统一类型不变量；返回值不共享原 data 对象，不修改输入。副作用无，错误 property getter/proxy 不在普通数据前提内；不添加任意对象执行安全保证。trivial：有限字段校验与复制，无循环。服务与历史日志使用同一判据，消除兄弟实现漂移。

### read-inhibition.ts：readBoulderInhibition(entries: readonly BoulderEntryLike[]): BoulderInhibitionSnapshot

职责：归约当前 branch。caller：内部 write、check、服务 get、tests。callee：parseBoulderInhibitSignal（保证有效/undefined 与复制）；Map 和数组操作。

Requires：§1 branch 数组合同，data 为普通数据。

流程与分支：从 length-1 递减至 0；缺失数组元素、非 custom 或其他 customType 跳过；调用 parse，undefined 跳过；已见 signal.type 跳过；否则将新 signal 放入 Map（包括 false）。结束后生成 states 与 blockers，返回 inhibited。

Ensures：每个 type 选中最大下标的有效记录；无记录为空快照；malformed 最新记录不屏蔽更早有效记录；不修改输入，不缓存，不按 timestamp 排序。副作用：无。

不变式：处理完后缀 entries[i+1..] 后，Map 对每个已见 type 恰持有该后缀最大有效下标的值，迭代顺序为首次发现顺序。建立：空后缀为空 Map。保持：无效/已见不变；新来源首次有效项在后缀中最新，加入保持唯一性与顺序。终止：i 每轮减一，有界。退出时后缀为整个数组，得到 post；filter true 不丢来源，因此 OR 和全 blockers 一致。时间 O(N+K)，辅助空间 O(K)。

## 3. format-inhibition.ts

### formatBoulderInhibition(snapshot: BoulderInhibitionSnapshot): string

caller：write、check。Requires：§1 快照不变量。Ensures：inhibited 时为 `Boulder inhibited: ${blockers.join(", ")}`；否则为 `Boulder inhibition clear`。不写“started”或“eligible”。副作用无；trivial：单分支字符串投影。

## 4. write-inhibition.ts

### writeBoulderInhibition(port: BoulderInhibitionPort, effects: BoulderInhibitionEffects, signal: BoulderInhibitSignal): BoulderInhibitionSnapshot

caller：OMP 服务 set handler、内部 writer tests；不是外部插件公共入口。Requires：有效 signal（服务 parse 的 post 提供）；§1 同目标 session 的端口与 effects 合同。effects 只取消等待或展示，不重入修改抑制日志。

调用顺序：复制 signal→appendEntry(共享常量, copiedSignal)→getBranch→readBoulderInhibition→若 snapshot.inhibited 调用 cancelWait→reportInfo(`Boulder signal ${type}=${value}; ${formatBoulderInhibition(snapshot)}`)→返回 snapshot。

Ensures：每次调用恰追加一条，包括重复值；只覆盖同 type 的有效值；返回写后当前 branch 快照；存在任何 true 就 cancel 一次，包括写 false 但其他来源为 true；report 恰一次。没有抑制则不 cancel，也不启动续跑。

失败：任一 callee 抛错立即向调用方传播；后续步骤不执行；不补写、不重试、不撤销已写 entry。report/cancel 失败时信号可能已写入；不声称整体回滚。

论证：append/read-your-write 与 read 的 post 推出写后值及兄弟独立性；cancel 条件来自整个快照，不是只看本次 signal；格式器与返回值用同一快照，诊断一致。副作用仅 append、条件 cancel、report，顺序穷尽。

## 5. check-inhibition.ts

### checkBoulderInhibition(reader: BoulderBranchReader, reportInfo: (text: string) => void): BoulderInhibitionSnapshot

caller：OMP scheduler 在安排/发送前；tests。不是服务 get（get 不应为 loop 比较值产生 info）。Requires：§1 本 session reader 合同，report 同步。

流程：getBranch→readBoulderInhibition→formatBoulderInhibition→reportInfo 一次→返回同一 snapshot。

Ensures：每次重新读 branch，不缓存；报告所有阻止 type 或 clear；不写 entry、不 cancel、不安排/发送消息。失败直通，report 之前 read 失败则没有报告。

论证：reader 限定 branch，read 保证最新集合，format 与返回值同源；重复调用可观察新日志。副作用只有 report，其他 callees 为只读/纯函数。

## 6. command.ts

```ts
export type BoulderSetCommand =
  | { kind: "unhandled" }
  | { kind: "invalid"; message: string }
  | { kind: "set"; signal: BoulderInhibitSignal };  // 形状不变
export type BoulderSetResult =
  | Exclude<BoulderSetCommand, { kind: "set" }>
  | { kind: "set"; signal: BoulderInhibitSignal; snapshot: BoulderInhibitionSnapshot }
  | { kind: "failed"; signal: BoulderInhibitSignal; failure: BoulderInhibitionFailure };
```

### parseBoulderSetCommand(args: string): BoulderSetCommand

输入是 /task 后的参数，不含 /task 本身。空输入或首 token 非 boulder（忽略大小写）返回 unhandled。boulder 命中但不是恰好四个 tokens、第二 token 不是 set、第四 token 不是 true/false/t/f 时返回 invalid，message 固定 `Usage: /task boulder set <type> <true|false|t|f>`。按任意空白分词；type 保留原样；第四 token 忽略大小写；不做引号解码。成功返回 set signal，true/t→true，false/f→false。

caller：execute、tests。Requires：字符串。Ensures：所有输入恰一个分支；无副作用。论证：token 数与保留位置确定无歧义语法；真假集合互斥，类型 token 非空无空白，满足服务 set 的 signal pre。分词终止于有限字符串。

### executeBoulderSetCommand(args: string, client: BoulderInhibitionClient): BoulderSetResult

client 类型与 get/set 合同见 service-contracts.md（返回 BoulderClientResult）。Requires：client 已绑定调用方目标 session，不向 command 暴露私有 port/effects。

流程：parse→unhandled/invalid 直接返回→set 调 client.set(command.signal)→`ok:true` 返回 kind:set 与 snapshot；`ok:false` 返回 kind:failed 与原 failure。

Ensures：unhandled/invalid 零 client 调用；set 发一次设置、不调用 get；**任何路径不抛出**（client 不抛 + 无其他可抛 callee）；不注册命令、不修改 task 状态、不发送模型消息；失败不伪装成功，也不声称回滚。

论证：parse 的有效 signal post 使服务解码成功；client.set 的新合同保证返回二态Result，分支穷尽 success/failure 映射到 kind:set/kind:failed，无异常路径可逸出。其他分支不跨服务边界；直接副作用仅一次 client.set，间接副作用完全由目标 session 服务承担。

## 7. loop-inhibition.ts

定义以下输入类型，结构可容纳真实 loop 状态；库不导入或读取 catalog：

```ts
export interface LoopInhibitionProgress { status: "active" | "completed" | "expired" }
export interface LoopInhibitionRegistration {
  id: string;
  reference: { scope: "workspace" | "global"; definitionId: string };
  registeredAt: number;
  progress: LoopInhibitionProgress;
}
export interface LoopInhibitionState {
  tasks: readonly {
    definition: { inhibitBoulder?: boolean };
    progress: LoopInhibitionProgress;
  }[];
  registrations: readonly LoopInhibitionRegistration[];
}
export type LoopRegistrationResolution =
  | { kind: "resolved"; inhibitBoulder: boolean }
  | { kind: "missing" }
  | { kind: "unavailable" };
export type LoopRegistrationResolver =
  (registration: LoopInhibitionRegistration) => LoopRegistrationResolution;
export type LoopInhibitionSyncResult =
  | { ok: true; written: boolean; snapshot: BoulderInhibitionSnapshot }
  | { ok: false; failure: BoulderInhibitionFailure };
```

（Result 化后的统一形状；成功分支 `ok:true` 恒带 written/snapshot，失败分支 `ok:false` 恒带 failure。BoulderInhibitionFailure 引 service-contracts.md §2。）

resolved 必须表示该 session registration 仍 indexed 且 definition 可读；其 inhibitBoulder 等于定义标记（缺省 false）。missing 表示已确认无 definition/index；unavailable 表示不能判定，不等于 false。resolver 持有当前 session 身份，这是未来 adapter 的责任。状态数组有限且调用期间不变，progress 由 loop 原状态转换负责；当前函数只读 status。

### hasSpecialLoopSchedules(state: LoopInhibitionState, resolveRegistration: LoopRegistrationResolver): boolean

caller：sync、tests。先遍历 session tasks：active 且 inhibitBoulder===true 返回 true。否则遍历 registrations：非 active 跳过；active 调 resolver：resolved(true) 返回 true，resolved(false)/missing 继续，unavailable 抛 `Error("Cannot resolve active loop registration: " + id)`。全部结束返回 false。resolver 自身异常直通。

Ensures：正常 true 有一个已证明 active+special+有效对象；正常 false 表示全部参与对象均已证明不满足；没有 registration 时不调用 resolver。遇到前面已证明的 true 可短路，不检查之后 unavailable 对象。若先遇到 unavailable 则抛错，不继续寻找后面的 true。只查询，没有持久化副作用。

论证：存在量词可由任一 session task 或 resolved registration 作见证；各循环通过 continue 仅排除已判定对象，未确定不能归入 false；有限数组确保终止。正常结束已遍历全部候选，所以得到不存在。复杂度 O(T+R)，resolver 外部成本另计。

### syncLoopBoulderInhibition(state: LoopInhibitionState, resolveRegistration: LoopRegistrationResolver, client: BoulderInhibitionClient): LoopInhibitionSyncResult

Requires：client 绑定 state/resolver 所属同一 session；get/set 按 service-contracts.md 返回 BoulderClientResult。本函数不接收 OMP 内部 port/effects。

流程：hasSpecialLoopSchedules→异常/unavailable→返回 `{ok:false, failure:{message:原 message 或 "Cannot resolve active loop registration: <id>", cause?}}`，零 client 调用；正常聚合→client.get()→`ok:false`→原样返回该 failure（不尝试 set）；`ok:true`→找最新 type===loop 信号，同值返回 `{ok:true, written:false, snapshot}`；不同/缺席→client.set({type:"loop",value})→set 结果原样映射为 `{ok:true, written:true, snapshot}` 或 `{ok:false, failure}`。首次 false 也写。

Ensures：**任何路径不抛出**（聚合异常、get/set 失败均转结果）；`ok:true` 后 loop 有效最新值等于聚合、兄弟不变；同值仅一次 get；聚合失败零 client 调用；get 失败不 set；无虚假回滚；state 不变、无缓存，人工值下次 sync 重算。

论证：hasSpecial 的异常/正常 post 分别桥接到 failure/聚合值；client 新合同给二态 Result，三分支（失败透传/同值静默/写后映射）穷尽且无异常可逸出。恢复/切 branch 不保存旧结果，每请求由服务重新解析 binding。

## 8. 独立测试义务与运行配置

- 基础：空 branch、单 true/false、跨来源 OR、同来源最新 false、再次 true、大小写和特殊 Map 键、输入不变与返回对象隔离。
- 边界：其他 entry/type、null/array/坏 type/坏 value/额外字段、最新 malformed 回退有效旧项、输入顺序胜过 timestamp、两个 branch 互不污染。
- 写入/检查：调用顺序、重复写、false 仍被其他来源阻止、每次 check 正好一次 info、无模型调用；每个注入端口异常的可见效果和后续步骤未调用。
- 命令：unhandled/invalid 零 client 请求、合法值/简写/大小写、type 保真、错误数量/未知值、不注册入口；client.set 失败不返回成功。
- 服务：按 service-contracts.md 测 get/set、目标 session 身份、未注册/已卸载/未知 session、非法请求、原异常 reply 与无缓存；内部 read/write/check 的不变合同继续跑原测试。
- loop：active 特殊与普通、completed/expired、共享 resolved/missing/unavailable、resolver 抛错、短路、首次 false、同值只有 get、人工 false 被下次 sync 恢复、多个任务删一个仍 true、归零关闭、重复同步/branch 切换无缓存；聚合失败不请求服务，get/set 的所有异常不吞掉。
- 性质：用独立的正序“最后有效写覆盖”参考模型与倒序 read 对照；有限穷举或固定 seed 随机序列均可，无需新依赖。
- 性能：提供 1k/10k/100k branch 的独立基准，包含模拟父链 getBranch 的分配/反转，输出 Node/平台、N/K、重复次数和时间；不设跨机器毫秒 pass 阈值，不把模拟耗时称真实 SDK/TUI 耗时。
- 使用 `.ts` 相对 import，`node --experimental-strip-types --test test/boulder-inhibition/*.test.ts`，从 OMP-v2 根运行。基准单独运行，不纳入自动主线程 hook。测试文件每个 ≤200 非空非注释 LOC，可按职责拆分。

测试结果按范围/版本记录，不用实现或旧报告反向规定新规范。当前入口已存在，真正运行加载/验收仍待用户；本轮只执行已授权增量 CCA，不追加审查。诊断 describeThrown 对 Error.message 也在自身 try 内执行 String 转换，必须返回 primitive string；包含自身转换失败 fallback，console 报告由 reportBoulderDiagnostic 捕获其失败。CCA4 当前裁定/修复、通畅测试及覆盖/SDK/恢复策略限制见 [cca4-findings.md](../task-system/cca4-findings.md)，不以流程结束认证全部既有内部函数零抛出。
