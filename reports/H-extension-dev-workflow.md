# H - Extension 开发、安装、测试与发布

## 概述

pi 的 Extension 系统基于 **TypeScript 工厂函数模式**：每个 Extension 是一个导出 `default function(pi: ExtensionAPI)` 的 TypeScript/JavaScript 模块。通过 [jiti](https://github.com/unjs/jiti)（一个 TypeScript 即时转译运行时）加载，**无需预编译**。

核心文件：
- 类型定义：`packages/coding-agent/src/core/extensions/types.ts`（1342 行）
- 加载器：`packages/coding-agent/src/core/extensions/loader.ts`（517 行）
- 运行器：`packages/coding-agent/src/core/extensions/runner.ts`（827 行）
- 包管理器：`packages/coding-agent/src/core/package-manager.ts`（1770 行）
- 资源加载器：`packages/coding-agent/src/core/resource-loader.ts`（872 行）
- 官方文档：`packages/coding-agent/docs/extensions.md`
- 包文档：`packages/coding-agent/docs/packages.md`
- 示例目录：`packages/coding-agent/examples/extensions/`（60+ 个示例）

---

## 1. 开发新 Extension

### 1.1 目录结构

Extension 有三种组织方式：

**单文件（最简单）**
```
~/.pi/agent/extensions/
└── my-extension.ts
```

**多文件目录**
```
~/.pi/agent/extensions/
└── my-extension/
    ├── index.ts        # 入口（必须 export default function）
    ├── tools.ts        # 辅助模块
    └── utils.ts        # 辅助模块
```

**带依赖的包**
```
~/.pi/agent/extensions/
└── my-extension/
    ├── package.json    # 声明依赖和入口
    ├── package-lock.json
    ├── node_modules/   # npm install 后生成
    └── src/
        └── index.ts
```

发现逻辑定义在 `discoverExtensionsInDir()` @ `packages/coding-agent/src/core/extensions/loader.ts:433`：
1. 直接文件：`extensions/*.ts` 或 `*.js` -- 直接加载
2. 子目录有 `index.ts` 或 `index.js` -- 加载 index
3. 子目录有 `package.json` 且含 `pi.extensions` 字段 -- 加载声明的入口
4. **不递归超过一层**。复杂包必须使用 `package.json` manifest

### 1.2 最小示例

**hello.ts** -- 最简工具注册（来自 `packages/coding-agent/examples/extensions/hello.ts`）：

```typescript
import { Type } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "hello",
    label: "Hello",
    description: "A simple greeting tool",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),

    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const { name } = params as { name: string };
      return {
        content: [{ type: "text", text: `Hello, ${name}!` }],
        details: { greeted: name },
      };
    },
  });
}
```

**完整功能示例**（事件、命令、工具）：

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

export default function (pi: ExtensionAPI) {
  // 订阅事件
  pi.on("tool_call", async (event, ctx) => {
    if (event.toolName === "bash" && event.input.command?.includes("rm -rf")) {
      const ok = await ctx.ui.confirm("Dangerous!", "Allow rm -rf?");
      if (!ok) return { block: true, reason: "Blocked by user" };
    }
  });

  // 注册工具
  pi.registerTool({
    name: "greet",
    label: "Greeting",
    description: "Generate a greeting",
    parameters: Type.Object({
      name: Type.String({ description: "Name to greet" }),
    }),
    async execute(toolCallId, params, signal, onUpdate, ctx) {
      return {
        content: [{ type: "text", text: `Hello, ${params.name}!` }],
        details: {},
      };
    },
  });

  // 注册命令
  pi.registerCommand("hello", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify("Hello!", "info");
    },
  });
}
```

### 1.3 TypeScript 配置

**不需要 tsconfig.json。** 扩展通过 jiti 即时转译，完全不需要编译步骤。

加载机制定义在 `loadExtensionModule()` @ `packages/coding-agent/src/core/extensions/loader.ts:258`：

```typescript
async function loadExtensionModule(extensionPath: string) {
  const jiti = createJiti(import.meta.url, {
    moduleCache: false,
    // Bun binary: virtualModules; Node.js/dev: aliases
    ...(isBunBinary
      ? { virtualModules: VIRTUAL_MODULES, tryNative: false }
      : { alias: getAliases() }),
  });
  const module = await jiti.import(extensionPath, { default: true });
  const factory = module as ExtensionFactory;
  return typeof factory !== "function" ? undefined : factory;
}
```

关键点：
- jiti 自动处理 TypeScript 转 JavaScript
- `moduleCache: false` 保证 `/reload` 时能重新加载
- Bun binary 模式通过 `virtualModules` 提供预捆绑模块
- Node.js 开发模式通过 `alias` 映射到 `node_modules` 路径
- Node.js 内置模块（`node:fs`, `node:path` 等）可直接使用

### 1.4 可用模块和 API

虚拟模块定义在 `VIRTUAL_MODULES` @ `packages/coding-agent/src/core/extensions/loader.ts:41`：

| 包名 | 用途 |
|------|------|
| `@mariozechner/pi-coding-agent` | Extension 类型 (`ExtensionAPI`, `ExtensionContext`, 事件类型等) |
| `@sinclair/typebox` | 工具参数 Schema 定义 (`Type.Object`, `Type.String` 等) |
| `@mariozechner/pi-ai` | AI 工具 (`StringEnum`, `Type` 重导出, 模型类型) |
| `@mariozechner/pi-tui` | TUI 组件 (`Text`, `Container`, `SettingsList`, `Component` 等) |
| `@mariozechner/pi-agent-core` | 底层 Agent 消息类型 |

**重要：** 使用 `StringEnum` 而非 `Type.Union`/`Type.Literal` 定义字符串枚举参数，否则 Google API 不兼容：

```typescript
import { StringEnum } from "@mariozechner/pi-ai";

