# 接入检查点 — 当前增量修正中

源码入口已存在，本文件不是未执行的未来方案；当前合同见 [integration-contracts.md](integration-contracts.md)。禁止以Pi吞异常或旧CCA只覆盖Standalone的结果闭合当前责任。

## OMP

- extension注册info renderer、get/set服务，boulder_enabled=false仍可人工set。
- adapter解析当前context，startup/tree绑定及ready通知，shutdown失效；不把旧context留作pi.appendEntry的可写目标。
- scheduler安排前/实际发送前查当前branch，set(true)取消已有等待，保留其他门；事件/timer/诊断错误自己捕获。
- task路由、help与completion全线；公共命令输出失败正常resolve，保留已发生状态。

## loop

- model/core/codec保存inhibitBoulder；CLI add/define/once/at及tool schema/AI解析传递有效boolean。
- snapshot及active注册的定义/index判定→bridge→client Result；unavailable不写false。
- mutation、initial恢复、ready、tree、poller afterRun同步；runtime比较cwd+manager+sessionID。
- 自动补全add/合法define选项、Boulder set/type/bool，原provider异步拒绝被await/catch消解。

## 未闭合的交付责任

1. 当前相关回归与完整检查的实际结果记录。
2. 本轮用户授权的增量CCA覆盖受影响的接入、补全及其Result调用闭包。
3. 真实Pi加载/TUI功能及用户验收；未自动reload。
4. 提交/发布仅按用户明确指令。更广的共享存储durability/cache/lease问题不因本功能catch而宣称解决。
