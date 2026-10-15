# Provider Usage — 设计入口

**截至 2026-10-15：插件已实现，GLM 团队全局多 provider 关联已接入并实测有效额度。** 目标是纯插件显示当前 provider 的套餐额度，在统计行费用之后；不感知 profiles。

- [Q：需求和事实](principles.md)
- [Architecture：性质、组件与组合论证](architecture.md)
- [Detail：各函数/接口合同与正确性论证](detail.md)
- [Evidence：源码与请求依据](evidence.md)
- [Correctness：全局完成门与事实缺口](correctness.md)

主路径：当前模型 → my-settings global 团队关联（优先）／API＋端点路由和模型认证（未关联时）→ 对应适配器 → 当前世代发布 → `ctx.ui.setFooter()` 绘制原统计与费用后用量。团队字段见 [README](../README.md#glm-团队配置)，不使用项目/session 配置。**所有运行代码只在 `my-plugins/provider-usage/`。**

真实边界：`setFooter` 完整替换原生 footer；扩展无法读取原生内部的实时 `(auto)` 状态，不能承诺此标记的原样保留；另一个自定义 footer 也无法与之自动合并。国内团队四账号各自认证 key 的查询已成功，32 项测试及真实 Pi 切换账号、详细命令与重载展示均通过；国际/国内个人套餐成功额度仍待实测，不扩大已验证范围。
