# codex-viewport 详细设计

状态：demand-driven pending suffix、bottom slack与native commit/re-entry已实现；D 层修正的证据见 `fixes/atomic-block-native-commit.md`。

## 1. 模块

| 模块 | 责任 |
|---|---|
| `runtime-coordinator.ts` | lifecycle与epoch phase |
| `runtime-patch.ts` | `doRender`/`stop` ownership、native width redraw |
| `managed-entry.ts` | 首次DSR entry transaction |
| `begin-width-recapture.ts` / `width-reentry.ts` | width redraw后的async recapture |
| `native-entry-baseline.ts` | origin、stable boundary、variable area、native seed frame |
| `inline-viewport-area.ts` | absolute `[top,bottom)` geometry |
| `live-region-growth.ts` | downward growth；terminal-bottom后当前实现裁pending顶部，最终策略待D层裁决 |
| `managed-height-rebase.ts` | terminal-height transition |
| `component-ledger-reconciler.ts` | lifecycle item与component绑定 |
| `transcript-ledger.ts` | source-order finalized frontier |
| `stable-screen-rows.ts` | area上方attested bytes，仅用于handoff |
| `native-commit.ts` | Pi native commit boundary |
| `recover-native-renderer.ts` | native recovery terminal sanitation |
| `volatile-region.ts` | Editor-first allocation |
| `screen-frame-diff.ts` | absolute-row variable-area diff |
| `managed-renderer.ts` | single-write transaction |
| `native-handoff.ts` | visible equality与baseline prime |

## 2. 核心类型

```ts
interface InlineViewportArea {
  top: number;
  bottom: number;
  width: number;
  height: number;
  terminalHeight: number;
}
```

`height=bottom-top`。初始bottom来自native已绘制内容末端，不是terminal bottom。

```ts
type RuntimePhase =
  | "idle-native"
  | "entering-managed"
  | "active-managed"
  | "width-recapture-gate"
  | "native-commit-gate"
  | "draining-handoff"
  | "active-native-fallback"
  | "disposed";
```

## 3. Entry

```text
agent_start
→ beginRuntimePatch: zero-write gate
→ queryTerminalCursor
→ capture origin + stable boundary + native [top,bottom) frame
→ initialize ledger
→ activate ManagedRenderer
```

首个renderer frame以native frame为previous；不重写相同bytes。

## 4. Geometry

令`D`为transcript、widgets、Editor、footer的intrinsic rows，`C=area.height`。

```text
overflow=max(0,D-C)
down=min(overflow,terminalHeight-bottom)
next=[top,bottom+down)
# remaining overflow crops pending transcript within next
```

当前实现只向下扩展`bottom`；到达terminal bottom后裁pending transcript顶部，不移动stable rows。tribunal已裁决保留crop；不得重新引入“upward rows/top scroll region”或插件history insertion。

## 5. Finalized与native commit

Ledger仍只commit最大连续finalized source-order前缀。prepared prefix在同一managed frame仍按完整component渲染；terminal write成功后ledger一次性commit，patch以一次fresh native observation证明physical frame等价并prime Pi baseline，不调用保存的Pi native `doRender`。

因此：

- finalized不等于off-screen；
- block不能跨native/managed边界拆行；
- blocked finalized suffix不能越过pending；
- 普通run可在agent仍运行时通过native commit推进history；
- native commit或DSR re-entry失败时保持native，不伪造managed provenance。

## 6. Resize

Height变化重建area的terminalHeight/bottom capacity，stable provenance保守降级，但不调用native renderer。

Width变化：

```text
ManagedRenderer → width-changed
→ saved native doRender一次full reflow
→ renderer gate
→ DSR
→ earliest non-committed component作为new top
→ native frame seed
→ activate new ManagedRenderer
```

Ledger实例不重建，item identity/finality保留；旧frame、displacement和committed byte snapshots按新宽度重建。Gate期间若消费了后续更新，失败/stop返回native前执行catch-up render；通常incremental，但Pi自身full-render条件仍然优先。

## 7. Render transaction

```text
preflight
→ reconcile + prepare
→ intrinsic demand + geometry plan
→ frame diff + cursor
→ one synchronized write
→ accept ledger/frame preview
→ 若有prepared prefix：native baseline adoption → DSR re-entry
```

Write error不accept、不重发。

## 8. Handoff

成功条件为attested physical bytes、cursor-anchored origin、Footer后bottom slack、cursor column和dimensions与一次Pi native observation一致。成功时prime Pi private baseline并无重画交权；否则native recovery。

## 9. Side effects

允许：run-scoped method patch、DSR、managed terminal write、一次width native reflow、handoff baseline prime。

禁止：message/tool/provider/session mutation、Editor/input/keybinding patch、cross-session renderer state、ordinary diff CRLF scroll。

## 10. 已实施的 native commit boundary

`ProtectedHistoryRows`与`history-insertion.ts`已删除。`StableScreenRows`只保存handoff attestation bytes，不管理history。prepared finalized prefix在同一managed frame保持完整可见，write成功后一次性commit ledger，并以当前已可见frame prime Pi baseline；不触发第二次component render。patch gate随后DSR，以第一个unfinished component重建managed suffix。slack只在Footer后。完整失败分支和回归矩阵见 `fixes/atomic-block-native-commit.md`。
