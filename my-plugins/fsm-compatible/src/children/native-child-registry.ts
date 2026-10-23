import type { PersistedBinding, BindingRecords } from "../binding/actor-binding.ts";
import type { NativeChildRecord } from "./native-child-record.ts";

export class NativeChildRegistry implements BindingRecords {
	readonly rows = new Map<string, NativeChildRecord>();
	readonly root: PersistedBinding;

	constructor(root: PersistedBinding) { this.root = root; }
	find(id: string) {
		const binding = id === this.root.sessionId ? this.root : this.rows.get(id)?.binding;
		return binding ? { binding } : undefined;
	}
	caller(token: unknown): PersistedBinding {
		const row = [...this.rows.values()].find((item) => item.token === token);
		if (!row) throw new Error("unknown native child capability");
		return row.binding;
	}
	visible(caller: string): PersistedBinding[] {
		const current = this.find(caller)?.binding;
		if (!current) throw new Error("unknown native caller");
		return [this.root, ...[...this.rows.values()].map((row) => row.binding)].filter((binding) =>
			binding.sessionId === caller || binding.sessionId === current.parentSessionId
			|| binding.parentSessionId === caller || (current.parentSessionId !== null && binding.parentSessionId === current.parentSessionId));
	}
	target(caller: string, target: string, direct = false): NativeChildRecord {
		let row = this.rows.get(target);
		if (!row && !target.startsWith("ses")) {
			const candidates = this.visible(caller).filter((binding) => this.rows.get(binding.sessionId)?.name === target);
			if (candidates.length !== 1) throw new Error("agent target missing or ambiguous");
			row = this.rows.get(candidates[0]!.sessionId);
		}
		if (!row || (direct && row.binding.parentSessionId !== caller)) throw new Error("agent target not admitted");
		return row;
	}
	descendants(parent: string): NativeChildRecord[] {
		const children = [...this.rows.values()].filter((row) => row.binding.parentSessionId === parent);
		return children.flatMap((row) => [row, ...this.descendants(row.binding.sessionId)]);
	}
}
