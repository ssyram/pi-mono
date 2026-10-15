# external-Set.md

ES `Set` 构造器。

- Sites: json-settings.ts:10 `new Set<object>()`（copySettings 祖先环检测集）。
- Pre: 无参构造。
- Post: 空集；`add`/`has`/`delete` 各自条目见 external-add/external-has/external-delete。
- Throw domain: 无参构造不抛（容量耗尽属宿主灾难，单独声明）。
