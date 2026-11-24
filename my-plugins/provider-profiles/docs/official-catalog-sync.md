# Profiles 官方目录同步 — A 方案实施合同

状态：用户已明确批准“只修 Profiles 同步官方在线目录”。本文件是当前范围的权威设计，取代 model-discovery 的外部发掘路线；不删除旧工件、不改 Pi 核心或用户配置。原账号原则、错误警告及回退、Fuzz/Docker、SCCO/Hoare和真实验收仍有效。

## Q：结果和范围

具名Profile直接继承对应官方在线目录，不需要用户给内置provider重复登录，也不借用内置或其他实例凭据。只GET pi.dev公开目录，不请求models.dev、厂商/models或官网抓取。官方已有GLM-5.4，应正常可选、可用并显示正确thinking/context。

最高非干扰合同：同步失败警告并维持原目录/最后有效官方overlay，原auth/transport/filter/安全modelOverrides/原错误语义不变。不假称新增在线目录模型能立即远端调用成功，真实使用单独验证。

## P/M：接线与数据

原校验→instanceProvider→await composeOfficialCatalog(original, sourceId, owner)（本地缓存）→原native注册。启动factory与/add-login共用此函数。未适配/关闭/创建异常返回original；cache miss初始目录为原目录，但保留后续联网刷新能力。

O为original.getModels每次实时结果，D为有效官方overlay；同type/id用D覆盖O（与Pi官方overlay一致），按实例ID重戳。不是把官方更新当外部补充，也不手写GLM模型字段。用户modelOverrides在宿主最上层继续生效。

首批覆盖当前Profiles支持的静态官方来源；官方目录404/501作为无可用更新，保留原模型，不把账号列为不支持。动态闭包来源仍按原规则排除，不扩大账号支持集。来源URL按原sourceId固定生成，不按profile名生成。

CacheV1={version:1,sourceId:string,apiSet:string[],baseUrl:string,models:Model<Api>[],checkedAt:number,lastModified?:number,etag?:string,retryAt:number}。不含凭据/env/额外请求headers。文件只用经原source分类确认的sourceId，置于宿主getAgentDir下provider-profiles/official-catalog/，不写官方models-store、models.json、auth.json。公共目录按来源共享缓存；任务、代次和owner只在本factory内，不建跨会话全局可变状态。

接受overlay条件：cache/response schema通过；模型provider与sourceId匹配；chat类型；API在原实例可处理的api集合内；端点不改变原source的已核端点；context/maxTokens正有限数、cost合法、thinkingLevelMap和compat字段按真实SDK类型验证。任何wire坏数据不得进入原调用路径。采用Last-Modified新于bundled generation的版本规则；不可采用的快照不作为官方模型。缺ETag正文时不发validator；304无有效body最多重取一次无条件GET。

## D：叶子契约与失败路径

1. resolveCatalogSource(original, sourceId)：验证既有来源、API和固定pi.dev URL；失败/未适配返回undefined，无副作用，无端点替换。
2. readCatalogCache(path, source)：本地读取/验证→hit或miss；ENOENT是正常miss；坏/错来源/不可读为警告miss。原目录保留，不能永久禁用更新。
3. parseCatalog(unknown, source, version)：wire/cache边界，对齐官方接受array、{models:array}或普通模型对象映射（Object.values），每条模型仍须校验，不把任意对象当有效空目录；有限遍历，未知operation不进chat。验证输入而非对typed内部值反复形状检查。非法整体拒绝，不将错误响应转为空目录。
4. mergeOfficial(base, overlay, instanceId)：有限纯函数，输入不变；同type/id官方新overlay优先，原未更新模型保留；最终provider=instanceId，元数据不手工转录。overlay无效时与原实例目录值等价。
5. writeCatalogCache(path, data, signal)：0600唯一temp→检查owner代次/取消→rename；失败旧文件保留、尽力清理本temp；只私有完整快照，不宣称rename解决用户配置事务。多进程只能读到完整已验证快照。
6. composeOfficialCatalog(...)：await只本地cache，保留id/auth/headers/baseUrl/stream/streamSimple/filter；只组合目录和实例专用refreshModels。原refresh若存在先委托，原失败原样，不吞官方错误。装配失败原实例仍注册。
7. refreshModels(context)：cache-only只publish(update)，不persist本目录到官方store。network阶段TTL=4h到期或force时启动单飞后台GET，不携带credential/env/原账号headers，不等待公网阻塞cache返回。10s总请求截止，16MiB逐块上界，401/429/5xx/截断/超时不改lastGood；失败retryAt至少60s，Retry-After受界限制。
8. 后台提交：每个await后检查active/generation；先验证和私有cache提交，再替换lastGood；session_start attach的onUpdated仅执行限定实例registry.refresh({allowNetwork:false})同步snapshot，拒绝仅警告保留下次普通refresh同步；cache-only不创建job，故无网络递归链。初始化阶段没有registry，不提前调用它，不事后setModel。
9. dispose：先失效owner/generation后abort任务；目录函数退回original；旧任务不能重新发布，私有残留只能被本插件下次验证读取。重复调用no-op。显式PI_PROFILE_CATALOG_SYNC=0禁用新增功能，不禁用Profiles身份。
10. warn：安全非秘密分类、每source/连续失败期去重；无UI暂存，attach后notify，print用安全stderr；输出失败不throw。fresh、初装missing、正常304、明确禁用不是error。原auth/transport本身报错原样，不重发请求/切号/换模型。

