# Broker：进度关联与未确认控制写入

## 1. 现象

runtime首轮23项中21通过；进度fixture通知没有回调，未知identity写入后coord目录已空。后者允许原daemon迟到PUT与下一个调用交错。

## 2. 根因

MCP pending未保存onProgress，也未发送progressToken/关联notifications/progress。broker只有MCP sent后才关闭/保留资源，遗漏控制层POST已写出但无响应的阶段；关闭Client不能证明daemon的identity写入未来不会完成。

## 3. 原合同

完整MCP结果/progress和实际身份acquire→response互斥区；未知mutation不重放，不提前解除未确认调用。不是新增通用审查要求。

## 4. 修正

pending保存progress回调，以本requestId作_meta.progressToken，通知只路由匹配pending。控制POST requester异常归delivery-unknown，broker在MCP尚未发送时关闭通道、拒绝复用且保留lease；MCP已发送未知仍以确认Client终结为释放条件。进入控制写入前再次检查signal/deadline，已取消的未发送请求仍安全释放。

## 5. 正确性

进度不能发给另一请求，回调异常不逃逸进程；控制写入无确认则没有证据证明旧PUT已结束，保留独占避免后续错身份。已知读回失败/非成功HTTP响应按其确定结果处理，不能全部叫成功。

## 6. 测试

保留原两个失败例；runtime最新37/37、旧admission22/22、插件strict tsc均通过。unknown后lease仍在、broker不可复用、正常source失败不发identity/MCP；补register unknown同类反例及MCP已发送unknown先确认关闭后才释放、queuefull写前拒绝/close取消等待。另有真实FSM0.11.0/wire2隔离通道测试1/1通过，不称完整系统运行。

## 7. 代码

mcp-transport：progress与请求_meta；register-source：POST异常阶段；fsm-broker：pre-send信号检查及控制unknown分支。

## 8. 文档

原契约的完整持有区间/未知写入责任保持；子计划与expectations已区分控制POSTunknown和MCPunknown的确认条件。本记录说明源码阶段遗漏，不以修改测试弱化门槛。root整体部署仍未完成，无commit。
