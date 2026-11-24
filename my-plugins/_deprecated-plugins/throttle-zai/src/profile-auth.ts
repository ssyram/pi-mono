/** Instance api-key auth policy: own stored credential -> own configured apiKey ($VAR/${VAR}
 * expansion) -> undefined. Mirrors provider-profiles' wrapApiKeyAuth until E1 exports it
 * publicly; same resolution order, no ambient env fallback for the instance key itself. */
import type { ApiKeyAuth, AuthResult } from "@earendil-works/pi-ai";

function resolveEnvTemplate(value: string, env: (name: string) => string | undefined): string | undefined {
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
		const envValue = env(name);
		if (envValue === undefined) return undefined;
		out += envValue;
	}
	return out;
}

export function wrapApiKeyAuth(auth: ApiKeyAuth, configKey: string | undefined): ApiKeyAuth {
	const resolve: ApiKeyAuth["resolve"] = async (input): Promise<AuthResult | undefined> => {
		input.signal.throwIfAborted();
		if (input.credential?.key) {
			return {
				auth: { apiKey: input.credential.key },
				env: input.credential.env,
				source: "stored credential",
			};
		}
		if (configKey !== undefined) {
			const resolvedKey = resolveEnvTemplate(configKey, (name) => process.env[name]);
			if (resolvedKey === undefined) return undefined;
			return { auth: { apiKey: resolvedKey }, source: "profile config" };
		}
		return undefined;
	};
	return { name: auth.name, ...(auth.login ? { login: auth.login } : {}), resolve };
}
