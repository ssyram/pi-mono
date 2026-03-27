/**
 * /omp-start — Prometheus multi-round interview + Momus plan review.
 *
 * Flow:
 * 1. Create Prometheus session for iterative planning
 * 2. First round: Prometheus analyzes the task
 * 3. Interview loop: extract questions → ctx.ui.input() → send answers back
 * 4. When PLAN_READY detected → spawn Momus for review
 * 5. Inject final plan (approved or rejected) into main context
 *
 * No module-level state. No --continue flag. Session lives within the handler.
 */

import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from "@mariozechner/pi-coding-agent";
import {
	SessionManager,
	createAgentSession,
	readOnlyTools,
} from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import type { AgentDef } from "../agents/types.js";
import { resolvePrompt } from "../agents/types.js";
import { extractLastAssistantText as extractLastAssistantTextFromMessages } from "./utils.js";

// ─── Work State Persistence ──────────────────────────────────────────────────

interface WorkState {
	activePlan?: string;       // plan file path
	startedAt?: number;        // timestamp
	lastUpdated: number;
}

const STATE_FILE = ".pi/oh-my-pi-state.json";
const PLAN_DIR = ".pi/oh-my-pi-plans";

async function loadState(cwd: string): Promise<WorkState | null> {
	try {
		const raw = await readFile(join(cwd, STATE_FILE), "utf-8");
		return JSON.parse(raw) as WorkState;
	} catch {
		return null;
	}
}

async function saveState(cwd: string, state: WorkState): Promise<void> {
	const filePath = join(cwd, STATE_FILE);
	try {
		await mkdir(join(cwd, ".pi"), { recursive: true });
		await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
	} catch (err: unknown) {
		// State save is best-effort; don't crash the command
		console.error(
			`[omp-start] Failed to save state: ${err instanceof Error ? err.message : String(err)}`,
		);
	}
}

