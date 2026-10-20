# CCA 关键问题测试设计

依据：已完成CCA与四路独立裁定，原始设计在本run audit-tools/post-cca/critical-test-design.md、regression-test-design.md。这里合并优先级，不开展新审查。原稿只设计；后续已实施C1/C3对应回归；C6曾实施SQLite方案，现按用户裁决撤销并接受原锁边界。G1–G8仍是增补设计，不以旧122项通过冒充它们全部已经实施。

## 当前范围与直接回归

用户新裁决：同一session transcript的多个执行者属于UB。历史C4/C5对应这个前提违例，不再作为缺陷、必须修复项或回归验收；不新增拒绝第二owner的防护。不同transcript的SDK实例隔离、共享catalog并发写仍在范围内。

| ID | 真实场景与顺序 | 正确断言 | 当前预计 |
|---|---|---|---|
| C1 | 两个真实SDK manager在同cwd通过实际扩展入口并存；同owner替换 | A加载B后继续创建，关闭A后B仍可用；退休工具不能复活，新claim不被旧release删除 | 已实现3项直接回归；未调用模型 |
| C2 | 正常shutdown-first重载，关闭空窗后启动新一代 | 空窗零投递，退休callback不修改状态/不throw，恢复后只投一次 | 按已修合同绿，真实fixture待跑 |
| C3 | 新会话文件尚不存在，命令/工具尝试创建；随后由fixture真实对话记录使文件落盘再创建 | 先UI error且无任务/定义/index追加；落盘后创建并在重新open时保留；零provider调用 | 已实现2项直接回归 |
| C6 | 原锁持有者超过30秒不刷新后恢复写入 | 用户明确接受此竞态，不再要求消除 | SQLite方案和4项专属测试已撤销 |

C6使用不同transcript的写者，不属于同transcript UB；但用户另行明确接受该长暂停边界，不再作为必须修复或通过的断言。P1已由用户选定空会话拒绝方案；C3改测明确拒绝、不改状态，以及已落盘会话的真实恢复，不再要求custom-only成功创建。

不保留C6的专用worker、慢测试或SQLite互斥测试；原来的普通写入失败清理及释放后可重新拿锁断言继续保留，完整套件不把已放弃的强保证计作通过。

## 已修问题的真实集成补强：8组

| ID | 补强内容 | 必须保持的辨别力 |
|---|---|---|
| G1 | 真state/catalog锁竞争穿过SDK命令、工具、生命周期 | 不throw/reject，有失败反馈；释放锁后下个健康请求成功 |
| G2 | POSIX child真实RLIMIT_FSIZE=4096，合法8192字符prompt连续3次EFBIG | 自有tmp清零，别人tmp sentinel不动，原错误保留，锁释放 |
| G3 | 真SessionManager已落盘，JSONL路径改目录触发EISDIR | 不reject但不谎称回滚；active对应已改变的内存；不可读=null |
| G4 | 固定T=1800000000000，工具delay=8700000000000s | 保存前拒绝，旧branch/JSONL不变，原任务和下次正常add/list可用 |
| G5 | 真CombinedAutocompleteProvider读本地文件先ENOENT后成功 | 同一provider首次null，下一次正常；signal/位置透传 |
| G6 | 真guarded SDK ctx经runner.invalidate后异步timer fire | 整个fire/重臂/诊断不throw，停止且零再次arming/零投递 |
| G7 | 真动作已成功，随后在callback seam使重排ctx失效 | 原动作结果保留，附刷新失败，无重复append |
| G8 | 重复registration pair坏catalog，以及健康catalog错definitionId查询/删除 | 坏pair拒绝；精确授权匹配不误删其它定义 |

优先G1/G2/G3/G4/G6，其后G5/G7/G8。现有15项outer单元回归保留；以上真实SDK/FS场景不能被共享数组journal或throw mock替代。

## 不重复已有覆盖

保留36项script基础设施测试。可在既有真实批次中补一组组合断言：默认Or、默认1800/null、全部结果顺序、FAILED/exit-code、展开===content，不再重写真值表/超时套件。单次聚合或mock投递计数不是实际AI turn成功证明。

## 实施边界

真实SDK导入、同步点、子进程或信号失败都是fixture/infrastructure失败，不是产品“绿”。全部文件、锁、临时目录和inspect端口属于测试；不读写真实user session/home、不加载生产OMP/FSM、不调用provider。不用skip/xfail或断言“投递=2、B消失、文件不存在”洗绿：那些是旧缺陷复现，新回归必须断言正确结果。

当前保留：test/instance-isolation.test.ts（3项）、session-persistence.test.ts（2项）。catalog-lock相关模块/测试/worker已删除；原拟议critical-*文件未创建。完整命令和运行边界见test-report.md。不借测试设计扩大用户确认的使用范围或接入新脚本流程。
