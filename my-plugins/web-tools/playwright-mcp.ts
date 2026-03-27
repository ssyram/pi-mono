/**
 * Playwright MCP Extension
 *
 * Connects to the Playwright MCP server (https://github.com/microsoft/playwright-mcp)
 * via stdio and dynamically registers all of its browser-automation tools in pi.
 *
 * The MCP server is launched on demand (first tool call) and shut down when the
 * session ends. All Playwright tools (browser_navigate, browser_click, etc.) become
 * first-class pi tools that the agent can invoke directly.
 *
 * Requirements:
 *   Node.js ≥ 18  (for built-in fetch)
 *   npx / npm available on PATH (to run @playwright/mcp)
 *
 * Usage:
 *   pi --extension playwright-mcp.ts
 *
 *   Or copy to ~/.pi/agent/extensions/  for auto-discovery.
 *
 * The agent can then call browser_navigate, browser_click, browser_snapshot, etc.
 * Run `/playwright-status` to check connection status.
 * Run `/playwright-stop` to shut down the browser.
 *
 * Environment variables (optional):
 *   PLAYWRIGHT_MCP_DEBUG=1  — Log Playwright MCP stderr output for debugging
 */

import { type ChildProcess, spawn } from "node:child_process";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { type TSchema, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// MCP Protocol types (JSON-RPC 2.0 over stdio)
// ---------------------------------------------------------------------------

interface JsonRpcRequest {
	jsonrpc: "2.0";
	id: number;
	method: string;
	params?: unknown;
}

interface JsonRpcNotification {
	jsonrpc: "2.0";
	method: string;
	params?: unknown;
}

interface JsonRpcResponse {
	jsonrpc: "2.0";
	id: number;
	result?: unknown;
	error?: { code: number; message: string; data?: unknown };
}

interface McpToolDefinition {
	name: string;
	description?: string;
	inputSchema?: {
		type?: string;
		properties?: Record<string, McpPropertySchema>;
		required?: string[];
	};
}

interface McpPropertySchema {
	type?: string | string[];
	description?: string;
	enum?: unknown[];
	items?: McpPropertySchema;
	properties?: Record<string, McpPropertySchema>;
	required?: string[];
	default?: unknown;
}

interface McpToolsListResult {
	tools: McpToolDefinition[];
}

interface McpToolCallResult {
	content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
	isError?: boolean;
}

// ---------------------------------------------------------------------------
// JSON-Schema → TypeBox converter (best-effort)
// ---------------------------------------------------------------------------

function jsonSchemaToTypebox(schema: McpPropertySchema | undefined): TSchema {
	if (!schema) return Type.Unknown();

	const desc = schema.description ? { description: schema.description } : {};

	// Enum / literal union
	if (schema.enum && schema.enum.length > 0) {
		// Use Type.Union of literals or just Type.String with description
		if (schema.enum.every((v) => typeof v === "string")) {
			return Type.Union(
				(schema.enum as string[]).map((v) => Type.Literal(v)),
				desc,
			);
		}
	}

	const rawType = Array.isArray(schema.type) ? schema.type[0] : schema.type;

	switch (rawType) {
		case "string":
			return Type.String(desc);
		case "number":
			return Type.Number(desc);
		case "integer":
			return Type.Integer(desc);
		case "boolean":
			return Type.Boolean(desc);
		case "array":
			return Type.Array(jsonSchemaToTypebox(schema.items), desc);
		case "object": {
			const props: Record<string, TSchema> = {};
			const required = new Set(schema.required ?? []);
			for (const [key, val] of Object.entries(schema.properties ?? {})) {
				const inner = jsonSchemaToTypebox(val);
				props[key] = required.has(key) ? inner : Type.Optional(inner);
			}
			return Type.Object(props, { additionalProperties: true, ...desc });
		}
		default:
			return Type.Unknown(desc);
	}
}

function mcpToolToTypebox(tool: McpToolDefinition): TSchema {
	if (!tool.inputSchema || tool.inputSchema.type !== "object") {
		return Type.Object({}, { additionalProperties: true });
	}
	const props: Record<string, TSchema> = {};
	const required = new Set(tool.inputSchema.required ?? []);
	for (const [key, val] of Object.entries(tool.inputSchema.properties ?? {})) {
		const inner = jsonSchemaToTypebox(val);
		props[key] = required.has(key) ? inner : Type.Optional(inner);
	}
	return Type.Object(props, { additionalProperties: true });
}

// ---------------------------------------------------------------------------
// Simple JSON-RPC client over stdio
// ---------------------------------------------------------------------------

class McpStdioClient {
	private process: ChildProcess;
	private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
	private buffer = "";
	private nextId = 1;
	private exited = false;

	constructor(command: string, args: string[]) {
		this.process = spawn(command, args, {
			stdio: ["pipe", "pipe", "pipe"],
		});

		this.process.stdout?.on("data", (chunk: Buffer) => {
			this.buffer += chunk.toString("utf8");
			this.flush();
		});

		this.process.stderr?.on("data", (chunk: Buffer) => {
			// Only log if debug mode is enabled — playwright-mcp is noisy on stderr
			if (process.env.PLAYWRIGHT_MCP_DEBUG) {
				process.stderr.write(chunk);
			}
		});

		this.process.on("exit", () => {
			this.exited = true;
			for (const [, { reject }] of this.pending) {
				reject(new Error("Playwright MCP process exited unexpectedly"));
			}
			this.pending.clear();
		});
	}

	private flush() {
		const lines = this.buffer.split("\n");
		this.buffer = lines.pop() ?? "";
		for (const line of lines) {
			const trimmed = line.trim();
			if (!trimmed) continue;
			let msg: JsonRpcResponse;
			try {
				msg = JSON.parse(trimmed) as JsonRpcResponse;
			} catch {
				continue;
			}
			if (msg.id !== undefined) {
				const pending = this.pending.get(msg.id);
				if (pending) {
					this.pending.delete(msg.id);
					if (msg.error) {
						pending.reject(new Error(msg.error.message ?? "MCP error"));
					} else {
						pending.resolve(msg.result);
					}
				}
			}
		}
	}

	private write(msg: JsonRpcRequest | JsonRpcNotification) {
		if (this.exited) throw new Error("Playwright MCP process has exited");
		this.process.stdin?.write(`${JSON.stringify(msg)}\n`);
	}

	async request<T>(method: string, params?: unknown, timeoutMs = 30_000): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			const id = this.nextId++;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP request '${method}' timed out after ${timeoutMs / 1000}s`));
			}, timeoutMs);
			this.pending.set(id, {
				resolve: (v) => {
					clearTimeout(timer);
					resolve(v as T);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.write({ jsonrpc: "2.0", id, method, params });
		});
	}

	notify(method: string, params?: unknown) {
		this.write({ jsonrpc: "2.0", method, params });
	}

	kill() {
		try {
			this.process.kill("SIGTERM");
		} catch {
			// already gone
		}
	}

	get alive() {
		return !this.exited;
	}
}

// ---------------------------------------------------------------------------
// Extension
// ---------------------------------------------------------------------------

const MCP_COMMAND = "npx";
const MCP_ARGS = ["--yes", "@playwright/mcp@latest"];

export default function playwrightMcpExtension(pi: ExtensionAPI) {
	let client: McpStdioClient | null = null;
	let tools: McpToolDefinition[] = [];
	let registered = false;

	// ------------------------------------------------------------------
	// Launch and initialise the MCP server
	// ------------------------------------------------------------------
	async function startClient(ctx: ExtensionContext): Promise<McpStdioClient> {
		ctx.ui.notify("Starting Playwright MCP server (this may take a moment)…", "info");

		const c = new McpStdioClient(MCP_COMMAND, MCP_ARGS);

		// MCP handshake
		await c.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: { tools: {} },
			clientInfo: { name: "pi-coding-agent", version: "1.0.0" },
		});
		c.notify("notifications/initialized");

		// Fetch tool list
		const listResult = await c.request<McpToolsListResult>("tools/list");
		tools = listResult.tools ?? [];

		ctx.ui.notify(`Playwright MCP ready — ${tools.length} tools available`, "info");
		return c;
	}

	// ------------------------------------------------------------------
	// Ensure client is running (lazy start)
	// ------------------------------------------------------------------
	async function ensureClient(ctx: ExtensionContext): Promise<McpStdioClient> {
		if (client?.alive) return client;
		client = await startClient(ctx);
		return client;
	}

	// ------------------------------------------------------------------
	// Register all Playwright tools once we know what they are
	// ------------------------------------------------------------------
	async function registerPlaywrightTools(ctx: ExtensionContext) {
		if (registered) return;

		// Start client now so we can register the real tools.
		// Only set registered=true after a successful start so that a transient
		// startup failure does not permanently prevent retrying on next call.
		try {
			await ensureClient(ctx);
		} catch (err) {
			ctx.ui.notify(`Playwright MCP failed to start: ${err instanceof Error ? err.message : String(err)}`, "error");
			return;
		}

		registered = true;

		for (const tool of tools) {
			const toolName = tool.name;
			const description = tool.description ?? `Playwright browser action: ${toolName}`;
			const parameters = mcpToolToTypebox(tool);

			pi.registerTool({
				name: toolName,
				label: toolName.replace(/_/g, " "),
				description,
				parameters,

				async execute(_toolCallId, params, signal, onUpdate, ctx2) {
					const c = await ensureClient(ctx2);

					onUpdate?.({
						content: [{ type: "text", text: `Running ${toolName}…` }],
						details: { tool: toolName },
					});

					const abortController = new AbortController();
					const onParentAbort = () => abortController.abort();
					if (signal) {
						signal.addEventListener("abort", onParentAbort, { once: true });
					}

					// Race the MCP call against the abort signal
					const callPromise = c.request<McpToolCallResult>("tools/call", {
						name: toolName,
						arguments: params,
					});

					const abortPromise = new Promise<never>((_, reject) => {
						abortController.signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
					});

					let result: McpToolCallResult;
					try {
						result = await Promise.race([callPromise, abortPromise]);
					} finally {
						// Remove listener to prevent leaking if signal is long-lived and never aborted
						if (signal) {
							signal.removeEventListener("abort", onParentAbort);
						}
					}

					if (result.isError) {
						const errText = result.content.map((block) => block.text ?? "").join("\n");
						throw new Error(`Playwright tool error: ${errText}`);
					}

					// Convert MCP content blocks to pi content blocks
					const content: Array<
						{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
					> = [];

					for (const block of result.content) {
						if (block.type === "text" && block.text) {
							content.push({ type: "text", text: block.text });
						} else if (block.type === "image" && block.data) {
							content.push({
								type: "image",
								data: block.data,
								mimeType: block.mimeType ?? "image/png",
							});
						} else if (block.text) {
							// Fallback: treat any block with text as text
							content.push({ type: "text", text: block.text });
						}
					}

					if (content.length === 0) {
						content.push({ type: "text", text: `${toolName} completed.` });
					}

					return { content, details: { tool: toolName } };
				},
			});
		}
	}

	// ------------------------------------------------------------------
	// Commands
	// ------------------------------------------------------------------
	pi.registerCommand("playwright-status", {
		description: "Show Playwright MCP connection status",
		handler: async (_args, ctx) => {
			if (!client) {
				ctx.ui.notify("Playwright MCP: not started", "info");
			} else if (client.alive) {
				ctx.ui.notify(`Playwright MCP: running — ${tools.length} tools registered`, "info");
			} else {
				ctx.ui.notify("Playwright MCP: process has exited", "warning");
			}
		},
	});

	pi.registerCommand("playwright-stop", {
		description: "Stop the Playwright MCP server and close the browser",
		handler: async (_args, ctx) => {
			if (!client) {
				ctx.ui.notify("Playwright MCP is not running", "warning");
				return;
			}
			client.kill();
			client = null;
			registered = false;
			ctx.ui.notify("Playwright MCP stopped", "info");
		},
	});

	// ------------------------------------------------------------------
	// Lifecycle
	// ------------------------------------------------------------------
	pi.on("session_start", async (_event, ctx) => {
		await registerPlaywrightTools(ctx);
	});

	pi.on("session_shutdown", async () => {
		if (client) {
			client.kill();
			client = null;
		}
	});
}
