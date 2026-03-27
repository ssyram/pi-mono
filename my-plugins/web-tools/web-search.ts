/**
 * WebSearch Tool
 *
 * Searches the web using the Exa AI search engine (via its public MCP endpoint).
 * Based on the WebSearch tool from https://github.com/anomalyco/opencode
 *
 * No API key required — uses Exa's free public MCP endpoint.
 *
 * Usage:
 *   Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 *   The agent can then call web_search to search the web.
 *
 * Search types:
 *   - auto   (default): balanced search
 *   - fast:  quick top results
 *   - deep:  comprehensive search
 *
 * Live crawl modes:
 *   - fallback  (default): use cached results, fall back to live crawl if unavailable
 *   - preferred: prioritize live crawling for fresher results
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";

const EXA_MCP_URL = "https://mcp.exa.ai/mcp";
const DEFAULT_NUM_RESULTS = 8;
const TIMEOUT_MS = 25_000;

const SEARCH_TYPES = ["auto", "fast", "deep"] as const;
const LIVECRAWL_MODES = ["fallback", "preferred"] as const;

const TOOL_PARAMS = Type.Object({
	query: Type.String({ description: "The search query" }),
	numResults: Type.Optional(
		Type.Number({ description: `Number of results to return (default: ${DEFAULT_NUM_RESULTS})` }),
	),
	type: Type.Optional(
		StringEnum(SEARCH_TYPES, {
			description: "'auto' (default): balanced search; 'fast': quick results; 'deep': comprehensive search",
		}),
	),
	livecrawl: Type.Optional(
		StringEnum(LIVECRAWL_MODES, {
			description:
				"'fallback' (default): use live crawl as backup; 'preferred': prioritize fresh live-crawled results",
		}),
	),
	contextMaxCharacters: Type.Optional(
		Type.Number({ description: "Max characters per result context string (default: 10000)" }),
	),
});

interface ExaMcpRequest {
	jsonrpc: "2.0";
	id: number;
	method: "tools/call";
	params: {
		name: "web_search_exa";
		arguments: {
			query: string;
			numResults?: number;
			livecrawl?: "fallback" | "preferred";
			type?: "auto" | "fast" | "deep";
			contextMaxCharacters?: number;
		};
	};
}

interface ExaMcpResponse {
	jsonrpc: string;
	result?: {
		content?: Array<{ type: string; text: string }>;
	};
	error?: { code: number; message: string };
}

/** Parse an SSE (Server-Sent Events) response body and extract the first data line. */
function parseSseData(text: string): ExaMcpResponse | undefined {
	for (const line of text.split("\n")) {
		const trimmed = line.trim();
		if (trimmed.startsWith("data: ")) {
			try {
				return JSON.parse(trimmed.slice(6)) as ExaMcpResponse;
			} catch {
				// continue scanning
			}
		}
	}
	return undefined;
}

export default function webSearchExtension(pi: ExtensionAPI) {
	const currentYear = new Date().getFullYear();

	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: `Search the web for up-to-date information using Exa AI. Returns relevant results with content summaries. Use this to find current information, documentation, or anything beyond the training cutoff (current year: ${currentYear}).`,
		promptSnippet: "web_search(query, numResults?, type?, livecrawl?): Search the web for current information",
		promptGuidelines: [
			"Use web_search when you need current information not in your training data.",
			"Prefer 'fast' type for quick fact lookups, 'deep' for research-heavy queries.",
			"Follow up interesting results with web_fetch to get the full page content.",
		],
		parameters: TOOL_PARAMS,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
				// If the signal is already aborted (e.g. caller aborted before execute was called),
				// addEventListener will never fire — check immediately.
				if (signal.aborted) {
					controller.abort();
				}
			}

			const body: ExaMcpRequest = {
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: {
					name: "web_search_exa",
					arguments: {
						query: params.query,
						type: params.type ?? "auto",
						numResults: params.numResults ?? DEFAULT_NUM_RESULTS,
						livecrawl: params.livecrawl ?? "fallback",
						contextMaxCharacters: params.contextMaxCharacters,
					},
				},
			};

			try {
				const response = await fetch(EXA_MCP_URL, {
					method: "POST",
					headers: {
						"Content-Type": "application/json",
						Accept: "application/json, text/event-stream",
					},
					body: JSON.stringify(body),
					signal: controller.signal,
				});

				clearTimeout(timer);

				if (!response.ok) {
					const errorText = await response.text();
					throw new Error(`Search request failed (${response.status}): ${errorText}`);
				}

				const responseText = await response.text();

				// Exa MCP returns SSE or plain JSON — try both
				let data: ExaMcpResponse | undefined;
				if (responseText.trimStart().startsWith("{")) {
					try {
						data = JSON.parse(responseText) as ExaMcpResponse;
					} catch {
						// fall through to SSE parsing
					}
				}
				data ??= parseSseData(responseText);

				if (data?.error) {
					throw new Error(`Search error: ${data.error.message}`);
				}

				const text = data?.result?.content?.[0]?.text;
				if (text) {
					return {
						content: [{ type: "text", text }],
						details: { query: params.query, numResults: params.numResults ?? DEFAULT_NUM_RESULTS },
					};
				}

				return {
					content: [{ type: "text", text: "No results found. Try rephrasing your query." }],
					details: { query: params.query, numResults: params.numResults ?? DEFAULT_NUM_RESULTS },
				};
			} catch (err) {
				clearTimeout(timer);
				if (err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"))) {
					throw new Error(`Search timed out after ${TIMEOUT_MS / 1000}s`);
				}
				throw err;
			}
		},
	});
}
