# Task 设置：直接依赖 my-settings

## 用户裁决

不实施独立的“人工 off 先改内存再保存”补丁。Task 的配置统一由 `my-plugins/my-settings` 管理，使用 `omp-task:XXX` 命名空间；任务记录/依赖/ID与 Boulder 运行抑制信号是业务状态，不迁成设置。其他 OMP 子系统的分类/agent 配置不属于本次 task 设置迁移。

| key | 默认值 | 用途 |
| --- | --- | --- |
| `omp-task:no-task-no-tool` | true | 非 task 工具须有进行中且未阻塞的任务 |
| `omp-task:show` | true | task widget 显示 |

两项使用相同命令范围：

```text
/task no-task-no-tool on|off [--persistent] [--global]
/task show on|off [--persistent] [--global]
```

默认仅 session。`--persistent` 额外写项目 `.pi/settings.json`；`--global` 额外写全局 `settings.json`，不隐含 local。两标记可组合、顺序不限，每个最多一次。指定的文件层依序尝试，最后恰好一次 saveSession；不调用组合 API 导致重复日志。文件失败不阻止 session 步骤；结果明确列出成功与失败的层，既不假称存盘成功也不假称回滚。

## 查询与生命周期

`my-settings` 按 defaults < global < local < session 当前分支的合法补丁合并。Task 直接调用服务，不再读写 `task.json` 或 `omp-task-widget-state`，不保留兼容/双读/自动迁移副本。旧文件和历史日志不删除，但不再生效。

OMP await my-settings factory 后注册消费者。门禁每次在 try 内 await 查询，无会话布尔缓存；exact task 在查询之前获豁免。服务缺失/会话失效返回明确拒绝和安装/不可用提示，不伪造默认成功。来源坏字段/坏文件按 my-settings 已定合同诊断并忽略，不由 task 再加另一套优先级。

widget 在 start/tree、task 变更和 show 命令后读取当前设置；异步刷新在自己的边界包含失败，使用查询返回后的当前 task 状态，不用旧任务数组。show 命令只在 session 保存成功后更新显示；显示失败不撤销已保存设置。服务 ready 是生命周期通知，不新增 settings change 订阅或新全局 registry。

## 失败与边界

消费者返回显式 Result，不主动 throw/rethrow。SDK和未知委托异常仍在真实 callback 内捕获，诊断自身安全。文件原件坏了不覆盖；session append 也失败时不能承诺当前设置已应用，可能的部分效果如实说明。未持久化的 session 设置在其分支日志内有效，不等于可以忽略宿主 append 故障或强行保证底层写入成功。

用户要求通畅：空会话可创建/启动第一项 task，配置服务故障不拦 task 自身；显式设置 off 成功后不调用 task-state reader 来判准入。保存失败返回结果，不用抛异常拒绝。若 SDK 的整个 branch 读入也失败，my-settings 不能保证 session 层可读；不能将只测试 task-state reader 抛错升级为底层全部 I/O 故障均可恢复。真实 SDK加载/用户验收与源码直接测试分开结算，不自动 reload/commit。

## 实际运行依据

从仓库根执行：

```sh
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/ts-resolve-hook.mjs --test my-plugins/oh-my-pi-v2/test/task-system-*.test.ts my-plugins/oh-my-pi-v2/test/task-*.test.ts my-plugins/oh-my-pi-v2/test/boulder-*.test.ts
# 191/191
node --experimental-strip-types --import ./my-plugins/oh-my-pi-v2/test/cca4-sdk-loader.mjs --test my-plugins/my-settings/test/*.test.ts
# 63/63；loader仅重导出真实SDK配置/文件队列，不mock配置服务。
node node_modules/typescript/bin/tsc --project my-plugins/oh-my-pi-v2/tsconfig.task-system.json
# exit 0；19个改动/新增TS文件scoped Biome无错误、警告、info。
```

包含两命令的标记组合/唯一性、默认不写文件、仅指定文件保存且保留其他字段、坏文件不覆盖但session步骤仍执行、append失败显式结果及可重试、替换session/切branch不复用缓存、服务缺失仍豁免task、真实service+task owner首次创建启动，以及异步widget拒绝不外逸。

原生直接运行my-settings全套曾有4个文件在旧SDK barrel导入时报缺`@mariozechner/pi-ai`；改用上述真实SDK窄导出后63项通过，未修改SDK或my-settings生产源码。Node26旧loader的DEP0205弃用提示保留。根npm run check已执行完整输出，停在其他工作历史快照的非精确依赖；扩展入口tsc仍因built SDK缺agent_settled失败，不冒称全部检查通过。
