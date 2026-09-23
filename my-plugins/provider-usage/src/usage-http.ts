export type HttpJsonResult =
	| { kind: "json"; value: unknown }
	| { kind: "cancelled" }
	| { kind: "error"; code: "auth" | "network" | "http" | "invalid-response" };

export async function requestJson(
	url: string,
	headers: Record<string, string>,
	signal: AbortSignal,
): Promise<HttpJsonResult> {
	if (signal.aborted) return { kind: "cancelled" };
	let response: Response;
	try {
		response = await fetch(url, {
			method: "GET",
			headers: { ...headers, Accept: "application/json" },
			signal,
			redirect: "error",
		});
	} catch {
		return signal.aborted ? { kind: "cancelled" } : { kind: "error", code: "network" };
	}
	if (signal.aborted) return { kind: "cancelled" };
	if (!response.ok) return { kind: "error", code: response.status === 401 || response.status === 403 ? "auth" : "http" };
	try {
		const value: unknown = await response.json();
		return signal.aborted ? { kind: "cancelled" } : { kind: "json", value };
	} catch {
		return signal.aborted ? { kind: "cancelled" } : { kind: "error", code: "invalid-response" };
	}
}
