# external: getAgentDir (宿主扩展 API)

- 来源引用点：extension.ts:18（作为 `globalRoot` 实参传给 registerMySettingsService，settings-service.ts:70 接收）。
- kind：native 宿主 API（@earendil-works/pi-coding-agent 导出；extern-model.md 'Pi lifecycle dispatch' 外部前提）。

## Pre
- 无参；在扩展初始化（mySettings）调用栈内调用。

## Post
- 返回 agent 数据目录的**绝对路径 string**（TS 标注 string；settingsFilePath 的 root 前提与 svc:29/49 的路径计算完全押在该 string 性上——external 前提，非本插件可证）。
- 同进程内多次调用语义稳定（宿主配置在会话期不变——外部前提）。

## 可否 throw-reject
- 同步 API；按外部前提建模可能同步 throw——唯一调用点 ext:18 位于 mySettings 的 try（extension.ts:8-37）内，失败被折为 console 诊断后插件降级（无服务注册），不外抛（fn-extension-mySettings-L6.md 已记）。
