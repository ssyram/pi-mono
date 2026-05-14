# session-namer

自动为 pi 聊天会话命名，方便在 `/resume` 会话选择器中快速定位。

## 触发时机

| 时机 | 条件 | 说明 |
|---|---|---|
| agent_end（与 recap 同步） | session 文件 > `sizeThreshold` | 与 recap 在同一事件触发 |
| agent_end（与 recap 同步） | `renameOnCompact` 开启时 | 每次对话回合结束都重新评估 |

两者都受 `enabled` 和各自的开关控制。

## 命名规则

- LLM 根据对话内容提取核心主题
- 长度限制 `maxLength` 字节（UTF-8，CJK 字符占 3 字节）
- 多个不同主题之间用 `separator` 拼接

**示例输出：**
```
数据分析脚本重构
API接口调试 | 权限模块开发
周报整理
用户画像分析 | 特征工程
```

## 命令

```
/session-namer                    查看当前配置和命名状态
/session-namer rename             立即重新生成名字
/session-namer on                 开启自动命名
/session-namer off                关闭自动命名
/session-namer config <key> <val> 修改参数
```

## 可配置参数

| 参数 | 类型 | 默认值 | 说明 |
|---|---|---|---|
| `sizeThreshold` | number | 10240 | 触发自动命名的文件大小阈值（字节） |
| `maxLength` | number | 40 | 名字最大字节长度 |
| `separator` | string | ` \| ` | 多主题分隔符 |
| `autoRename` | boolean | true | 是否在文件超过阈值时自动命名 |
| `renameOnCompact` | boolean | true | 是否与 recap 同步在 agent_end 时命名 |
| `enabled` | boolean | true | 总开关 |

### 修改参数示例

```
/session-namer config sizeThreshold 20480
/session-namer config maxLength 60
/session-namer config separator " · "
/session-namer config autoRename false
```

配置持久化到 `~/.pi/agent/session-namer.json`，重启后保留。

## 文件结构

```
session-namer/
├── index.ts              # 主逻辑
├── prompts/
│   └── namer.md          # LLM 命名提示词
└── config.default.json   # 默认配置
```