## R：保证和边界

创建者已有原实例，故注册前cache组合无需事后抢同名注册。目录数据只来自同一官方source，官方更新按其版本规则合成，用户覆盖仍归宿主。所有同步状态归owner，网络/磁盘失败不改变原身份与transport，私有残留不被官方层读；这回答旧功能非干扰义务。现有createModels/faux机制exit0只证明组合原语，不能替代本实现逐路径证明或真实loader/网络使用。

cache-first意味着首次无cache可先显示旧目录，后台成功后正常refresh/重新打开picker应出现更新；不得强迫用户额外扫描/配置。重启必须能在初始解析前恢复有效cache，实际SDK/loader测试证明。若这部分无法做到则不交付。

## 固定验收（workflow十节）

1契约源：本文件+Profiles原身份原则+model-discovery/robustness-and-proof.md中仍适用部分+model-scout/acceptance.md。2schema：CacheV1精确字段，认证信息零持久化。3枚举：hit/miss、active/disposed、idle/running、updated/unchanged/failed。4流程：创建本地恢复→注册→标准双阶段刷新→后台提交→cache-only同步→关闭失效。5行为：同账号transport、官方更新和用户覆盖优先、无外部发掘。6时序：启动/重启、单飞、代次、取消、partial source失败。7不变量：原身份不变、原模型不丢、去重幂等、旧job不发布、私有残留隔离。8性能：本地同步无公网、请求10s/16MiB、有限循环、有界重试、print可退出。9安全：不写用户/官方配置，不带凭据GET，不输出秘密。10跨入口：factory与/add-login同路径。

固定seed至少10k wire/归并案例、256×32状态步骤、128隔离网络故障组合；Docker internal网络不对真实厂商fuzz，不挂家目录/socket，不特权，清理限自有资源。正常和每类失败必须验证原模型仍可调用，警告去重且无unhandled rejection。

Hoare/SCCO在一次实现契约对照内执行，从本设计抽规范再看代码，逐分支/退出/await拒绝/循环与不变量反例，缺项PARTIAL不假称PROVEN。用户未撤销这些要求；不因A更小就删除。

最终主会话tmux小量真实试用：GLM-5.4出现、实际对话/工具、Shift+Tab low/high/max、context1000000和输出131072来自当前官方元数据（不是固定写死）、首响应后不变错、重启恢复、原模型照常。然后用户亲自Pi使用。当前官方目录包含glm-5.4，只说明在线数据存在，不预先承诺远端账号调用成功。

## 实施前检查记录

GLM-5.3:max独立检查 d33b0720-e398-4e2e-b4e9-38f948c757ba 的完整报告结论DESIGN_ACCEPTED，未发现实施阻断。它只提供设计/源码契约论证，不是测试通过。

主会话处置：接受parseCatalog与官方三种wire形态对齐；不接受报告中“getAgentDir不可导入、应复刻路径”的建议——现有provider-profiles-extension.ts已直接从官方coding-agent包导入getAgentDir并实际运行，继续复用此接口，不另写路径规则。后继是否放行由保存的完整报告判断，不依赖可能被摘要/输出路由影响的末尾字符串。

## 尚待执行

实施、直接测试、故障Fuzz/Docker、实际逐路径代码映射和真实tmux仍未完成。已暂停的外部发现模块不重新接线、不删除；不用半成品宣布修复。
