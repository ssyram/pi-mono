/**
 * WebFetch Tool
 *
 * Fetches content from a URL and returns it as markdown, plain text, or raw HTML.
 * Based on the WebFetch tool from https://github.com/anomalyco/opencode
 *
 * Usage:
 *   Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 *   The agent can then call web_fetch to read any URL.
 *
 * Supports:
 *   - HTML → Markdown conversion (default, via turndown)
 *   - HTML → plain text extraction
 *   - Raw HTML passthrough
 *   - Image responses (returned inline)
 *   - Configurable timeout (default 30s, max 120s)
 */

import { StringEnum } from "@mariozechner/pi-ai";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import TurndownService from "turndown";
import { gfm } from "turndown-plugin-gfm";

const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5 MB
const DEFAULT_TIMEOUT_S = 30;
const MAX_TIMEOUT_S = 120;

const FORMATS = ["markdown", "text", "html"] as const;

const TOOL_PARAMS = Type.Object({
	url: Type.String({ description: "The URL to fetch content from" }),
	format: Type.Optional(
		StringEnum(FORMATS, {
			description:
				"Output format: 'markdown' (default, converts HTML), 'text' (plain text, strips tags), or 'html' (raw HTML).",
		}),
	),
	timeout: Type.Optional(
		Type.Number({
			description: `Request timeout in seconds (default ${DEFAULT_TIMEOUT_S}, max ${MAX_TIMEOUT_S}).`,
		}),
	),
});

// ---------------------------------------------------------------------------
// HTML conversion helpers
// ---------------------------------------------------------------------------

/** Named HTML entities map for single-pass decoding. */
const NAMED_HTML_ENTITIES: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: "\u00A0",
	copy: "\u00A9",
	reg: "\u00AE",
	trade: "\u2122",
	mdash: "\u2014",
	ndash: "\u2013",
	laquo: "\u00AB",
	raquo: "\u00BB",
	hellip: "\u2026",
};

/**
 * Decode HTML entities in a single pass to avoid double-decoding.
 * e.g. &amp;lt; → &lt; (not <), &lt; → <
 */
