# 给插件加 Tab 补全菜单

写 `skill-ref`（句中 `/` 补全 SKILL/prompt）与 `/impression`、`/save-msg` 的参数菜单时踩出来的经验。
读这篇之前先读 `my-plugins/CONVENTIONS.md`（句柄泄漏、`renderResult` 形状校验那些通用铁律）。

> 文中的 `file:line` 是写作时（2026-07）上游代码的位置，上游改动后以实际代码为准；但下面每条**结论**都是从那份代码实测出来的，不是推测。

---

## 一、先搞清楚补全有两条路

编辑器把补全请求分成两类，分别走完全不同的判定，这是所有困惑的源头。

| | 触发方式 | `options.force` | 谁会被调用 |
|---|---|---|---|
| **自然触发** | 打字 | `false` | 打字符时按字符类别判断（见下） |
| **强制触发** | 按 Tab | `true` | 先过 `shouldTriggerFileCompletion` 闸门 |

Tab 的分派在 `packages/tui/src/components/editor.ts` 的 `handleTabCompletion`：

```ts
if (this.isInSlashCommandContext(beforeCursor) && !beforeCursor.trimStart().includes(" ")) {
    this.handleSlashCommandCompletion();   // force=false —— 行首斜杠命令菜单
} else {
    this.forceFileAutocomplete(true);      // force=true  —— 其余一切
}
```

`isInSlashCommandContext` = `trimStart().startsWith("/")`。由此得到两条可直接用的判据：

- **`force === true` ⟺ 不是"行首斜杠命令名"那个菜单。** 想接管"句中的某个 token"，判 `force` 就够了，不必自己去猜光标在哪。
- 行首命令**名**的补全永远走 `force=false`，你只要在 `force !== true` 时原样透传，就绝不会破坏原生菜单。

自然触发的字符类别在 `handleCharacter` 里写死（`editor.ts:1119-1145`）：`/`（且在消息开头）、`triggerCharacters` 里的符号、以及 `/[a-zA-Z0-9.\-_]/`。**空白字符不在其中**，这条决定了下面第五节那个做不到的需求。

---

## 二、扩展点：装饰器链，且必须在 `session_start` 注册

```ts
pi.on("session_start", (_event, ctx) => {
    ctx.ui.addAutocompleteProvider((current) => myProvider(current));
});
```

- `addAutocompleteProvider(factory)`（`packages/coding-agent/src/core/extensions/types.ts:223`）把 `factory` 压进一个数组，然后从内置 provider 开始逐层包裹（`interactive-mode.ts:625-640`）。你的 `current` 就是下一层。
- **`/reload` 会清空这个数组**（`interactive-mode.ts:1953`）。所以注册必须放在 `session_start` 里，写在扩展顶层的话 reload 一次功能就没了。
- 多个插件各包一层互不影响 —— **前提是每个插件在"不是我的场景"时原样返回 `current` 的结果**。这条是链式共存的唯一契约，破了它就会互相吃掉。

官方参考实现：`packages/coding-agent/examples/extensions/github-issue-autocomplete.ts`。

---

## 三、坑一：`shouldTriggerFileCompletion` 是 Tab 的闸门（最容易中招）

按 Tab 时，编辑器在**请求补全之前**先问这个方法，返回 false 就整个请求作废，你的 `getSuggestions` 根本不会被调用（`editor.ts:2163-2174`）。

而内置实现是（`packages/tui/src/autocomplete.ts` 末尾）：

```ts
shouldTriggerFileCompletion(lines, cursorLine, cursorCol): boolean {
    if (textBeforeCursor.trim().startsWith("/") && !textBeforeCursor.trim().includes(" ")) return false;
    return true;
}
```

注意那个 `.trim()`：它把用户刚打的**尾随空格**抹掉了。于是 `/impression ` 变回 `/impression`，被当成"正在打一个还没打完的裸命令"，返回 false。

**症状**：光标停在 `/mycmd ` 的空格后按 Tab 毫无反应；再多打一个字母（`/mycmd s`）Tab 就好了。当时我们把这个方法原样委托给 `current`，等于自己把门锁上。

**修法**：在自己能补全的位置上主动认领这道门。

```ts
shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
    if (parseMyPosition(lines, cursorLine, cursorCol)) return true;   // 我能补的位置，放行
    return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
}
```

