import { codexAccountId } from "./codex-account-id.js";
import { findHeader } from "./header-value.js";
import { route as resolveRoute } from "./route.js";
import type { AuthResolution, Route, Selection, SupportedRouteKind, UsageModelRegistry } from "./usage-contract.js";

function defaultAuthorization(route: SupportedRouteKind, apiKey: string | undefined): string | undefined {
	if (!apiKey || apiKey.trim() === "") return undefined;
	return route === "zai-cn" ? apiKey : `Bearer ${apiKey}`;
}

function scopedHeaders(headers: Record<string, string | null> | undefined): string[] {
	return Object.entries(headers ?? {})
		.filter(([name, value]) =>
			typeof value === "string" && value.trim() !== "" &&
			/^(?:x-)?(?:zai[-_]|bigmodel[-_])?(?:organization|project)(?:[-_](?:id|name))?$/i.test(name))
		.map(([name]) => name.toLowerCase());
}

export async function resolveAuth(
	selection: Selection,
	initialRoute: Extract<Route, { kind: SupportedRouteKind }>,
	registry: Pick<UsageModelRegistry, "getApiKeyAndHeaders">,
	signal: AbortSignal,
): Promise<AuthResolution> {
	if (signal.aborted) return { kind: "cancelled" };
	let resolved;
	try {
		resolved = await registry.getApiKeyAndHeaders(selection.model);
	} catch {
		return { kind: "error", code: "auth" };
	}
	if (signal.aborted) return { kind: "cancelled" };
	if (!resolved.ok) return { kind: "error", code: "auth" };
	const effectiveEndpoint = resolved.baseUrl === undefined ? selection.endpoint : resolved.baseUrl;
	const rerouted = resolveRoute(selection, effectiveEndpoint);
	if (rerouted.kind === "error") return { kind: "error", code: "invalid-response" };
	if (rerouted.kind === "unsupported" || rerouted.kind !== initialRoute.kind) return { kind: "unsupported" };
	const scopes = scopedHeaders(resolved.headers);
	if (rerouted.kind === "zai" && scopes.length > 0) return { kind: "unsupported" };
	const organization = findHeader(resolved.headers, "bigmodel-organization");
	const project = findHeader(resolved.headers, "bigmodel-project");
	if (rerouted.kind === "zai-cn" && scopes.length > 0 &&
		(scopes.length !== 2 || !scopes.includes("bigmodel-organization") || !scopes.includes("bigmodel-project") || !organization || !project)) {
		return { kind: "unsupported" };
	}
	const authorization = findHeader(resolved.headers, "authorization") ?? defaultAuthorization(rerouted.kind, resolved.apiKey);
	if (!authorization) return { kind: "error", code: "auth" };
	const headers: Record<string, string> = { Authorization: authorization };
	if (rerouted.kind === "codex") {
		const accountId = codexAccountId(authorization, resolved.headers);
		if (!accountId) return { kind: "error", code: "auth" };
		headers["ChatGPT-Account-Id"] = accountId;
	}
	if (rerouted.kind === "zai-cn" && organization && project) {
		headers["bigmodel-organization"] = organization;
		headers["bigmodel-project"] = project;
	}
	return { kind: "ready", auth: { route: rerouted.kind, endpoint: rerouted.endpoint, headers } };
}
