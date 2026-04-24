# Verification: readState shape validation

**Verdict: PASS**

## Checklist

### 1. Reads as `unknown` — PASS

```ts
const data = await readJsonStrict<unknown>(join(fsmDir(sessionDir, fsmId), "state.json"));
```

Parsed JSON is typed `unknown`, not pre-cast to `StateFile`.

### 2. Validates both required fields — PASS

```ts
const obj = data as Record<string, unknown>;
if (
    typeof data !== "object" || data === null ||
    typeof obj.current_state_id !== "string" ||
    typeof obj.entered_at !== "string"
) {
```

Checks: (a) is a non-null object, (b) `current_state_id` is string, (c) `entered_at` is string.

### 3. Descriptive error message — PASS

```ts
throw new CorruptedStateError(..., "invalid shape: missing current_state_id or entered_at");
```

Identifies the file path (via first arg) and names the missing fields.

### 4. Sound cast pattern — PASS

```ts
return data as StateFile;
```

The cast occurs only after validation confirms the shape. The intermediate `obj = data as Record<string, unknown>` is a standard narrowing technique to access properties on `unknown` without TS errors while keeping the top-level null/object guard on the original `data` binding.

### 5. Consistency with sibling validators — PASS (with note)

| Function | Read type | Guard pattern | Error detail |
|---|---|---|---|
| `readState` | `<unknown>` | null + object + field types | names missing fields |
| `readTape` | `<unknown>` | null + object + Array reject | describes expected shape |
| `readStack` | `<unknown>` | `!Array.isArray` | implicit |
| `readFsmStructure` | `<FsmStructure>` (pre-cast) | object + `.states` exists | generic "invalid shape" |

`readState` follows the safer `<unknown>` pattern used by `readTape` and `readStack`. `readFsmStructure` is the outlier still using a pre-cast generic — outside scope of this fix but worth noting for a future pass.
