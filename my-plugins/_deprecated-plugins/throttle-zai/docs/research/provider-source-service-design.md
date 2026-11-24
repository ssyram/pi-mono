# 来源服务调研：已归档

本文件原有的 provider-profiles 代码级候选已迁至 [外部依赖设计](../extern-dep-design.md#e1-provider-profiles)。它不属于 throttle-zai 内部实现。

当前插件规范从 [README](../../README.md)、[内部架构](../design/architecture.md) 和 [内部细化](../design/detailed-design.md) 进入。研究原型仍保存在 evidence/，只作为版本固定实验，不是已接入的产品。

后续文件级登录探针又证明公开 SDK 可以保存标准凭据；旧的“默认把新 token 写 profile.apiKey”候选已被替代。所有当前外部接口/修改只以 extern-dep-design.md 为准。
