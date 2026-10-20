# 基础设施直接测试依据

## Loop结果卡标题点击展开（最新）

用户已在当前会话现场确认标题点击展开/收起可用，并批准提交；两张实际结果卡的成功/唤醒判定和独立人工确认记录见[test-results/card-live-0b4e98bb.json](test-results/card-live-0b4e98bb.json)。
用户指出此前只有顶部widget可点，Loop ·结果卡未接鼠标，这是独立的遗漏；本轮已补task-run-renderer.ts（52非空非注释行）。仅标题套官方MouseRegion；左键切换同一TaskRun.content，正文/边框/其它鼠标输入不切换。消息身份WeakMap保存在renderer注册闭包，不是模块级全局；同message重建保留局部展开，全局Expand参数改变时仍控制显示。legacy宿主不派发全屏鼠标事件，保留原键盘Expand。未改官方Pi、调度/唤醒策略或持久消息内容。

新增5项直接测试均通过：标题切换/正文原样/不拦正文、同message重建与padding、全局Expand、消息及实例隔离、换行标题各行可点。官方Pi1.2下5/5及strict类型通过；Pi1.3 strict通过，全插件串行171/171，16 suites、0 fail/skip/cancel。

官方Pi1.3隔离offline真实TUI的9项观察全部通过：全屏初始折叠、点击A展开、点击正文不折叠、点击A收起、B独立展开、全局Expand展开/收起、legacy初始折叠及键盘Expand。实际截图、receipt和完整套件日志见[test-results/card-click-UpqcHt](test-results/card-click-UpqcHt/)。无凭据/真实模型调用，测试tmux已正常退出。新代码需用户reload加载；本轮没有替用户reload。

npm run check在Biome检查1868文件无fix后仍被其它历史快照的pinned-deps阻断，后续root检查未运行；未修改那些快照。以下为历史批次，不能用旧顶部widget点击测试代替本轮结果卡点击依据。

## 当前会话follow-up/steering区分实测（最新）

[test-results/followup-44-MqUxOm.json](test-results/followup-44-MqUxOm.json)保存60秒真实在途工具窗口、原回复结束标记entry、8份实际custom结果及相对顺序。窗口时长60001ms；原回复ORIGINAL_TURN_END记录于10:26:46.473Z、transcript index2849。6条shouldWake=true均在其后进入会话（B,C,F,G,A,H，index2850–2855）；NoWake D/E为false，出现在标记前（2841/2842）。8项status/exitCode/successCount/shouldWake与预期一致；长批次首尾齐全，timeout为SIGKILL且后续继续，纯prompt结果列表为空且唤醒。

本轮表现符合忙时follow-up而非steering，未用提示词要求模型忽略到达消息、未改宿主或重跑。入会话时间不是脚本完成时间；H虽稍晚登记触发，实际与其它唤醒一起消费，不证明独立空闲启动。NoWake可在当前工具轮结束后、整段回复结束前进入正在运行的AI上下文；它不启动新run，不应把技术turn边界等同整段回复完成。以下为历史批次记录。

## reload后全面测试与简短英文文案（最新）

实际依据保存在[test-results/reload-0kIJBZ](test-results/reload-0kIJBZ/)，含成功、预期脚本失败、原始测试失败与后续结果，不以最终通过覆盖原记录。默认运行文案已改为短英文：Loop · N scheduled、Waiting、Running、wake/no wake；用户prompt、路径和脚本stdout/stderr不翻译。现场8例在本次英文文案重新reload前执行，英文UI另外由官方Pi1.3隔离实测，未替用户reload。

两套官方SDK初轮均166/166通过；改英文后Pi1.3为166/166，Pi1.2并行高负载时165/166：400ms超时测试的Node子进程未在被杀前输出ready，status/signal仍为timeout/SIGKILL。原断言未改；该文件单独5/5通过，--test-concurrency=1完整166/166通过。此现象按测试负载敏感保留，不把重测绿灯当原失败不存在。两版SDK严格类型检查、script-tasks专用tsc及5文件Biome均通过。

