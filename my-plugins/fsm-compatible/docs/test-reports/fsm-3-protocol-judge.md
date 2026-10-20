# fsm-3-protocol-judge 当前运行依据

状态：本单元设计已 READY（D3-1～D3-4闭合），实现完成并通过直接测试；实施后独立contract对照尚未运行，未结算PASS。

## 设计门槛

原B5经两轮审查：run60df8e97 BLOCKED（D3-1～D3-4），修订后由owner授权的tmp-Haokun/glm-5.3-flash run f13dcdae限定确认READY，P2 terminate措辞已补。报告：design-review-initial.md、design-review.md；处置：design-decisions.md。

## 实现（均在my-plugins/fsm-compatible）

- 记录层：record-time ISO roundtrip归一化/数值独立验证；RecordStore owner隔离+judge独立索引；oc-messages真实call/result关联envelope（custom_message/bash/system投影、pending不造completed、错关联整体拒绝）；oc-roster BFS+judge独立根+unavailable不掩盖。
- OC HTTP：oc-route固定路由/404/405；oc-server loopback随机端口+Basic常数时间比较+1MiB 413+严格204+错误码映射；oc-handlers真实接线（judge/execution目标分离403、create仅fsm-gate、prompt_async未接fsm-5显式503）。
- judge：judge-input严格shape+Ajv wire schema编译；tool-policy wildcard deny+基础三件套常在+deny别名即拒；path-scope真实cwd范围+external_directory才放开；directory-read真实readdir/localeCompare/offset||1/limit??2000；file-tools五工具（edit原生edits+replaceAll全替换+空old queue内mkdir+wx新建/存在拒绝）；CaptureTurn保留冲突/失败独立/reset同sid repair；judge-envelope失败+成功实际parts；finishTurn原decision先跑、完整批次+真实capture才end；judge-error仅typed provenance；judge-session每回合真实Agent（faux或真实streamFn同路径）+同sid转写seed/吸收+singleflight+终结envelope以capture账本为准（过滤投影重复StructuredOutput part）。

实施偏离记录（较subplan §6）：judge会话不使用DefaultResourceLoader/createAgentSession，而用公开raw Agent按回合组装——隔离更强（零扩展/资源加载），同sid经转写数组续跑；StructuredOutput参数为宽松object、精确schema以system后缀注入（raw Agent工具声明的适配）。两者不削弱READY合同（隔离/真实回合/envelope契约不变），已记入design-decisions供对照审查核实。

## 命令与结果（插件目录）

- npm run test:admission：22/22。
- npm run test:runtime：37/37。
- npm run test:protocol：14/14（records7+roster2+server4+handlers1）。
- npm run test:judge：15/15（input2+capture2+file-tools4+turn2+session5，session5用registerFauxProvider真实整回合：capture完成envelope/失败后成功/同批conflict双保留/length终结/同sid repair不复用旧capture+并发409）。
- npm run check：strict tsc退出0。devDeps显式固定@earendil-works系列1.0.3（overrides），与真实宿主一致，修复此前1.2.0传递漂移。
- 隔离FSM binary通道测试仍需FSM_COMPATIBLE_TEST_SERVER/CLIENT指向use-fsm/target/release产物。

合计88项本地测试通过，无provider key/真实网络/真实模型调用。

## 过程缺陷与修正

oc-server初版readBody误用require（重写为OcHttpError 413+丢弃后续）；参数属性错误三次（已记教训：一律显式字段）；judge-session初版未接入sid转写（改为转写数组seed/吸收）；终结envelope投影StructuredOutput part与账本重复（以账本为准过滤）；abort未知sid测试期望错误（改为404/真实idle确认）；目录排序期望笔误、oldString空串误用非空校验——均已修实现或测试，反例保留。

## 未完边界

实施后独立contract对照未运行（下一步，用既定授权reviewer对照expectations与implementation.patch）。fsm-2最终结算、根runtime入口/SA/child/gates/Watcher/安装/mandatory翻译仍未完成。无staging/commit；根write check边界不变。
