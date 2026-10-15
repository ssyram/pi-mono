# external-String.md

Manifest external `String` — covered for Batch C. Write-once.

## `String(value)` (ES built-in, explicit string conversion)

Site (this batch): settings-error.ts:7 (`message = typeof value === "string" ? value : String(value)` inside settingsFailure).

- Pre: any JS value (this is the escape hatch for non-string values inside the try at settings-error.ts:5-8).
- Post: returns a string. Semantics = ToString after ToPrimitive(value, hint=string): tries `Symbol.toPrimitive` (throw propagates; returning an object is a TypeError), then `toString`, then `valueOf`. Notable safe case: `String(symbol)` is legal and yields `"Symbol(desc)"` (unlike `"" + symbol`, which throws).
- Failure behavior: every exotic throw domain (Proxy get/getPrototypeOf traps, throwing toString/valueOf/Symbol.toPrimitive, circular/self-naming toPrimitive returning objects) propagates synchronously from the call — and is contained at settings-error.ts:8 (empty catch), leaving the `"Unknown settings error"` default. Callers must keep this call inside such a boundary; the in-repo only site does.
- Caller obligations: none beyond the enclosing try — the function is unconditionally no-throw for all argument domains (proved in fn-settings_error-settingsFailure-L3.md).