本会话L01-L08实际custom结果8/8齐全，逐项断言shouldWake、status序列、exitCode序列、successCount、非用户来源及关键输出：never成功/Or全成功/And混合均false，Or混合/And全失败/timeout后继续/start-failed后继续/always三脚本含sleep10均true。超时为SIGKILL、exitCode=null，无FORBIDDEN_END；启动失败为ENOENT，后续成功。全部登记inhibitBoulder:true，未重跑现场脚本。共5个唤醒判定、3个仅存结果，不证明5个独立模型回合；rawMessage timestamp是入会话时间，不冒充脚本完成时间。

官方Pi1.3无凭据offline隔离HOME/会话的12项UI观察全部通过：英文摘要、点击原地10总行、倒计时真实递减、缩小后折叠/拒绝展开、show off/on保持12条预约、零项隐藏、单项摘要、legacy始终一行/命令不展开/清空后当前编辑区无widget。ui-r1/r2最初停在show off：Enter确认了token补全，命令未提交；测试改为Esc关闭补全再Enter提交，不改产品代码。ui-r3最后一项断言错误地匹配plural并把regular历史区域当当前编辑区；保留失败截图，按实际singular及当前区域修正后ui-r4全通过。测试tmux均已退出，未留下子进程；这些隔离UI运行不调用真实模型。

NoWake与follow-up解释已纠正：调用虽都带deliverAs=followUp，官方Pi对triggerTurn=false仅追加custom消息（忙时延后到turn end），不排AI续轮；triggerTurn=true且忙时调用agent.followUp，但官方待发栏只列用户文本队列，故custom follow-up可能不可见。未为可视化改官方Pi。

npm run check在Biome检查1868文件无fix后，仍被无关历史SDK快照的pinned-deps阻断，后续root检查未运行。以下为之前阶段记录；旧中文截图、旧TUI弹层和旧套件数量不能替代本轮结果。没有追加CCA/独立审查或绝对无Bug/无抛证明。

## 当前widget规则：常驻预约摘要、零项隐藏、只全接管原地展开

用户追加预约等待项/执行项统一常驻摘要，并纠正0项隐藏。当前实现合并active schedules与running batch、按item ID去重；N>0显示，N=0或show off隐藏。全屏点击原地展开，整个widget≤10行（摘要+最多9项），每项一行等待倒计时或执行I/K/M及当前命令。legacy永远一行，旧overlay已移除；/loop show off|on为当前会话分支设置，默认on，写独立custom entry，不增加服务依赖，不停任务。

全插件166/166通过（16 suites，0 fail/skip/cancel，约7.53秒）；新的11项widget/状态测试取代旧4项运行弹层测试，覆盖真实源去重、零项/隐藏、十行上限、编辑区被占/小终端/未知布局、legacy不展开、缓存倒计时与隐藏后停timer、session/reload恢复、失败保存和错误不外逸。当前官方Pi1.2 SDK/TUI严格类型检查通过。

隔离官方Pi1.2实际终端记录已保存在[test-results/persistent-widget-TPMXAi](test-results/persistent-widget-TPMXAi/)，原始运行目录/tmp/loop-persistent-ui-TPMXAi：fullscreen-expanded.txt显示12条预约、摘要+9行等待；mixed-running.txt显示13条中执行行(0/0/1) /bin/sleep及等待行，每项一行。12行高终端与20行高+其它12行widget占位时点击仍只有摘要（short-collapsed.txt/occupied-collapsed.txt）；show-off.txt隐藏时批次继续，show-on-after-success.txt可见该批1/1结果和原12条预约；stop all后zero-hidden.txt没有widget；legacy-single-line.txt在/loop running后仍一行。均为无凭据offline隔离HOME/会话，未触发模型、未reload用户当前会话。

