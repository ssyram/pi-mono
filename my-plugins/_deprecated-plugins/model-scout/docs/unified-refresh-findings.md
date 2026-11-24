# 全部 Provider 注册后的统一刷新时机

## 用户指向

目标是官方 Provider、Profiles 与其他已注册 Provider 统一获取模型；用户提出的是统一处理时机，不是指定修改 provider-profiles。不得继续把修改 Profiles 当成已选方案。

## 已核事实

- packages/coding-agent/src/core/agent-session-services.ts:160 冲刷配置型注册，:172 冲刷 native 注册，随后冲刷 virtual 注册；:193 清空 virtual 注册队列；:194 await modelRuntime.refresh({allowNetwork:false})。此处确实是全部注册后的统一缓存刷新。
- packages/ai/src/models.ts:83 起 RefreshModelsContext 提供该 provider 的 credential、stored、publish、allowNetwork、force、signal、baseUrl；不含目标会话 registry 或全部 Provider 表。
- packages/coding-agent/src/core/extensions/loader.ts:150–254：加载期只排注册队列，createContext 等动作在 bind 前不可调用；:500–552 的 virtual 路由也在请求时创建 context。事件总线只负责收发，未在上述注册完成位置看到宿主发布统一事件。
- ModelRuntime.refresh 与 Models.refresh 执行已有 Provider 的 refreshModels。共享刷新流程不自动为原本没有发现回调的 provider 添加新的发现实现。

## 结论与边界

用户的统一时机有真实代码位置，能同时服务官方和 profiles；缓存阶段应先归并，联网发现不能阻塞零网络初始化。统一调度不意味着所有来源可用同一种列表协议。

尚缺当前独立插件如何在该点读取并装配全部原 Provider 的公开接线。本次证据不能证明公开接口之外的所有纯插件组合不可能，也不能据此宣称已经有完整方案。反过来，注册结束后的内部调用存在，也不能证明它已是插件可订阅的钩子。

若后续需新增宿主公开接入，准确范围应讨论这一统一阶段，而不是为 Profiles 单独加功能；未获授权不修改核心。此前“必须改Profiles”与“必须改核心”的定论均不保留。
