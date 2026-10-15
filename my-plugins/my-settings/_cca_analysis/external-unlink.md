# external-unlink.md

node:fs/promises `unlink`。

- Sites: settings-files.ts:72 `await unlink(temporary)`（未提交路径清理）。
- Pre: temporary 路径；仅删文件（目录 ⇒ EISDIR/EPERM）。
- Post: 删除存在文件或 reject；无递归。
- Rejection 域: **ENOENT（tmp 本就不存在——如 writeFile 未成功、或已被并发清理）**、EACCES、EPERM ⇒ 落内层 catch（:71-75）⇒ `reportSettingsError`（no-throw）诊断后吞掉。
- 设计关键: 内层 try/catch 使清理失败**不能替换** try 体原 rejection/返回值（finally 语义保护），且保证 action 恒 settle fulfilled。
- 悬挂义务: 宿主 fs 永不 settle ⇒ action 悬起（合同外，queue-L51 报告已列）。
