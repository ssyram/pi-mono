# 首次提交前检查

## 范围

仅 `my-plugins/fsm-compatible/`。本机配置 `fsm-compatible.config.json`、`node_modules/`、`.runtime/`、`_cca_analysis/`、测试临时目录不提交；提供配置示例，保留源码、锁文件、必要文档和运行依据。根 `.pi/AI-learning.md` 含其它会话改动，本次不整文件提交。

## 直接修正

- README移除过时的pi-subagents必需依赖、固定旧FSM版本及同步child返回描述，明确当前v3覆盖和已知边界。
- `src/index.ts` 改为纯re-export，工厂迁到`src/extension.ts`；必载扩展身份指向真正入口而非runtime模块。
- Agent预绑定失败不再吞错继续启动；HTTP非成功或无`ok:true`的预绑定响应也不确认启动。
- 新增`agent-tool.test.ts`：四个Agent别名的预绑定失败均传播，且不spawn。

## 实际检查

- 插件`npm run check`通过。
- admission/runtime/protocol/judge/gates/children/watch/assembly/commands九组共126项通过，0失败、0跳过。
- 独立真实FSM重复permission/Stop时延回归通过，main与child各三次检查约0.69–1.02秒（并行运行其它本地检查时），未重现10秒TTL等待。
- `src/index.ts`实际导入并导出可调用工厂，入口加载通过。
- 待提交文本中的高置信凭据模式扫描无命中；该检查不构成全面安全审查。
- 根`npm run check`：Biome检查1868文件通过、无写回；后续`check:pinned-deps`被两个旧快照目录中的既有`^1.x`依赖版本阻塞，后续根检查未运行。未修改这些范围外的文件或放宽检查。

## 保留边界

最新完整CCV v3场景的90秒结果及已知B62裸写边界见`ccv-latency-investigation.md`第9节；它不是15态完整验收，也不是本次入口整理后的新一轮整机测试。主FSM转移耗时仍待分段定位。

当前main还含一个既存未推提交`f3d83b47b`（task/settings改动）；直接push main会一并发布，不能声称只发布本插件提交。

首次执行`git commit -m "feat(coding-agent): add FSM server compatibility plugin"`时，pre-commit中的根检查在`check:pinned-deps`失败，hook退出1，未产生提交。随后owner明确授权：无关问题直接`--no-verify`，有关问题必须修复。本轮插件相关修正和直接检查已完成，因此本次提交按该授权跳过被无关旧快照阻塞的hook；不将其记录为根检查通过，也不修改范围外依赖。暂存213个文件全部位于本插件目录（约3.1MB，含首次实现与历史材料）。最终提交与push结果以Git回执为准。
