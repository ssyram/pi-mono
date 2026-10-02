import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { ClickExpandText, clickExpandable } from "../tools/click-expand.js";

export const BOULDER_RESUME_MESSAGE_TYPE = "omp-boulder-resume";

export interface BoulderResumeDetails {
	resumeId: string;
	attempt: number;
	maxAttempts: number;
	scheduledDelayMs: number;
}

export type BoulderResumeSchedule = Omit<BoulderResumeDetails, "resumeId">;

export interface BoulderResumeTask {
	id: number;
	text: string;
	status: string;
}

export interface BoulderResumeController {
	send(context: ExtensionContext, tasks: BoulderResumeTask[], schedule: BoulderResumeSchedule): void;
	clear(context: ExtensionContext): void;
}

function resumeIdOf(message: AgentMessage): string | undefined {
	// Runtime shape of custom messages is not represented in every AgentMessage
	// union revision, so narrow through an untyped view instead of type assertions.
	const record = message as { role?: string; customType?: string; details?: unknown };
	if (record.role !== "custom" || record.customType !== BOULDER_RESUME_MESSAGE_TYPE) return undefined;
	if (typeof record.details !== "object" || record.details === null) return undefined;
	const resumeId = (record.details as Record<string, unknown>).resumeId;
	return typeof resumeId === "string" ? resumeId : undefined;
}

export function filterBoulderResumeMessages(
	messages: AgentMessage[],
	liveResumeId: string | undefined,
): AgentMessage[] {
	return messages.filter((message) => {
		const record = message as { role?: string; customType?: string; details?: unknown };
		if (record.role !== "custom" || record.customType !== BOULDER_RESUME_MESSAGE_TYPE) return true;
		return liveResumeId !== undefined && resumeIdOf(message) === liveResumeId;
	});
}

export function buildBoulderResumeContent(tasks: BoulderResumeTask[]): string {
	const taskLines = tasks.map((task, index) => {
		const status = task.status === "in_progress" ? "[in_progress]" : "[ready]";
		return `${index + 1}. ${status} #${task.id}: ${task.text}`;
	});
	return [
		"<SYSTEM:omp-boulder-resume>",
		"This reminder was generated automatically by the system, NOT sent by the user.",
		"Continue the actionable tasks below. Complete or expire them before stopping.",
		"If you truly require user intervention, output AT THE END <CONFIRM-TO-STOP/> to stop automatic continuation.",
		...taskLines,
		"</SYSTEM:omp-boulder-resume>",
	].join("\n");
}

export function registerBoulderResumeMessages(pi: ExtensionAPI): BoulderResumeController {
	const liveResumeIds = new WeakMap<ExtensionContext["sessionManager"], string>();
	const clear = (context: ExtensionContext): void => {
		liveResumeIds.delete(context.sessionManager);
	};

	pi.registerMessageRenderer<BoulderResumeDetails>(BOULDER_RESUME_MESSAGE_TYPE, (message, options, theme) => {
		const label = theme.fg("accent", "↻ Automatic Boulder resume");
		const content = typeof message.content === "string" ? message.content : "";
		const contentBlock = () => (content ? `\n${theme.fg("muted", content)}` : "");
		// Click-to-expand needs the fullscreen TUI mouse path; without a stable
		// resumeId the wrapper is skipped and keyboard expansion still works.
		const resumeId =
			typeof message.details === "object" &&
			message.details !== null &&
			typeof (message.details as { resumeId?: unknown }).resumeId === "string"
				? (message.details as { resumeId: string }).resumeId
				: undefined;
		if (!resumeId) return new Text(label + (options.expanded ? contentBlock() : ""), 0, 0);
		try {
			const key = `boulder-resume:${resumeId}`;
			return clickExpandable(
				new ClickExpandText({
					key,
					collapsed: () => (options.expanded ? label + contentBlock() : label + theme.fg("dim", " (click to expand)")),
					expanded: () => label + contentBlock(),
				}),
				key,
			);
		} catch {
			return new Text(label, 0, 0);
		}
	});
	pi.on("context", (event, context) => ({
		messages: filterBoulderResumeMessages(event.messages, liveResumeIds.get(context.sessionManager)),
	}));
	pi.on("input", (event, context) => {
		if (event.source === "interactive" || event.source === "rpc") clear(context);
	});
	pi.on("agent_end", (_event, context) => clear(context));
	pi.on("session_start", (_event, context) => clear(context));
	pi.on("session_tree", (_event, context) => clear(context));
	pi.on("session_shutdown", (_event, context) => clear(context));

	return {
		clear,
		send(context, tasks, schedule) {
			const resumeId = randomUUID();
			liveResumeIds.set(context.sessionManager, resumeId);
			try {
				pi.sendMessage<BoulderResumeDetails>(
					{
						customType: BOULDER_RESUME_MESSAGE_TYPE,
						content: buildBoulderResumeContent(tasks),
						display: true,
						details: { resumeId, ...schedule },
					},
					{ triggerTurn: true },
				);
			} catch (error) {
				if (liveResumeIds.get(context.sessionManager) === resumeId) clear(context);
				throw error;
			}
		},
	};
}