空间测量只读当前已确认的公开组件树，未知树拒绝展开而非猜位置。倒计时仅展开且有等待行时重绘缓存，不读盘/重取状态；隐藏与关闭清理。以下旧运行弹层、159项及更早记录是历史，不能当当前legacy行为。当前10文件Biome check、3个旧紧凑解析/补全文件lint、脚本专用tsc均通过；npm run check在Biome检查1868文件且无修改后，仍因不相关.local/stability-against-oc及impression-demo/sdk-snapshots的非固定依赖范围失败，后续root检查未运行。两项测试tmux已正常退出，未留下运行脚本。

## 当前会话现场定时实测：七例结果齐全

用户授权七例现场测试，全部inhibitBoulder:true。只读本会话实际custom_message/loop-task-run及任务快照，七份结果无缺失、shouldWake无不匹配，每条runCount=1；不是重跑或用创建回执代替执行结果。成功与失败均已持久留档：[test-results/live-task34.json](test-results/live-task34.json)，含原始单例及七例共8条统计、8份实际custom message原始正文/details、时间、退出码和唤醒判定，不再只依赖临时文件。

| 例 | 实际脚本结果 | 成功/总数 | 实际shouldWake |
|---|---|---|---|
| T01 never | success,0 | 1/1 | false |
| T02 Or全成功 | success,0 | 1/1 | false |
| T03 And混合 | failed,7 + success,0 | 1/2 | false |
| T04 Or混合 | failed,7 + success,0 | 1/2 | true |
| T05 And全失败 | failed,7 + failed,9 | 0/2 | true |
| T06 Or超时后继续 | timeout/null/SIGKILL + success,0，后续stdout标记存在 | 1/2 | true |
| T07 always/sleep10 | success,0，BEGIN和END均存在 | 1/1 | true |

七例的脚本执行结果及策略判定均与预期一致，成功结果也记为明确通过；不是只有失败才log。合计4条唤醒请求、3条仅存结果。T01–03结果在处理T04时一并进入模型上下文，本批未收到额外Boulder提醒；消息条数不证明独立AI回合数，忙时follow-up可合并。原始#33的/bin/sleep10也已成功收到，1/1、code0，但漏设inhibit的事实不抹去。没有声称所有异常路径或全部TUI模式因此获证，也未因测试继续改生产代码。

## 当前：脚本接线与运行widget已实施

用户批准发起计次/stop只取消后续/关闭清理，并追加aboveEditor栏目与全屏点击详情。本批复用原执行、聚合、正文和文字渲染；输入/共同decoder/执行目标保留ScriptTask，异步批次不持有状态锁，结果统一custom message。NoWake保留结果但不启动新回合。

最新全插件159/159通过，16 suites、0 fail/skip/cancel（约6.09秒）。新增17项覆盖：脚本CLI与存盘3；dispatcher进度/策略/单消息/关闭5；widget I/K/M/单行截断/全屏点击/普通模式/可配置关闭/错误包含4；真实无限脚本abort2；CLI真实执行/工具真实定时/stop保留已启动批次3。旧测试保留时间/进度/权限/资源断言，更新为custom来源；测试capture helper先断言customType与自动非用户来源再提取prompt，不把旧用户消息悄悄当通过。

当前官方Pi 1.2.0的SDK/TUI声明绑定下全插件strict tsc通过：`PI_LOOP_TEST_SDK_ROOT=$HOME/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent node test/check-types.mjs`。专用script-tasks tsc也通过。默认workspace dist仍是旧SDK接口，不能因缺MouseRegion/mode/outputPad而删功能；测试loader与类型checker都显式使用同一已安装官方版本，未修改安装包、依赖或关闭strict。新文件及入口做Biome check，原紧凑文件只做lint避免无关全文件重排；全部本批生产源码≤200非空非注释行。

