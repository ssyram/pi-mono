# Round 002 Prover

正向复合重跑：

1. Native entry proof建立首个ManagedRenderInv。
2. Ledger proof保持source-order finalized prefix。
3. Layout lemma保证trailing优先且frame bounded。
4. Render transaction proof在正常write模型下保持physical/memory一致。
5. Handoff proof只在byte-visible等价后交权。
6. Lifecycle把Ctrl+O/width change/pre-write/write failure分流到互斥状态。

目标映射、接口分册、Hoare assumptions、verification expectations互相一致。代码尚未实现，因此此证明只证明设计可实现性，不证明运行结果。
