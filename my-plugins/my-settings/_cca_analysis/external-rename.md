# external-rename.md

node:fs/promises `rename`。

- Sites: settings-files.ts:66 `rename(temporary, target)`（提交点）。
- Pre: temporary 存在（:62 刚写）；与 target 同目录（:59 join(dirname(target),...)）⇒ 同一文件系统。
- Post: POSIX 原子替换：target 存在则整体换入，读者任意时刻只见完整旧/新文件；失败则 target 不动。
- Rejection 域: **EXDEV 跨设备——同目录约束下不可达**（结构排除，非概率排除）；EACCES/EPERM、ENOENT（tmp 被并发删除/目录异动）、EISDIR/EEXIST 目录语义冲突 ⇒ :78 contained；finally unlink 清理 tmp。
- 平台注记: darwin POSIX 语义；Windows 的 EPERM 换入竞态不在目标平台（记录）。
- 崩溃窗口: rename 返回前进程死 ⇒ 文件或已换或未换（原子），无半态；返回值丢失属崩溃一致性（writeSettingsFile 报告已声明）。
