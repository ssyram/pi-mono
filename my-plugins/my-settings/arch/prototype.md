# my-settings 原型实现

状态：待用户审阅。本文是拟采用的原型，不是现有代码已经符合本文的声明。确认前不据此修改运行实现。

## 1. 数据与基本约定

```haskell
type Key = String
type FilePath = String

data Value
    = Null
    | Bool Boolean
    | Number JsonNumber
    | String Text
    | Array [Value]
    | Object (Map Key Value)

type Values = Map Key Value
type KeysAndDefaults = Values

data Result a = Ok a | Error ErrorInfo

empty = {}
x <> y = rightBiasedUnion x y
```

`x <> y` 表示 y 覆盖 x 的同名 key，同时保留两边不重复的 key。它是**顶层浅合并**；数组或对象作为一个完整值被覆盖，不递归合并。

Map 中每个 key 只有一个值。此约定不额外要求 JSON 解析器检测原始文本里的重复键。

`Value` 保留 JSON 类型，不把 bool、number 等统一转换成字符串。数据不包含函数、getter、setter 或自定义序列化方法。

本原型用默认值的 `kind` 作为该 key 的期望类型：

```haskell
kind Null       = NullKind
kind (Bool _)   = BoolKind
kind (Number _) = NumberKind
kind (String _) = StringKind
kind (Array _)  = ArrayKind
kind (Object _) = ObjectKind
```

不进行跨类型转换：`String "false"` 不会变成 `Bool false`。

数字使用 JSON number；不凭默认值是 `1` 就推断该 key 只接受整数。`NullKind` 只匹配 null。数组、对象只校验其种类与 JSON 数据合法性，不从默认内容推导元素类型、对象字段结构或可空类型。

## 2. 路径与原生操作

```haskell
agentRoot   = getPiAgentDir()          -- 通常 ~/.pi/agent
projectRoot = getCurrentProjectDir() / ".pi"

defaultName   = "settings.json"
globalDefault = agentRoot / defaultName
localDefault  = projectRoot / defaultName

globalFile maybePath =
    resolveWithin agentRoot (fromMaybe defaultName maybePath)

localFile maybePath =
    resolveWithin projectRoot (fromMaybe defaultName maybePath)
```

`globalPath`、`localPath` 独立配置，都是对应根目录内的相对文件路径。省略表示默认文件，不表示禁用该层。`saveFile` 等底层函数只接收**已经解析好的具体路径**，不再处理 Maybe 或默认作用域。

以下原生操作只声明合同，不展开实现：

| 操作 | 合同 |
| --- | --- |
| `resolveWithin root relativePath` | 返回根目录内的绝对路径；非法路径返回 Error，不向外抛异常 |
| `readRawObject path` | 返回未经查询过滤的完整 JSON 对象；仅文件不存在返回 `Ok empty`；I/O、语法或顶层类型错误返回 Error |
| `validateValues values` | 检查并取得合法 JSON 数据快照；不执行业务提供的方法，不把非法值悄悄转成合法值 |
| `withFileWriteQueue path action` | 使用稳定的规范化文件路径串行执行本进程的完整读—改—写，返回 action 的 Result |
| `atomicWriteObject path object` | 创建所需目录，以原子文件替换写入完整对象；失败返回 Error |
| `readCurrentSessionPatches()` | 读取当前 session 当前分支的补丁，按旧到新排序，包含来源标识；单条日志结构损坏则诊断并跳过该条，整个读取操作失败才返回 Error |
| `addNewPiLog values` | 向当前 session 日志追加只含 values 的补丁；失败返回 Error。日志条目只记 values，不记 scope，合并优先级即日志顺序 |
| `ensureCurrentSession()` | 检查请求所属会话仍有效；失效返回 Error，不能转用另一个会话 |
| `reportError error` | 向 Pi 输出可定位的错误；诊断自身失败也不向外抛异常 |
| `catchAndPrint result` | Error 时 reportError 并原样返回该 Result，不改变成功值 |
| `keys`、`pickKeys`、`kind`、Map 操作 | 基本数据操作，不展开实现 |

