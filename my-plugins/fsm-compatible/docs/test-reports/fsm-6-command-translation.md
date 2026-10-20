# fsm-6-command-translation 当前运行依据

状态：设计READY（run d850ae30，两项澄清已钉死叶子）；实现完成；实施后独立contract对照尚未运行，未结算PASS。

## 实现

src/commands/command-aliases.ts：registerCommandAliases——/new（waitForIdle→newSession，cancelled如实通知，重置undo状态）、/undo（leaf→entry.parentId；null明确拒绝；navigateTree包try/catch原始消息通知，成功记prevLeaf）、/redo（单步恢复已校验prevLeaf后清除；二次拒绝；失效目标清除并拒绝）、/usage（getContextUsage真实字段或明示无数据）、/exit（waitForIdle→shutdown）、/fsm-commands（已实现/未实现+原因+Pi原生指向+宿主消歧说明）。注册无注销API，按合同接受进程驻留。index.ts在组装成功前注册（命令使用ctx公开动作，安全）。未注册任何假命令。

## 命令与结果

npm run test:admission 22、runtime 37、protocol 15、judge 16、gates 4、children 11、watch 7、assembly 5、command-aliases 3——合计120项 + tsc 0。测试：真inMemory树上undo→parent/redo恰一次/二次拒绝/new重置/根拒绝/compaction抛错原文/usage双分支/exit/shutdown/帮助双清单；无真实模型/网络。

## 未完边界

fsm-6实施对照未运行（下一步）；真实模型E2E/SA集成烟雾须账户/预算授权；用户验收。无staging/commit。