async function savePlan(cwd: string, taskLabel: string, content: string): Promise<string> {
	const planDir = join(cwd, PLAN_DIR);
	await mkdir(planDir, { recursive: true });
	const safeName = taskLabel.slice(0, 50).replace(/[^a-zA-Z0-9-_]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "");
	const fileName = safeName || "plan";
	const filePath = join(planDir, `${fileName}.md`);
	await writeFile(filePath, content, "utf-8");
	return filePath;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_INTERVIEW_ROUNDS = 10;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractLastAssistantText(session: AgentSession): string {
	return extractLastAssistantTextFromMessages(session.agent.state.messages);
}

/** Check if output indicates the plan is ready (not asking questions). */
function isPlanReady(text: string): boolean {
	return /PLAN_READY|^## Plan\b|^### Implementation Plan\b|^### Execution Strategy\b/im.test(text);
}

/** Extract question lines from assistant text (lines ending with ?, outside code blocks). */
function extractQuestions(text: string): string[] {
	const lines = text.split("\n");
	const questions: string[] = [];
	let inCodeBlock = false;
	for (const line of lines) {
		if (line.trim().startsWith("```")) {
			inCodeBlock = !inCodeBlock;
			continue;
		}
		if (inCodeBlock) continue;
		const trimmed = line.trim();
		if (trimmed.endsWith("?") && trimmed.length > 10) {
			// Strip list markers (-, *, 1., etc.)
			questions.push(trimmed.replace(/^[-*\d.]+\s*/, ""));
		}
	}
	return questions;
}

// ─── Momus Review ─────────────────────────────────────────────────────────────

interface MomusResult {
	approved: boolean;
	summary: string;
}

async function runMomusReview(
	ctx: ExtensionCommandContext,
	momusAgent: AgentDef,
	plan: string,
): Promise<MomusResult> {
	const { session } = await createAgentSession({
		cwd: ctx.cwd,
		model: ctx.model ?? undefined,
		modelRegistry: ctx.modelRegistry,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		tools: readOnlyTools,
	});

	const prompt = ctx.model
		? resolvePrompt(momusAgent, ctx.model)
		: momusAgent.systemPrompt;
	session.agent.setSystemPrompt(prompt);

	try {
		await session.prompt(`Review this plan for executability:\n\n${plan}`, {
			expandPromptTemplates: false,
		});
		await session.agent.waitForIdle();

		const result = extractLastAssistantText(session);
		const approved = /\[OKAY\]|\[APPROVED?\]/i.test(result);
		return { approved, summary: result.slice(0, 500) };
	} finally {
		session.dispose();
	}
}

// ─── Registration ─────────────────────────────────────────────────────────────

export function registerStartWork(
	pi: ExtensionAPI,
	agents: Map<string, AgentDef>,
): void {
	pi.registerCommand("omp-start", {
		description: "Start Prometheus planning interview for a task",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const task = args.trim();

			if (!task) {
				ctx.ui.notify("Usage: /omp-start <task description>", "error");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("/omp-start requires interactive mode", "error");
				return;
			}

			// Check for existing active plan
			const existingState = await loadState(ctx.cwd);
			if (existingState?.activePlan) {
				const elapsed = Date.now() - (existingState.startedAt ?? existingState.lastUpdated);
				const hours = Math.round(elapsed / 3600000 * 10) / 10;
				const resume = await ctx.ui.input(
					`Active plan exists: ${existingState.activePlan} (started ${hours}h ago). Continue with new task? (yes/no)`,
					"yes",
				);
				if (resume === undefined || resume.toLowerCase() === "no") {
					ctx.ui.notify("Cancelled. Use the existing plan or clear state first.", "info");
					return;
				}
			}

			const prometheusAgent = agents.get("prometheus");
			const momusAgent = agents.get("momus");
			if (!prometheusAgent || !momusAgent) {
				ctx.ui.notify("Prometheus or Momus agent not available", "error");
				return;
			}

			ctx.ui.notify("Starting Prometheus planning interview...", "info");

			try {
				// 1. Create Prometheus session
				const { session } = await createAgentSession({
					cwd: ctx.cwd,
					model: ctx.model ?? undefined,
					modelRegistry: ctx.modelRegistry,
					sessionManager: SessionManager.inMemory(ctx.cwd),
					tools: readOnlyTools,
				});

				const prompt = ctx.model
					? resolvePrompt(prometheusAgent, ctx.model)
					: prometheusAgent.systemPrompt;
				session.agent.setSystemPrompt(prompt);

				try {
					// 2. Initial prompt
					await session.prompt(
						`Analyze this task and interview me to understand requirements: ${task}`,
						{ expandPromptTemplates: false },
					);
					await session.agent.waitForIdle();

					// 3. Interview loop
					for (let round = 0; round < MAX_INTERVIEW_ROUNDS; round++) {
						const response = extractLastAssistantText(session);

						// Check if plan is ready
						if (isPlanReady(response)) {
							ctx.ui.notify("Plan generated. Running Momus review...", "info");

							const reviewResult = await runMomusReview(ctx, momusAgent, response);

							if (reviewResult.approved) {
								ctx.ui.notify("Plan approved by Momus!", "info");
								const planContent = `## Prometheus Plan (Momus Approved)\n\n${response}\n\n---\n*Review: ${reviewResult.summary}*`;
								try {
									const planPath = await savePlan(ctx.cwd, task, planContent);
									await saveState(ctx.cwd, {
										activePlan: planPath,
										startedAt: Date.now(),
										lastUpdated: Date.now(),
									});
									ctx.ui.notify(`Plan saved: ${planPath}`, "info");
								} catch (err: unknown) {
									ctx.ui.notify(
										`Failed to save plan: ${err instanceof Error ? err.message : String(err)}`,
										"warning",
									);
								}
								pi.sendUserMessage(planContent);
							} else {
								ctx.ui.notify("Plan rejected by Momus", "warning");
								const planContent = `## Prometheus Plan (Momus Rejected)\n\n${response}\n\n---\n*Issues: ${reviewResult.summary}*`;
								try {
									const planPath = await savePlan(ctx.cwd, `${task}-rejected`, planContent);
									await saveState(ctx.cwd, {
										activePlan: planPath,
										startedAt: Date.now(),
										lastUpdated: Date.now(),
									});
									ctx.ui.notify(`Rejected plan saved: ${planPath}`, "info");
								} catch (err: unknown) {
									ctx.ui.notify(
										`Failed to save plan: ${err instanceof Error ? err.message : String(err)}`,
										"warning",
									);
								}
								pi.sendUserMessage(planContent);
							}
							return;
						}

						// Extract questions from Prometheus response
						const questions = extractQuestions(response);

						if (questions.length === 0) {
							// No clear questions and no plan ready — show response and ask for general input
							const userInput = await ctx.ui.input(
								`Prometheus (round ${round + 1})`,
								"Type your response...",
							);
							if (userInput === undefined) {
								ctx.ui.notify("Interview cancelled", "warning");
								return;
							}
							await session.prompt(userInput, { expandPromptTemplates: false });
							await session.agent.waitForIdle();
						} else {
							// Ask each question via UI
							const answers: string[] = [];
							for (const q of questions) {
								const answer = await ctx.ui.input(q);
								if (answer === undefined) {
									ctx.ui.notify("Interview cancelled", "warning");
									return;
								}
								answers.push(`Q: ${q}\nA: ${answer}`);
							}

							// Send all answers back to Prometheus
							await session.prompt(answers.join("\n\n"), {
								expandPromptTemplates: false,
							});
							await session.agent.waitForIdle();
						}
					}

					// Max rounds reached — extract whatever we have
					ctx.ui.notify(
						"Max interview rounds reached. Extracting plan...",
						"warning",
					);
					const finalResponse = extractLastAssistantText(session);
					const maxRoundsPlanContent = `## Prometheus Plan (max rounds)\n\n${finalResponse}`;
					try {
						const planPath = await savePlan(ctx.cwd, `${task}-max-rounds`, maxRoundsPlanContent);
						await saveState(ctx.cwd, {
							activePlan: planPath,
							startedAt: Date.now(),
							lastUpdated: Date.now(),
						});
						ctx.ui.notify(`Plan saved: ${planPath}`, "info");
					} catch (err: unknown) {
						ctx.ui.notify(
							`Failed to save plan: ${err instanceof Error ? err.message : String(err)}`,
							"warning",
						);
					}
					pi.sendUserMessage(maxRoundsPlanContent);
				} finally {
					session.dispose();
				}
			} catch (err: unknown) {
				ctx.ui.notify(
					`omp-start error: ${err instanceof Error ? err.message : String(err)}`,
					"error",
				);
			}
		},
	});
}