// 正确
action: StringEnum(["list", "add"] as const)

// 错误 - Google API 不支持
action: Type.Union([Type.Literal("list"), Type.Literal("add")])
```

**ExtensionAPI 完整能力**（定义在 `packages/coding-agent/src/core/extensions/types.ts:916-1117`）：

- `pi.on(event, handler)` -- 订阅 30+ 种事件（session/agent/tool/model/input 等）
- `pi.registerTool(definition)` -- 注册 LLM 可调用的工具
- `pi.registerCommand(name, options)` -- 注册 `/command` 命令
- `pi.registerShortcut(shortcut, options)` -- 注册键盘快捷键
- `pi.registerFlag(name, options)` -- 注册 CLI 标志
- `pi.registerMessageRenderer(type, renderer)` -- 注册自定义消息渲染
- `pi.registerProvider(name, config)` -- 注册自定义 AI 提供者
- `pi.sendMessage(message, options)` -- 注入自定义消息
- `pi.sendUserMessage(content, options)` -- 发送用户消息
- `pi.appendEntry(customType, data)` -- 持久化状态（不参与 LLM 上下文）
- `pi.exec(command, args, options)` -- 执行 shell 命令
- `pi.getActiveTools()` / `pi.setActiveTools(names)` -- 管理活跃工具
- `pi.setModel(model)` / `pi.getThinkingLevel()` / `pi.setThinkingLevel()` -- 模型管理
- `pi.events` -- 扩展间事件总线

---

## 2. 本地开发与调试

### 2.1 加载方式（三种）

**方式一：全局自动发现**
```bash
# 放入全局扩展目录
cp my-extension.ts ~/.pi/agent/extensions/
```
目录为 `~/.pi/agent/extensions/`（即 `getAgentDir()` + `"extensions"`）。

**方式二：项目本地自动发现**
```bash
# 放入项目 .pi 目录
cp my-extension.ts .pi/extensions/
```
目录为 `<cwd>/.pi/extensions/`。

**方式三：CLI 参数（推荐用于开发测试）**
```bash
pi --extension ./my-extension.ts
pi -e ./my-extension.ts

