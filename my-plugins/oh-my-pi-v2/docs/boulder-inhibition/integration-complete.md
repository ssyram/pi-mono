# 接入代码与操作说明 — 不等于已验收

接线和补全源码已存在；本轮直接测试/增量CCA在进行，当前Pi加载版本未知，未自动reload、未提交。合同入口见 [design.md](design.md)，边界见 [integration-contracts.md](integration-contracts.md)。

## 逐文件

| OMP路径 | 函数/职责 |
|---|---|
| boulder-inhibition/report-error.ts、describe-error.ts | reportBoulderDiagnostic与describeThrown：诊断/描述失败不再抛。 |
| boulder-inhibition/service-client.ts、service.ts、loop-inhibition.ts | get/set、handler、sync的成功/失败Result；内部write/check可抛但由实际外围捕获。 |
| hooks/boulder-inhibition-adapter.ts | registerBoulderInhibitionAdapter：当前context binding、ready通知、shutdown失效、disposer。 |
| hooks/boulder-info-entry.ts | append内部信息；运行renderer捕获显示错误，不注入模型消息。 |
| hooks/boulder-scheduler.ts、boulder-countdown.ts | 安排/发送门、cancel句柄；finish/refresh/错误报告定时回调捕获。 |
| commands/task.ts | 命令handler自己捕获所有运行分支；boulder set/result/help。 |
| tools/task-system/human-completion*.ts | input/slot/choices/provider：boulder/set/type/bool，委托await捕获，失败保留编辑输入。 |

| scheduled-wakeup路径 | 函数/职责 |
|---|---|
| src/v2/model.ts、session-state-codec.ts、loop-core.ts | 标记定义与恢复；registrationInhibition三态有效性。 |
| src/v2/parse-v2-command.ts、ai-session-actions.ts、register-v2-tool.ts | CLI/工具布尔标记；prompt边界；运行失败输出结果而非外抛。 |
| src/v2/boulder-sync.ts | createBoulderSync/sync：当前snapshot与注册→aggregate→client；安全诊断，不改schedule。 |
| src/v2/create-loop-runtime.ts、src/extension.ts | runtime构造及每session初始化、ready/tree/命令/工具/关闭钩子。 |
| src/v2/due-poller.ts | fire/afterRun：推进一次性任务后同步，重排/报告失败不进定时器外。 |
| src/v2/loop-command-autocomplete.ts、loop-completion-candidates.ts | provider/addFlags/defineFlags/scheduleFlags；合法位置、去重、不提示available。 |

## 用户验收时的最短操作

这些命令分开输入，不用`&&`串两条slash命令；本轮不替用户执行reload。

```text
/reload
/task boulder set user true
/loop add --no-boulder 10m 检查进度
/loop stop <返回的任务ID>
/task boulder set user false
```

创建标记schedule后的loop来源为true；停止最后一个则false；user=true仍独立阻止。来源显示次序为branch最新记录顺序，不固定loop,user顺序。clear只表示信号门通过，不保证其他Boulder条件允许启动。手动loop=false只持续到下一次loop同步。

补全：/task→boulder→set→loop/user提示→true/false/t/f（其他type可手输）；/loop add/define选项位提示--no-boulder，已有标记/正文/available不提示。具体运行依据更新在delivery.md，不引用旧版本统计伪称当前已验收。
