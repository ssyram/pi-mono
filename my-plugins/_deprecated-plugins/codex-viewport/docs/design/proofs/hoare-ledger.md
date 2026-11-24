# Hoare Proof：TranscriptLedger

## Invariant

对items `I=[i0..in)`、frontier p：

```text
all j<p: committed(ij) and finalized(ij)
all j≥p: not committed(ij)
ids/components unique
committed component order equals chat order
```

## Initialization

chat按component顺序扫描。entry baseline attested components形成连续committed prefix；其余static finalized、opaque pending。baseline不会跨first mismatch，因此Invariant成立。

## Lifecycle binding

assistant/tool event先创建pending item；reconcile按structural identity绑定实际component。user/known static component可直接finalized；unknown component pending。

Uncommitted suffix可按chat component rank稳定重排；committed prefix不移动。committed component消失立即报mutation并fallback。

## Finalize

`pending→finalized`只改finality，不改order/frontier。opaque只有可信static分类或被后续chat component从tail推开时finalize；commit后bytes snapshot每帧验证。

## Prepare

令q为从p开始第一个pending index或n。prepare batch严格是`I[p..q)`。render全部成功后才标prepared并生成包含ledger revision/range/item ids/raw lines的token；render抛错时state不变。

因此later finalized item不能越过earlier pending item。

## Commit / cancel

terminal write成功且token revision/range仍匹配才把`[p,q)`标committed并令`p=q`。这些items按定义均finalized，故Invariant保持。

pre-write failure cancel prepared，p不变。write failure不调用commit。

## Parallel completion

若i0 pending、i1 finalized，则q=p，batch为空；i0 finalize后q才可同时跨i0/i1。任意completion permutation均只影响何时推进，不影响source order。

## Mutation

committed component render bytes与snapshot不同、component消失或顺序冲突都离开正常证明域并native recovery；scrollback从不尝试原地改写。
