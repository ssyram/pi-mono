# /save-msg ~/ 修复：代码级计划（已按用户批准实施）

当前结果：共享路径函数已接入，帮助与两处合同已更新；新增output.test.ts共7项实际写入/剪贴板隔离测试，连同原有测试3文件38/38通过，Loop共享路径回归5/5通过。output/helper/新测试在严格选项下tsc通过，3个改动源码/测试Biome通过。全插件严格检查另有既有UI类型/索引诊断，根npm run check仍停在其它快照的pinned-deps；未扩大修改。没有实际reload或TUI试用，以下保留实施前预算与范围。

## 结论与范围

只修输出路径的home展开，生产逻辑改两个文件，共2行替换、1行帮助说明。默认保存和picker已共同调用outputResult，不分别改handler或TUI。共享resolveUserPath已实现，不新增依赖、解析器或路径模块。下表为功能代码预算，不是假称已有diff；新增测试行数为估算。

## 逐文件改动

| 文件（相对仓库根） | 当前行数 | 预计改动 | 做什么／为什么必须改 |
|---|---:|---:|---|
| my-plugins/save-msg/output.ts | 25 | +2 / -2，净0 | 删除node:path的resolve导入，导入../file-path/resolve-user-path.js；const abs改为resolveUserPath(filePath,cwd)。这是写错~/位置的唯一根因入口，默认与picker一起生效。 |
| my-plugins/save-msg/command.ts | 91 | +1 / -0 | HELP增加“相对路径基于当前cwd，~/基于当前用户主目录”。只更新帮助字符串，不改变参数分派。 |
| my-plugins/save-msg/output.test.ts（新） | 0 | 约+80 | 临时HOME/cwd，真实调用parseArgs→outputResult写文件，断言实际位置和内容；避免仅测路径函数却漏接线。复用现有Vitest，不增加loader。 |
| my-plugins/save-msg/docs/design/save-msg/architecture.md | 69 | +2 / -1 | 修改PATH语义那一处：relative/absolute/~/，不复制整份设计。 |
| my-plugins/save-msg/docs/design/save-msg/detailed-design.md | 92 | +1 / -1 | outputResult的Post将resolve替换为resolveUserPath，append/overwrite/clipboard契约不变。 |
| my-plugins/file-path/resolve-user-path.ts | 12 | 0 | 直接复用已测实现；不再写一套expandHome。 |

生产功能代码预计+3/-2；新测试约80行；另有两处文档修正。不以格式化或无关清理扩大此次修复。

## 精确接线

```ts
// output.ts：替换已有导入和那一个路径解析表达式
import { resolveUserPath } from "../file-path/resolve-user-path.js";
const abs = resolveUserPath(filePath, cwd);
```

abs仍传给同一个writeFile，flag仍是append ? "a" : "w"；成功和失败通知仍报告实际绝对路径。无路径的pbcopy分支不变。

## 必须运行的测试

新增output.test.ts约6项／参数组：

1. parseArgs("~/out.md")保留字面路径，再由outputResult真实写进临时HOME；cwd下不出现~目录。
2. 相对路径仍写临时cwd；绝对路径仍写指定目标（表驱动两组）。
3. 同目标覆盖、再append，逐次检查内容，证明写入flag没改。
4. Unicode文件名写入成功；不把这当CLI带空格引号支持。
5. 父目录不存在时仍warning且不自动mkdir。
6. 省略路径时用已有Vitest mock隔离execSync，只检查pbcopy分支，绝不动真实剪贴板。

测试用vi.stubEnv设置临时HOME（POSIX目标），afterEach恢复环境和删除本次目录；文件写入不mock。另跑已有save-msg.test.ts、tab-complete.test.ts和Loop的script-path.test.ts，防止共享helper语义回归。预期在插件目录运行：`node ../../node_modules/vitest/dist/cli.js --run output.test.ts save-msg.test.ts tab-complete.test.ts`；随后规定的npm run check，外部既有阻塞单独报告。

## 明确不改

parse-args.ts（37行）已经接受以~开头的裸路径；message-list.ts（198行）直接把同一个opts.path/cwd交给outputResult。它们修改0行。turns、viewport、index、补全、文件覆盖策略均不改。不扩展$VAR、~user、shell/glob、不自动建父目录，不新增home参数或配置。

当前parseArgs按空白分词；本次不顺便增加带空格路径的引号语法。共享helper的纯路径覆盖已存在，不重写一批同义测试。不新增审查、真实模型调用或tmux流程。用户随后明确批准第2项，本计划已实施；未据此授权或实施第3项Loop多脚本接线。
