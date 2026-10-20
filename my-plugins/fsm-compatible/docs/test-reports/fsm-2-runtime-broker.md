# fsm-2-runtime-broker 当前运行依据

状态：通道组件已有实际实现与直接运行依据；完整根extension/SA接线及本单元最终contract退出尚未完成。不能称整个FSM插件已经可安装运行。

## 设计依据

原B3/B4机制经独立设计审查，D2-1/D2-2限定确认run1fe740c1-3167-4e2a-b74d-58a4dd4d6f04返回READY/critical-unresolved=0。实际报告保存在docs/audits/fsm-2-runtime-broker/design-review.md；不是实施审查或完整系统证明。

## 实现

根初始化/startup冻结账本与managed factory代理；真实Mac/Linux PID/start identity；atomic canonical lease；直接spawn和退出确认；固定daemon helper routes/新token；source读回；MCP handshake/catalog/schema/fullresult/progress；FSM工具投影、实际SID执行守卫、not-ready gate；有界broker等待与close取消；资源逆序回收；capability→source→Client→catalog通道prepare。没有拿这些资源替代缺失protocol/judge/child/gates/Watcher的完整prepared条件。

## 命令与结果

在插件目录：

- `npm run test:runtime`：37/37通过。覆盖D2读回/事件snapshot、真实父PID重复探测、租约跨root串行/不同tool独立、foreigntoken、取消/unknown关闭顺序、queuefull写入前拒绝、MCP分页/错ID/timeout/progress、完整结构化结果及错误、工具冲突/foreignSID、资源关闭/未就绪门禁、channel准备与拒绝。
- `npm run test:admission`：22/22通过。首单元不重开审查，作为已有模块直接回归依据。
- `npm run check`：插件strict tsc退出0；官方Pi依赖固定1.0.3，避免仓库另一份1.2.0错误类型来源。新增package/lock仅在本插件，安装使用--ignore-scripts，未改根依赖。
- `FSM_COMPATIBLE_TEST_SERVER=/Users/ssyram/workspace/ai-tools/use-fsm/target/release/mcp-server-fsm FSM_COMPATIBLE_TEST_CLIENT=/Users/ssyram/workspace/ai-tools/use-fsm/target/release/mcp-server-fsm-client node --test test/fsm-binary-protocol.test.ts`：1/1通过。隔离FSM_DATA_DIR，实际daemon=0.11.0/wire2/schema2；真实helper读取capabilities/source、actor acquire、Client握手/catalog/ping及broker fsm_get_state调用，最后确认租约释放、回收Client/daemon/临时目录。无模型、provider key或Web请求。

合计60个测试通过（37+22+1），不包括实际Review/Stop/Watcher或官方Pi完整extension启动。

## 发现与修正

最初runtime23项中progress丢失和unknown identity提前释放失败；保留反例并修复request token关联、控制POSTunknown保留lease/关闭通道。见docs/fixes/broker-fix-progress-unconfirmed-identity.md。

新测试收尾失败属于fixture cleanup先rm后release；修正为finally先释放lease/撤临时close包装，再交fixture删目录；原业务断言未删除/削弱。

真实安装二进制`/Users/ssyram/bin/mcp-server-fsm`返回0.10.0/schema2但没有wire_contract_version，插件拒绝；不能把源码0.11.0当安装版本。没有升级/覆盖该二进制。已有target/release产物满足wire2并实际通过。test:binary默认指向现有bin，因此此机器默认命令仍会正确失败；运行兼容测试必须显式选以上已核实产物，安装单元后续应给出同样明确的路径与能力门槛。

## 未完边界

尚未根完整runtime入口与静态manifest生成/安装、SA真实owner注册、child mandatory及完整协议/gate接线。本单元最终独立实施contract对照尚未运行，当前不能结算PASS。下一步B5字段/工具合同闭合并实现protocol/records/judge，再接回完整根运行依赖。mandatory常用插件命令翻译仍排核心之后。

根npm run check包含write并可能越界，仍未执行；此前只读等价链Biome首项缺@biomejs/wasm-nodejs，后续根checks未运行。没有修改官方Pi/FSM/SA源码、用户bin/global配置，无staging/commit，无真实token消耗。
