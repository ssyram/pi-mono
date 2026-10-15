# external-readFile.md

node:fs/promises `readFile`。

- Sites: settings-files.ts:29 `readFile(path, "utf8")`。
- Pre: path 为可解析路径（string/Buffer/URL）；encoding "utf8" ⇒ 返回 string。
- Rejection 域（全谱，均落 settings-files.ts:32 catch）: ENOENT（文件或目录分量缺失 → :34 特判成功空对象）、EISDIR（路径是目录）、EACCES/EPERM、ELOOP（符号链接环）、EMFILE/ENFILE（fd 耗尽）、路径含 NUL（ERR_INVALID_ARG_VALUE）、path 非 string（同步 TypeError 被 async 帧折叠为 rejection）、ENOTDIR（分量是文件）。
- 语义注记: UTF-8 非法字节序列以 U+FFFD 替换（不 reject）⇒ 后续 JSON.parse 按内容判定；带 BOM 文件 ⇒ parse SyntaxError ⇒ OPERATION_FAILED（"语法损坏"语义 ✔）。
- 悬挂义务: 宿主 fs 层 promise 永不 settle 时调用方悬挂（JS 异常合同外，readSettingsFile 报告已列）。