# 支持多个
pi -e ./ext1.ts -e ./ext2.ts

# 支持 npm 和 git 源
pi -e npm:@foo/bar
pi -e git:github.com/user/repo
```

通过 `-e` 传入的包会安装到临时目录（`/tmp/pi-extensions/`），仅本次运行有效。

**方式四：settings.json 配置**

全局：`~/.pi/agent/settings.json`
```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1"
  ],
  "extensions": [
    "/absolute/path/to/extension.ts",
    "relative/path/from/agent/dir"
  ]
}
```

项目：`.pi/settings.json`（同结构，路径相对于 `.pi/`）

### 2.2 热重载

pi 支持通过 `/reload` 命令热重载扩展：

```
/reload
```

reload 流程：
1. 发出 `session_shutdown` 事件给旧的 Extension runtime
2. 重新加载所有资源（extensions, skills, prompts, themes）
3. 发出 `session_start` 和 `resources_discover`（reason: `"reload"`）给新的 runtime

重要限制：
- jiti 设置了 `moduleCache: false`，所以 `/reload` 能加载最新代码
- 只有放在自动发现目录中的扩展可以热重载
- 通过 `-e` 参数传入的扩展也可以重载

### 2.3 调试技巧

**1. console.log / console.error**

Extension 中的 `console.log` 输出会直接显示在终端。在非交互模式下（`-p`, `--mode json`），输出更清晰。

**2. ctx.ui.notify() -- 通知**
```typescript
ctx.ui.notify("Debug: something happened", "info");
ctx.ui.notify("Warning: check this", "warning");
ctx.ui.notify("Error: failed!", "error");
```

**3. ctx.ui.setStatus() -- 持久状态栏**
```typescript
ctx.ui.setStatus("my-ext", "Debug: processing...");
ctx.ui.setStatus("my-ext", undefined); // 清除
```

**4. 错误处理机制**

Extension 错误不会 crash 主进程。错误通过 `ExtensionRunner.emitError()` @ `packages/coding-agent/src/core/extensions/runner.ts:398` 传播。

- 事件处理器抛异常：记录错误，agent 继续运行
- `tool_call` 处理器抛异常：阻止工具执行（fail-safe）
- 工具 `execute` 抛异常：向 LLM 报告 `isError: true`

Extension 加载错误收集在 `LoadExtensionsResult.errors` 中：
```typescript
interface LoadExtensionsResult {
  extensions: Extension[];
  errors: Array<{ path: string; error: string }>;
  runtime: ExtensionRuntime;
}
```

**5. 查看加载了哪些扩展**

启动时会显示加载的扩展和任何错误。可以通过 `/reload` 重新触发加载报告。

---

## 3. 测试

### 3.1 单元测试

pi 使用 **vitest** 作为测试框架。Extension 相关测试位于：

- `packages/coding-agent/test/extensions-discovery.test.ts` -- 发现和加载机制测试
- `packages/coding-agent/test/extensions-runner.test.ts` -- Runner 冲突检测、事件发射等
- `packages/coding-agent/test/extensions-input-event.test.ts` -- 输入事件处理
- `packages/coding-agent/test/compaction-extensions.test.ts` -- 压缩相关扩展
- `packages/coding-agent/test/compaction-extensions-example.test.ts` -- 压缩示例

**测试模式示例**（来自 `packages/coding-agent/test/extensions-discovery.test.ts`）：

```typescript
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { discoverAndLoadExtensions } from "../src/core/extensions/loader.js";

