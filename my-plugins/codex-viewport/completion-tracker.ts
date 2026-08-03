type UnitKind = "assistant" | "tool";

interface TrackedUnit<T extends object> {
	id: string;
	kind: UnitKind;
	completed: boolean;
	contained: boolean;
	component?: T;
}

class CompletionTracker<T extends object> {
	private units: TrackedUnit<T>[] = [];
	private assistantSequence = 0;
	private currentAssistantId?: string;

	beginAssistant(): void {
		const id = `assistant:${this.assistantSequence++}`;
		this.units.push({ id, kind: "assistant", completed: false, contained: false });
		this.currentAssistantId = id;
	}

	containCurrentAssistant(): void {
		if (!this.currentAssistantId) return;
		const unit = this.units.find((candidate) => candidate.id === this.currentAssistantId);
		if (unit) unit.contained = true;
	}

	ensureTool(toolCallId: string): void {
		const id = `tool:${toolCallId}`;
		if (this.units.some((unit) => unit.id === id)) return;
		this.units.push({ id, kind: "tool", completed: false, contained: true });
	}

	completeAssistant(completePendingTools = false): void {
		if (this.currentAssistantId) {
			const unit = this.units.find((candidate) => candidate.id === this.currentAssistantId);
			if (unit) unit.completed = true;
			this.currentAssistantId = undefined;
		}
		if (completePendingTools) this.completeAllTools();
	}

	completeTool(toolCallId: string): void {
		this.ensureTool(toolCallId);
		const unit = this.units.find((candidate) => candidate.id === `tool:${toolCallId}`);
		if (unit) unit.completed = true;
	}

	completeAll(): void {
		for (const unit of this.units) unit.completed = true;
		this.currentAssistantId = undefined;
	}

	attachNextAssistant(component: T): boolean {
		const unit = this.units.find((candidate) => candidate.kind === "assistant" && !candidate.component);
		if (!unit) return false;
		unit.component = component;
		return true;
	}

	attachTool(toolCallId: string, component: T): boolean {
		const unit = this.units.find((candidate) => candidate.id === `tool:${toolCallId}`);
		if (!unit || unit.component) return false;
		unit.component = component;
		return true;
	}

	hasOpenAssistant(): boolean {
		return this.currentAssistantId !== undefined;
	}

	contains(component: T): boolean {
		return this.units.some((unit) => unit.component === component);
	}

	shouldContain(component: T): boolean {
		return this.units.some((unit) => unit.component === component && unit.contained);
	}

	components(): T[] {
		return this.units.flatMap((unit) => (unit.contained && unit.component ? [unit.component] : []));
	}

	releaseCompletedPrefix(): T[] {
		const released: T[] = [];
		while (this.units[0]?.completed && this.units[0].component) {
			const unit = this.units.shift();
			if (unit?.component) released.push(unit.component);
		}
		return released;
	}

	reset(): void {
		this.units = [];
		this.currentAssistantId = undefined;
	}

	private completeAllTools(): void {
		for (const unit of this.units) {
			if (unit.kind === "tool") unit.completed = true;
		}
	}
}

export { CompletionTracker };