function decodeHtmlEntities(text: string): string {
	return text.replace(
		/&(?:([a-z]+)|#(\d+)|#x([0-9a-f]+));/gi,
		(_match, name: string, decimal: string, hex: string) => {
			if (name) {
				return NAMED_HTML_ENTITIES[name.toLowerCase()] ?? `&${name};`;
			}
			if (decimal !== undefined && decimal !== "") {
				return String.fromCharCode(Number(decimal));
			}
			if (hex !== undefined && hex !== "") {
				return String.fromCharCode(Number.parseInt(hex, 16));
			}
			return _match;
		},
	);
}

/**
 * Build a regex that strips a paired HTML tag (e.g. <script...>...</script>).
 * Allows optional whitespace in the closing tag: </script  >.
 * Note: this is content-extraction regex for LLM text, not a security sanitiser.
 */
function stripTagRegex(tag: string): RegExp {
	return new RegExp(`<${tag}\\b[^<]*(?:(?!<\\/${tag}\\s*>)<[^<]*)*<\\/${tag}\\s*>`, "gi");
}

/** Strip HTML and return readable plain text. */
function htmlToText(html: string): string {
	return decodeHtmlEntities(
		html
			.replace(stripTagRegex("script"), "")
			.replace(stripTagRegex("style"), "")
			.replace(/<br\s*\/?>/gi, "\n")
			.replace(/<\/p>/gi, "\n\n")
			.replace(/<\/h[1-6]>/gi, "\n\n")
			.replace(/<\/li>/gi, "\n")
			.replace(/<\/tr>/gi, "\n")
			.replace(/<\/td>/gi, "\t")
			.replace(/<\/th>/gi, "\t")
			.replace(/<[^>]+>/g, ""),
	)
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

/** Convert HTML to Markdown using TurndownService. */
function htmlToMarkdown(html: string): string {
	const td = new TurndownService({
		headingStyle: "atx",
		codeBlockStyle: "fenced",
		bulletListMarker: "-",
	});
	td.use(gfm);
	td.remove(["script", "style", "meta", "link", "nav", "header", "footer"]);
	return td.turndown(html);
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

export default function webFetchExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "web_fetch",
		label: "Web Fetch",
		description:
			"Fetch content from any URL (HTTP/HTTPS). Returns the page as Markdown by default (converts HTML), plain text, or raw HTML. Images are returned inline. Useful for reading documentation, articles, APIs, and any web resource.",
		promptSnippet: "web_fetch(url, format?, timeout?): Fetch a URL and return its content",
		promptGuidelines: [
			"Use web_fetch to read online documentation, articles, or any URL the user references.",
			"Default format is markdown — prefer it for LLM-readable output.",
			"Use format=text for cleaner plain-text extraction, format=html to inspect raw markup.",
		],
		parameters: TOOL_PARAMS,

		async execute(_toolCallId, params, signal, _onUpdate, _ctx) {
			if (!params.url.startsWith("http://") && !params.url.startsWith("https://")) {
				throw new Error("URL must start with http:// or https://");
			}

			const timeoutMs = Math.min((params.timeout ?? DEFAULT_TIMEOUT_S) * 1000, MAX_TIMEOUT_S * 1000);
			const controller = new AbortController();
			const timer = setTimeout(() => controller.abort(), timeoutMs);
			if (signal) {
				signal.addEventListener("abort", () => controller.abort(), { once: true });
			}

			const format = params.format ?? "markdown";
			const acceptMap: Record<string, string> = {
				markdown: "text/markdown;q=1.0, text/x-markdown;q=0.9, text/plain;q=0.8, text/html;q=0.7, */*;q=0.1",
				text: "text/plain;q=1.0, text/markdown;q=0.9, text/html;q=0.8, */*;q=0.1",
				html: "text/html;q=1.0, application/xhtml+xml;q=0.9, text/plain;q=0.8, */*;q=0.1",
			};

			const headers: Record<string, string> = {
				"User-Agent":
					"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
				Accept: acceptMap[format] ?? "*/*",
				"Accept-Language": "en-US,en;q=0.9",
			};

			try {
				let response = await fetch(params.url, { signal: controller.signal, headers });

				// Retry with honest UA if Cloudflare blocks with bot challenge
				if (response.status === 403 && response.headers.get("cf-mitigated") === "challenge") {
					response = await fetch(params.url, {
						signal: controller.signal,
						headers: { ...headers, "User-Agent": "pi-coding-agent" },
					});
				}

				clearTimeout(timer);

				if (!response.ok) {
					throw new Error(`Request failed: ${response.status} ${response.statusText}`);
				}

				const contentLength = response.headers.get("content-length");
				if (contentLength && Number.parseInt(contentLength) > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5 MB)");
				}

				const arrayBuffer = await response.arrayBuffer();
				if (arrayBuffer.byteLength > MAX_RESPONSE_SIZE) {
					throw new Error("Response too large (exceeds 5 MB)");
				}

				const contentType = response.headers.get("content-type") ?? "";
				const mime = contentType.split(";")[0]?.trim().toLowerCase() ?? "";

				// Return images inline
				if (mime.startsWith("image/") && mime !== "image/svg+xml") {
					const base64 = Buffer.from(arrayBuffer).toString("base64");
					return {
						content: [
							{ type: "text", text: `Image from ${params.url} (${mime}, ${arrayBuffer.byteLength} bytes)` },
							{ type: "image", data: base64, mimeType: mime },
						],
						details: { url: params.url, format, contentType, bytes: arrayBuffer.byteLength },
					};
				}

				const rawText = new TextDecoder().decode(arrayBuffer);
				const isHtml = contentType.includes("text/html");

				let output: string;
				if (format === "html") {
					output = rawText;
				} else if (format === "text") {
					output = isHtml ? htmlToText(rawText) : rawText;
				} else {
					output = isHtml ? htmlToMarkdown(rawText) : rawText;
				}

				return {
					content: [{ type: "text", text: output }],
					details: { url: params.url, format, contentType, bytes: arrayBuffer.byteLength },
				};
			} catch (err) {
				clearTimeout(timer);
				if (err instanceof Error && (err.name === "AbortError" || err.message.includes("abort"))) {
					throw new Error(`Request timed out after ${timeoutMs / 1000}s`);
				}
				throw err;
			}
		},
	});
}
