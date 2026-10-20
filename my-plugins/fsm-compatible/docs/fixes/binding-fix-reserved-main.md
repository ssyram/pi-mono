# 子绑定：拒绝根 actor 保留标识 main

## 1. 现象与复现

真实测试调用 bindNewChild(..., actualSessionId="main", ...) 返回execution-child且agentId="main"；原FSM以(rootSessionId,"main")寻址根actor，违反主子隔离。复现已加入actor-binding.test.ts，首次运行9项中该用例失败。

## 2. 根因

实现只检查child self不同于rootSessionId，遗漏agentId中的根保留值。Pi实际SID与FSM actor命名不是可无条件互换的两个命名空间。

## 3. 参考合同

原FSM身份约定及本架构ActorBinding：root agentId="main"，child agentId=self；不能让child同样占用保留根actor。正常SA新建SID不是该保留值；损坏或不兼容的恢复数据必须显式拒绝，而非串到根。

## 4. 修正

bindNewChild在状态改变前拒绝actualSessionId="main"；持久child reader和parent-chain同样拒绝child agentId="main"。root仍可合法agentId=main，不改变root恢复分支。schema在child变体明确not main，合同/expectations同步。

## 5. 正确性

保留root唯一main actor；合法child仍自映射，冲突SID错误不修改PendingLaunch、不消费dispatch或换ID。没有静默重命名以改变既定身份合同。

## 6. 测试

保留已失败反例；补persisted child main和parent-chain反例；重跑全首单元21项及类型检查。状态：修正后全套通过，保留了实际失败反例；C1修正后的最新全套为22/22，插件tsc无诊断。

## 7. 代码

bind-new-child、read-persisted-binding、parent-chain：同一保留冲突拒绝；原root分支不变。

## 8. 文档

细化/叶子/expectations/schema明确保留根actor不可由child占用；这是原P2身份隔离的必要表达，不新增工具功能或换架构。
