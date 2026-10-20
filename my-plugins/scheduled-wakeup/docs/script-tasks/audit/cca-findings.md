# CCA 裁定与原任务回程

CCA 是待核证据，不是正确性证书。四路独立核对已完成，原始报告与复现留在 `.cca-runs/loop-full-cca-20261013/audit-tools/post-cca/`：exceptions.md、storage.md、framework.md、coverage.md。产品源码在分析/核对期间未改；347份文件与24个mismatch不能当作347个证明或24个独立Bug。

## 真问题（按根因去重）

| ID | 裁定 / 实际后果 | 根因及最小方向 | 本阶段 |
|---|---|---|---|
| T1 | confirmed：正常时长语法可使 now+delay/interval 越界，命令或恢复回调抛出 | 建立时间时报告不可表示输入；实际Pi边界承接内部验证异常，不能重复要求所有内部函数nothrow | 直接修复 |
| T2 | confirmed：一次性时间超Date域，命令追加后RangeError；工具也可成功保存，随后list抛 | 创建和格式化域必须一致；拒绝新超Date once，展示已存在的范围外数据时显示原始epoch-ms，不能使整个列表失败 | 直接修复 |
| E1 | confirmed：命令/生命周期/tool普通锁或写盘失败escape/reject，shutdown finally清理不等于承接 | 边界覆盖parse/ensure/动作/重排；失败反馈自身不抛；内部throw和busy值保持 | 直接修复 |
| E2 | confirmed：append可先变内存再写盘失败；AI add返回失败但active含新任务，cancel后抛；错误构造再查询也会失败 | 错误不声称回滚，active不可读用null而非假空数组；动作、查询、通知和重排结果分开 | 直接修复 |
| E3 | confirmed：失效SDKctx使timer的runDue catch后armNext再次抛，下一timer为空；实际补全委托ENOENT也会reject | timer完整承接并停止不可重臂runtime；补全在catch内await委托，失败返回null/原输入/false | 直接修复 |
| E4 | gap：通知异常被误标投递失败；正常注册期具体throw未证 | 通知best-effort且不属于投递try，整个扩展注册入口也不得逃逸；不造重复注册/SDK失败前提 | 直接承接 |
| I1 | 已修：按SessionManager对象隔离实例所有权，不同cwd或相同cwd的独立会话都不互踩 | 同owner替换仍清理旧实例；旧release不能移除新claim；退休工具不能复活runtime | 3项直接回归 |
| P1 | 已按用户裁决缩小支持范围：未真实落盘的会话拒绝创建并display error，不再假报成功 | 命令add/define/register和工具add在操作前检查公开getSessionFile对应的真实文件；不改Pi、不插消息、不新增数据库 | 已实现并直接回归 |
| P2 | 已裁决为UB：两个执行者使用同一session transcript，历史复现的双投事实保留，但不属于正常使用Bug | 用户规定一个transcript理论上对应同一个人；不承担并行/串行多执行者缓存同步，不加owner检测或防护 | 不修，不作验收项 |
| L1 | 用户明确接受：持锁进程超过30秒不刷新并恢复写入的竞态保留 | 恢复原proper-lockfile机制，撤掉SQLite及专属测试；不新增依赖、组件或进程补此边界 | 不修，接受已知问题 |
| L2 | confirmed：真实EFBIG连续失败留3个自有tmp，锁已释放 | 失败write/rename收尾自有temporary，保留原始错误；OS同时拒绝清理时诚实保留边界 | 直接修复 |
| K1 | contract gap：规范要求sessionId/registrationId唯一，读取实现按三元组，普通JSON重复pair被接受 | 当前生产UUID不制造冲突，但读侧域不能靠写侧Pre消掉；修读侧唯一性并保持授权匹配含definitionId | 直接修复 |

报告以真实代码/隔离复现建立上述可达性，不等于全部平台或全部环境已验证。详情与真实调用路径见各lane报告，不把hypothetical SDK失败当生产实证。

## 不改的项 / CCA纠正

- getBranch/getSessionId 是内存操作，“读session文件失败”不是它们的throw理由。当前src失效getter与安装dist普通属性必须区分；不能跨版本声称实测。
- append失败≠零痕迹；成功append≠必然刷盘。P1不是已经接受的“投递后、持久化前崩溃”重投边界；P2已由后续用户裁决排除为UB。
- 正常CLI new/resume/fork/reload是shutdown-first，cwd-only串会话的该反例不成立；独立SDK实例I1另有真实证据。
- 未接线script-tasks没有已证实现/设计矛盾。close含stdio生命周期、None可不终止、setsid脱组、输出适合内存、OS拒杀时等待close，均保留。spawn error后仍可close，正确性来自settled guard，不是“不会再close”。
- 内部写侧已有生产caller验证，不重复加guard；生产UUID/NUL键碰撞、坏注入时钟、同步timer注入不作普通生产Bug。
- busy mkdir不算资源泄漏；cancelActive路由TOCTOU、保守孤儿index、投递与进度非事务性、非健康stale执行互斥保持声明边界。release失败“最多30s恢复”的断言没有保证。
- formatDuration(0)=0d、重复clone分支、未用DAY_MS是cosmetic，不为审查制造清理。
- expiredAt取resume now、终态registration幂等复用旧进度符合现行文字，不追加重激活功能。

## 未闭合/需集中裁决

1. I1已闭合技术修复：SessionManager-keyed WeakMap保留同owner清理，不修改Pi对象/源码；真实SDK manager加扩展入口fixture测试不同owner并存、同owner替换及退休工具，未冒充真实模型turn验收。
2. P1：已裁决并实现空会话拒绝：display error，不追加或创建。当前官方安装包的公开创建API没有无副作用强制flush；不采用新会话预填消息、私有方法、模型调用或插件新数据库。真实落盘后正常创建，当前task/session能力之外的SDK保存保证未被扩大。
3. P2：用户已明确同transcript多执行者属于UB。该正常使用义务关闭，不要求锁内刷新Pi缓存、单owner准入检测或新增回归。
4. L1已由用户裁决接受原锁边界，并明确要求撤销SQLite。已恢复30秒proper-lockfile目录锁，删除本次新增的SQLite锁模块、两项快测、两项慢测及worker；历史复现不抹去，但不再宣称该边界已修，也不新增辅助线程/进程。
5. catalog锁外snapshot读 vs definition/index同版本事务读、SDK接收/排队 vs 实际模型turn完成：公开成功语义需明确，不引入重试/daemon/exactly-once。Pi void异步API不能证明turn成功。

## CCA vs HoarePrompt

两者都做CFG/SP/循环/caller-callee推理。HoarePrompt是方法，强调设计先行、原Pre与真实API；CCA增加manifest、图、SCC、派发和结构覆盖门。本轮CCA有实际贡献，也出现未核SDK假设、失败效果错误和Pre重复验证建议，说明流程门不是语义证明。旧Hoare只覆盖新基础设施，CCA扩到既有Loop且新增外层nothrow要求，不能用不同范围的问题数/模型/时间判胜负。比较不取代以上缺陷处理。

## 任务状态

新脚本基础设施继续未接线，save-msg仅有路径基础设施，命令接线未做。直接修复项由后续修正方案与回归测试记录；待裁决项不得标“已修”或“无Bug”。不提交、不改官方packages源码，不再新增审查轮次。
