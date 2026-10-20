# fsm-1-admission-binding 契约处置

原始独立对照：run443a0a42-047d-48c8-9f85-ec43f7fde9de，报告audit-report-initial.md；原patch implementation-initial.patch。独立结论是BLOCK，不能因测试当时21/21通过而忽略critical。

C1判断：同意。恢复只证明旧父链无环，不能推出待恢复self接入后的树无环。实际新增回归先失败，确认是实现偏差而非用例错误。

修正：parentDepth增加forbiddenSessionId并预置seen；restore传真实待恢复self，new bind同样传待绑定self。普通caller深度不设禁止节点。失败仍在返回binding/PendingLaunch更新之前，无new fallback或原记录修改。原root恢复仍不查parent。

直接结果：最新22/22测试通过；其中新增C1回归断言拒绝及saved/records不变；插件tsc无诊断。详见docs/test-reports/fsm-1-admission-binding.md、docs/fixes/binding-fix-restored-parent-cycle.md。

限定修正确认：run71d9cffd-5a5f-4ceb-9eef-06f46a0f9c53已返回C1闭合、本单元PASS、critical/unresolved=0，报告audit-report.md。结合本地22/22测试及插件tsc，本单元按既定技术合同结算；这不关闭完整系统目标或B3-B9。

保留边界：根只读check因缺@biomejs/wasm-nodejs在第一项中止，后续未执行；没有修改根依赖来掩盖。B3-B9为后续各模块编码前设计责任，未因首单元测试通过而关闭。
