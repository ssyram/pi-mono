# fsm-1-admission-binding 运行记录

状态：首单元实际源码、22项直接测试与插件类型检查通过；独立contract差异C1已限定确认闭合、本单元PASS。不是完整插件可运行声明。

## 设计门槛

初次设计审查BLOCK，B1/B2修正后原独立审查者在run ba93ecc4-c978-4905-b2bc-7cb60c8a0c26明确给首单元READY；原始与修正确认分别保存在docs/audits/design/design-review-initial.md、design-review-corrections.md。B3-B9仍是后续模块编码前的设计义务。

## 已实现

固定exact canonical名单、native runner准入、mandatory真路径及补self后32项上限、不可变定义/政策快照、后代策略单调收窄、真实caller与父链/深度、new launch唯一self、根/子独立恢复、原mandatory基线保留/增加、坏binding不fallback、child不占用根保留main。

没有root extension/Client/HTTP/judge/child启动/permission/Stop/Watcher的运行实现，不宣传只完成纯准入单元就是FSM已兼容。

## 直接命令与结果

在插件目录执行：

- `node --test test/admission-policy.test.ts test/actor-binding.test.ts test/admission-binding-schema.test.ts`：C1修正后最终22/22通过。名单性质用例内部遍历三项全集的64个父/子集合对；其它测试覆盖真symlink/files、32项补self边界、root/child恢复、原mandatory删换增、损坏/未知字段、父链环/失联、工具ceiling及保留main。
- `node ../../node_modules/typescript/bin/tsc --noEmit -p tsconfig.json`：退出0，无诊断。
- 源码原始行数均小于200，当前首单元15个源码文件；无barrel实现或外部源码修改。

首次测试19/21；稀疏array实现漏洞修复、Reflect.set错误断言按API实际返回false修正，fixture narrowing类型错误修正后全部通过。额外保留main反例先失败、修正后全套再次通过；失败用例未删除。根因分别见docs/fixes/admission-array-input-fix-sparse.md、binding-fix-reserved-main.md。

## 根检查的真实边界

未运行带`--write`的根npm run check，因为它可能修改用户禁止修改的官方源码/其它会话文件。

已尝试对应只读链（Biome不带--write，随后各root checks/tsc/browser smoke），但第一项就因缺少`@biomejs/wasm-nodejs`失败：ERR_MODULE_NOT_FOUND。因此后续root checks并未执行，不能报告根check通过。没有清理/重装根node_modules或修改官方package/lock来绕过边界。插件类型检查与上述直接测试独立通过。

## 证据与尚欠

实现patch只包含本单元的明确新source/test/package/tsconfig，保存在docs/audits/fsm-1-admission-binding/implementation.patch；它不是整个dirty仓库的diff。无staging/commit，无provider/daemon/subagent执行测试。

独立contract对照已发现C1恢复接入后父环；反例实际先失败，加入forbidden self后22/22及tsc通过。原报告保存在audit-report-initial.md；该差异已在run71d9cffd-5a5f-4ceb-9eef-06f46a0f9c53限定确认闭合并结算；其后按依赖完成runtime/broker、协议/judge、受控子生命周期和gates、Watcher/安装/实际运行、mandatory命令翻译。根工具缺失作为实际环境问题保留，不伪装为已完成检查。
