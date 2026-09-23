# provider-profiles

在同一 Pi 内管理多个供应商账号，`/model` 手动切换。通过为官方 provider 创建**具名实例**实现：每个实例独立登录、独立凭据槽、独立登出，模型元数据与登录/请求行为完整继承官方实现。

设计与论证见 `docs/`（principles / architecture / detailed / test-plan / correctness）。

## 为什么需要它

Pi 原生凭据按 **provider id** 保存：一个内置 id 只能保留一套认证，例如再次 `/login openai-codex` 会替换该 id 的 OAuth 登录；`/model` 只选择 provider/model，没有账号 profile。要在同一 Pi 内同时保留多个 Codex 或 API-key 账号，并在额度耗尽时显式切换，必须让每个账号成为不同的 provider id；本插件提供的就是这个具名实例层。

## 支持的原生 provider（动态）

**全部内置 provider 均可作来源**（Tab 补全即时列出当前全集），两类除外：

- 携带动态模型目录的 `radius`（克隆会错绑目录恢复）；
- custom（models.json 里自定义的 provider）——本插件只做账号身份层，目录/端点定义留在 models.json（不做 custom 实例，用户裁决）。

| 来源形状 | 认证方式 | 凭据来源 |
|---|---|---|
| OAuth 型（openai-codex、github-copilot…） | 浏览器 OAuth | `/login <name>` |
| API-key 型（zai、openai、anthropic、google、openrouter…） | API key | `/login <name>` 或配置内 `apiKey` |

不可识别的 provider 值（拼错、非内置）一律拒绝，不会写入或注册。

## 配置

`~/.pi/agent/provider-profiles.json`（对象映射，name 为键；缺文件 = 空配置）：

```json
{
  "codex-001": { "provider": "openai-codex" },
  "codex-002": { "provider": "openai-codex" },
  "zai-000-g-l": { "provider": "zai", "apiKey": "$ZAI_000_KEY" },
  "zai-001-g-l": { "provider": "zai" }
}
```

- `name` 规则：`^[a-z0-9][a-z0-9-]{0,63}$`；不得与内置 provider id 或宿主保留键（如 `constructor`）冲突。**可与 `models.json` 同名**，只要其条目仅包含 `modelOverrides` 且模型覆盖中没有 `headers`；如 `codex-001` 只覆盖 `contextWindow`。同名条目若含 `apiKey`、`baseUrl`、`models` 等 provider 级字段，或模型级 `headers`，仍会拒绝该实例，避免引入其他认证或请求来源。
- `provider` 值必须是可识别的内置 provider（动态支持集；`/add-login` Tab 即列出）。
- `apiKey`：可选；支持明文 / `$ENV_VAR` / `${ENV_VAR}`。`openai-codex` 条目不得携带 `apiKey`。
- 坏 JSON → 插件整体失败（Pi 标记扩展失败，零注册）；条目错误（非法名、未知 provider、codex+apiKey、内置名冲突）→ 跳过该条目，`console.error` 报含条目名的原因，其余条目正常。

## 使用

```text
1. 写配置 → 启动 Pi（或重启；见下方边界）
2. /login codex-001        # 每个号一次；zai 系也可省略，直接在配置里给 apiKey
3. /model 选 codex-001/gpt-5.6-terra（或任意官方模型）
4. 一个号用光 → /model 切到 codex-002/…，已登录的不受影响
5. /logout codex-001       # 只清这一个实例的凭据
```

凭据解析顺序（每个实例固定）：① 本实例存储凭据（`/login` 存入）→ ② 本实例配置 `apiKey` → 不可用。**绝不**读取环境变量（`ZAI_API_KEY` 等官方 env 回退在实例上被去除），绝不借用其他实例或内置 provider 的凭据。

## 边界（如实）

- 实例是 Pi 内的身份入口；两个实例登同一个远端账号不会产生两份额度。
- `/logout` 后若配置里仍有本实例 `apiKey`，会回退使用它（要彻底禁用需删配置条目）。
- 插件不做自动轮换、额度探测、失败转移；认证失败就是失败。
- 修改配置后需重启 Pi 生效（扩展不热重载本配置）；实例注册存活至 Pi 进程退出（无自动卸载）。
- 不迁移、不修改既有 `models.json` 条目；纯 `modelOverrides` 的同名覆盖由 Pi 正常合成，含 provider 级字段或模型级 `headers` 的同名配置才会被拒绝。
- 支持集为动态判定：新增内置 provider 自动可用（携带动态目录者除外）；见 `docs/architecture.md` P.local.4。

### 宿主通用行为边界（非本插件缺陷，详见 docs/correctness.md）

- CLI 显式 `--api-key` 可覆盖任意选中实例的凭据（用户显式动作，优先于存储/配置 key）。
- 存储凭据字符串内的 `$ENV` 语法会被宿主在读取时展开（对所有 provider 一致）。
- 注册实例会触发宿主全局可用性刷新：读本底内置槽位、可能迁移旧目录持久化（`allowNetwork=false` 亦然）。
- 登出后 `/model` 的会话 scoped 列表可能仍显示实例模型（宿主 UI 陈旧，请求级认证仍拦截）。
- 注册在扩展加载期延迟提交：提交失败的逐项隔离依赖宿主提交语义（未观察到真实提交失败）。

## 开发

```bash
cd my-plugins/provider-profiles
node "$(git rev-parse --show-toplevel)/node_modules/vitest/dist/cli.js" --run
```

## /add-login 命令

```text
/add-login <name> <provider> [apiKey]    # Tab 第二段补全 provider
/add-login help | h | ? | -h | --help    # 帮助（含删除方法）
```

- 写入 `provider-profiles.json` 前整体重过校验（名称规则/保留键/内置名及同名 `models.json` 的**危险配置**），**即时注册**，无需重启。
- `apiKey` 支持字面量与 `$ENV_VAR` / `${ENV_VAR}`（使用时展开；不支持 `!command`——凭据字段不执行 shell）。含空白的 key 请用 env 引用或直接编辑文件。
- 同名条目**拒绝静默覆盖**（提示编辑文件修改）。
- **删除条目**（有意不做成命令，避免残留）：从文件删对象 → 有存储凭据则 `/logout <name>` → 活实例存活至 Pi 重启。
