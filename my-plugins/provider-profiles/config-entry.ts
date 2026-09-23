/**
 * Profile entry validation for provider-profiles. Pure data layer: no file
 * access, no host state, no side effects. See docs/detailed.md (C1).
 *
 * Config shape: a JSON object mapping profile names to entries:
 *   { "codex-002": { "provider": "openai-codex" },
 *     "zai-001": { "provider": "zai", "apiKey": "$ZAI_KEY_001" } }
 * Unknown fields inside an entry are ignored. JSON object keys are unique
 * after parsing, so in-config duplicate names are structurally impossible.
 *
 * The provider-value set and the oauth/apiKey rule are supplied by the caller
 * (derived from official factory products at load) — unrecognized providers
 * are always rejected.
 */

export interface ProfileEntry {
	readonly name: string;
	readonly provider: string;
	readonly apiKey?: string;
}

export interface EntryError {
	readonly name: string;
	readonly reason: string;
}

export interface ValidationContext {
	/** Names an instance id must not take (all built-in ids). */
	readonly nameDenylist: ReadonlySet<string>;
	/** Same-name models.json entries containing provider fields or model headers. */
	readonly modelsJsonConflicts: ReadonlySet<string>;
	/** Built-in ids usable as a profile source. */
	readonly supportedSources: ReadonlySet<string>;
	/** Sources whose auth is OAuth (these reject the apiKey field). */
	readonly oauthSources: ReadonlySet<string>;
}

const NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Keys that collide with inherited Object.prototype properties in host
 * object-backed credential storage (G-07: `constructor` made a configured
 * instance unavailable). Exact-match only; lowercase variants do not collide. */
const RESERVED_STORAGE_KEYS: ReadonlySet<string> = new Set(Object.getOwnPropertyNames(Object.prototype));

export function parseEntries(
	raw: Readonly<Record<string, unknown>>,
	validation: ValidationContext,
): { entries: ProfileEntry[]; errors: EntryError[] } {
	const entries: ProfileEntry[] = [];
	const errors: EntryError[] = [];
	for (const [name, value] of Object.entries(raw)) {
		const fail = (reason: string): void => {
			errors.push({ name, reason });
		};
		if (!NAME_PATTERN.test(name)) {
			fail("name must match ^[a-z0-9][a-z0-9-]{0,63}$");
			continue;
		}
		if (RESERVED_STORAGE_KEYS.has(name)) {
			fail("name is reserved by host credential storage (e.g. constructor)");
			continue;
		}
		if (validation.nameDenylist.has(name)) {
			fail("name collides with a built-in provider id");
			continue;
		}
		if (validation.modelsJsonConflicts.has(name)) {
			fail("models.json defines provider settings or model headers for this name; only modelOverrides are allowed");
			continue;
		}
		if (typeof value !== "object" || value === null || Array.isArray(value)) {
			fail("entry must be a JSON object");
			continue;
		}
		const record = value as Record<string, unknown>;
		if (typeof record.provider !== "string" || !validation.supportedSources.has(record.provider)) {
			fail("provider must be a recognized built-in provider (dynamic-catalog providers are not supported)");
			continue;
		}
		const provider = record.provider;
		if (validation.oauthSources.has(provider)) {
			if (record.apiKey !== undefined) {
				fail(`${provider} uses OAuth login; apiKey is not accepted`);
				continue;
			}
			entries.push({ name, provider });
			continue;
		}
		if (record.apiKey !== undefined && (typeof record.apiKey !== "string" || record.apiKey === "")) {
			fail("apiKey must be a non-empty string");
			continue;
		}
		entries.push(
			record.apiKey === undefined
				? { name, provider }
				: { name, provider, apiKey: record.apiKey as string },
		);
	}
	return { entries, errors };
}
