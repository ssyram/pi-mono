import type { Route, Selection } from "./usage-contract.js";

export const CODEX_USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";
export const ZAI_USAGE_URL = "https://api.z.ai/api/monitor/usage/quota/limit";
export const ZAI_CN_USAGE_URL = "https://open.bigmodel.cn/api/monitor/usage/quota/limit";

const codexEndpoint = "https://chatgpt.com/backend-api";
const zaiEndpoint = "https://api.z.ai/api/coding/paas/v4";
const zaiCnEndpoint = "https://open.bigmodel.cn/api/coding/paas/v4";

function normalizeEndpoint(endpoint: string): string | undefined {
	if (endpoint.trim() !== endpoint || endpoint === "") return undefined;
	try {
		const url = new URL(endpoint);
		if (
			url.protocol !== "https:" ||
			url.username !== "" ||
			url.password !== "" ||
			url.search !== "" ||
			url.hash !== "" ||
			url.port !== ""
		) {
			return undefined;
		}
		const pathname = url.pathname.replace(/\/+$/, "") || "/";
		return `${url.origin}${pathname}`;
	} catch {
		return undefined;
	}
}

export function route(selection: Selection, effectiveUrl = selection.endpoint): Route {
	const endpoint = normalizeEndpoint(effectiveUrl);
	if (!endpoint) return { kind: "error", code: "invalid-response" };
	if (selection.api === "openai-codex-responses" && endpoint === codexEndpoint) return { kind: "codex", endpoint };
	if (selection.api === "openai-completions" && endpoint === zaiEndpoint) return { kind: "zai", endpoint };
	if (selection.api === "openai-completions" && endpoint === zaiCnEndpoint) return { kind: "zai-cn", endpoint };
	return { kind: "unsupported" };
}