所有原生可失败操作均返回 `Result`，不依赖调用方或 Pi 捕获 throw/rejection。伪代码的 `<-` 只表示等待并取得返回值，保留 Result 容器；`<-?` 表示等待后取出 Ok 的值，遇 Error 则从当前函数原样返回 Error。`return Ok x` 显式构造成功结果，`return x` 不额外包装。

**默认文件按用户给出的 `settings.json` 定义。** 这会与 Pi 自身设置文件共享存储，因此保存必须保留所有未修改的原始 key。当前运行代码使用的是独立的 `my-settings.json`；本文审核通过前不切换默认文件。

## 3. 逐字段解析

`parseQuery` 返回该来源中合法的 `Map<Key, Value>`，不是字符串表，也不填充默认值。

```haskell
parseQuery source keysAndDefaults raw = do
    parsed = empty

    for key in keys keysAndDefaults:
        if not (containsKey raw key):
            continue

        expected = kind keysAndDefaults[key]
        actual   = raw[key]

        if kind actual /= expected:
            reportError TypeMismatch {
                source   = source,
                key      = key,
                expected = expected,
                actual   = kind actual,
                action   = "忽略该来源的该值"
            }
            continue

        parsed[key] = actual

    return parsed
```

规则：

- 只处理调用方请求的 key；其他插件或未请求的 key 不参与查询，也不因此报错。
- 一个 key 类型错误，不影响同一对象里的其他合法 key。
- 类型错误只取消**这个来源的这项贡献**，不是删除低优先级来源的同名值。
- 不存在的 key 不报错、不在本层补默认值。
- 默认值只在最终合并时加入一次，且优先级最低。

例如：默认 `enabled=true`、global `enabled=false`、local `enabled="off"`。local 的字符串报错并被忽略，最终结果是 global 的 `false`。

## 4. 查询

查询时延续用户原型的容错方向：**一个来源读取失败则报错、忽略该来源，继续其他来源**，不能静默变成 empty。成功读出的对象再按上一节逐字段处理。

```haskell
queryFile path keysAndDefaults = do
    result <- readRawObject path
    case result of
        Ok raw:
            values <- parseQuery (FileSource path) keysAndDefaults raw
            return values
        Error error:
            reportError error
            return empty

queryGlobal maybePath keysAndDefaults = do
    path <-? globalFile maybePath      -- 路径参数错误直接返回 Error
    values <- queryFile path keysAndDefaults
    return Ok values

queryLocal maybePath keysAndDefaults = do
    path <-? localFile maybePath
    values <- queryFile path keysAndDefaults
    return Ok values

querySession keysAndDefaults = do
    _ <-? ensureCurrentSession()
    result <- readCurrentSessionPatches()
    case result of
        Error error:
            reportError error
            return Ok empty
        Ok patches:
            session = empty
            for patch in patches:      -- 旧到新；不能先合并未经校验的补丁
                valid <- parseQuery patch.source keysAndDefaults patch.values
                session = session <> valid
            return Ok session

query globalPath localPath keysAndDefaults =
    queryAt Session globalPath localPath keysAndDefaults

queryAt scope globalPath localPath keysAndDefaults = do
    _ <-? ensureCurrentSession()
    defaults <-? validateValues keysAndDefaults
    global <-? queryGlobal globalPath defaults
    local   = empty
    session = empty

    if scope /= Global:
        local <-? queryLocal localPath defaults
    if scope == Session:
        session <-? querySession defaults

    _ <-? ensureCurrentSession()
    combined = defaults <> global <> local <> session
    return Ok (pickKeys (keys defaults) combined)
```

`queryFile` 的 empty 仅表示这个来源没有贡献，不声称该文件不存在或读取成功；它的失败已通过诊断交给 Pi。`parseQuery` 的返回值是 Values，`queryFile` 等待它完成后得到 Values；对外 `queryAt`/`query` 返回 Result Values。`scope` 仅允许 Global、Project、Session，由协议入口校验。

因此：

