# FSM-03：真实子会话、OC/Pi对照与CCV交付测试修复

## 结论与版本

本轮“测 & 修”完成了固定场景下的真实入口约束、持久子会话、OC/Pi行为对照和独立合法失败交付；不构成全部OC行为、全部CCV状态或真实模型判断正确性的证明。

最终测试源码 SHA-256：

```text
7852534b5dbad16a40cc12bab58a43239f83441677dacd5429acc6c15167ffd0
```

runner按相对路径及文件内容计算 `src/`、`test/`、`scripts/`、`package.json`、`package-lock.json`、`tsconfig.json` 的有序hash；不包含后补的本报告、README或WS。基础Git HEAD为 `cf5e5872f6147c07edf8074d29c681e2f7edbfbe`，**本轮改动未commit/push**。

环境：macOS arm64、Node26.8.1、官方Pi1.3.0、FSM wire7、OC `1.18.31-fmv3-beta.14`、本地mock-with-pi。manifest保存实际二进制与catalog的hash，不能从源码版本或二进制名字倒推运行身份。

## 最终运行结果

同一源码快照，命令均退出0：

| 命令 | 实际范围 | 结果 | 命令耗时 |
| --- | --- | --- | --- |
| `npm run check`（插件目录） | strict tsc | 通过 | 2.873秒 |
| `npm run test`（插件目录） | admission22、runtime37、protocol15、judge16、gates8、children12、watch7、assembly5、commands4 | 126/126，无skip | 14.535秒 |
| `npm run test:native` | 真实Pi/FSM/mock及子Pi进程 | 21/21，无skip | 129.215秒 |
| `npm run test:parity` | 同FSM/输入/动作的真实OC与Pi | 1/1，无skip | 94.137秒 |
| `npm run test:ccv` | 原版v3、独立失败交付 | 2/2，无skip | 74.559秒 |
| 真实daemon时延专项 | 连续main/child permission和Stop | 1/1，无skip | 用例1.656秒 |

普通children组含历史实现的独立模块测试；**当前原生入口的证据是21项真实进程测试，不以旧模块测试替代**。共151项测试通过，但这个总数不是151种独立业务保证。

OC对照在模型工作前两次启动超时。fixture关闭各自拥有的进程并保留两份失败目录，第三次启动后完成全部比较；不是首次启动成功，更不是忽略断言失败后重试。

时延专项中每组三次检查累计：main permission373ms、Stop384ms；child permission375ms、Stop375ms。普通hook不再错误地写MCP pending identity槽，实际MCP仍走source读回、identity acquire及consume。

## 真实修复与对应证据

- 原native Agent实际接受未列入名单的 `subagent_type`。新路径冻结每root策略，接入实际admission；非法类型在actor acquire与spawn前拒绝，配置更改不能扩大已持久化会话权限。
- 旧路径只转发父CLI扩展。新路径生成静态必载bundle，FSM factory最后运行；CLI和项目级加载均测试。缺文件、factory/session_start失败、超时及取消均不能返回启动成功。
- 旧detached print模式改为持久Pi RPC。等待实际session/model/thinking与bootstrap ready；`agent_settled`才最终回报，自动重试中的 `agent_end`不冒充完成；处理 `handled` 与真正开始的区别。
- child实际session ID与actor ID一致，递归共用根协调器；测试root→child→grandchild、深度限制、child实际禁写、消息/list、真实shell取消、启动取消和后代级联停止。
- 父进程重启原先丢child。保存非秘密快照并恢复；child crash/stop后可恢复同session。对可能仍存活的旧PID保守拒绝重复启动，不kill未证身份进程。`/new`关闭旧root资源，不继承旧注册表。
- `/new`原先与自己注册的FSM工具冲突。只允许同extension source的自有重注册，保留外部名称冲突拒绝。
- 实际对照暴露共享root的source PID竞争：child和parent各自登记导致父MCP通道读回另一个存活PID。修为root统一登记source、按actor维护通道并代理child的鉴权FSM调用；增加child异步完成后parent通道继续使用的真实回归。
- Bash使用支持取消的宿主实现；bridge环境按会话传入，不修改跨session的全局 `process.env`。
- 安装计划与README已同步原生协调器，不再错误要求pi-subagents；状态移到Pi agent目录，bootstrap凭据不落业务Git工作区。

## OC/Pi对照的固定判据

两端使用同一FSM服务/客户端二进制、同一skill定义、空初始业务文件及相同mock动作，各自独立workspace/data-dir。只适配启动结果的文本/JSON形状、ID及路径；不改门禁期望。