describe("extensions discovery", () => {
  let tempDir: string;
  let extensionsDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-ext-test-"));
    extensionsDir = path.join(tempDir, "extensions");
    fs.mkdirSync(extensionsDir);
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it("discovers direct .ts files in extensions/", async () => {
    const extensionCode = `
      export default function(pi) {
        pi.registerCommand("test", { handler: async () => {} });
      }
    `;
    fs.writeFileSync(path.join(extensionsDir, "foo.ts"), extensionCode);

    const result = await discoverAndLoadExtensions([], tempDir, tempDir);

    expect(result.errors).toHaveLength(0);
    expect(result.extensions).toHaveLength(1);
    expect(result.extensions[0].commands.has("test")).toBe(true);
  });
});
```

关键 API：
- `discoverAndLoadExtensions(configuredPaths, cwd, agentDir)` -- 完整的发现+加载
- `loadExtensions(paths, cwd)` -- 仅加载指定路径（无发现）
- `loadExtensionFromFactory(factory, cwd, eventBus, runtime)` -- 从内联工厂加载

### 3.2 集成测试

Runner 测试使用真实的 `SessionManager` 和 `ModelRegistry`：

```typescript
import { ExtensionRunner } from "../src/core/extensions/runner.js";
import { SessionManager } from "../src/core/session-manager.js";
import { ModelRegistry } from "../src/core/model-registry.js";

const result = await discoverAndLoadExtensions([], tempDir, tempDir);
const sessionManager = SessionManager.inMemory();
const modelRegistry = new ModelRegistry(authStorage);
const runner = new ExtensionRunner(
  result.extensions,
  result.runtime,
  tempDir,
  sessionManager,
  modelRegistry
);
```

**运行测试**：
```bash
cd packages/coding-agent
npx vitest run test/extensions-discovery.test.ts
```

或运行全部测试：
```bash
npm run check  # 类型检查
./test.sh      # 全部测试
```

---

## 4. npm 发布

### 4.1 包命名规范

pi 使用 `npm:` 前缀标识 npm 包：

```
npm:package-name
npm:@scope/package-name
npm:@scope/package-name@1.2.3
```

解析逻辑在 `parseSource()` @ `packages/coding-agent/src/core/package-manager.ts:1003`：
- `npm:` 前缀 -- 明确是 npm 包
- 带版本号（`@1.2.3`）视为 pinned，不会被 `pi update` 更新

推荐使用 `pi-package` 关键词以便在 [package gallery](https://shittycodingagent.ai/packages) 被发现。

### 4.2 package.json 配置

完整的 pi 包 `package.json` 示例：

```json
{
  "name": "my-pi-extension",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions"],
    "skills": ["./skills"],
    "prompts": ["./prompts"],
    "themes": ["./themes"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "@mariozechner/pi-agent-core": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "ms": "^2.1.3"
  }
}
```

**`pi` manifest 字段**（定义在 `readPiManifest()` @ `packages/coding-agent/src/core/extensions/loader.ts:358`）：

```typescript
interface PiManifest {
  extensions?: string[];  // Extension 入口路径（相对于包根）
  themes?: string[];      // 主题 JSON 路径
  skills?: string[];      // Skill 路径
  prompts?: string[];     // Prompt 模板路径
}
```

路径支持 glob 模式和 `!排除` 模式。

**Gallery 元数据**（可选）：
```json
{
  "pi": {
    "extensions": ["./extensions"],
    "video": "https://example.com/demo.mp4",
    "image": "https://example.com/screenshot.png"
  }
}
```

**关于 peerDependencies**：pi 内置的核心包（`@mariozechner/pi-ai`, `@mariozechner/pi-agent-core`, `@mariozechner/pi-coding-agent`, `@mariozechner/pi-tui`, `@sinclair/typebox`）必须放在 `peerDependencies` 且版本设为 `"*"`，不要打包它们。

### 4.3 发布步骤

```bash
# 1. 创建包目录
mkdir my-pi-extension && cd my-pi-extension

# 2. 初始化 package.json
npm init
# 设置 name, version, keywords 等

# 3. 编写 Extension
mkdir extensions
cat > extensions/index.ts << 'EOF'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("Extension loaded!", "info");
  });
}
EOF

# 4. 添加 pi manifest 到 package.json
# "pi": { "extensions": ["./extensions/index.ts"] }