官方Pi隔离终端测试已执行：`/tmp/loop-widget-ui-uM8ILc/receipt.json`与fullscreen-progress.txt、regular-progress.txt。独立HOME/配置/会话、env清空凭据、offline、无内置扩展/MCP；只加载本插件。全屏实际SGR鼠标点击栏目打开详情，原生画面显示(1/2/3)和当前/bin/sleep；普通模式文字栏目+/loop running键盘详情显示(0/0/1)。首个完整NoWake批次有一条custom result；两份会话除明确的fixture assistant外无新增assistant消息。隔离/reload后自有PID80967消失，隔离正常退出后PID1717消失，两个task-owned tmux均已结束。不是对用户当前会话reload，也不是付费模型烟测或全部Bun/Windows认证。

新增源码/runtime/renderer/UI普通错误边界由上述直接测试覆盖，不把159项或旧CCA347函数报告当本批机械证明，没有追加审查。根npm run check的Biome阶段无fix，仍被其它任务的历史快照依赖版本范围阻塞；后续根检查未执行，未修改那些快照或官方Pi。原30秒锁长暂停竞态继续按用户裁决接受，SQLite未恢复。

以下均为历史阶段记录，不反向规定当前已获授权的接线范围。

## SQLite撤销后：当前依据

按用户明确要求恢复原proper-lockfile（stale=30000、retries=0），删除catalog-lock.ts及3个专属测试/worker文件；保留实例隔离、空会话拒绝及普通错误修复。src/test搜索node:sqlite、acquireCatalogLock、mutex.sqlite及catalog-lock均无匹配。接受持锁者超过30秒不刷新后恢复写入的竞态，不再把这项强保证列入测试或引入替代机制。

当前官方SDK安装已从旧Homebrew路径移至`$HOME/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent`。旧路径首轮造成2个测试文件加载失败，其余137项通过；明确绑定当前官方1.2.0安装后，全插件142/142通过（16 suites，0 fail/skip/cancel，约3.82秒）。两套strict tsc（插件全量带--allowImportingTsExtensions及script-tasks专用）均退出0。未安装依赖或修改官方Pi。

命令：`cd my-plugins/scheduled-wakeup && PI_LOOP_TEST_SDK_ROOT=$HOME/.pi/agent/install/releases/1.2.0/node_modules/@earendil-works/pi-coding-agent node --import ./test/script-task-register.mjs --test test/*.test.ts`。

npm run check的Biome阶段无fix，随后仍被其它任务历史快照中的非精确版本依赖阻塞；未修改那些快照。下面的SQLite测试、Bun结果和OS锁结论仅为已撤销方案的历史，不是当前实现或保证。

## 历史：实例隔离与SQLite互斥方案（锁方案已撤销）

当前快套件144/144通过（16 suites，0 fail/skip/cancel，约3.99秒）；独立慢套件2/2通过（约31.45秒），随后组合运行中两项慢测试也通过。全插件strict tsc（--allowImportingTsExtensions）退出0，定向10文件Biome无修正。Bun v1.4.2另跑catalog-lock.test.ts的2项快测试通过；未跑全部Bun或真实Pi reload。

新增实例回归3项：不同真实SDK SessionManager在同cwd通过扩展入口并存，关A不伤B；同manager替换后旧tool不复活；旧release不删除后继claim。ExtensionAPI和投递使用fixture，不伪称真实模型turn或完整SDK应用验收。

共享catalog改用Node内置SQLite BEGIN IMMEDIATE仅持有OS锁，业务数据仍是JSON，无依赖安装。快测试证明不同连接互斥、不同catalog独立、失败事务释放锁并保留JSON。慢测试在实际catalog事务已读/修改快照、tmp写入前同步停下子进程：SIGSTOP 31.2秒后另一写者仍busy；恢复后两次依序写保留全部定义。另一项SIGKILL后无需人工清理即可写入。升级前所有写者必须采用同一锁协议，不能混用旧proper-lockfile写者，也不能运行中删除mutex inode。

