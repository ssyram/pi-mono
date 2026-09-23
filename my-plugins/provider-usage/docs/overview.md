# Provider Usage — 设计入口

**截至 2026-09-23：设计稿，未实现。** 目标是纯插件显示当前 provider 的套餐额度，在统计行费用之后；不感知 profiles。

- [Q：需求和事实](principles.md)
- [Architecture：性质、组件与组合论证](architecture.md)
- [Detail：各函数/接口合同与正确性论证](detail.md)
- [Evidence：源码与请求依据](evidence.md)
- [Correctness：全局完成门与事实缺口](correctness.md)

主路径：当前模型 → API＋端点路由 → 当前模型认证 → 三家中的一个适配器 → 当前世代发布 → `ctx.ui.setFooter()` 绘制原统计与费用后用量。**所有运行代码只在 `my-plugins/provider-usage/`。**

真实边界：`setFooter` 完整替换原生 footer；扩展无法读取原生内部的实时 `(auto)` 状态，不能承诺此标记的原样保留；另一个自定义 footer 也无法与之自动合并。国际/国内 Z.AI 的目标账号及精确非套餐响应尚缺实际证据，不伪称支持已验收。
