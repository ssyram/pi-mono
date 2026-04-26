/**
 * /omp-start — Two-Stage Prometheus + Momus Workflow
 *
 * Stage 1: Intent Confirmation Form (YAML)
 *   - Prometheus generates minimal form
 *   - Momus Gate 1 (strict gatekeeper): APPROVED/REJECTED/APPROVED_WITH_WARNINGS
 *   - Rejection loop (max 3 cycles)
 *
 * Stage 2: Design Document Collaboration (Markdown)
 *   - Prometheus expands design document
 *   - Momus Collaborative Review (per round, non-rejecting)
 *   - Prometheus declares "no pending decisions"
 *   - Momus Final Self-Review: END/EXPAND/SUPPLEMENT
 *
 * Resume Mode: /omp-start --resume
 *   - Read existing plan, detect stage, continue from current state
 */

import type { ExtensionAPI, ExtensionCommandContext } from "@mariozechner/pi-coding-agent";
import { SessionManager, createAgentSession } from "@mariozechner/pi-coding-agent";
import type { AgentSession } from "@mariozechner/pi-coding-agent";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { readAgentPrompt, extractLastAssistantText as extractLastAssistantTextFromMessages } from "./utils.js";

// ─── Types ───────────────────────────────────────────────────────────────────

type Stage = "stage1" | "stage2";
type MomusGate1Status = "APPROVED" | "APPROVED_WITH_WARNINGS" | "REJECTED";
type MomusFinalAction = "END" | "EXPAND" | "SUPPLEMENT";

interface WorkState {
	activePlan?: string;
	stage: Stage;
	round: number;
	gate1Rejections: number;
	startedAt?: number;
	lastUpdated: number;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const STATE_FILE = ".pi/oh-my-pi-state.json";
const PLAN_DIR = ".pi/oh-my-pi-plans";
const MAX_GATE1_REJECTIONS = 3;
const MAX_STAGE2_ROUNDS = 20;

// ─── State Persistence ───────────────────────────────────────────────────────

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
	await mkdir(join(cwd, ".pi"), { recursive: true });
	await writeFile(filePath, JSON.stringify(state, null, 2), "utf-8");
}

async function savePlan(cwd: string, safeName: string, content: string): Promise<string> {
	const planPath = join(cwd, PLAN_DIR, `${safeName}.md`);
	await mkdir(join(cwd, PLAN_DIR), { recursive: true });
	await writeFile(planPath, content, "utf-8");
	return planPath;
}

async function loadPlan(cwd: string, safeName: string): Promise<string | null> {
	try {
		const planPath = join(cwd, PLAN_DIR, `${safeName}.md`);
		return await readFile(planPath, "utf-8");
	} catch {
		return null;
	}
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function extractLastAssistantText(session: AgentSession): string {
	return extractLastAssistantTextFromMessages(session.agent.state.messages);
}

function makeSafeName(task: string): string {
	return task
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 50);
}

// ─── Stage 1 Detection ───────────────────────────────────────────────────────

function isStage1FormReady(text: string): boolean {
	const hasIntent = /^intent:/m.test(text);
	const hasDesignApproach = /^design_approach:/m.test(text);
	const hasComponents = /^components:/m.test(text);
	return hasIntent && hasDesignApproach && hasComponents;
}

