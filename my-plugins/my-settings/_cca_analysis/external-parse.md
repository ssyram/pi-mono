# external-parse.md

`JSON.parse`。

- Sites: settings-files.ts:30（readSettingsFile 解析文件文本）；json-settings.ts:79（copySettings 往返：stringify 输出再解析）。
- Pre: string（含 BOM 的文本会抛 SyntaxError——文件读取路径按 UTF-8 解码，BOM 处理为 U+FEFF 字符 ⇒ 领先 BOM 抛错 ⇒ OPERATION_FAILED，语义上属"语法损坏"✔ prototype readRawObject）。
- Post: 解析值；对象属性经 CreateDataProperty 写入 ⇒ `__proto__` 键成为自身数据属性（无原型污染）；重复键后写覆盖先写（prototype §1 明示不检测重复键）。
- Throw domain: 非法 JSON ⇒ SyntaxError。settings-files.ts:30 落 ：32 catch；json-settings.ts:79 的入参是同表达式 stringify 的产物（well-formed，ES2019 起 lone surrogate 转义）⇒ 规范上不可达，仍落 ：82。均 contained。