- 覆盖优先级是 **defaults < global < local < session**。
- session 内也是后来的**合法**补丁覆盖先前值；后来的错误类型不会遮掉先前合法补丁。
- 文件完全损坏时无法可靠保留其部分字段，整份来源被忽略并诊断；不是伪称逐字段恢复成功。
- 参数非法、会话失效不属于“某项配置值错误”，仍返回 Error，不带着错误上下文继续。
- 查询不写文件、不追加 session 日志。

`queryAt Global` 使用 defaults/global，`queryAt Project` 再加入 local，`queryAt Session` 再加入 session。`queryGlobal`/`queryLocal` 是内部来源读取函数，最终对外结果才包含默认值；不能把 Result 容器当作 Map 合并。

## 5. 保存

保存不得使用 `parseQuery` 的过滤结果作为原文件基线：那会删除类型错误项、未请求项或其他插件的 key。

```haskell
saveFile path values = do
    patch <-? validateValues values

    result <- withFileWriteQueue path $ do
        _ <-? ensureCurrentSession()
        original <-? readRawObject path  -- 读取失败直接 Error，绝不当成 empty
        let merged = original <> patch
        _ <-? ensureCurrentSession()
        written <- atomicWriteObject path merged
        return written
    return result
```

保存文件时，只有文件不存在才允许从 empty 创建。原文件损坏、无法读取或不是对象时必须停止，不能用 patch 覆盖原文件。

保存按作用域拆成纯文件保存与显式组合，不再有隐式的“保存必写日志”：

```haskell
saveGlobalOnly maybePath values = do
    path <-? globalFile maybePath
    saveFile path values

saveLocalOnly maybePath values = do
    path <-? localFile maybePath
    saveFile path values

saveGlobalAndSession maybePath values = do
    catchAndPrint =<< saveGlobalOnly maybePath values
    saveSession values

saveLocalAndSession maybePath values = do
    catchAndPrint =<< saveLocalOnly maybePath values
    saveSession values

saveSession values = addNewPiLog values
```

- `saveGlobalOnly` / `saveLocalOnly` 纯写对应文件，不写 session 日志；`saveSession` 只写 session 日志。
- `AndSession` 组合 = `catchAndPrint` 文件步骤 + 追加日志：文件失败仅诊断并继续，日志步骤总是尝试；整体结果等于 `saveSession` 的结果，因此组合返回 Error 时文件可能已提交，需以诊断区分，不自动回滚。
- 层间效果：Only 保存经文件层在后续查询生效，服从默认覆盖顺序（local > global）；`AndSession` 组合的日志使该补丁在当前会话高于另一层文件覆盖，其他会话不受该日志影响。文件与 session 日志不是一个事务。
- 协议操作集相应为 `query / save-global-only / save-local-only / save-global-and-session / save-local-and-session / save-session`，以及第 6 节的三个 unset 操作。
- 保存只知道 patch 的 Value 类型，不知道查询方未来会为该 key 声明什么期望类型。因此本接口校验 JSON 数据合法性，不凭原文件当前值或隐藏注册表推断业务类型；查询时按各自 keysAndDefaults 校验。
- 未被本次 patch 指定的原始 key 原样保留，即使某次查询曾忽略了它。

## 6. unset（方案 A，用户已确认）

删除/取消语义放在信封层，不碰值域：`null` 是合法存储值，不当墓碑。

### 数据形状

```haskell
data LogEntry = LogEntry
    { values  :: Maybe Values    -- 与 removed 至少其一
    , removed :: Maybe [Key]     -- 墓碑：取消本 session 层对该 key 的意见
    }

addNewPiLog values  = appendLogEntry (LogEntry (Just values)  Nothing)
addNewTombstone keys = appendLogEntry (LogEntry Nothing       (Just keys))
```

### 文件层：真删除

```haskell
unsetFile path keys = do
    result <- withFileWriteQueue path $ do
        _ <-? ensureCurrentSession()
        exists <- fileExists path
        if not exists:
            return (Ok ())                 -- 缺文件 = no-op，不创建文件
        original <-? readRawObject path    -- 坏原文件：Error，不覆盖
        let reduced = foldr deleteKey original keys
        _ <-? ensureCurrentSession()
        atomicWriteObject path reduced
    return result
```