# 5. 本地测试
pi -e ./

# 6. 发布到 npm
npm publish

# 7. 用户安装
# pi install npm:my-pi-extension
```

### 4.4 版本管理

- **带版本号**（`npm:pkg@1.2.3`）：pinned，`pi update` 不会更新
- **不带版本号**（`npm:pkg`）：unpinned，`pi update` 会检查 npm registry 获取最新版本
- 版本检查逻辑在 `npmNeedsUpdate()` @ `packages/coding-agent/src/core/package-manager.ts:1041`

npm 安装路径：
- 全局（user scope）：`npm install -g <spec>`，安装到系统 npm 全局目录
- 项目（project scope）：`npm install <spec> --prefix .pi/npm/`
- 临时（`-e` 参数）：`npm install <spec> --prefix /tmp/pi-extensions/npm/<hash>/`

---

## 5. git 发布

### 5.1 URL 格式

支持多种 git URL 格式（解析逻辑在 `packages/coding-agent/src/utils/git.ts:134`）：

```bash
# 带 git: 前缀（支持所有简写格式）
git:github.com/user/repo
git:github.com/user/repo@v1.0.0
git:git@github.com:user/repo
git:git@github.com:user/repo@v1

# 协议 URL（不需要 git: 前缀）
https://github.com/user/repo
https://github.com/user/repo@v1
ssh://git@github.com/user/repo
```

- `@ref` 指定分支/tag/commit，指定后视为 pinned，不会自动更新
- 不指定 ref 时，`pi update` 会 `git fetch + reset --hard`

### 5.2 安装方式

```bash
# 全局安装
pi install git:github.com/user/repo
pi install git:github.com/user/repo@v1.0.0

# 项目本地安装
pi install -l git:github.com/user/repo

# 临时试用
pi -e git:github.com/user/repo
```

安装路径：
- 全局：`~/.pi/agent/git/<host>/<user/repo>`
- 项目：`.pi/git/<host>/<user/repo>`

安装流程（`installGit()` @ `packages/coding-agent/src/core/package-manager.ts:1161`）：
1. `git clone <repo> <targetDir>`
2. 如果指定了 ref：`git checkout <ref>`
3. 如果存在 `package.json`：`npm install`

更新流程（`updateGit()` @ `packages/coding-agent/src/core/package-manager.ts:1182`）：
1. `git fetch --prune origin`
2. `git reset --hard @{upstream}` 或 `origin/HEAD`
3. `git clean -fdx`
4. 如果存在 `package.json`：`npm install`

---

## 6. 用户安装与使用

### 6.1 安装方式

**npm 安装**：
```bash
pi install npm:@foo/bar           # 全局
pi install -l npm:@foo/bar        # 项目本地
pi install npm:@foo/bar@1.0.0     # 固定版本
```

**git 安装**：
```bash
pi install git:github.com/user/repo
pi install https://github.com/user/repo
pi install -l git:github.com/user/repo@v2
```

**本地路径安装**：
```bash
pi install /absolute/path/to/extension
pi install ./relative/path
```

**手动复制**：
```bash
# 全局
cp my-extension.ts ~/.pi/agent/extensions/

