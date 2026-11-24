# 细化：TranscriptLedger

## 1. 责任

维护 run 内 transcript item 的语义顺序、finality 与 commit frontier。它不渲染、不访问 terminal、不修改 component tree。

## 2. 类型

```ts
type LedgerItemKind = "assistant" | "tool" | "user" | "static" | "opaque";
type Finality = "pending" | "finalized";
type CommitState = "live" | "prepared" | "committed";

interface LedgerItem {
  id: string;
  kind: LedgerItemKind;
  components: Component[];
  finality: Finality;
  commitState: CommitState;
  renderRevision: number;
}
```

不变量：

- `id` run 内唯一。
- component identity 最多出现于一个 item。
- item 顺序与 chat child 的语义显示顺序一致。
- `committed ⇒ finalized`。
- committed items 构成且只构成数组前缀。
- prepared items 构成 frontier 起的连续前缀，任意时刻最多一个 prepared batch。

## 3. Finality 来源

- assistant：`message_start` pending；`message_end` finalized。
- tool：注册/tool start pending；`tool_execution_end` finalized。
- user：已提交并成为 transcript component 时 finalized。
- Pi built-in static message：有明确immutable component shape/event时 finalized。
- Pi tail status：`showStatus` 可原地更新最后 `Text`；generic Text本身不足以证明来源，只有在官方Pi tail-displacement规则和render stability同时成立时才 finalized。
- extension opaque：没有completion contract时整个managed epoch持续pending；run end本身不是immutability证据，由native handoff/recovery显示最终版本。

“当前 render 与上一帧相同”本身不是 finalized 证据。opaque阻塞后续commit是明确的保守降级；runtime应记录warning/metric，不得冒充普通完整能力。

## 4. Component reconciliation

```ts
function reconcileComponents(
  ledger: TranscriptLedger,
  chatChildren: readonly Component[],
  bindings: EventBindings,
): ReconcileResult;
```

Requires：ledger invariant；`chatChildren` identity 无重复；bindings id 唯一。

步骤：

1. 建立 child identity → 已有 item 映射。
2. 按 `chatChildren` 顺序扫描。
3. 已绑定 assistant/tool child 复用 event item。
4. 新 user/static/opaque child 创建对应 item。
5. 处理 Pi 在 streaming component 前 splice custom entry 的情况：按实际 child index 插入，不按发现时间 append。
6. 已从 tree 删除且未 committed 的空 streaming item可删除；committed item被删除视为 handoff-invalidating mutation。
7. 若已有 committed component 的 render revision 改变，返回 `committedMutation`，不得继续增量 history。

Ensures：所有可见 chat child 被唯一表示；相对顺序一致；旧 committed 前缀不被重排。

## 5. Event API

```ts
beginAssistant(messageId: string): void;
finalizeAssistant(messageId: string): void;
ensureTool(toolCallId: string): void;
finalizeTool(toolCallId: string): void;
finalizeKnownRunRemainder(): void;
```

所有 finalize 幂等；状态只允许 `pending → finalized`。不存在反向转换。run barrier只能finalize有assistant/tool终止证据的known items；不得把所有opaque items批量finalize。

## 6. Prepare/commit 两阶段

```ts
prepareCommit(render: (item: LedgerItem) => string[]): PreparedCommit | undefined;
commitPrepared(prepared: PreparedCommit): void;
cancelPrepared(prepared: PreparedCommit): void;
```

`prepareCommit`：

1. 从 `frontier` 扫描到第一项 pending。
2. 无 finalized 前缀则返回 undefined。
3. render batch 的所有 components；任一 render 失败则不改 ledger。
4. 记录 `ledgerRevision`、范围、ids 与 immutable lines。
5. 把范围标为 prepared。

`commitPrepared` Requires：token revision/range/ids 仍匹配，且 terminal write 已成功返回。Ensures：范围标 committed，frontier 前进到 `endExclusive`，revision 加一。

`cancelPrepared` 只把 prepared 恢复 live；不得改变 finality/frontier。

## 7. 查询 API

```ts
liveItems(): readonly LedgerItem[];
committedItems(): readonly LedgerItem[];
hasPending(): boolean;
assertInvariant(): void;
```

`liveItems()` 等于 `items.slice(frontier)`，包括 finalized 但被前序 pending 阻塞的项。

## 8. 循环终止

所有扫描循环索引单调增加，上界为有限 `items.length` 或 `chatChildren.length`。prepare 每次成功至少令 frontier 增加一，因此单 run 成功 commit 次数不超过 item 数。

## 9. 正确性论证入口

函数级 Hoare triples 与并行 completion permutation 证明见 `../proofs/hoare-ledger.md`。
