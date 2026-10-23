import { open, type FileHandle } from "node:fs/promises";

export interface ChildStats {
	readonly totalTokens: number;
	readonly ctxPercent: number | null;
	readonly firstTs: number | null;
	readonly lastTs: number | null;
}

interface AssistantUsage {
	input?: number;
	output?: number;
	cacheRead?: number;
	cacheWrite?: number;
	totalTokens?: number;
	cost?: { total?: number };
}

const EMPTY: ChildStats = { totalTokens: 0, ctxPercent: null, firstTs: null, lastTs: null };

function timestampOf(value: unknown): number | null {
	if (typeof value === "number" && Number.isFinite(value) && value > 1_000_000_000_000) return value;
	return typeof value === "string" ? Date.parse(value) || null : null;
}

function applyMessage(stats: ChildStats, message: Record<string, unknown>, contextWindow: number | null): ChildStats {
	const role = message.role;
	const ts = timestampOf(message.timestamp);
	const firstTs = stats.firstTs ?? ts;
	const lastTs = ts ?? stats.lastTs;
	if (role !== "assistant") return { ...stats, firstTs, lastTs };
	const usage = message.usage as AssistantUsage | undefined;
	if (!usage) return { ...stats, firstTs, lastTs };
	const totalTokens = stats.totalTokens + (usage.cost?.total !== undefined ? usage.cost.total : usage.totalTokens ?? 0);
	let ctxPercent = stats.ctxPercent;
	if (contextWindow && contextWindow > 0) {
		const window = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0) + (usage.output ?? 0);
		ctxPercent = Math.max(0, Math.min(100, Math.round((window / contextWindow) * 100)));
	}
	return { totalTokens, ctxPercent, firstTs, lastTs };
}

/** Incremental per-child session reader: parses only newly appended bytes. */
export class SessionStatsReader {
	private offset = 0;
	private buffer = "";
	private value: ChildStats = EMPTY;
	private lastError: string | null = null;
	private readonly contextWindow: number | null;

	constructor(contextWindow: number | null) { this.contextWindow = contextWindow; }

	get stats(): ChildStats { return this.value; }
	get error(): string | null { return this.lastError; }

	async advance(path: string): Promise<ChildStats> {
		let handle: FileHandle;
		try { handle = await open(path, "r"); }
		catch { this.lastError = "unreadable"; return this.value; }
		try {
			const { size } = await handle.stat();
			if (size <= this.offset) { this.lastError = null; return this.value; }
			const read = await handle.read(Buffer.alloc(size - this.offset), 0, size - this.offset, this.offset);
			this.buffer += read.buffer.subarray(0, read.bytesRead).toString("utf8");
			let newline = this.buffer.indexOf("\n");
			while (newline >= 0) {
				const line = this.buffer.slice(0, newline).trim();
				this.buffer = this.buffer.slice(newline + 1);
				this.offset += newline + 1;
				if (line) {
					try {
						const entry = JSON.parse(line) as { type?: string; message?: Record<string, unknown> };
						if (entry.type === "message" && entry.message && typeof entry.message === "object") {
							this.value = applyMessage(this.value, entry.message, this.contextWindow);
						}
					} catch { /* corrupt line: skipped, offset still advances */ }
				}
				newline = this.buffer.indexOf("\n");
			}
			this.lastError = null;
			return this.value;
		} catch (error) {
			this.lastError = error instanceof Error ? error.message : "read failed";
			return this.value;
		} finally {
			await handle.close();
		}
	}
}

export function elapsedTextMs(stats: ChildStats, now: number, terminal: boolean): string {
	if (stats.firstTs === null) return "—";
	const end = terminal ? stats.lastTs ?? now : now;
	const ms = Math.max(0, end - stats.firstTs);
	if (ms < 10_000) return `${Math.round(ms / 1000)}s`;
	const minutes = Math.floor(ms / 60_000);
	const seconds = Math.round((ms % 60_000) / 1000);
	if (minutes < 60) return `${minutes}m${seconds.toString().padStart(2, "0")}s`;
	const hours = Math.floor(minutes / 60);
	return `${hours}h${(minutes % 60).toString().padStart(2, "0")}m`;
}