# 项目本地
mkdir -p .pi/extensions
cp my-extension.ts .pi/extensions/
```

### 6.2 配置

安装后会自动写入 settings.json。`pi install` 默认写入 `~/.pi/agent/settings.json`（全局），`pi install -l` 写入 `.pi/settings.json`（项目）。

settings.json 中的 packages 字段：
```json
{
  "packages": [
    "npm:@foo/bar@1.0.0",
    "git:github.com/user/repo@v1",
    {
      "source": "npm:my-package",
      "extensions": ["extensions/*.ts", "!extensions/legacy.ts"],
      "skills": [],
      "prompts": ["prompts/review.md"]
    }
  ]
}
```

对象形式支持过滤：
- 省略字段 -- 加载该类型全部资源
- `[]` -- 不加载该类型任何资源
- `!pattern` -- 排除匹配项
- `+path` -- 强制包含精确路径
- `-path` -- 强制排除精确路径

### 6.3 启用/禁用

```bash
pi config    # 交互式启用/禁用资源
```

settings.json 中也可以通过 `extensions` 字段的 `!`/`+`/`-` 前缀模式控制：

```json
{
  "extensions": [
    "!legacy-ext.ts",
    "+important-ext.ts"
  ]
}
```

自动发现的扩展可以通过 override 模式禁用：
- `!pattern` -- 从自动发现中排除
- `-path` -- 强制排除精确路径
- `+path` -- 强制包含精确路径

### 6.4 更新与卸载

**更新**：
```bash
pi update              # 更新所有非 pinned 包
pi update npm:@foo/bar # 更新指定包
```

- Pinned 包（带 `@version` 或 `@ref`）不会被更新
- npm 包：重新 `npm install`
- git 包：`fetch + reset --hard + clean + npm install`

**卸载**：
```bash
pi remove npm:@foo/bar     # 全局卸载
pi remove -l npm:@foo/bar  # 项目本地卸载
```

- npm 包：运行 `npm uninstall`
- git 包：删除克隆目录
- 本地路径：仅从 settings.json 移除（不删除文件）

**手动卸载**：
```bash
# 删除全局扩展文件
rm ~/.pi/agent/extensions/my-extension.ts

# 删除项目本地扩展
rm .pi/extensions/my-extension.ts
```

查看已安装：
```bash
pi list    # 显示 settings 中的包
```

---

## 7. 带依赖的 Extension

### 7.1 package.json 示例

来自 `packages/coding-agent/examples/extensions/with-deps/package.json`：

```json
{
  "name": "pi-extension-with-deps",
  "private": true,
  "version": "1.18.2",
  "type": "module",
  "pi": {
    "extensions": [
      "./index.ts"
    ]
  },
  "dependencies": {
    "ms": "^2.1.3"
  },
  "devDependencies": {
    "@types/ms": "^2.1.0"
  }
}
```

对应的 `index.ts`（`packages/coding-agent/examples/extensions/with-deps/index.ts`）：

```typescript
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import ms from "ms";  // 来自自己的 node_modules

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "parse_duration",
    label: "Parse Duration",
    description: "Parse a human-readable duration string to milliseconds",
    parameters: Type.Object({
      duration: Type.String({ description: "Duration string like '2 days', '1h'" }),
    }),
    execute: async (_toolCallId, params) => {
      const result = ms(params.duration as ms.StringValue);
      if (result === undefined) {
        return {
          content: [{ type: "text", text: `Invalid duration: "${params.duration}"` }],
          isError: true,
          details: {},
        };
      }
      return {
        content: [{ type: "text", text: `${params.duration} = ${result} milliseconds` }],
        details: {},
      };
    },
  });
}
```

### 7.2 依赖安装机制

**本地开发**：
```bash
cd my-extension/
npm install
```

jiti 会从 Extension 所在目录的 `node_modules/` 解析第三方依赖。

**npm 包安装**：
`pi install npm:my-extension` 内部调用 `npm install`，自动安装依赖。

**git 包安装**：
`installGit()` 在 clone 后自动检查 `package.json` 并执行 `npm install`：
```typescript
// @ packages/coding-agent/src/core/package-manager.ts:1176-1179
const packageJsonPath = join(targetDir, "package.json");
if (existsSync(packageJsonPath)) {
  await this.runCommand("npm", ["install"], { cwd: targetDir });
}
```

**关于 pi 核心包**：
pi 的内置包（`@mariozechner/pi-coding-agent` 等）通过 `virtualModules`（Bun binary）或 `alias`（Node.js 开发模式）机制提供，不需要 Extension 自己安装。这些应放在 `peerDependencies` 中：

```json
{
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@mariozechner/pi-ai": "*",
    "@mariozechner/pi-tui": "*",
    "@mariozechner/pi-agent-core": "*",
    "@sinclair/typebox": "*"
  }
}
```

**关于 bundledDependencies**：
如果依赖其他 pi 包，需要打包它们：
```json
{
  "dependencies": {
    "another-pi-package": "^1.0.1"
  },
  "bundledDependencies": ["another-pi-package"],
  "pi": {
    "extensions": ["extensions", "node_modules/another-pi-package/extensions"]
  }
}
```

---

## 8. 快速开始清单

### 从创建到发布的完整步骤

**第一步：创建单文件 Extension**

```bash
mkdir -p ~/.pi/agent/extensions
cat > ~/.pi/agent/extensions/my-first-ext.ts << 'TYPESCRIPT'
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function (pi: ExtensionAPI) {
  pi.on("session_start", async (_event, ctx) => {
    ctx.ui.notify("My extension loaded!", "info");
  });

  pi.registerCommand("greet", {
    description: "Say hello",
    handler: async (args, ctx) => {
      ctx.ui.notify(`Hello, ${args || "world"}!`, "info");
    },
  });
}
TYPESCRIPT
```

**第二步：测试**

```bash
# 启动 pi，扩展自动加载
pi

