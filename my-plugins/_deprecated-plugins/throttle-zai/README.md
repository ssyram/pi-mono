# throttle-zai

**状态：内部实现骨架与测试已落地（src/ + 47 项离线测试），但尚未接入真实 Pi 扩展链路。**`/add-login`、用量插件与 quota-throttle 服务契约（extern-dep-design.md 的 E1/E2/E3）尚未实施，因此还不能真实建号或转发请求。以下为拟实现行为。

## 目标使用方式

```text
/add-login my-zai throttle-zai
→ 输入智谱 Coding Plan 上游 KEY
→ 初始化或复用受管本机池，握手、导入账号、取得网关调用凭据
→ 按实例 my-zai 保存标准凭据
→ /model 选择 my-zai/glm-5.3
```

`throttle-zai` 是来源 TYPE，`my-zai` 是 Provider.id。实例不是池成员：本版推荐多个实例连接同一个受管本机池；上游账号有独立的非秘密标签。

模型请求使用 Pi 标准 OpenAI Chat Completions，经 new-api 转发。模型元数据复用安装版 Pi 的国内 Coding Plan 目录；不维护第二份上下文长度表。初始目录本地可读，联网后才收敛到网关实际可用模型。

用量由独立的 provider-usage 插件展示：底部是绑定池的 5h/week，详细命令显示分 key 状态。两者只共享公开协议，不导入对方私有实现。

## 文档与权威位置

| 文档 | 内容 |
|---|---|
| [QPDI 原则](docs/principles.md) | 用户意图、已核事实、实验、假设的来源与状态 |
| [内部架构](docs/design/architecture.md) | 根 P/M/R、模块协作、不变量、取舍和根层限制 |
| [内部细化](docs/design/detailed-design.md) | 类型、来源、目录、请求和用量的逐函数契约 |
| [后台细化](docs/design/backend.md) | 初始化、启动、管理会话、token 与失败恢复 |
| [测试设计](docs/test-plan.md) | 需求映射、功能/边界/性质测试和真实运行门槛 |
| [外部依赖设计](docs/extern-dep-design.md) | 所有其他插件、quota-throttle、新 API 管理面的接口与修改 |
| [历史调研](docs/research/throttle-zai-research.md) | 固定版本源码与前期候选，不覆盖当前设计 |

内部规范只拥有本插件实现。外部配置、源码改动和验收由 `extern-dep-design.md` 唯一定义；本插件引用其 E 编号，不复制外部实现。

## 拟实现配置

文件：`<getAgentDir()>/throttle-zai/config.json`，仅插件配置，不是账号文件。

```json
{
  "version": 1,
  "executable": "/absolute/path/to/quota-throttle",
  "controlUrl": "http://127.0.0.1:3001",
  "relayBaseUrl": "http://127.0.0.1:3000/v1",
  "plan": {
    "kind": "team",
    "organization": "<组织ID>",
    "project": "<项目ID>"
  },
  "quota": { "kind": "equal" }
}
```

- `plan.kind` 可为 personal；team 必须同时提供组织、项目。不能从 KEY 猜出来。
- `quota.kind=equal` 是操作者对各 key **额度独立、同窗口容量相等**的声明，不由 key 数或套餐名称推断。
- 异档池使用 weighted，配置格式见内部细化；未配置足够权重时不伪造总池百分比。
- 本版只管理自己的本机服务目录，不自动接管未知服务，不安装 binary，不执行 shell。
- binary 必须实现外部 E3 契约；当前上游 HEAD 尚未完整提供该契约。

静态来源声明和 `/add-login` 的外部改动见 [E1](docs/extern-dep-design.md#e1-provider-profiles)。服务名不会替你安装或加载扩展。

## 凭据和日常行为

自动登录取得的 gateway credential 拟经公开 SDK 存入 `auth.json` 的 my-zai 槽；profile 声明只保留来源。上游 KEY 只进入受管 backend 配置，不放入模型上下文、命令参数或客户端日志。

原生 `/logout my-zai` 清除该标准凭据，不删除池成员、不撤销远端 token、不关闭共享 daemon。若用户主动在 profile 中配置 apiKey，仍存在原有配置回退：logout 不会删除该配置。

自动启动发生在登录、联网模型刷新或模型请求；同步 create/offline refresh 和只读用量查询不启动进程。会话退出不停止本机共享池。

## 重要边界

- 单受管池、默认 CLI 文件凭据存储、macOS/Linux 是本版推荐部署基线；自定义 SDK 凭据存储需额外公开桥接，不静默写错位置。
- 源服务工厂必须同步提供本地初始目录，READY 必须是提供者初始化最后成功步骤。
- 服务身份和单实例锁依赖 E3；不能以端口有响应、PID 文件或先查后起证明没有重复调度器。
- 百分比没有绝对容量；异档、重复额度身份或查询失败不能被隐藏成完整总池。
- 本版不承诺跨多个 Pi 同时进行账号配置变更的事务性；推理请求共享池与配置并发是不同问题。
- 私有 new-api 用零分组倍率记本地订阅流量，但仍要求正用户余额；不把它当作智谱额度或真实付费价格。

## 已有依据

`docs/research/evidence/source-loading-probe.json`：实际 Pi 1.4 加载器的 7 个离线场景通过，含加载顺序、覆盖、失败隔离和初始 CLI 模型可见性。

`docs/research/evidence/login-runtime-probe.json`：公开 SDK 写入假凭据、主运行时刷新可见、原生 logout 清除，通过；假文件权限 0600。

这些证据不包含真实 KEY、网关、模型、UI 登录、并发启动或生产 TypeScript 验收。后续实施命令和完成标准见测试设计。
