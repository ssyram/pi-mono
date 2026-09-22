# 最小接线检查

权威设计见 [design.md](design.md)。当前 candidate 只把两个原始路径数组交给 formatter：

```sh
node --import tsx --test \
  my-plugins/oh-my-pi-v2/test/format-compaction-path-list.test.ts

./node_modules/.bin/tsc --noEmit --strict --skipLibCheck \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --types node \
  my-plugins/oh-my-pi-v2/hooks/format-compaction-path-list.ts \
  my-plugins/oh-my-pi-v2/test/format-compaction-path-list.test.ts

git apply --reverse --check --whitespace=error-all \
  my-plugins/oh-my-pi-v2/docs/simplify-compact-20260911/candidate.patch
```

[candidate.patch](candidate.patch) 是 `compaction-file-operations.ts` 的 `+4/-2` 接线；不包含旧摘要 renderer 变化。完整 facade/runtime 证据见 [verification.md](verification.md)。