---

## 四、坑二：`getArgumentCompletions` 只覆盖一半

注册命令时可以给 `getArgumentCompletions(argumentPrefix)`，内置 provider 会在 `/cmd <args>` 时调它（`autocomplete.ts:346-350`）。但那段代码在 `!options.force` 分支里 —— **Tab 走不到**。

所以：只用 `getArgumentCompletions` 的话，打字有菜单、按 Tab 没有。要两条路一致，就得自己包一层 provider，在 wrapper 里同时处理 `force=true` 与 `force=false`（wrapper 在链的上层，会先于内置分派拿到请求）。

---

## 五、做不到的事（别浪费时间）

- **空格自动弹菜单**：`/mycmd` + 空格想让菜单自己出来 —— 不行。自然触发不认空白字符（第一节），而 `triggerCharacters` 这个扩展点会显式过滤掉空白字符**和 `/`**（`editor.ts:2214-2225`）。只能靠 Tab。
- **句中 `/` 自然触发**：同上，`/` 注册不进 `triggerCharacters`，句中的 `/` 菜单只能 Tab 唤出。
- **给输入框正文着色**：编辑器把 `layoutLine.text` 原样写出，只对光标处做反显；`EditorTheme` 只有 `borderColor` + `selectList` 两项，没有 token 着色钩子。唯一途径是 `setEditorComponent` 换掉整个编辑器组件，而那个 factory 全局唯一、后注册者覆盖前者，代价远大于收益。

这三条都只能改 `packages/`，而本仓库的规矩是**插件外的东西一律不改**（fork 要持续合上游，核心分叉的代价是长期的合并冲突）。做不到就如实说，不要偷偷改核心。

---

## 六、可复制的骨架

```ts
import type { AutocompleteItem, AutocompleteProvider, AutocompleteSuggestions } from "@earendil-works/pi-tui";
// 只用 import type —— 插件可能被单独安装，不要给它加运行时依赖

export function createMyProvider(current: AutocompleteProvider): AutocompleteProvider {
    return {
        async getSuggestions(lines, cursorLine, cursorCol, opts) {
            const pos = parseMyPosition(lines, cursorLine, cursorCol, opts.force === true);
            if (!pos) return current.getSuggestions(lines, cursorLine, cursorCol, opts);   // 透传！

            const items = candidatesFor(pos);
            if (items.length === 0) return current.getSuggestions(lines, cursorLine, cursorCol, opts);
            return { items, prefix: pos.token };
        },

        applyCompletion(lines, cursorLine, cursorCol, item, prefix) {
            const pos = parseMyPosition(lines, cursorLine, cursorCol, true);
            const isOurs = pos !== null && prefix === pos.token
                && candidatesFor(pos).some((c) => c.value === item.value);
            if (!isOurs) return current.applyCompletion(lines, cursorLine, cursorCol, item, prefix);

            const line = lines[cursorLine] ?? "";
            const next = [...lines];
            next[cursorLine] = `${line.slice(0, pos.tokenStart)}${item.value} ${line.slice(cursorCol)}`;
            return { lines: next, cursorLine, cursorCol: pos.tokenStart + item.value.length + 1 };
        },

        shouldTriggerFileCompletion(lines, cursorLine, cursorCol) {
            if (parseMyPosition(lines, cursorLine, cursorCol, true)) return true;   // 第三节
            return current.shouldTriggerFileCompletion?.(lines, cursorLine, cursorCol) ?? true;
        },
    };
}
```

几处细节都是有原因的：

- **`applyCompletion` 必须自己判断"这一项是不是我给的"**。它对链上所有补全都会被调用，包括别人的。别指望对象引用相等（中间隔着 `SelectList`），用**数据**判断：位置能解析出来、`prefix` 与当前 token 一致、且 `item.value` 在自己的候选集里。三条都满足才接管。
- **返回的 `prefix` 必须是"以 `cursorCol` 结尾的真子串"**。上游用 `cursorCol - prefix.length` 反推替换起点（`autocomplete.ts:383`），编错了会把前面的字吃掉。`prefix` 允许是空串（刚打完空格的位置）。
- **插入后补一个空格**，下一次 Tab 才能接着补下一段（例如 `set ` → 字段名）。
- 现成实现：`my-plugins/impression/src/tab-complete.ts`（命令参数菜单，可直接抄，命令名是参数）、`my-plugins/skill-ref/src/autocomplete.ts`（句中 token 接管）。