组合首轮146项中144通过、2项旧清理测试失败：它们假定目录完全为空，未考虑必须保留的mutex文件。已改成仅允许该确定的mutex文件、继续拒绝任何tmp残留，并新增重新拿锁断言；最后快套件144项全部通过，未修改生产清理逻辑来洗绿。

命令：`PI_LOOP_TEST_SDK_ROOT=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent node --import ./test/script-task-register.mjs --test test/*.test.ts`；慢测：`node --import ./test/script-task-register.mjs --test test/catalog-lock.slow.ts`（均在插件目录）。当前Node v26.8.1/macOS。根npm run check仍停在其它任务的快照pinned-deps，Biome无fix；未改官方源码/快照。I1/L1本批实现及直接功能依据不冒充旧CCA对新快照的证明，没有追加审查。

以下空会话、122项及初始阶段记录均为历史。四项遗留按当前合同结算：I1实例隔离已修，P1空会话拒绝已实现，P2同transcript多执行者由用户裁决为UB，L1暂停/崩溃互斥已修。script-tasks仍未接线，save-msg/output仍未修改。

## 空会话拒绝创建：当前运行依据

用户已接受缩小支持范围：文件尚未真实落盘时，命令add/define/register和工具add先display error并拒绝；查询不受影响。不改Pi、不插消息、不新增存储。新增session-persistence.test.ts两项直接回归使用明确绑定的已安装官方SDK；custom-only会话无文件/无追加、通知失败不逃逸，fixture模拟真实对话落盘后同一runtime可创建并由新manager读回。无模型调用。

当前全插件138/138通过，16 suites、0 fail/skip/cancel（约3.96秒）；全插件strict tsc（--allowImportingTsExtensions）退出0，定向9文件Biome无修正。原有生命周期/Boulder测试的已保存会话fixture补齐真实临时文件/getSessionFile，未削弱断言。

运行：`cd my-plugins/scheduled-wakeup && PI_LOOP_TEST_SDK_ROOT=/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent node --import ./test/script-task-register.mjs --test test/*.test.ts`。未绑定时仓库旧dist缺依赖，不能把它当官方SDK运行证据；loader支持显式SDK根，不修改安装包。

本轮npm run check退出1：Biome通过且无fix，随后pinned-deps检查命中其它任务的.local/stability-against-oc/sources/pi-v1.2.0和my-plugins/impression-demo/runs/sdk-snapshots/pi-0d77872快照内的版本范围。未修改这些快照，后续root检查未执行。以下122项和7项类型诊断是历史，不是当前结果。P1按拒绝合同已处理，P2同transcript多执行者由用户裁决为UB；I1全局实例隔离与L1共享catalog stale问题仍未修。

## 最新修复阶段依据

全插件 122/122 通过（16 suites，0 fail/skip/cancel，约4.02秒），含本会话新增15项outer边界/时间/资源回归；新script基础设施专用tsc通过；root `npm run check`全链通过（此前嵌套配置阻塞已由其它工作消失，本会话未迁移它们）。定向24文件Biome检查无错误/警告/修正。新改源码按职责拆分，所有本批源文件≤200非空非注释行。

插件全量strict tsc（`--allowImportingTsExtensions`）仍有并行Boulder接线的7项诊断，位于oh-my-pi-v2/boulder-inhibition/read-inhibition.ts、v2/boulder-sync.ts、test/boulder-sync.test.ts及test/defer-command.test.ts；本批outer测试隐式any已修，未用类型断言/禁用strict压掉这些共享改动的错误。因此root检查通过不等于整个插件strict类型检查通过。

当前生产Loop外层的错误修复已改extension/handler/v2文件，下面的“未接线证据”只记录最初基础设施阶段。新script-tasks依旧没有被production入口引用，save-msg/output未接线；原SDK durability/multi-owner/lease/global-owner问题仍未修。

