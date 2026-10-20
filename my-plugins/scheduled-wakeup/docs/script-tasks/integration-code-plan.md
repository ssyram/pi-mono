# Loop 多脚本接线计划（已按后续批准实施）

当前：输入/保存/执行/custom结果及aboveEditor进度widget已接入；正式用户会话未擅自reload。下面行数保留为实施前预算，不是实际diff。功能/普通错误、widget全屏点击/普通模式键盘入口及关闭清理的运行依据见test-report.md。

## 只接三处

1. **输入与保存**：命令支持重复`--script <JSON>`和唤醒策略；工具接结构化ScriptTask。用已有prepareScriptTask校验/解析路径，将结果完整保存、深拷贝、恢复，不重复保存prompt。
2. **到期执行**：旧调度器把目标交给会话内执行桥，调用已有executeScriptTask；同任务不重入，不长时间持有状态锁。普通脚本失败仍继续；结束后清理运行标记，关闭会话清理自有子进程，异步错误不外逸。
3. **展示与唤醒**：只发送一条Pi custom message，正文用run.content，执行框用renderTaskRun；triggerTurn=run.shouldWake。不调用sendUserMessage冒充用户。

默认值和纯提示功能不变：全脚本运行、默认Or、单脚本1800秒/null、相对/绝对/~/、argv原样。复用原周期/注册/延期/共享锁，不新建调度、存储、重试、依赖图、输出配额或后台进程。

## 输入示例

```text
/loop add --script {"path":"./check.sh"} --wake on-error --error-mode or 10m 处理失败
```

选项在时间前；JSON保护params中的空格，不引入shell解析。脚本路径在add/define时按ctx.cwd准备为绝对路径，register不重解释。工具二选一：原prompt或scriptTask，不得同时提供。

## 代码预算

以下相对插件目录，数字是原估算的新增/删除行，不是已实施diff或最小性证明。必要搬移仅为职责/200代码行限制，不作全仓整理。

| 文件 | +/− | 必要动作 |
|---|---:|---|
| src/v2/task-content.ts（新） | 70/0 | 两种内容、复制、存盘校验，避免字段丢失或双prompt |
| src/v2/script-task-options.ts（新） | 80/0 | 读取前置脚本JSON和策略，供解析/补全共用 |
| src/v2/parse-task-command.ts（新） | 120/0 | 承接创建解析，其中约80行搬移 |
| src/v2/scheduled-wakeup-schema.ts（新） | 110/0 | 工具输入schema，其中约80行搬移 |
| src/task-dispatcher.ts（新） | 100/0 | 异步批次、会话归属、唯一结果投递 |
| src/task-run-renderer.ts（新） | 30/0 | 官方Box/Text接既有渲染文字 |
| src/v2/model.ts | 8/5 | 输入、定义、执行目标携带任务内容 |
| src/v2/loop-core.ts | 8/4 | 创建时保留和复制内容 |
| src/v2/session-state-codec.ts | 12/5 | session/shared恢复保留脚本 |
| src/v2/parse-v2-command.ts | 10/80 | 委托创建解析，补帮助 |
| src/loop-command-handler.ts | 8/6 | 传入新内容，不复制执行逻辑 |
| src/v2/register-v2-tool.ts | 15/80 | 用ctx.cwd准备输入，接schema |
| src/v2/ai-session-actions.ts | 8/8 | 接受两种内容，权限不变 |
| src/v2/session-task-executor.ts | 3/1 | 转交完整目标 |
| src/v2/registration-executor.ts | 3/1 | 同上，共享注册不丢脚本 |
| src/v2/create-loop-runtime.ts | 12/5 | 旧定时器接执行桥及收尾重排 |
| src/run-prompt-now.ts | 10/14 | 手动run复用执行桥 |
| src/extension.ts | 8/20 | 注册renderer、传cwd、关闭清理；只搬必要补全注册块 |
| src/v2/loop-command-autocomplete.ts | 24/4 | 承接注册块，JSON内不乱补全 |
| src/v2/loop-completion-candidates.ts | 18/6 | 新选项候选，正文不解释为选项 |
| src/v2/format-list.ts | 6/4 | 显示脚本数/策略，不塞运行日志 |
| src/script-tasks/run-script.ts | 24/2 | 可选AbortSignal，关闭时清理自有进程组 |

不再以“净增约440行”宣称最小；实际必须改哪些行由上面的数据通路约束。其余已有准备、运行、超时、聚合、正文和渲染算法直接复用。

## 必要测试

新增：task-content.test.ts约100行（复制/恢复）；script-task-command.test.ts约120行（输入/补全）；task-dispatcher.test.ts约130行（全执行、单消息、策略、重入、关闭）；script-abort.test.ts约80行（真实子进程清理）。删除原计划独立60行renderer测试，注册/组件接线断言并入已有入口测试；已有正文/折叠测试不重复。

现有文件仅适配新接口并保留原断言：register-v2-tool.test.ts约+25；outer-boundary-fixture.ts约+12；extension.test.ts约+25/−178，extension-fixture.ts约+190（约170行搬移）；extension-resume.test.ts约+8/−4；loop-boulder-integration-fixture.ts约+12；loop-boulder-lifecycle.test.ts约+4/−2；outer-boundary.test.ts约+4/−2；defer-command.test.ts约+4。

继续跑全插件现有测试、两套tsc、改动文件lint和根check；不调用真实provider、不擅自reload、不追加审查。文档只更新README约+15/−3、v2架构/详细设计各约+10/−3、基础设施三份说明各2–6行；test-report仅记录实际结果。

## 后续明确批准的口径

用户随后确认发起时计次、stop只取消后续调度，关闭会话清理当前进程；NoWake结果允许进入以后AI上下文。新增widget的N是运行中脚本批次项数，I成功/K已结束（含失败超时，不含当前）/M总数；current命令单行截断。全屏点击和/loop running共用实时详情，零运行隐藏；不新增状态库或轮询器。

NoWake不触发新回合；官方Pi忙碌时可能延后展示，custom message仍进入后续上下文，不承诺真正API system role。保留这项外部边界，不为绕过它修改Pi。SQLite已撤销的长暂停锁问题不重开。接线已按后续授权实施；没有因此重开锁改造或追加审查。
