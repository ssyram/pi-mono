type Instance = { dispose(): void };

declare global {
	var __scheduledWakeupOwners: WeakMap<object, Instance> | undefined;
}

/** Reload bookkeeping is keyed by the owning session manager, never by cwd. */
export function claimLoopInstance(
	owner: object,
	dispose: () => void,
): () => void {
	globalThis.__scheduledWakeupOwners ??= new WeakMap<object, Instance>();
	const owners = globalThis.__scheduledWakeupOwners;
	owners.get(owner)?.dispose();
	const instance = { dispose };
	owners.set(owner, instance);
	return () => {
		if (owners.get(owner) === instance) owners.delete(owner);
	};
}
