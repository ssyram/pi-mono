import { randomUUID } from "node:crypto";
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";

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
	if (message.role !== "custom" || message.customType !== BOULDER_RESUME_MESSAGE_TYPE) return undefined;
	if (typeof message.details !== "object" || message.details === null) return undefined;
	const details = message.details as Record<string, unknown>;
	return typeof details.resumeId === "string" ? details.resumeId : undefined;
}

export function filterBoulderResumeMessages(messages: AgentMessage[], liveResumeId: string | undefined): AgentMessage[] {
	return messages.filter((message) => {
		if (message.role !== "custom" || message.customType !== BOULDER_RESUME_MESSAGE_TYPE) return true;
		return liveResumeId !== undefined && resumeIdOf(message) === liveResumeId;
	});
}

export function buildBoulderResumeContent(tasks: BoulderResumeTask[]): string {
	const taskLines = tasks.map((task, index) => {
		const status = task.status === "in_progress" ? "[in_progress]" : "[ready]";
		return `${index + 1}. ${status} #${task.id}: ${task.text}`;
	});
	return [
		"<omp-boulder-resume>",
		"Continue the actionable tasks below. Complete or expire them before stopping.",
		"If continuation is impossible, output <CONFIRM-TO-STOP/> to stop automatic continuation.",
		...taskLines,
		"</omp-boulder-resume>",
	].join("\n");
}

export function registerBoulderResumeMessages(pi: ExtensionAPI): BoulderResumeController {
	const liveResumeIds = new WeakMap<ExtensionContext["sessionManager"], string>();
	const clear = (context: ExtensionContext): void => {
		liveResumeIds.delete(context.sessionManager);
	};

	pi.registerMessageRenderer<BoulderResumeDetails>(BOULDER_RESUME_MESSAGE_TYPE, (message, options, theme) => {
		const label = theme.fg("accent", "↻ Automatic Boulder resume");
		const content = options.expanded && typeof message.content === "string"
			? `\n${theme.fg("muted", message.content)}`
			: "";
		return new Text(label + content, 0, 0);
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
					context.isIdle() ? { triggerTurn: true } : { deliverAs: "followUp" },
				);
			} catch (error) {
				if (liveResumeIds.get(context.sessionManager) === resumeId) clear(context);
				throw error;
			}
		},
	};
}