## 初始基础设施阶段已运行

从仓库根：

```
cd my-plugins/scheduled-wakeup && node --import ./test/script-task-register.mjs --test test/*.test.ts
node node_modules/typescript/bin/tsc --noEmit -p my-plugins/scheduled-wakeup/tsconfig.script-tasks.json
node node_modules/@biomejs/biome/bin/biome check --write --error-on-warnings --max-diagnostics=none --config-path=my-plugins/scheduled-wakeup/biome.script-tasks.json my-plugins/scheduled-wakeup/src/script-tasks my-plugins/scheduled-wakeup/test/script-*.ts my-plugins/scheduled-wakeup/test/script-task-register.mjs my-plugins/file-path/resolve-user-path.ts
```

全 scheduled-wakeup 套件 103/103 通过，15 suites，0 fail/skip/cancel；约3.77秒。新基础设施36个测试（包含0–8项失败谓词的511个穷举排列），其余67项覆盖现有v2功能。专用tsc退出0；定向Biome检查19个新源码/测试/loader文件，退出0、无warning/info。

根级 `npm run check` 已运行，退出1，停在Biome配置加载：oh-my-pi-v2/.opencode/worktrees 的 neon-river、playful-sailor、quiet-falcon、sunny-cactus、tidy-planet、witty-nebula 含嵌套root配置。未修改这些无关工作树，未绕过或宣称根检查通过。后续根检查步骤未执行。

## 实际覆盖

- 路径：~、~/、多余斜杠、absolute/relative/../、space/Unicode、literal $VAR/~user/glob；正确展开回归，不写真实home。
- 规格：默认1800秒/or/cwd/params、null无限、空任务、结构/枚举/timeout非法值、输入快照。
- 聚合：0–8项全部布尔向量、各失败终态、所有策略下全脚本按序执行；纯prompt不运行进程。
- 正文/展示：Boulder来源句、用户指定script标签、真实exit code/unavailable、FAILED、动态标记转义、100个固定种子字符串、展开与AI正文相同。
- 实际进程：cwd/argv、字面shell元字符、可执行路径空格/Unicode、非零/信号、启动失败、NUL、UTF-8分片、null及并发调用隔离。
- 生命周期：忽略SIGTERM仍超时、同组后代和正常退出后的背景成员不再写标记、父退出但继承pipes仍被deadline收尾、真实混合失败批次继续运行。
- 事件/计时：重复终态、timeout优先于exit0/error、清理错误不成功、原始与清理原因同时保留、Windows明确不支持、timer取消/null/32bit分片。

本次真实进程环境 Node v26.8.1 / macOS。POSIX运行证据不推广为Windows支持；发出SIGKILL不等于任意脱组后代隔离或硬实时抢占。完整输出保存在结果内，不证明任意大小输出可适合内存。

## 测试开发中纠正

第一轮28/29通过：cwd断言错误地要求macOS /var符号路径与子进程/private/var文字相同；用realpath确认目录身份，不修改实现的路径契约。事件模拟首次错误地mock ESM namespace属性spawn，改为mock Node默认导出并syncBuiltinESMExports；这修的是测试接线，不削弱断言。根Biome配置阻塞另用明确非自动加载的专项配置检查新文件，不迁移无关仓库配置。

## 未接线证据

`git diff --name-only -- my-plugins/scheduled-wakeup/src/extension.ts my-plugins/scheduled-wakeup/src/loop-command-handler.ts my-plugins/scheduled-wakeup/src/v2 my-plugins/scheduled-wakeup/index.ts my-plugins/save-msg/output.ts packages` 返回空。新模块只由新模块/直接测试引用；没有注册命令、renderer、计时轮询或调用sendMessage/sendUserMessage。

基础设施测试不证明生产功能已接入，不证明save-msg命令Bug已修。Hoare独立推导另有输出，测试报告不替代推导。
