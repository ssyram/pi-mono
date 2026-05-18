/**
 * diagnose-500 — One-shot diagnostic for "yunwu nginx 500 after first reply".
 *
 * Logs every provider request + response to /tmp/pi-500-diag.log:
 *   - request: model, message count, total bytes, last 3 message roles, has tool_calls/tool roles, reasoning_effort
 *   - response: HTTP status, key headers (server, content-type, content-length)
 *
 * Read with: tail -f /tmp/pi-500-diag.log
 */
import { appendFileSync } from "node:fs";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const LOG = "/tmp/pi-500-diag.log";

function ts(): string {
	return new Date().toISOString();
}

function safeStringify(value: unknown): string {
	try {
		return JSON.stringify(value);
	} catch {
		return "<unserializable>";
	}
}

function summarizePayload(payload: any): Record<string, unknown> {
	const messages = Array.isArray(payload?.messages) ? payload.messages : [];
	const bytes = safeStringify(payload).length;
	const lastN = messages.slice(-5).map((m: any) => {
		const role = m?.role ?? "?";
		const hasToolCalls = Array.isArray(m?.tool_calls) && m.tool_calls.length > 0;
		const contentLen =
			typeof m?.content === "string"
				? m.content.length
				: Array.isArray(m?.content)
					? m.content.reduce((acc: number, p: any) => acc + (typeof p?.text === "string" ? p.text.length : 0), 0)
					: 0;
		return `${role}${hasToolCalls ? "+tc" : ""}(${contentLen}c)`;
	});
	return {
		model: payload?.model,
		stream: payload?.stream,
		msgCount: messages.length,
		payloadBytes: bytes,
		reasoning_effort: payload?.reasoning_effort,
		store: payload?.store,
		max_completion_tokens: payload?.max_completion_tokens,
		max_tokens: payload?.max_tokens,
		toolsCount: Array.isArray(payload?.tools) ? payload.tools.length : 0,
		hasPromptCacheKey: payload?.prompt_cache_key !== undefined,
		hasPromptCacheRetention: payload?.prompt_cache_retention !== undefined,
		lastMessages: lastN,
	};
}

function write(line: string): void {
	try {
		appendFileSync(LOG, line + "\n");
	} catch (err) {
		console.error(`[diagnose-500] failed to write log: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export default async function diagnose500(pi: ExtensionAPI) {
	let requestSeq = 0;
	let lastRequestSummary: Record<string, unknown> | null = null;

	pi.on("before_provider_request", async (event) => {
		requestSeq++;
		const summary = summarizePayload(event.payload);
		lastRequestSummary = { seq: requestSeq, ...summary };
		write(`${ts()} REQ #${requestSeq} ${safeStringify(summary)}`);
		return undefined;
	});

	pi.on("after_provider_response", async (event) => {
		const headers = event.headers ?? {};
		const interesting = {
			server: headers.server,
			"content-type": headers["content-type"],
			"content-length": headers["content-length"],
			"x-request-id": headers["x-request-id"],
			"cf-ray": headers["cf-ray"],
		};
		write(
			`${ts()} RESP #${requestSeq} status=${event.status} headers=${safeStringify(interesting)} ` +
				`reqSummary=${safeStringify(lastRequestSummary)}`,
		);
	});

	write(`${ts()} ====== diagnose-500 loaded (pid=${process.pid}) ======`);
}
