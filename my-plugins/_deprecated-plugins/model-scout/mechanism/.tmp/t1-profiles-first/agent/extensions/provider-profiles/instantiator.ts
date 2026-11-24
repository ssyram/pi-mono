/**
 * Instance construction (C3): whitelist copy + model restamping + api-key
 * auth wrapping. Pure with respect to host state — reads its arguments,
 * mutates nothing outside freshly created objects. See docs/detailed.md
 * (D.C3) for the per-field justification table.
 */

import type { ApiKeyAuth, AuthResult, Model, Provider } from "@earendil-works/pi-ai";
import type { ProfileEntry } from "./config-entry.js";

/** Returns a same-length, same-order copy with `provider` rebound to `name`.
 * Nested metadata objects are shared by reference (read-only host data);
 * inputs are never mutated. */
export function restampModels(models: readonly Model[], name: string): Model[] {
	return models.map((model) => ({ ...model, provider: name }));
}

/** Resolve `$VAR` / `${VAR}` templates against process.env (README-documented
 * subset; `!command` execution is deliberately NOT supported for credential
 * fields). Returns undefined when any referenced variable is unset — the
 * entry then counts as unconfigured, matching models.json semantics. */
function resolveEnvTemplate(value: string): string | undefined {
	if (!value.includes("$")) return value;
	let out = "";
	for (let i = 0; i < value.length; i++) {
		const ch = value[i];
		if (ch !== "$") {
			out += ch;
			continue;
		}
		const next = value[i + 1];
		if (next === "$") {
			out += "$";
			i++;
			continue;
		}
		if (next === "!") {
			out += "!";
			i++;
			continue;
		}
		let name: string | undefined;
		if (next === "{") {
			const end = value.indexOf("}", i + 2);
			if (end > 0) {
				const candidate = value.slice(i + 2, end);
				if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(candidate)) name = candidate;
			}
			if (name === undefined) {
				out += "$";
				continue;
			}
			i = end;
		} else {
			const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(value.slice(i + 1));
			if (!match) {
				out += "$";
				continue;
			}
			name = match[0];
			i += name.length;
		}
		const envValue = process.env[name];
		if (envValue === undefined) return undefined;
		out += envValue;
	}
	return out;
}

/** Resolution order (P.local.2.1): own stored credential → own configured
 * apiKey → undefined. Never reads environment variables as an auth fallback
 * (drops the base envApiKeyAuth fallback); `$VAR` templates inside the
 * configured key are expanded once at resolve time; reuses the official
 * login flow untouched. */
export function wrapApiKeyAuth(auth: ApiKeyAuth, configKey: string | undefined): ApiKeyAuth {
	const resolve: ApiKeyAuth["resolve"] = async (input): Promise<AuthResult | undefined> => {
		input.signal.throwIfAborted();
		if (input.credential?.key) {
			input.signal.throwIfAborted();
			return {
				auth: { apiKey: input.credential.key },
				env: input.credential.env,
				source: "stored credential",
			};
		}
		if (configKey !== undefined) {
			const resolvedKey = resolveEnvTemplate(configKey);
			if (resolvedKey === undefined) return undefined;
			return { auth: { apiKey: resolvedKey }, source: "profile config" };
		}
		return undefined;
	};
	return { name: auth.name, login: auth.login, resolve };
}

/** Builds an instance Provider from an official base. Field whitelist is
 * closed (P.local.4.1): id/name rebound, transport fields shared, auth
 * wrapped only for api-key providers, models restamped per call.
 * refreshModels is always absent; filterModels is forwarded only when C2 has
 * source-verified it as safe for this provider. */
export function instanceProvider(base: Provider, entry: ProfileEntry, forwardFilterModels = false): Provider {
	const apiKey = base.auth.apiKey;
	const auth =
		apiKey === undefined
			? base.auth
			: { ...base.auth, apiKey: wrapApiKeyAuth(apiKey, entry.apiKey) };
	return {
		id: entry.name,
		name: `${base.name} (${entry.name})`,
		baseUrl: base.baseUrl,
		headers: base.headers,
		auth,
		getModels: () => restampModels(base.getModels(), entry.name),
		stream: base.stream,
		streamSimple: base.streamSimple,
		...(forwardFilterModels && base.filterModels
			? { filterModels: (models, credential) => base.filterModels!(models, credential) }
			: {}),
	};
}