---

## 七、菜单外观

- **`prefix` 以 `/` 开头时，菜单自动套用斜杠命令的排版**（`editor.ts:2131`），观感与原生菜单一致，不用自己做。
- **`force && explicitTab && items.length === 1` 时编辑器直接应用，不弹菜单**（`editor.ts:2266`）。所以"唯一候选"的体验是"Tab 一下就补全了"，这是设计如此。
- **可以在 `label` / `description` 里内嵌 ANSI**：`visibleWidth`（`packages/tui/src/utils.ts:216-253`）与 `truncateToWidth`（同文件 `:936`）都显式跳过转义序列，宽度和截断都不会算错。
- **着色收尾要用 `\x1b[39m`（仅恢复前景色）而不是 `\x1b[0m`**：选中行会被 `theme.selectedText()` 整行包裹（`select-list.ts:138-175`），全量 reset 会把该行剩余部分的选中色一并清掉。直接用 `ctx.ui.theme.fg("accent", text)` 最省事 —— 它本来就以 `\x1b[39m` 收尾（`theme.ts:359-363`），而且跟随用户主题。
- 想在被包裹的段落里保持自己的颜色，就**显式重申**一遍（例如描述文本自己再包一层 `muted`），不要依赖外层。

---

## 八、要列 SKILL / prompt 时的数据源

别自己扫目录，用 `pi.getCommands()`（`agent-session.ts:2315-2338`），返回 `{ name, description, source: "extension"|"prompt"|"skill", sourceInfo: { path, baseDir } }`。它就是 pi 自己的口径：用户级、项目级、包与插件贡献的资源全在内，且跟随 `/reload`，没有缓存要失效。

配套的三条事实（都验证过，会直接影响你的设计）：

1. **skill 的 `name` 形如 `skill:<name>`**，prompt 是裸名。
2. **同名资源在加载期就被 first-wins 去重**（`skills.ts:410-427` / `resource-loader.ts:913-936`），输的那份只留一条 collision 诊断、从列表里彻底消失 —— 所以 `(kind, name)` 全局唯一，**不需要路径级标识符**；反过来说，被屏蔽的那份你也加载不了（这是与 pi 口径一致的代价，不要绕过去自己扫盘）。
3. **去重用的 Map 是大小写敏感的**，`Abc` 与 `abc` 能同时存在。所以做精确匹配时**先大小写敏感**，否则"用限定名重调"这个消歧出口本身就是歧义的，模型会绕不出来。skill 的 `description` 是必填的（缺了根本不加载，`skills.ts:303-306`），prompt 缺描述时上游会取正文首个非空行截到 60 字符。

---

## 九、怎么测

拿一个假的 `current` 就能把整条链测掉，不需要真终端：

```ts
const current = {
    async getSuggestions() { calls.push("getSuggestions"); return { items: [...], prefix: "" }; },
    applyCompletion(lines, cursorLine, cursorCol) { calls.push("applyCompletion"); return { lines, cursorLine, cursorCol }; },
};
```

必测的四类：位置解析（含缩进、光标不在行尾、其他命令、裸命令名）、菜单内容与筛选顺序、`applyCompletion` 的替换结果与光标位置、以及**每个该透传的场景确实调到了 `current`**（用上面的 `calls` 数组断言）。第三节那个闸门值得单独钉一条回归：喂一个 `shouldTriggerFileCompletion: () => false` 的假底层，验证你仍然放行自己的位置。

跑法（仓库根目录没装 vitest，只在 `packages/*/node_modules` 里有）：

```bash
node --import tsx --test my-plugins/<plugin>/**/*.test.ts        # node:test，零依赖
packages/coding-agent/node_modules/.bin/vitest --run my-plugins/<plugin>/   # 插件已用 vitest 时
```

最后：**TUI 手感必须人肉过一遍**。至少确认行首 `/` + Tab 与安装前一致、`@` 与其他命令的补全没被吃掉、`/reload` 后功能还在、`pi -p "hi"` 能正常退出。