- 只删 `keys` 中的 key，其余原样保留。
- 缺文件是幂等 no-op（不创建空文件）；坏原文件报 Error 且不用删除结果覆盖。
- 与 saveFile 同一队列、同一原子替换协议。

### session 层：墓碑

```haskell
unsetSession keys = do
    _ <-? ensureCurrentSession()
    deduped = nub keys
    if null deduped: return (Ok ())
    addNewTombstone deduped
```

### 查询折叠（querySession 改动点）

```haskell
querySession keysAndDefaults = do
    -- ...读取补丁序列（旧到新）同前...
    overlay = foldl step empty patches
      where
        step acc (LogEntry (Just vs)  Nothing)  = acc <> parseQuery' vs
        step acc (LogEntry Nothing    (Just ks)) = foldr deleteKey acc ks
        step acc (LogEntry (Just vs)  (Just ks)) =
            foldr deleteKey (acc <> parseQuery' vs) ks   -- 同条内先赋值后删，删除胜
    return overlay
```

- 折叠即优先级：`set k=1 → tombstone k → set k=2` 结果为 2；`set → tombstone` 结果为“无 session 意见”。
- 墓碑只删 session overlay 的 key，global/local 照常生效（方案 A 边界；不逃蔽低层）。
- 结构损坏的 removed（非字符串数组）与结构损坏的 values 同等待遇：诊断并跳过该条。

### 对外操作与命令

```haskell
unsetGlobalOnly maybePath keys = do path <-? globalFile maybePath; unsetFile path keys
unsetLocalOnly  maybePath keys = do path <-? localFile  maybePath; unsetFile path keys
unsetSession keys = ...          -- 墓碑，无文件参与
```

- 无 AndSession 组合变体（unset 的组合 = 调用方自行依序调用多个 Only）。
- 命令层：`/my-setting unset [--global] [--local] [--session] [--global-file P] [--local-file P] KEY...`，多 scope 按序执行各 Only。KEY 可用 JSON 字符串引号包裹（含空白/转义引号/-- 开头）。
- 协议操作集追加 `unset-global-only / unset-local-only / unset-session`；操作负载为 `unset: { keys: [Key], globalPath?, localPath? }`。keys 只校验“是字符串数组”（搬运工原则）：空数组 = no-op 成功，空串 key 合法并字面处理；非字符串元素才拒绝。

### 不做的（方案 B，已否决）

session 强制全层不存在：查询中缺失 key 恒被 defaults 填充，“不存在”不可观测；其可观测效果退化为“赋默认值”，普通 save 即可表达，不新增原语。

## 7. 外部交互与审核边界

公共调用仍使用 `pi.events` 的 `my-settings:service:v1`，请求绑定当前 session 身份。协议传输、同步认领 Promise、错误输出和 ready 通知沿用现有接口，不在此重复实现。返回的 Error 由调用方报告给 Pi，不可转成 throw 或无提示的成功默认值；查询途中已经输出的字段/来源诊断不改变成功值的 Result 形状。

- 消费者声明自己的带前缀 key 与默认值，调用查询/保存；不直接读写设置文件或配置日志。
- 服务不存在时返回安装提示，不把“缺服务”当作“某个配置来源没有值”。
- 每个 session 的日志按当前分支恢复；路径不同不隔离同名 session key，因此 key 前缀仍必要。
- Only 保存经文件层在后续查询生效；AndSession 组合额外把补丁钉到当前 session 日志，使其在当前会话高于另一层文件。消费者自己的业务缓存仍需应用查询结果。
- 本原型不新增消费者注册表、变更订阅或全体消费者启动屏障。

本次审核尤其需要确认三项明确选择：

1. 使用用户原型中的 Pi `settings.json`，而不是现有代码的 `my-settings.json`。
2. 查询来源读取失败时，诊断并忽略该来源；保存原文件读取失败时停止，不能覆盖。
3. 类型校验按 Value 种类与默认值匹配；不自动推导整数、可空类型、数组元素类型或对象字段 schema。

用户确认本文后，再按本文调整实现；本文本身不表示迁移、代码修改或上线已经发生。
