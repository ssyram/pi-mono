# 验证证据

## 结果

- 完整相关离线套件：61 tests / 11 suites，61 pass，0 fail。
- formatter 直接套件：10/10；覆盖深层/非相邻前缀、根文件、不同根、重复、终点兼父节点、opaque 局部旁路、已分组输入原样、128 组多重集合、12,000 层和异常回退。
- 一次定向运行遍历 65,536 个 UTF-16 code unit，并覆盖孤立 surrogate、控制字符、emoji 与 `A/{B/{C,D},E/F}`；均返回字符串且不长于 baseline，opaque 原文仍存在。
- finalization 回归确认：ON/OFF 的本轮 read/modified 清单压缩；上一轮 suffix 原样进入 prompt；最终只追加本轮新 suffix。
- production handler、fallback、两轮 compaction、reference codec/state 和 OFF prompt 字节一致性测试通过；provider guard 未触发。
- formatter 与直接测试的 standalone strict tsc 退出 0。
- formatter、直接测试和 finalization 测试通过合成纳入路径的 Biome check/format 字节一致性；插件目录本身不在根 Biome includes 中。
- 快速 Hoare 结论为 OK，见 [hoare-review-result.md](hoare-review-result.md)。

## 命令

```sh
node --import tsx \
  --import ./my-plugins/oh-my-pi-v2/test/prepare-compaction-request-loader.mjs \
  --import ./my-plugins/oh-my-pi-v2/test/custom-compaction-runtime-loader.mjs \
  --test \
  my-plugins/oh-my-pi-v2/test/custom-compaction*.test.ts \
  my-plugins/oh-my-pi-v2/test/prepare-compaction-request*.test.ts \
  my-plugins/oh-my-pi-v2/test/compaction-reference-*.test.ts \
  my-plugins/oh-my-pi-v2/test/format-compaction-path-list.test.ts
```

## 全仓门禁

隔离 detached worktree 的 `npm run check` 与 commit hook 均被既有 `packages/ai/test/**`、`packages/coding-agent/test/**` 模型目录类型错误阻塞；没有目标路径诊断。因此不能声称全仓门禁绿色。

## 未覆盖边界

- 没有为最终保守版本要求新的 live compact：当前旧 `F` 已是压缩表示，再 compact 不能区分是否重压旧 suffix；新 `F'` 行为由离线 facade 测试覆盖。
- 完整 compact 仍包含原有模型调用；formatter 本身不调用模型。
- baseline join、模块加载、恶意运行时输入和不可恢复资源终止不在回退保证内。
