# external-isArray.md

Manifest external `isArray` — covered for Batch C. Write-once.

## `Array.isArray(value)` (ES built-in)

Sites (this batch): settings-service.ts:26 (handler rejects array-valued `data.session` before resolveSession). Other known in-repo sites: settings-operation.ts:15 (readDataFields) — owned by another batch; semantics below are site-independent.

- Pre: any JS value; no observable side effects on ordinary objects. For a Proxy, `isArray` consults the proxy target's internal slot via IsArray (proxy [[ProxyHandler]] is NOT invoked) — it cannot throw on any input.
- Post: `true` iff the value is a real Array (cross-realm safe); `false` otherwise (including Proxy-of-array? — spec: IsArray on a Proxy recurses into the target, so Proxy([]) is true; exotic typed arrays are false).
- Failure behavior: cannot throw for any argument; no caller-side containment required.
- Caller obligations: none. Its role in the handler is narrowing the resolver's argument domain to plain `object` (Batch B discharge, settings-service.ts:26).
