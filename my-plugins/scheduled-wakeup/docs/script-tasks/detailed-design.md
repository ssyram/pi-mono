# 叶子 D — 函数级设计

本文件是本次新基础设施的规范来源；Hoare 不得从实现倒填 stronger spec。

## 1. 范围 / 2. 复用 / 3. 错误策略 / 4. 数据结构

范围仅下列函数及其内部回调。数据结构引用 architecture 数据结构节，不另建持久化 schema。复用 Node path/os、child_process、进程信号和 setTimeout；不依赖 Pi import、tsx、新 npm 包。路径和正文为纯函数；prepare 返回 discriminated result；runScript 将普通 OS 执行失败转为 ScriptResult。内部依赖以 pre 保证，不重复校验。

输入必须从 prepare 建立 pre；手工构造不合法 ScriptSpec 是调用者违反契约，不对 OOM、被猴补丁的 Node APIs 或任意 JS getter 抛错承诺容错。prepare 接受普通 JSON 数据树，未知字段不消费；无持久化 round-trip，因此不声称保留未知字段。

## 准备与路径

### D.path / resolveUserPath(path:string,cwd:string,home:string=homedir()):string

implemented-by `my-plugins/file-path/resolve-user-path.ts`。

Pre：path/cwd/home 为字符串；cwd/home 为绝对路径。Post：~ 用 home，~/suffix 用 home 下 suffix，其余 resolve(cwd,path)；不做 $VAR/~user/glob 展开。副作用无。callers prepareScriptTask；未来 save-msg 接线未发生。callee Node resolve 对字符串返回规范绝对路径；homedir 返回主目录。

分支：path==='~'；startsWith('~/')；其他。~/ 后多余 / 不能使后缀变成绝对路径逃离 home；但显式 '..' 保留通常路径解析语义。退出仅字符串，字符串 pre 下无普通抛错。推理：分支互斥且完备，先展开再 resolve，故 post；无需循环。

### D.prepare / prepareScriptTask(input:unknown,baseCwd:string,home?:string):PreparationResult

implemented-by `src/script-tasks/prepare-task.ts`。caller当前命令/工具adapter及直接测试。callees resolveUserPath、prepareScript（同文件内部）、Array.isArray；类型来源 `task-spec.ts`。

Pre：input 是普通 JSON 数据；baseCwd/home 绝对且有效宿主路径字符串。Post：失败返回明确 error、无进程副作用；成功 task 满足 architecture P1/P2，输入数组及 params 已复制。不会改变 input。

流程：检查 root非null非array对象 → scripts 为数组 → wakeUp 对象/kind → never 或 always/on-error 的 string prompt → on-error aggregation 默认or且只接受and/or → 检查空scripts可执行性 → for-of逐项 prepareScript → 第一个输入错误返回，不执行任何脚本 → 累积全部准备规格 → 成功返回。

prepareScript(script:unknown,baseCwd:string,home:string):ScriptPreparationResult：检查非null对象；path非空字符串；cwd默认'.'且非空字符串；params默认[]且所有成员为string；timeout默认1800，接受null或有限正number，timeout*1000为有限且≤MAX_SAFE_INTEGER。失败返回error；成功解析cwd然后path并复制params。

分支/退出：所有结构错误返回ok=false；never无需prompt；always/on-error需string（允许空）；on-error非法aggregate失败；仅always允许零脚本。每项默认仅在undefined时使用，null不误当默认。路径失败若由合法字符串和absolute base pre导致则属于外部前提失效，不额外吞掉。

循环义务：i=已成功准备项数，prepared===输入前缀对应快照；初始化空，追加建立i+1且保留前缀；遇错误出口返回失败，无执行；variant n-i，有限数组保证终止。callee pre由结构检查建立。函数结果建立runScript与批次pre。源码所有内部函数和回调同样须列入Hoare清单。

## 单脚本执行

### D.process / runScript(script:ScriptSpec,options:RunnerOptions={}):Promise<ScriptResult>