# 或用 -e 参数临时测试
pi -e ~/.pi/agent/extensions/my-first-ext.ts
```

**第三步：升级为带依赖的包**

```bash
mkdir my-pi-package && cd my-pi-package

# 创建 package.json
cat > package.json << 'JSON'
{
  "name": "my-pi-package",
  "version": "1.0.0",
  "keywords": ["pi-package"],
  "pi": {
    "extensions": ["./extensions/index.ts"]
  },
  "peerDependencies": {
    "@mariozechner/pi-coding-agent": "*",
    "@sinclair/typebox": "*"
  },
  "dependencies": {
    "ms": "^2.1.3"
  }
}
JSON

mkdir extensions
# 编写 extensions/index.ts ...

npm install
pi -e ./  # 测试
```

**第四步：发布到 npm**

```bash
npm publish
```

**第五步：发布到 git**

```bash
git init && git add . && git commit -m "Initial release"
git remote add origin git@github.com:username/my-pi-package.git
git push -u origin main
git tag v1.0.0 && git push --tags
```

**第六步：用户安装**

```bash
# npm
pi install npm:my-pi-package

# git
pi install git:github.com/username/my-pi-package
pi install git:github.com/username/my-pi-package@v1.0.0

# 临时试用
pi -e npm:my-pi-package
pi -e git:github.com/username/my-pi-package
```

**第七步：维护**

```bash
# 用户更新
pi update

# 版本迭代
npm version patch
npm publish
```

---

## 附录：事件生命周期概览

```
pi 启动
  └─> session_start
      |
      v
用户输入 ────────────────────────────────────────────┐
  ├─> (检查 extension commands，匹配则直接执行)      |
  ├─> input (可拦截/转换/处理)                        |
  ├─> (skill/template 展开)                          |
  ├─> before_agent_start (可注入消息/修改 system prompt)
  ├─> agent_start                                    |
  │   ┌── turn (LLM 调用工具时重复) ──┐              |
  │   ├─> turn_start                  |              |
  │   ├─> context (可修改消息)        |              |
  │   │   LLM 响应:                   |              |
  │   │     ├─> tool_call (可阻止)    |              |
  │   │     ├─> tool_execution_*      |              |
  │   │     └─> tool_result (可修改)  |              |
  │   └─> turn_end                    |              |
  └─> agent_end                                      |
                                                     |
用户再次输入 <────────────────────────────────────────┘

session 操作:
  /new, /resume  -> session_before_switch (可取消) -> session_switch
  /fork          -> session_before_fork (可取消)   -> session_fork
  /compact       -> session_before_compact (可取消) -> session_compact
  /tree          -> session_before_tree (可取消)    -> session_tree
  model 变更     -> model_select
  退出           -> session_shutdown
```
