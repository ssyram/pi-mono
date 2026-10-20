# save-msg ~/ 路径修正方案（workflow §7.1）

## 1. 现象与复现

用户报告 `/save-msg ~/...` 不接受正确主目录语义。出错路径 `my-plugins/save-msg/output.ts::outputResult`，直接 `resolve(cwd,filePath)`。最小纯路径复现：cwd=/work/project，home=/home/me，filePath=~/out.md；现有resolve得到/work/project/~/out.md，预期/home/me/out.md。实际写文件会失败或写错位置，取决于cwd下是否已有~目录。本阶段不运行真实save-msg命令或写用户home。

## 2. 根因

Node path.resolve不执行shell tilde展开；路径既未经过shell，也未在输出边界先展开。修复不是让shell代写文件，而是在路径解析入口统一正确语义。

## 3. 参考实现

非算法Bug，算法参考对照N/A。Node path/os接口为参考：homedir提供当前用户目录，resolve只规范路径；Boulder无相关路径职责。原有save-msg架构只定义相对ctx.cwd，需在接线阶段补上~语义。

## 4. 修复方案

基础设施：新增 `my-plugins/file-path/resolve-user-path.ts`，先识别~和~/，再resolve；同时供新Loop规格准备使用。用户随后批准接线：save-msg/output已将resolve替换为该函数，默认与picker共用outputResult，无须分别修复。不要引入shell、$VAR、~user、自动mkdir或新的覆盖策略。

## 5. 正确性论证

根因消除：~/经过显式home展开，不再作为cwd下普通目录。保持不变量：绝对输入仍不加cwd，相对输入仍基于ctx.cwd，append与overwrite/clipboard不变。无回归：路径纯函数测试覆盖上述三种与空格/Unicode/额外斜杠。现已接入outputResult，并由真实临时HOME文件写入回归通过；不以纯函数通过替代输出接线。当前运行会话尚未reload，不冒充live试用。

## 6. 测试清单

回归：~/out.md与~；新增：absolute、relative、../、space/Unicode、~//后缀、字面$VAR/~user/glob、输入不变。基础设施本阶段执行；未来output接线后用临时home/cwd的实际文件写入回归，不写真实用户文件。

## 7. 代码更新清单

| 文件 | 改动 | 状态 |
|---|---|---|
| my-plugins/file-path/resolve-user-path.ts | 公用纯解析 | 已实现并测试，不重复开发 |
| scheduled-wakeup/test/script-path.test.ts | 路径回归 | 已实现并测试 |
| my-plugins/save-msg/output.ts | 替换解析入口 | 已按用户批准接线，输出回归7项通过 |

具体逐文件行数、2行接线替换及真实写入测试预算见 `my-plugins/save-msg/docs/design/save-msg/path-fix-code-plan.md`；随后用户已批准并实施output.ts接线，3个Vitest文件38项通过；第3项Loop接线仍未实施。不提交，不回填虚构commit。

## 8. 文档更新清单

本方案及基础设施设计在本阶段落实；save-msg architecture/detailed-design/help在运行接线阶段同步~支持。现有save-msg文档属于尚未改变的生产行为，不提前宣称Bug修复。expectations §9约束本阶段不接线。
