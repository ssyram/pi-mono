# 更正：在 provider 创建时发现模型

本次为响应用户“新 providers 怎么来的，能否发现 provider 时直接获取 models”的只读核实。没有授权修改核心或其他插件。

## 一手事实

- provider-profiles/provider-profiles-extension.ts 的异步 factory 先读账号配置、校验，再调用 instanceProvider(getBase(entry.provider), entry, ...) 创建 provider，最后 registerInstances 注册。该过程发生在会话启动阶段之前。
- provider-profiles/registrar.ts: registerInstances 用 pi.registerProvider(item.provider) 注册完整原生 provider。
- provider-profiles/instantiator.ts:101 起的 instanceProvider 保留基础 transport，按实例包装认证；getModels 每次从 base.getModels() 取得目录并重绑定 provider 名。该实现刻意不携带 refreshModels。
- provider-profiles/commands.ts:132 起 /add-login 走同样的创建后注册路径。

## 可推出的结论

用户提出的创建时机确实存在。若由创建者在注册前组合模型目录，便不需要第三方插件在账号创建之后抢占它，也不必因启动解析时序而新增 Pi 核心钩子。

可采用的设计方向是：创建者组合一个发现能力；缓存预先恢复，目录读取先取当前官方模型，再补可信缓存，刷新继续走标准 provider.refreshModels；外部失败返回原官方目录。认证、transport、实例身份继续由现有创建者负责。这里是源码支持的候选，不是已实现或已运行验证。

## 未闭合范围与原结论更正

这需要 provider 创建者调用/组合发现模块。当前 provider-profiles 并没有该调用，且会丢弃 base.refreshModels；因此不能声称仅放入独立 model-scout 插件、其他插件完全不动，就已能自动接入此路径。

“允许在自有 provider-profiles 插件创建入口接入发现模块”与“修改 Pi 核心”不是同一权限。此前把现有第三方接管路径的阻塞说成必须改 Pi 核心，超出证据，应撤回。现阶段没有必要据此修改核心。

官方接管、缓存失败隔离、动态刷新、thinking 档位、上下文长度、禁用恢复与用户实际 GLM-5.4 验收仍需按最高合同细化和证明，不能因找到了创建入口就宣称完成。
