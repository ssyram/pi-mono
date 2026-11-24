# Round 005 SCCO Report

审查对象：`my-plugins/codex-viewport/` 当前实现，56个非测试TS文件；18个测试文件作为证据。

Spec来源：`README.md`、`docs/design/{principles,architecture,detailed-design,known-state}.md`、`docs/design/fixes/atomic-block-native-commit.md`、用户当前不变量、Pi官方源码。

运行档位：完整档，第005轮。C&P、两次disprove-first、counter-challenge和独立Judge产物均在本目录。

## S — Sound：partial

已直接修复并回归：同一transaction重复render、drain/后继run/FSM闭包、三个native failure baseline fencing、snapshot epoch/stop、capture child timeout、artifact symlink/atomic publication、DSR stale filter、cursor/diff边界。

仍未证明：native handoff完整物理状态、opaque/custom finality、accepted ANSI/control grammar、早注册Pi input listener、partial terminal write后的物理等价。

## C — Complete：partial

Judge已给出56文件逐模块覆盖表。当前仍有PARTIAL/DISPROVEN函数，且六个D/Q门未裁决。完整PROVEN不成立。

## C — Concise：partial

非零`viewport-expansion`当前不可达；`StableScreenRows.previewAppend/accept/revision`无仓内调用。是否删除取决于overflow contract裁决。Prepared ledger、stable attestation和native commit均为活跃机制，不得以“清理”为由删除。

## O — Optimization：partial

`managed unfinished suffix + Pi native finalized commit + native idle`仍是最小可行owner架构，但内部proof机制尚未收敛。不能用正常session永久fallback冒充正确性。

## 有效问题与处置

| 根因 | 层级 | 处置 |
|---|---|---|
| 单transaction重复render观察 | I | 已修、已测 |
| lifecycle/drain/native exception闭包 | I/D | 非决策部分已修、已测；same-run fallback待裁决 |
| snapshot epoch/process ownership | I/D | 已修、已测 |
| artifact path/publication | I/Q | no-follow+atomic+sync已修；durability contract待确认 |
| DSR query overlap | I/D | plugin内single-flight已修；Pi listener priority仍是外部边界 |
| frame cursor/diff | I | 已修、已测 |
| overflow crop vs upward displacement | Q/D | 待用户裁决 |
| native handoff physical equivalence | D | 待用户裁决 |
| component identity/finality evidence | D | 待用户裁决 |
| ANSI/control grammar + terminal matrix | D/Q | 待用户裁决 |
| partial terminal writes | external/Q | 明确残余边界，不承诺rollback |
| proof/evidence drift | Q | factual部分已更新；决策相关文本待裁决后收敛 |

## 伪问题/降级

- 一般`originRow`完全遗漏：驳回；entry确实使用origin。仅stable attestation/handoff liveness仍有问题。
- official Pi一定重复agent start/end：未证实；合法后继run during drain已修。
- Fallback从不native recovery：驳回；只确认三个exception分支并已fence baseline。
- 当前Pi同步register callback leak：驳回；官方`addInputListener`不同步回调。
- Kitty/iTerm marker完全漏检：驳回；只保留其他控制/图像协议。
- 要求terminal byte rollback：驳回；接口无法提供，保留显式边界。
- Prepared/native commit/stable attestation全部dead：驳回。

## 需要用户裁决

1. terminal bottom后裁pending，还是向上占用stable rows。
2. 临时overlay/image/tool-expansion/height fallback清除后，是否同run自动recapture。
3. 哪些component identity/finality证据足以允许不可逆native commit。
4. 接受哪些ANSI/control序列，哪些terminal算verified。
5. native handoff是否必须证明cursor visibility、terminal modes和全部trailing physical rows；若不能证明是否禁止seamless handoff。
6. snapshot durability要求仅atomic current pointer，还是必须file+directory sync（当前实现已采用后者）。

## SCCO覆盖勾单

```text
S[partial(native handoff/finality/terminal grammar)]
C[partial(PARTIAL/DISPROVEN paths and missing PBTs)]
C[partial(dead surfaces depend on overflow decision)]
O[partial(core owner architecture retained; internal proof not converged)]
```

## 收敛判定

FAILED。78/78测试通过、TypeScript通过不等于proof。决策门、未追踪边界和缺失PBT仍阻止Round 005结束。