比较main和child检查账本、`main-ok`、`child-ready`、`child-ping`、`release-parity`四个实际文件内容；确认禁写与未派发child无文件副作用；验证消息确实收到，最终两个actor均回 `_default`。禁止仅凭模型“成功”措辞判定。

OC宿主内部Stop评估使用原smoke方式的脚本化 `wait_async` 决定，judge/watcher为mock verdict；不宣称测试了真实模型的判断能力或所有邻居可见性、名字歧义、版本与平台组合。

## CCV两条独立场景

### 原版v3

冻结复制上游mocker目录中的原 `.py/.c/.md`，只用Pi adapter设置隔离环境并调用原 `scenario_ext_v3.main()`；不修改原动作、断言或外部OC脚本。

最终同快照用例约50.895秒通过，main按原定义留在 `V_A_LOOP`；child按原剧本格式负例、修正、终结及退出。这个端点就是v3原范围，不是未执行完的 `V_DELIVER`。

### 独立诚实失败交付

用clean CCV framework clone和正式workspace installer建立私有工作区。使用真实已安装fcil/CompCert及Clight helper，不伪造frontend回执或直接改FSM状态。

固定输入是不可替换、缺右花括号的direct `.i`，目标为 `memory_safety`：

1. 正常 `V_A_INTENT` 边由真实frontend syntax error拒绝。测试要求具体syntax原因，不能用缺工具链或配置的INFRA拒绝充数。
2. failure边真实生成并锁定canonical `failure-evidence.json` 和报告机器骨架，合法进入 `V_FAILED`。
3. 故意清空唯一人工原因正文并提交；即使mock提交满意的自检声明，`failed_report_check`仍因 `must be non-empty` 拒绝 `V_DELIVER`。
4. 保持证据hash、分类、reason-code和UNVERIFIED exact-set不变，仅补全具体原因；按实际白名单分别执行git add/commit/rev-parse，重新自检后合法进入 `V_DELIVER`。
5. 自检并 `exit_fsm` 回 `_default`；确认真实frontend run存在且不产 `proof/vst/cert.json`。

最终用例约20.955秒。soft review和watcher verdict为受控脚本判定；hard-check脚本、frontend、Git与FSM迁移真实执行。**此路径没有建立任何verification target，不是V_VERIFIED或形式化成功证书链。**

## 六层能力范围

| 层 | 本轮能支持的结论 | 不能推出的结论 |
| --- | --- | --- |
| 名称/参数 | 已覆盖Pi/OC/CC常用工具归一及当前实际调用 | 外部apply_patch执行、多文件patch逐路径鉴权、任意编辑语义等价 |
| 通信/身份 | 当前root/child实际actor、source及MCP通道在固定场景可连续工作 | 任意FSM版本/平台或故障注入全域成立 |
| 门禁/迁移 | 实际允许拒绝、非终态Stop续跑、self-check及hard gate拒绝/修正 | FSM是OS sandbox；Stop transport错误fail-close（实际仍soft-pass并警告） |
| 子会话控制 | 21项真实入口约束及生命周期用例通过 | 所有OC Agent/list/send/stop边界、所有可选第三方扩展均等价 |
| judge/Watcher/记录 | 当前协议、真实child历史/鉴权及mock结构化回执集成可运行 | 真实模型评审正确性、完整OC辅助会话行为全覆盖 |
| 工作流 | 原v3端点和独立诚实失败交付可运行 | CCV全部15态、V_VERIFIED/cert成功链、任意复杂项目证明完成 |

B62在途裸写仍是已披露行为，不能把两端一致允许当作安全。历史57.149秒迁移内部开销仍未分解；新版总耗时不是其具体原因的证明。

## 根检查与产物边界

根 `npm run check` 实际运行：Biome1684文件无修改，pinned/runtime dependencies、TS imports、entry graphs及coding-agent install-lock通过；随后官方 `packages/ai` Azure/model类型错误导致根tsc失败，browser smoke未执行。没有修改官方源码来换绿；不能宣称根check全绿。

所有本轮代码/文档产物在 `my-plugins/fsm-compatible/`。无真实付费模型调用，无新独立审查，无本轮commit/push。当前host实际要求Pi1.3.0；包内历史SDK/type pins1.0.3不构成旧宿主兼容保证。

私有证据根：`.runtime/final-20261021-2/`，含 `summary.json`、各命令日志和native/parity/CCV的manifest、session、captures、FSM归档。每次case独立进程、目录和端口；只关闭拥有的进程。**raw bootstrap、captures和环境可能含凭据，不可直接提交。**本报告仅摘取非秘密结果。

复跑参数见README的 `test:native`、`test:parity`、`test:ccv`；runner缺必要输入会明确失败而非skip。
