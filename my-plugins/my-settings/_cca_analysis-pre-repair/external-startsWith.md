# external: startsWith

`String.prototype.startsWith(searchString, position)` — used at settings-files.ts:16 (`within.startsWith(`..${sep}`)`) in `settingsFilePath` root-escape check.

- Pre: receiver is a string (`within` is `node:path.relative` output, always a string); `searchString` is a string (template literal).
- Post: returns boolean. Does not throw for normal string inputs (only throws if receiver is null/undefined or `searchString` is a RegExp — neither constructible here: `relative` returns a string, the argument is a literal).
- Failure relevance: none on this call path; `settingsFilePath`'s own throw contract comes from its explicit `throw` statements (settings-files.ts:12/17), not from this call.
