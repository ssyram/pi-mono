import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Agent } from "@earendil-works/pi-agent-core";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Model } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { RuntimeError } from "../runtime/runtime-error.ts";
import { projectOcMessages } from "../records/oc-messages.ts";
import type { OcMessage } from "../records/oc-shapes.ts";
import type { RecordStore } from "../records/record-store.ts";
import { CaptureTurn } from "./capture-turn.ts";
import { buildJudgeAgentTools, structuredOutputSystemSuffix } from "./judge-agent-tools.ts";
import type { JudgeInput } from "./judge-input.ts";
import { resolveJudgeToolPolicy } from "./judge-tool-policy.ts";
import { structuredOutputParts } from "./judge-envelope.ts";

export interface JudgeModelSource {
	readonly model: Model<any>;
	getApiKey(): string | undefined;
	// Step P3: streaming goes through the same provider path as the real host.
	readonly streamFn: unknown;
}

interface JudgeEntry {
	transcript: AgentMessage[];
	sessionFile?: string;
	agent: Agent | undefined;
}

function judgeEntries(messages: readonly AgentMessage[]): SessionEntry[] {
	return messages.map((message, index) => {
		const timestamp = typeof (message as { timestamp?: number }).timestamp === "number"
			? (message as { timestamp: number }).timestamp : 0;
		return { type: "message", id: `jm${index}`, parentId: index > 0 ? `jm${index - 1}` : null,
			timestamp: new Date(timestamp).toISOString(), message } as SessionEntry;
	});
}

async function waitForIdleBounded(agent: Agent, budgetMs: number): Promise<boolean> {
	return Promise.race([
		agent.waitForIdle().then(() => true),
		new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => resolve(false), budgetMs);
			timer.unref();
		}),
	]);
}

/** Judge sessions per OC contract: one real transcript per sid, one turn per POST message. */
export class JudgeSessions {
	private readonly entries = new Map<string, JudgeEntry>();
	private readonly store: RecordStore;
	private readonly cwd: string;
	private readonly maxJudges: number;
	private readonly configuredSource: JudgeModelSource | undefined;

	constructor(store: RecordStore, cwd: string, source?: JudgeModelSource, maxJudges = 64) {
		if (!store || !cwd || !Number.isSafeInteger(maxJudges) || maxJudges < 1) throw new RuntimeError("protocol-invalid");
		this.store = store;
		this.cwd = cwd;
		this.configuredSource = source;
		this.maxJudges = maxJudges;
	}

	// The bridge and gates never need the judge model; validate lazily on first real turn.
	private requireSource(): JudgeModelSource {
		const source = this.configuredSource;
		if (!source?.model || typeof source.getApiKey !== "function" || !source.streamFn) throw new RuntimeError("not-ready");
		return source;
	}

	create(): string {
		if (this.entries.size >= this.maxJudges) throw new RuntimeError("queue-full");
		// HC judge sessions carry the ses_ protocol prefix; the FSM stop hook
		// addresses judges by this id on the bridge surface.
		const sessionId = `ses_${randomUUID().replace(/-/g, "").slice(0, 24)}`;
		this.entries.set(sessionId, { transcript: [], agent: undefined });
		// Persist under the instance cwd so observation layers that scan
		// session transcripts (dual harness evidence) can see judge turns.
		const sessionFile = join(this.cwd, ".fsm-compatible-judges", sessionId, "session.jsonl");
		mkdirSync(dirname(sessionFile), { recursive: true });
		writeFileSync(sessionFile, "");
		this.entries.set(sessionId, { transcript: [], agent: undefined, sessionFile });
		this.store.registerJudge({ sessionId, title: "fsm-gate", createdAt: Date.now(), updatedAt: Date.now(),
			sessionFile, lifecycle: "idle" });
		return sessionId;
	}

	async run(sessionId: string, input: JudgeInput): Promise<OcMessage> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new RuntimeError("not-ready");
		if (entry.agent) throw new RuntimeError("queue-full");
		const policy = resolveJudgeToolPolicy(input.tools);
		// Step P3: web factories are wired by the install unit; requesting them stays explicit not-ready.
		if (policy.allowed.has("webfetch") || policy.allowed.has("websearch")) throw new RuntimeError("not-ready");
		this.store.updateJudge(sessionId, "busy", Date.now());
		const source = this.requireSource();
		const capture = new CaptureTurn(input.validate);
		let agent: Agent | undefined;
		try {
			const tools = buildJudgeAgentTools(this.cwd, policy, capture);
			agent = new Agent({
				getApiKey: () => source.getApiKey(),
				streamFn: source.streamFn as never,
				initialState: { model: source.model,
					systemPrompt: `${input.system}\n\n${structuredOutputSystemSuffix(input.schema)}`,
					tools, messages: structuredClone(entry.transcript) },
				finishTurn: async (turn: unknown): Promise<{ action: "continue" | "end" } | undefined> => {
					const stopReason = (turn as { message?: { stopReason?: string } }).message?.stopReason;
					if (stopReason === "error" || stopReason === "aborted" || stopReason === "length") return undefined;
					if (capture.captures.length > 0) return { action: "end" };
					return undefined;
				},
			});
			entry.agent = agent;
			await agent.prompt(input.user);
			await agent.waitForIdle();
			const updated = agent.state.messages;
			entry.transcript = [...updated];
			if (entry.sessionFile) {
				const lines = updated.map((message) => JSON.stringify({ type: "message", message }) + "\n").join("");
				writeFileSync(entry.sessionFile, lines);
			}
			const envelope = this.terminalEnvelope(sessionId, updated, capture);
			this.store.updateJudge(sessionId, "idle", Date.now());
			return envelope;
		} finally {
			entry.agent = undefined;
		}
	}

	// Step P4: true means generation actually stopped; unconfirmed aborts stay not-ready.
	async abort(sessionId: string): Promise<true> {
		const entry = this.entries.get(sessionId);
		if (!entry) throw new RuntimeError("not-ready");
		const agent = entry.agent;
		if (!agent) {
			this.store.updateJudge(sessionId, "idle", Date.now());
			return true;
		}
		agent.abort();
		const idle = await waitForIdleBounded(agent, 10000);
		if (!idle) throw new RuntimeError("not-ready");
		this.store.updateJudge(sessionId, "idle", Date.now());
		return true;
	}

	close(): void {
		for (const entry of this.entries.values()) entry.agent?.abort();
		this.entries.clear();
	}

	private terminalEnvelope(sessionId: string, messages: readonly AgentMessage[], capture: CaptureTurn): OcMessage {
		const projected = projectOcMessages({ sessionId, branch: judgeEntries(messages) });
		const index = projected.findLastIndex((message) => message.info.role === "assistant");
		if (index < 0) throw new RuntimeError("protocol-invalid");
		const last = projected[index]!;
		const transcriptIndex = messages.findLastIndex((message) => (message as { role?: string }).role === "assistant");
		if (transcriptIndex < 0) throw new RuntimeError("protocol-invalid");
		const soParts = structuredOutputParts(capture, sessionId, `jm${transcriptIndex}`);
		const parts = last.parts.filter((part) => !(part.type === "tool" && part.tool === "StructuredOutput"));
		return { info: last.info, parts: [...parts, ...soParts], ...(last.metadata ? { metadata: last.metadata } : {}) };
	}
}