implemented-by `src/script-tasks/run-script.ts`（无 logDir 时管道内存模式，保留供直接单测）；落盘模式由 `run-script-logged.ts` 实现；callees Node spawn、armScriptTimeout、killScriptGroup、readTail；caller executeScriptTask（wrapper 传入 logDir）。

Pre：prepare建立规格，执行期间不可修改；Node正常工作；宿主事件循环能推进。POSIX支持进程组；子孙未自行setsid脱组。Post：正常code=0为success；非零/信号为failed；spawn失败为start-failed；timeout一旦置位终态必timeout。stdout/stderr口径：管道模式为已接收流的UTF-8全文；落盘模式为 `output/NN-stdout.log`/`NN-stderr.log` 文件（全量持久），result 携带末尾 OUTPUT_TAIL_BYTES=8192 字节 tail 与 stdoutLog/stderrLog 绝对路径。普通失败不reject。资源副作用仅本次子进程、日志文件、pipes和timer。

步骤：Windows早退start-failed且无spawn；POSIX直接spawn(path,[...params],{cwd,shell:false,detached:true,stdio:['ignore','pipe','pipe']})；同步throw转start-failed；设置stdout/stderr UTF-8解码并累积；error事件以start-failed结束；close事件取得code/signal，超时路径复用已记录的terminationError，普通结束则同步清理剩余group，再构造结果；唯一finish guard防止多事件双重结算。

spawn事件启动本项timer；null不建timer。timeout回调先置timedOut=true，再kill本次group；若pid缺失则终止函数no-op，spawn错误路径仍返回失败。close/error结算取消timer、销毁pipes。group cleanup错误存error，并令非timeout结果failed，不伪装success；若OS拒绝终止，不能保证仍活进程消失，必须可见。没有自动重试或长期全局PID表。loop-2 起 abort 仅供 wrapper 内部取消（SIGTERM 取消路径）；会话关闭不再向脚本传递 abort，也不抑制结果——run 在磁盘上独立完成，由 ownerSessionId 严格相等的会话投递（fork 断联；绝无领养）。

闭包不变量：settled只从false到true；timedOut只从false到true；stdout/stderr仅追加；拥有child/timer不泄漏到别次调用；终止结果由timeout回调记录并由close出口消费；成功不能有error或signal。Rely：Node的spawn/error/close事件与stdio关闭契约；Guarantee：自己的监听器不投递消息，不改变任何session。没有跨会话共享锁。

### armScriptTimeout(seconds:number|null,onTimeout:()=>void):()=>void

implemented-by `src/script-tasks/script-timeout.ts`。Pre：null或合法正timeout；callback不抛普通异常。Post：null无timer；finite分片≤2147483647ms，所有片用尽后回调一次；返回取消器，使当前timer清除且不再触发回调。副作用每次至多一个timer。

分支：null→no-op取消器；finite→schedule下一片；回调扣去该片，剩余>0重排，否则调用onTimeout；cancel标记cancelled并clear。variant remaining严格减去positive slice；finite循环次数有限，但依赖计时器执行。Host延迟不保证硬实时。large seconds不得因Node的32bit timer溢出而立即超时。

### killScriptGroup(pid:number|undefined):string|null

implemented-by `src/script-tasks/kill-script-group.ts`。Pre：pid是本次spawn分配的进程组ID或undefined；不得传入任意外部PID。Post：undefined→null；process.kill(-pid,'SIGKILL')成功→null；ESRCH→null（组已不存在）；其他错误→错误文字。不抛普通OS错误。副作用只对拥有group发信号；它证明信号调用成功，不证明OS瞬间完成所有后代回收。正常close清理不能误把自身group当作childgroup（detached建立group ownership）。

## 批次执行与聚合

### shouldWakeUp(setting:WakeUpSetting,results:readonly ScriptResult[]):boolean

