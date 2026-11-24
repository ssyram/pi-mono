# codex-viewport Known State

状态：Round 006已完成local code-contract tribunal并修复确认缺陷；跨terminal/IME、direct stdout、partial write与hard death仍阻止production-wide证明。

## 当前模型

### KS-1：run-scoped takeover

Agent run内插件拥有instance `doRender`；idle恢复Pi。业务components、Editor/input、provider/tool/session保持原生。

### KS-2：variable inline area

Entry用DSR求physical origin。Area是`[top,bottom)`：top位于最早unfinished content，bottom位于Pi当前native内容末端。不是全屏，也不预先锚定terminal bottom。

### KS-3：actual-demand growth

内容增长先使用bottom以下空行；抵达terminal bottom后裁掉pending view顶部。没有新内容占据某行时，stable rows不得被清除、位移或由插件滚入history。

### KS-4：finality与visibility分离

Finalized block在当前managed frame保持完整可见。只有source-order连续前缀能commit；commit把已可见frame原子采纳为Pi baseline，不调用第二次native/component render，随后必要时从第一个pending block重新进入managed。Finalized suffix位于pending之后时保持顺序，但相同bytes不重复写入。

### KS-5：resize epochs

Terminal height、footer和widget高度变化留在managed mode。Width变化触发一次mandatory Pi native `2J/3J` reflow，随后DSR recapture并进入新managed epoch。Gate期间若有dirty update，返回native时执行catch-up render；通常incremental，但Pi自身height/clear-on-shrink等full-render条件仍然优先。

### KS-6：native boundaries

Visible overlay、Kitty image、Ctrl+O、foreign owner、ABI mismatch、committed mutation和write failure走native。Persistent hidden overlay不触发。

### KS-7：hard death

只恢复Pi在`message_end`已写入JSONL的entries；in-flight assistant/tool和旧terminal partial bytes不恢复。

## 已验证

### 自动层

- 当前 revision：87 tests / 16 suites；56个非测试TS文件、19个`*.test.ts`文件。
- 覆盖ledger permutations、DSR input、nonzero physical origin、retained viewport与bottom slack、one-row demand growth、stable-prefix no-clear、finalized baseline adoption、无第二次native render、official Pi follow-up diff、height/width re-entry、`agent_settled`、snapshot publication cancellation/cap、widget、cursor、fallback、stop和handoff。
- TypeScript plugin config通过。
- 所有source/test文件≤200非空非注释行。

### Global Pi 0.83.0（历史证据，早于Round 005修复）

以下结果不能证明当前revision，仅保留为先前实机记录。Demand-driven run，tmux 100x30：

```text
DSR 1
sync frames 260 (timing-dependent)
2J/3J 0/0
history regions 9
warnings 0
mid-run submitted message visible true
mid-run Editor/footer visible true
final line 79 visible true
```

Width resize 100→80：

```text
DSR 2
2J/3J 1/1
managed sync frames after re-entry 255
warnings 0
submitted message and final line 79 visible true
```

同时加载`docker`的persistent hidden overlays：overlay warning 0，managed rendering正常。

## 已修正的 D 层缺陷

- 已删除按行 `ProtectedHistoryRows` spill；finalized multi-line block 经native commit整体转移，不会跨 native/managed 边界拆开。
- slack已改为Footer后缀；widget/status/candidate收缩不会在transcript前制造空洞。
- 已删除插件手工 top scroll-region history insertion；长block提交不再组合插件滚动与frame重写。

这些教训及其artifact证据、方案和回归门禁保存在 `fixes/atomic-block-native-commit.md`。

## Tribunal裁决

- terminal bottom保留pending crop；不恢复upward stable displacement。
- opaque/custom component缺少正向lifecycle证据时保持pending。
- genuine transition failure在本run保持native；下一run重新尝试managed，不做未知partial-prefix盲重试。
- snapshot durability以private exclusive files、file/directory sync和atomic `latest.json` rename为合同；rename后的root-sync失败属于committed-but-reported-failed外部边界。
- terminal grammar只在当前allowlist上best-effort；未完成实机matrix前不写production-wide `PROVEN`。

## 已知风险

- Apple Terminal中文IME composition/candidate未直接验证，不能承诺系统crash已修复。
- iTerm2、Kitty、WezTerm、Zellij未完成；Zellij当前fail-open。
- Direct `process.stdout.write`可破坏physical provenance，不提供强保证。
- Partial terminal write与SIGKILL不能rollback。
- Width reflow采用Pi原生`2J/3J`，会按Pi自身语义清空并重建scrollback。
