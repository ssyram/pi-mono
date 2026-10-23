import { isAdmissionObject } from "../admission/parse-policy-input.ts";
import { startOwnedProcess, type OwnedProcess } from "../process/owned-process.ts";
import { RuntimeError } from "../runtime/runtime-error.ts";

interface PendingRpc {
	readonly onProgress?: (params: unknown) => void;
	resolve(value: unknown): void;
	reject(error: RuntimeError): void;
	cleanup(): void;
}
export interface RpcOptions {
	readonly deadline: number;
	readonly signal?: AbortSignal;
	readonly onProgress?: (params: unknown) => void;
}

export class McpTransport {
	private readonly process: OwnedProcess;
	private readonly pending = new Map<number, PendingRpc>();
	private buffer = "";
	private nextId = 0;
	private usable = true;
	private failureReason = "closed";
	private readonly capacity: number;

	constructor(command: string, args: readonly string[], env: NodeJS.ProcessEnv, capacity = 64) {
		if (!Number.isInteger(capacity) || capacity < 1) throw new RuntimeError("protocol-invalid");
		this.capacity = capacity;
		this.process = startOwnedProcess(command, args, env);
		this.process.child.stdout.setEncoding("utf8");
		this.process.child.stdout.on("data", (chunk: string) => this.consume(chunk));
		this.process.child.stderr.resume();
		this.process.child.stdin.on("error", () => this.fail("stdin-error"));
		void this.process.closed.then((exit) => this.fail(`peer-exit-${exit.code ?? exit.signal ?? "unknown"}`));
	}

	private fail(reason = "closed"): void {
		if (this.usable) this.failureReason = reason;
		this.usable = false;
		for (const entry of this.pending.values()) { entry.cleanup(); entry.reject(new RuntimeError("delivery-unknown")); }
		this.pending.clear();
	}

	private consume(chunk: string): void {
		this.buffer += chunk;
		if (Buffer.byteLength(this.buffer) > 2 * 1024 * 1024) { this.fail("frame-limit"); return; }
		for (;;) {
			const newline = this.buffer.indexOf("\n");
			if (newline < 0) return;
			const line = this.buffer.slice(0, newline).trim();
			this.buffer = this.buffer.slice(newline + 1);
			if (!line) continue;
			let value: unknown;
			try { value = JSON.parse(line); } catch { this.fail("malformed-json"); return; }
			if (!isAdmissionObject(value) || value.jsonrpc !== "2.0") { this.fail("invalid-envelope"); return; }
			if (typeof value.method === "string") {
				if (value.method === "notifications/progress" && isAdmissionObject(value.params)
					&& typeof value.params.progressToken === "number") {
					const entry = this.pending.get(value.params.progressToken);
					try { entry?.onProgress?.(value.params); } catch { this.fail(); return; }
				}
				if (value.method === "ping" && (typeof value.id === "number" || typeof value.id === "string")) {
					this.process.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id: value.id, result: {} })}\n`);
				}
				continue;
			}
			if (typeof value.id !== "number") { this.fail("invalid-response-id"); return; }
			const entry = this.pending.get(value.id);
			if (!entry) { this.fail("unmatched-response"); return; }
			this.pending.delete(value.id);
			entry.cleanup();
			if ("error" in value) entry.reject(new RuntimeError("transport-failed"));
			else if ("result" in value) entry.resolve(value.result);
			else { entry.reject(new RuntimeError("protocol-invalid")); this.fail(); return; }
		}
	}

	async initialize(options: RpcOptions): Promise<void> {
		const reply = await this.call("initialize", {
			protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "fsm-compatible", version: "0.1.0" },
		}, options);
		if (!isAdmissionObject(reply) || !["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"].includes(String(reply.protocolVersion))) {
			throw new RuntimeError("protocol-invalid");
		}
		this.notify("notifications/initialized", {});
	}

	call(method: string, params: unknown, options: RpcOptions): Promise<unknown> {
		if (!this.usable) return Promise.reject(new RuntimeError("not-ready", `MCP transport not ready: ${this.failureReason}`));
		if (options.signal?.aborted) return Promise.reject(new RuntimeError("cancelled"));
		if (Date.now() >= options.deadline) return Promise.reject(new RuntimeError("deadline-exceeded"));
		if (this.pending.size >= this.capacity) return Promise.reject(new RuntimeError("queue-full"));
		const id = ++this.nextId;
		return new Promise((resolve, reject) => {
			const abort = () => {
				const entry = this.pending.get(id);
				if (!entry) return;
				this.pending.delete(id);
				entry.cleanup();
				this.usable = false; this.failureReason = "request-cancelled-or-deadline";
				reject(new RuntimeError("delivery-unknown"));
			};
			const timer = setTimeout(abort, Math.max(0, options.deadline - Date.now()));
			timer.unref();
			const cleanup = () => { clearTimeout(timer); options.signal?.removeEventListener("abort", abort); };
			options.signal?.addEventListener("abort", abort, { once: true });
			this.pending.set(id, { resolve, reject, cleanup, ...(options.onProgress ? { onProgress: options.onProgress } : {}) });
			const requestParams = options.onProgress && isAdmissionObject(params)
				? { ...params, _meta: { ...(isAdmissionObject(params._meta) ? params._meta : {}), progressToken: id } }
				: params;
			try { this.process.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params: requestParams })}\n`); }
			catch { abort(); }
		});
	}

	notify(method: string, params: unknown): void {
		if (!this.usable) throw new RuntimeError("not-ready");
		this.process.child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, params })}\n`);
	}

	async close(deadline: number): Promise<boolean> {
		this.fail();
		return this.process.close(deadline);
	}
}
