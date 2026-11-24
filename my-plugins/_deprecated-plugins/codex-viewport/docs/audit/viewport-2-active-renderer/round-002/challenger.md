# Round 002 Challenger

复查round-001修复，只找新问题。

- entry原生首帧可能已包含pending assistant初始行；设计把它保留为previous active像素且ledger仍pending，不会误commit，未构成反例。
- expanded变化只能在component状态改变后检测；检测位于patched render第一步且该帧取消prepared/零managed write，可以安全转native。
- private helper虽可structural调用，但shape不证明语义；已由AR-1和version review约束，不是可在下游消除的问题。
- opaque可能阻塞整run；已明确warning/metric和保守降级，没有隐瞒为完整提交。
- normal write与hard death保证已分开。

没有发现新的非决策设计缺口。仍有PD-1/2/3用户决策。
