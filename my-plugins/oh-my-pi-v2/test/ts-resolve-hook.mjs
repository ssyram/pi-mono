// 一次性 resolve hook 注册器（详见 .pi/AI-learning.md）：
// node --experimental-strip-types --import ./test/ts-resolve-hook.mjs --test test/<file>.test.ts
import { register } from "node:module";

register("./ts-resolve-hooks.mjs", import.meta.url);