function extractStage1Form(text: string): string {
	const yamlBlockMatch = text.match(/```yaml\n([\s\S]+?)\n```/);
	if (yamlBlockMatch) return yamlBlockMatch[1];
	
	const rawYamlMatch = text.match(/^intent:[\s\S]+/m);
	if (rawYamlMatch) {
		const yamlText = rawYamlMatch[0];
		const headerMatch = yamlText.match(/\n#{1,6}\s+/);
		if (headerMatch && headerMatch.index) {
			return yamlText.slice(0, headerMatch.index);
		}
		return yamlText;
	}
	
	return text;
}

// ─── Stage 2 Detection ───────────────────────────────────────────────────────

function isStage2DocReady(text: string): boolean {
	const hasIntent = /^#{1,2}\s+(?:\d+\.\s+)?Intent/m.test(text);
	const hasDesignApproach = /^#{1,2}\s+(?:\d+\.\s+)?Design Approach/m.test(text);
	const hasComponents = /^#{1,2}\s+(?:\d+\.\s+)?Components/m.test(text);
	return hasIntent && hasDesignApproach && hasComponents;
}

function extractStage2Doc(text: string): string {
	const mdBlockMatch = text.match(/```markdown\n([\s\S]+?)\n```/);
	if (mdBlockMatch) return mdBlockMatch[1];
	
	const rawMdMatch = text.match(/^#\s+.+[\s\S]+/m);
	if (rawMdMatch) return rawMdMatch[0];
	
	return text;
}

function prometheusDeclaresComplete(text: string): boolean {
	const patterns = [
		/no pending decision points/i,
		/ready for final self-review/i,
		/design is complete/i,
		/ready for handoff/i,
	];
	return patterns.some(p => p.test(text));
}

// ─── Momus Parsing ───────────────────────────────────────────────────────────

function parseMomusGate1Response(text: string): {
	status: MomusGate1Status;
	findings: string;
} {
	const statusMatch = text.match(/status:\s*(APPROVED|APPROVED_WITH_WARNINGS|REJECTED)/i);
	const status = (statusMatch?.[1]?.toUpperCase() as MomusGate1Status) || "REJECTED";
	
	const findingsMatch = text.match(/findings:\s*\|?\s*([\s\S]+?)(?:\n\n|$)/i);
	const findings = findingsMatch?.[1]?.trim() || text;
	
	return { status, findings };
}

function parseMomusFinalReview(text: string): {
	action: MomusFinalAction;
	rationale: string;
} {
	const actionMatch = text.match(/\*\*Action\*\*:\s*(END|EXPAND|SUPPLEMENT)/i);
	const action = (actionMatch?.[1]?.toUpperCase() as MomusFinalAction) || "EXPAND";
	
	const rationaleMatch = text.match(/\*\*Rationale\*\*:\s*([\s\S]+?)(?:\n\n|\*\*|$)/i);
	const rationale = rationaleMatch?.[1]?.trim() || text;
	
	return { action, rationale };
}

// ─── Command Registration ────────────────────────────────────────────────────

export function registerStartWorkCommand(
	pi: ExtensionAPI,
	agentsDir: string,
): void {
	pi.registerCommand("omp-start", {
		description: "Start two-stage Prometheus + Momus workflow (use --resume to continue)",
		handler: async (args: string, ctx: ExtensionCommandContext) => {
			const isResume = args.includes("--resume");
			const task = args.replace("--resume", "").trim();
			
			const existingState = await loadState(ctx.cwd);
			
			// Resume mode
			if (isResume) {
				if (!existingState || !existingState.activePlan) {
					ctx.ui.notify("[Error] No active design session to resume.", "error");
					return;
				}
				
				const safeName = existingState.activePlan.replace(`${PLAN_DIR}/`, "").replace(".md", "");
				await resumeSession(ctx, existingState, safeName);
				return;
			}
			
			// New session
			if (!task) {
				ctx.ui.notify("[Error] Task description required (or use --resume).", "error");
				return;
			}
			
			const safeName = makeSafeName(task);
			
			const existingPlan = await loadPlan(ctx.cwd, safeName);
			if (existingPlan) {
				ctx.ui.notify(`[Warning] Plan for "${task}" exists. Use --resume to continue.`, "warning");
				return;
			}
			
			const state: WorkState = {
				activePlan: `${PLAN_DIR}/${safeName}.md`,
				stage: "stage1",
				round: 0,
				gate1Rejections: 0,
				startedAt: Date.now(),
				lastUpdated: Date.now(),
			};
			await saveState(ctx.cwd, state);
			
			ctx.ui.notify(`Starting two-stage workflow: ${task}`, "info");
			
			// Create Prometheus session
			const prometheusPrompt = await readAgentPrompt(ctx.cwd, "prometheus");
			const { session: prometheusSession } = await createAgentSession({
				cwd: ctx.cwd,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				sessionManager: SessionManager.inMemory(ctx.cwd),
				tools: ["read", "bash"],
			});
			
			try {
				if (prometheusPrompt) {
					prometheusSession.agent.state.systemPrompt = prometheusPrompt;
				}
				
				// Start Stage 1
				await prometheusSession.prompt(
					`Task: ${task}\n\n` +
					`You are in Stage 1: Intent Confirmation Form.\n\n` +
					`Please generate the minimal YAML form capturing intent, design approach, components, and sanity check.`,
					{ expandPromptTemplates: false }
				);
				await prometheusSession.agent.waitForIdle();
				
				const { form, approved } = await runStage1(ctx, prometheusSession, state, safeName);
				
				if (!approved) {
					ctx.ui.notify("[System] Stage 1 not approved. Use --resume to continue.", "warning");
					return;
				}
				
				// Transition to Stage 2
				state.stage = "stage2";
				state.round = 0;
				await saveState(ctx.cwd, state);
				
				const { complete } = await runStage2(ctx, prometheusSession, state, safeName, form);
				
				if (complete) {
					ctx.ui.notify(`Design complete! Saved to ${PLAN_DIR}/${safeName}.md`, "info");
					await saveState(ctx.cwd, {
						lastUpdated: Date.now(),
						stage: "stage1",
						round: 0,
						gate1Rejections: 0,
					});
				} else {
					ctx.ui.notify(`Session paused. Saved to ${PLAN_DIR}/${safeName}.md. Use --resume to continue.`, "info");
				}
			} finally {
				prometheusSession.dispose();
			}
		},
	});
}

// ─── Stage 1: Form Generation + Gate 1 Loop ─────────────────────────────────

async function runStage1(
	ctx: ExtensionCommandContext,
	prometheusSession: AgentSession,
	state: WorkState,
	safeName: string,
): Promise<{ form: string; approved: boolean }> {
	ctx.ui.notify("=== Stage 1: Intent Confirmation Form ===", "info");
	
	let rejectionCount = 0;
	
	while (rejectionCount < MAX_GATE1_REJECTIONS) {
		const lastText = extractLastAssistantText(prometheusSession);
		
		if (!isStage1FormReady(lastText)) {
			ctx.ui.notify("[Prometheus] Generating form...", "info");
			return { form: "", approved: false };
		}
		
		const form = extractStage1Form(lastText);
		await savePlan(ctx.cwd, safeName, form);
		ctx.ui.notify(`[System] Form saved to ${PLAN_DIR}/${safeName}.md`, "info");
		
		// Spawn Momus Gate 1
		ctx.ui.notify("[Momus Gate 1] Reviewing form...", "info");
		
		const momusPrompt = await readAgentPrompt(ctx.cwd, "momus");
		const { session: momusSession } = await createAgentSession({
			cwd: ctx.cwd,
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			tools: ["read", "bash"],
		});
		
		try {
			if (momusPrompt) {
				momusSession.agent.state.systemPrompt = momusPrompt;
			}
			
			await momusSession.prompt(
				`You are in Role 1: Stage 1 Gatekeeper.\n\n` +
				`Review the following intent confirmation form and decide: APPROVED, APPROVED_WITH_WARNINGS, or REJECTED.\n\n` +
				`Form:\n\`\`\`yaml\n${form}\n\`\`\`\n\n` +
				`Provide your review in the specified YAML format.`,
				{ expandPromptTemplates: false }
			);
			await momusSession.agent.waitForIdle();
			
			const momusText = extractLastAssistantText(momusSession);
			const { status, findings } = parseMomusGate1Response(momusText);
			
			ctx.ui.notify(`[Momus Gate 1] Status: ${status}`, "info");
			
			if (status === "APPROVED" || status === "APPROVED_WITH_WARNINGS") {
				state.gate1Rejections = rejectionCount;
				await saveState(ctx.cwd, state);
				return { form, approved: true };
			}
			
			// Rejected
			rejectionCount++;
			state.gate1Rejections = rejectionCount;
			await saveState(ctx.cwd, state);
			
			if (rejectionCount >= MAX_GATE1_REJECTIONS) {
				ctx.ui.notify(`[System] Max rejections (${MAX_GATE1_REJECTIONS}) reached. Manual review needed.`, "error");
				return { form, approved: false };
			}
			
			// Send rejection back to Prometheus
			await prometheusSession.prompt(
				`Momus Gate 1 has REJECTED your form. Please revise based on the following findings:\n\n` +
				`${findings}\n\n` +
				`Generate a revised form.`,
				{ expandPromptTemplates: false }
			);
			await prometheusSession.agent.waitForIdle();
		} finally {
			momusSession.dispose();
		}
	}
	
	return { form: "", approved: false };
}

// ─── Stage 2: Design Document Collaboration ──────────────────────────────────

async function runStage2(
	ctx: ExtensionCommandContext,
	prometheusSession: AgentSession,
	state: WorkState,
	safeName: string,
	initialForm: string,
): Promise<{ doc: string; complete: boolean }> {
	ctx.ui.notify("=== Stage 2: Design Document Collaboration ===", "info");
	
	// Initialize Stage 2 document
	await prometheusSession.prompt(
		`Stage 1 form has been approved. Please convert it to the Stage 2 Markdown design document template.\n\n` +
		`Stage 1 Form:\n\`\`\`yaml\n${initialForm}\n\`\`\`\n\n` +
		`Generate the initial Stage 2 design document.`,
		{ expandPromptTemplates: false }
	);
	await prometheusSession.agent.waitForIdle();
	
	let round = state.round;
	
	while (round < MAX_STAGE2_ROUNDS) {
		const lastText = extractLastAssistantText(prometheusSession);
		
		if (!isStage2DocReady(lastText)) {
			ctx.ui.notify("[Prometheus] Generating design document...", "info");
			return { doc: "", complete: false };
		}
		
		const doc = extractStage2Doc(lastText);
		await savePlan(ctx.cwd, safeName, doc);
		ctx.ui.notify(`[System] Document saved (Round ${round + 1})`, "info");
		
		// Check if Prometheus declares complete
		if (prometheusDeclaresComplete(lastText)) {
			ctx.ui.notify("[Prometheus] Declares: No pending decision points.", "info");
			
			// Spawn Momus Final Self-Review
			const momusPrompt = await readAgentPrompt(ctx.cwd, "momus");
			const { session: momusSession } = await createAgentSession({
				cwd: ctx.cwd,
				model: ctx.model,
				modelRegistry: ctx.modelRegistry,
				sessionManager: SessionManager.inMemory(ctx.cwd),
				tools: ["read", "bash"],
			});
			
			try {
				if (momusPrompt) {
					momusSession.agent.state.systemPrompt = momusPrompt;
				}
				
				await momusSession.prompt(
					`You are in Role 3: Stage 2 Final Self-Reviewer.\n\n` +
					`Prometheus has declared the design complete. Perform final self-review and recommend: END, EXPAND, or SUPPLEMENT.\n\n` +
					`Design Document:\n\`\`\`markdown\n${doc}\n\`\`\`\n\n` +
					`Provide your final self-review in the specified format.`,
					{ expandPromptTemplates: false }
				);
				await momusSession.agent.waitForIdle();
				
				const momusText = extractLastAssistantText(momusSession);
				const { action, rationale } = parseMomusFinalReview(momusText);
				
				ctx.ui.notify(`[Momus Final Self-Review] Recommendation: ${action}`, "info");
				
				const finalDoc = doc + `\n\n---\n\n${momusText}`;
				await savePlan(ctx.cwd, safeName, finalDoc);
				
				if (action === "END") {
					return { doc: finalDoc, complete: true };
				}
				
				// EXPAND or SUPPLEMENT
				await prometheusSession.prompt(
					`Momus Final Self-Review recommends: ${action}\n\n` +
					`Rationale: ${rationale}\n\n` +
					`Please address the recommendations and continue expanding the design.`,
					{ expandPromptTemplates: false }
				);
				await prometheusSession.agent.waitForIdle();
			} finally {
				momusSession.dispose();
			}
			
			round++;
			state.round = round;
			await saveState(ctx.cwd, state);
			continue;
		}
		
		// Not complete yet, spawn Momus Collaborative Review
		const momusPrompt = await readAgentPrompt(ctx.cwd, "momus");
		const { session: momusSession } = await createAgentSession({
			cwd: ctx.cwd,
			model: ctx.model,
			modelRegistry: ctx.modelRegistry,
			sessionManager: SessionManager.inMemory(ctx.cwd),
			tools: ["read", "bash"],
		});
		
		try {
			if (momusPrompt) {
				momusSession.agent.state.systemPrompt = momusPrompt;
			}
			
			await momusSession.prompt(
				`You are in Role 2: Stage 2 Collaborative Reviewer.\n\n` +
				`Review the following design document and extract hidden decision points from the non-decision list.\n\n` +
				`Design Document:\n\`\`\`markdown\n${doc}\n\`\`\`\n\n` +
				`Append your review findings in the specified format.`,
				{ expandPromptTemplates: false }
			);
			await momusSession.agent.waitForIdle();
			
			const momusText = extractLastAssistantText(momusSession);
			const updatedDoc = doc + `\n\n---\n\n${momusText}`;
			await savePlan(ctx.cwd, safeName, updatedDoc);
			
			ctx.ui.notify(`[Momus] Review appended (Round ${round + 1})`, "info");
		} finally {
			momusSession.dispose();
		}
		
		// Ask user for next action
		const userInput = await ctx.ui.input(
			"Round complete. Provide feedback, type 'continue', or 'done': ",
			"continue"
		);
		
		if (!userInput || userInput.toLowerCase() === "done") {
			ctx.ui.notify("[System] Session ended by user.", "info");
			return { doc: extractStage2Doc(extractLastAssistantText(prometheusSession)), complete: false };
		}
		
		if (userInput && userInput.toLowerCase() === "continue") {
			await prometheusSession.prompt(
				`Momus has reviewed the design. Please continue expanding or declare completion if ready.`,
				{ expandPromptTemplates: false }
			);
		} else {
			await prometheusSession.prompt(
				`User feedback:\n${userInput}\n\n` +
				`Please incorporate this feedback and update the design document.`,
				{ expandPromptTemplates: false }
			);
		}
		await prometheusSession.agent.waitForIdle();
		
		round++;
		state.round = round;
		await saveState(ctx.cwd, state);
	}
	
	ctx.ui.notify(`[System] Max rounds (${MAX_STAGE2_ROUNDS}) reached.`, "warning");
	const lastText = extractLastAssistantText(prometheusSession);
	const doc = isStage2DocReady(lastText) ? extractStage2Doc(lastText) : lastText;
	return { doc, complete: false };
}

// ─── Resume Mode ─────────────────────────────────────────────────────────────

async function resumeSession(
	ctx: ExtensionCommandContext,
	state: WorkState,
	safeName: string,
): Promise<void> {
	ctx.ui.notify("=== Resume Mode: Continuing design session ===", "info");
	
	const existingPlan = await loadPlan(ctx.cwd, safeName);
	if (!existingPlan) {
		ctx.ui.notify(`[Error] No plan found for "${safeName}".`, "error");
		return;
	}
	
	ctx.ui.notify(`[System] Loaded plan from ${PLAN_DIR}/${safeName}.md`, "info");
	ctx.ui.notify(`[System] Stage: ${state.stage}, Round: ${state.round}`, "info");
	
	const prometheusPrompt = await readAgentPrompt(ctx.cwd, "prometheus");
	const { session: prometheusSession } = await createAgentSession({
		cwd: ctx.cwd,
		model: ctx.model,
		modelRegistry: ctx.modelRegistry,
		sessionManager: SessionManager.inMemory(ctx.cwd),
		tools: ["read", "bash"],
	});
	
	try {
		if (prometheusPrompt) {
			prometheusSession.agent.state.systemPrompt = prometheusPrompt;
		}
		
		if (state.stage === "stage1") {
			await prometheusSession.prompt(
				`Resuming Stage 1 design session.\n\n` +
				`Existing form:\n\`\`\`yaml\n${existingPlan}\n\`\`\`\n\n` +
				`This form was previously rejected by Momus Gate 1. Please revise it based on user feedback.`,
				{ expandPromptTemplates: false }
			);
			await prometheusSession.agent.waitForIdle();
			
			const { form, approved } = await runStage1(ctx, prometheusSession, state, safeName);
			
			if (approved) {
				state.stage = "stage2";
				state.round = 0;
				await saveState(ctx.cwd, state);
				
				await runStage2(ctx, prometheusSession, state, safeName, form);
			}
		} else {
			await prometheusSession.prompt(
				`Resuming Stage 2 design session.\n\n` +
				`Existing design document:\n\`\`\`markdown\n${existingPlan}\n\`\`\`\n\n` +
				`Please continue expanding the design or declare completion if ready.`,
				{ expandPromptTemplates: false }
			);
			await prometheusSession.agent.waitForIdle();
			
			await runStage2(ctx, prometheusSession, state, safeName, "");
		}
	} finally {
		prometheusSession.dispose();
	}
}
