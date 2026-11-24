# A方案失败路径与SCCO — 修复后处置记录

状态：PARTIAL，不是机器证明，不宣称所有环境/所有输入已证明。规范源为 ../../official-catalog-sync.md 与 ../../model-discovery/robustness-and-proof.md；原始独立逐函数路径表见 hoare-scco-original.md，按当时revision保存，不重写历史结论。用户亲验未发生。

## 原始路径表的适用边界

独立reasoner对源码scope做了逐函数/分支/循环/await分析，但部分宿主前提核的是仓库1.5.2依赖，不是实际安装1.6.0；它未逐行核对每个测试断言，且漏了headers之后正文deadline缺口。不得直接沿用它“全部源码义务成立”的措辞作为最终证明。下表是主会话基于直接源码和反例测试的处置，不是新一轮独立审查。

## 已处置反例及代码依据

| 义务/反例 | 代码锚点与状态推导 | 直接证据 |
|---|---|---|
| dispose后新compose复活 | catalog-owner/createCatalogOwner持closed；compose入口和await readCatalogCache后都检查closed，返回original；attach关闭后no-op，不能创建新runtime或重新绑定hooks | owner新增关闭前/中/后compose测试通过 |
| 重复dispose改变代次 | dispose先if(closed)return；首次置closed后使runtime失效再abort，重复不再次遍历或递增 | owner/refresh关闭回归通过 |
| 无body读取无界text | catalog-fetch/readBoundedBody无reader直接invalid；没有text全量回退 | 合法Response(null)直接测试通过 |
| headers到达后body永久挂起 | once在try内await respond/body，finally才清deadline；body持组合signal，abort主动cancel reader；按外部信号→disposed，否则deadline→timeout分类 | 可取消ReadableStream和真实localhost挂起HTTP反例均通过；Docker对应场景通过 |
| 16MiB边界 | readBoundedBody逐chunk累加byteLength，超限cancel且invalid，不提交overlay；恰好上限正常JSON解析 | 单测边界及宿主/Docker实际大body通过 |
| 500后429警告消失 | catalog-refresh失败key含source+result.kind，成功resolve清该source所有错误key；同类别连续错误期仅一次 | refresh测试分别验证http和rate-limit各一次、重复429不刷屏 |
| 生命周期重启看见旧会话未见模型 | 私有cache先rename成功，再检查owner代次决定是否更新旧内存；关闭可截断内存发布但留下完整已验证快照；新owner再次验证读取是设计允许行为 | Fuzz重启合法来源断言：仅base或本序列实际提供的takeoverId，非任意缓存ID；原来“必须旧内存见过”预期撤销并说明原因 |
| 正常流程不报警 | 初装missing/fresh/合法304/明确禁用不是错误，实际错误按来源分类警告；输出失败不穿透 | 保留256×32混合序列，另加16×32只含正常操作的序列，不依赖随机碰巧避开故障；静默断言通过 |

## 原始行为回退链（按代码路径而非catch自述）

- source不适配/禁用/owner已关闭→compose返回原实例；source、原auth/stream/filter的定义不改变。
- 缓存ENOENT→原目录且保留将来更新能力；损坏/错来源/不可读→miss并告警；不改账号、配置或原模型。
- 网络/HTTP/429/解析/写失败→不替换lastGood，仅更新退避及警告；getModels仍能返回原实例官方列表和此前有效overlay；原transport错误不被发现逻辑catch成成功。
- publish=false/宿主abort/owner迟到→不发布新状态；cache-only不启动网络，onUpdated只做限定实例的allowNetwork=false同步，无网络递归链。
- 私有cache写temp/rename失败→尽力删自身temp；残留名字不被reader当有效快照。rename已完成但owner关闭→文件可存在，新进程必须重验；不写官方models-store/models.json/auth.json。
- 正常warning输出若UI不可用走安全stderr；stderr环境完全不可写时无法保证物理可见，这属于明示输出环境前提，不允许因此中断原账号。

上述返回/错误类别的原始逐函数覆盖见原报告；修复后函数锚点优先于旧行号。测试为反例检查，不是“所有输入”证明。

## SCCO处置

Sound：只取pi.dev同source官方模型，端点/API/归属验证，元数据不手抄；原凭据/transport保持。本次实际Pi1.6.0可启动、选glm5.4、切档及真实read调用，支持被测接线事实，不推出所有协议/账号均可用。

Complete：直接回归、10,500输入/归并、256×32混合+16×32正常序列、128host+128Docker网络故障已跑。仍未证明全体账号/全部厂商模型、每个测试断言与所有源码路径一一对应、所有跨进程中断时序。用户亲验、持久会话完整resume（不仅fresh启动选择）待补；不能写PROVEN。

Concise/Orthogonality：A只同步官方，不启用旧discovery，不新增virtual/桥接/第二套凭据；身份创建与目录更新分离。错误不会授权自动切换账号或模型。

Optimality：Profiles创建前已拥有实例，用原实例组合官方目录避免全局注册抢占，不改Pi核心或用户凭据，也不要求为builtin额外登录。已无理由继续为GLM5.4开发外部目录发掘。

## 未闭合项

- 原报告宿主依赖版本差异不能靠真实一次调用彻底抹平；实际安装版关键cache/refresh接口此前已读且实际运行，但还不是所有外部API路径的完整1.6.0逐行复证。
- Fuzz恢复计数采用fixture响应语义，不能当成磁盘提交原子性的完整证明；多进程故障组合未穷尽。
- 输入compat部分字段透传的类型覆盖、私有缓存先readFile再检查长度、整体文件/测试大小纪律仍需作为已知实现边界看待，不把本文件当额外豁免授权。
- 自然语言Hoare不等于形式化验证；现阶段足以给出具体已测回退依据，不满足用户最强“每一条路径严格证明”的全称声明。保留PARTIAL给用户审核。
