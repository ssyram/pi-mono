# 恢复绑定：禁止接入后的父环

## 1. 现象与复现

独立contract审查C1指出旧无环树r→c→d中恢复saved c.parent=d会接入形成c↔d。该反例已加入actor-binding.test.ts并实际复现：10项中该新增测试失败，restore返回ok。

## 2. 根因

parentDepth只检查当前父链自身重复，以空seen从d遍历d→c→r不会重复；它缺少待恢复self=c的禁止祖先事实，无法证明接入后无环。

## 3. 参考合同

原架构P2和ActorBinding父链无环、叶子P7恢复真实父链及原expectations的非法parent/环拒绝。不依赖provider或daemon。

## 4. 修正

parentDepth增加可选forbiddenSessionId，并以它初始化seen；恢复传actualSessionId，new binding也传待绑定self。遇到它返回parent-cycle，恢复转换为restore-conflict。普通caller深度查询不传该禁止节点。

## 5. 正确性

当前父链既必须无重复，也不能包含待接入self；只有两条件同时满足，加入self→parent后才无环。根恢复仍不查询parent，合法child恢复不变。错误发生在binding返回/PendingLaunch修改前，无new fallback和外部效果。

## 6. 回归测试

新增C1反例保留实际失败，另断言saved和当前records未修改；全部原测试和类型检查重跑。状态：修正后全首单元22/22通过，插件tsc无诊断；保存了实际失败反例，未改弱断言。

## 7. 代码

parent-chain的新参数与seen初始化；restore-actor-binding和bind-new-child在父链检查透传真实self。

## 8. 文档

函数细化/叶子/事前expectations明确“接入后的树”而不只“原父链自身无环”；C1作为原合同修正，不新增目标。独立审查修正确认只针对该已知critical，不重新展开整轮。
