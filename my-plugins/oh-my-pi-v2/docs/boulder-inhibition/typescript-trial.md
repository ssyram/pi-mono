# TypeScript 前端与历史 CCA 运行依据

该文档保存准备试跑及两次旧运行的边界；当前接入代码的增量分析见 [delivery.md](delivery.md)，不能把历史结果升级为新源码保证。

## 初始试跑

`gen_manifest.py` 对当时的 boulder-inhibition 11个TS文件返回 exit 0、零函数，前端语言 unknown。同环境已有语言fixture能够抽取函数，故问题为未注册TS而不是可据exit0判成功。先阻止空工作集，后经用户批准添加TS能力。

## 已添加、尚未提交/发布的支持

外部工具仓：`~/workspace/work-fv/c-code-verify/.local/analysis-decouple`。

- gen_funclist：`.ts`与tree-sitter-typescript，declaration/method/constructor及arrow/callback抽取；不把interface当实现。
- gen_callgraph：TS与非TS候选隔离，不改SCC核心/已有输出格式。
- dependency：`tree-sitter-typescript==0.23.2`。
- 新TS fixtures和两组测试；历史原funclist/callgraph及manifest 45/45 GREEN，新语言/混合同名测试GREEN。
- 当时真实输入生成19函数、18外部、26边。

明确未实现：import alias精确解析、嵌套调用只归属内层、`.tsx`；名称近似匹配可能产生噪声边、漏派发边，必须在实际分析中作为缺口处理。方案中这些更强能力没有因函数数非零自动成立；不冒充完整TS语义前端。

## 已结束的旧运行

- boulder-ts-cca1，4217，root `ses_ed0b270baffePY805GMZWprkat`：19函数/18外部、goal/self-check/reachable。开始时OC缺Pi模型key、python环境/工具白名单失配，按授权处理后完成；不改写失败历史。
- boulder-ts-cca2，4218，root `ses_eccc5ba56ffehpGvoAVhXK8Yw2`：22函数/19外部、goal/self-check/reachable/coverage。分析当时的Result独立模块，条件无外逸结论之外指出敌意错误String转换风险，后由describeThrown及直接测试修正。
- 两次task-owned服务已停止，旧产物保留在 `_cca_analysis/` 与 `_cca_analysis.run1/`，均不是新adapter/命令/lifecycle/completion的覆盖证明。

模型按用户要求采用 `tmp-haokun/glm-5.3-flash`；凭据曾按授权由Pi `tmp-Haokun`迁入隔离OC auth，未在日志/参数输出。真实请求成功不等于后续无额度/认证故障。

## 能力界限

CCA产物是自然语言契约/异常路径/资源并发推理与风险证据，不是机械证明，不宣称天然强于HoarePrompt。覆盖门证明所选manifest工件结构而不是语义必真。当前增量运行必须绑定当前源快照和受影响边界，不重用旧通过自述。
