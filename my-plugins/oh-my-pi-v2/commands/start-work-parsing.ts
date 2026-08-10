import type { AgentSession } from "@earendil-works/pi-coding-agent";
import { extractLastAssistantText as extractTextFromMessages } from "./assistant-message-text.js";

export type MomusGateOneStatus = "APPROVED" | "APPROVED_WITH_WARNINGS" | "REJECTED";
export type MomusFinalAction = "END" | "EXPAND" | "SUPPLEMENT";

export function extractLastAssistantText(session: AgentSession): string {
	return extractTextFromMessages(session.agent.state.messages);
}

export function isStageOneFormReady(text: string): boolean {
	return /^intent:/m.test(text) && /^design_approach:/m.test(text) && /^components:/m.test(text);
}

export function extractStageOneForm(text: string): string {
	const yamlBlock = text.match(/```yaml\n([\s\S]+?)\n```/);
	if (yamlBlock) return yamlBlock[1];
	const rawYaml = text.match(/^intent:[\s\S]+/m);
	if (!rawYaml) return text;
	const header = rawYaml[0].match(/\n#{1,6}\s+/);
	return header?.index ? rawYaml[0].slice(0, header.index) : rawYaml[0];
}

export function isStageTwoDocumentReady(text: string): boolean {
	return (
		/^#{1,2}\s+(?:\d+\.\s+)?Intent/m.test(text) &&
		/^#{1,2}\s+(?:\d+\.\s+)?Design Approach/m.test(text) &&
		/^#{1,2}\s+(?:\d+\.\s+)?Components/m.test(text)
	);
}

export function extractStageTwoDocument(text: string): string {
	const markdownBlock = text.match(/```markdown\n([\s\S]+?)\n```/);
	if (markdownBlock) return markdownBlock[1];
	return text.match(/^#\s+.+[\s\S]+/m)?.[0] ?? text;
}

export function prometheusDeclaresComplete(text: string): boolean {
	return [
		/no pending decision points/i,
		/ready for final self-review/i,
		/design is complete/i,
		/ready for handoff/i,
	].some((pattern) => pattern.test(text));
}

export function parseMomusGateOneResponse(text: string): {
	status: MomusGateOneStatus;
	findings: string;
} {
	const match = text.match(/status:\s*(APPROVED|APPROVED_WITH_WARNINGS|REJECTED)/i);
	const status = (match?.[1]?.toUpperCase() as MomusGateOneStatus) || "REJECTED";
	const findings = text.match(/findings:\s*\|?\s*([\s\S]+?)(?:\n\n|$)/i)?.[1]?.trim() || text;
	return { status, findings };
}

export function parseMomusFinalReview(text: string): {
	action: MomusFinalAction;
	rationale: string;
} {
	const match = text.match(/\*\*Action\*\*:\s*(END|EXPAND|SUPPLEMENT)/i);
	const action = (match?.[1]?.toUpperCase() as MomusFinalAction) || "EXPAND";
	const rationale = text.match(/\*\*Rationale\*\*:\s*([\s\S]+?)(?:\n\n|\*\*|$)/i)?.[1]?.trim() || text;
	return { action, rationale };
}
