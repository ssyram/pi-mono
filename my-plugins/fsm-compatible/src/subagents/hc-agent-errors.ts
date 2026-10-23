export class HcAgentDomainError extends Error {
	public readonly tag: string;

	constructor(tag: string, message: string) {
		super(message);
		this.name = "HcAgentDomainError";
		this.tag = tag;
	}

	public static agentNotFound(sessionId: string): HcAgentDomainError {
		return new HcAgentDomainError("AgentNotFound", `No Agent found for session ${sessionId}.`);
	}

	public static agentTypeNotFound(subagentType: string, available: readonly string[]): HcAgentDomainError {
		return new HcAgentDomainError(
			"AgentTypeNotFound",
			`Unknown agent type "${subagentType}". Available: ${available.join(", ")}.`,
		);
	}

	public static nameReservedPrefix(name: string): HcAgentDomainError {
		return new HcAgentDomainError(
			"AgentNameConflict",
			`The name "${name}" starts with the reserved prefix "ses". Choose a different name or omit it.`,
		);
	}

	public static nameTaken(name: string): HcAgentDomainError {
		return new HcAgentDomainError(
			"AgentNameConflict",
			`The name "${name}" is already used by another Agent in this tree. Choose a different name or omit it.`,
		);
	}

	public static notAChild(target: string): HcAgentDomainError {
		return new HcAgentDomainError(
			"NotAChild",
			`Session ${target} is not a direct child of this Agent. You can only stop Agents you spawned yourself.`,
		);
	}

	public static selfDelivery(): HcAgentDomainError {
		return new HcAgentDomainError("SelfDelivery", "Cannot send a message to yourself.");
	}

	public static depthLimitReached(depth: number, limit: number): HcAgentDomainError {
		return new HcAgentDomainError(
			"DepthLimitReached",
			`Nesting limit reached: this Agent is at depth ${depth} and the limit is ${limit}. It cannot spawn further Agents.`,
		);
	}

	public static targetNotAddressable(value: string): HcAgentDomainError {
		return new HcAgentDomainError("TargetNotResolved", `No Agent named "${value}" is addressable from here.`);
	}

	public static targetAmbiguous(value: string, matches: readonly string[]): HcAgentDomainError {
		return new HcAgentDomainError(
			"TargetNotResolved",
			`The name "${value}" matches ${matches.length} Agents (${matches.join(", ")}). Use a session_id instead.`,
		);
	}

	public static worktreeUnavailable(reason: string, paths: readonly string[]): HcAgentDomainError {
		const leftover = paths.length > 0 ? ` Possible leftovers: ${paths.join(", ")}.` : "";
		return new HcAgentDomainError("WorktreeUnavailable", `Could not prepare a working directory: ${reason}.${leftover}`);
	}
}