implemented-by `src/script-tasks/wake-up-policy.ts`。Pre：setting合法，results每项合法。Post：never=false，always=true；on-error空列表=false；or=some(status!='success')；and=every(status!='success')。无副作用。回调只是纯谓词，有限数组保证终止。真假表测试覆盖所有长度≤8的布尔组合；没有计数反转。

### executeScriptTask(task:ScriptTask,wakeUpId:string,runner:ScriptRunner=runScript):Promise<TaskRun>

implemented-by `src/script-tasks/execute-task.ts`。Pre：task来自prepare；ID是调用者指定的当前执行标识；runner接收规格，返回对应合法结果，普通执行失败不reject且每次有限/无限遵循规格。callers当前测试，未来adapter；callees runner、shouldWakeUp、buildWakeUpContent。

流程：空results→for-of await每项runner→无论status均push→全部结束后filter成功计数→计算shouldWake→构建一次content→返回。不会根据错误策略跳过脚本。注入runner若违反pre而throw，不把编程错误伪装成普通脚本失败。

循环展开：n=3时，[r0]→[r0,r1]→[r0,r1,r2]，每步保持顺序和先前结果；general invariant结果为已经运行的输入前缀，尚未运行项未调用；maintenance一次await+push建立下一前缀，variant n-i。总终止性条件是所有runner终止；None可无限等待。TaskRun不调用模型或写磁盘，除runner的本地执行副作用外无其它副作用。

## 正文与展示

### buildWakeUpContent(task:ScriptTask,results:readonly ScriptResult[],shouldWake:boolean):string

implemented-by `src/script-tasks/wake-up-content.ts`。Pre：规格及结果合法，results同序对应task，shouldWake为调用方用shouldWakeUp(task.wakeUp,results)算得的同一值；Post：Boulder来源外层 `<SYSTEM:loop-wakeup>`，明确自动生成非用户；`<prompts>`块存在当且仅当shouldWake且kind≠never（never、on-error未触发等no-wake投递不携带prompts）；每项script块固定含script头（path、exit-code，null为unavailable）、status、cwd与（非success时）FAILED行，仅当有值时含params（length>0）、signal（非null）、error（非null）、stdout（非空）、stderr（非空）——空栏目不打印，原始值仍完整保存在results。

用户指定标签是展示分隔协议，不是合法XML；不新增XML parser。动态path、prompt、输出和元数据文本转义&<>及属性引号，防止正文中的闭合标记改变分块；results 携带 8192 字节 tail（stdoutLog/stderrLog 指向全量日志），转义不额外截断。内部escapeMarkup(text:string):string是确定替换，无副作用、不生成模型请求。循环每个结果恰生成一块，有限n保证终止，失败与正常分支均有closing tag。共同正文在TaskRun唯一生成。

### renderTaskRun(run:TaskRun,expanded:boolean):string

implemented-by `src/script-tasks/render-task-run.ts`。Pre：run满足TaskRun不变量。Post：短串含wakeUpId及成功s/n、已/未唤醒（表示策略判定，不声称已实际投递）；展开串=短串+'\n'+run.content。无Pi renderer注册，字符串只供未来renderer使用；生产实际状态可在接线时区分“将唤醒/已投递”，基础设施文案使用“触发/不触发”避免虚假投递。trivial分支组合，无循环。

## 6. 完整性 / Hoare工作集

所有上述export、prepareScript、escapeMarkup及数组/事件/timer回调均为工作集。验证按函数/回调CFG写NSP，分别覆盖分支、退出、循环k=3、资源/异常/跨边界/角色与未接线不变量；非平凡函数不得仅写概括。callee pre由上面的类型与prepare链建立，不重复防御。

已在本设计显式给出全部状态变化、成功/失败出口、callee合同、循环variant和外部假设。实施后的独立推导必须对照这些合同，而非加强成沙箱、输出限额、调度器恢复或自动重试。若真正违反合同，先纠正拥有该义务的设计/实现，再直接运行相关回归；不开展无限复审。
