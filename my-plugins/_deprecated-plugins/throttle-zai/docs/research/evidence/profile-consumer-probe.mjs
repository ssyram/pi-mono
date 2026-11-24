// Research-only consumer: source declarations shadow builtins before any profile is constructed.
import { resolveSource, SOURCE_READY } from "./provider-service-probe.mjs";

export function profileConsumer(declarations, profiles, nativeSources, observed) {
	return (pi) => {
		const slots = new Map([...nativeSources].map(([id, source]) => [id, { kind: "ready", source }]));
		const declared = new Set();
		const owned = new Set();
		for (const { id } of declarations) {
			if (slots.has(id)) observed.warnings.push(`source override: ${id}`);
			slots.set(id, { kind: "pending" });
			declared.add(id);
		}
		function construct(id, source) {
			for (const profile of profiles.filter((entry) => entry.provider === id)) {
				try {
					const provider = source.create({ id: profile.name, apiKey: profile.apiKey });
					if (provider.id !== profile.name) throw new Error("source returned the wrong instance id");
					if (provider.auth.oauth && profile.apiKey !== undefined) throw new Error("OAuth source rejects apiKey");
					pi.registerProvider(provider);
					owned.add(profile.name);
				} catch (error) {
					if (owned.delete(profile.name)) pi.unregisterProvider(profile.name);
					observed.errors.push({ name: profile.name, message: String(error) });
				}
			}
		}
		function bind(id) {
			const source = resolveSource(pi.events, id, (message) => observed.warnings.push(message));
			if (!source) return;
			const previous = slots.get(id);
			if (previous?.kind === "ready" && previous.source === source) return;
			if (previous?.kind === "ready") observed.warnings.push(`service replaced: ${id}`);
			slots.set(id, { kind: "ready", source });
			construct(id, source);
		}
		pi.events.on(SOURCE_READY, ({ id }) => {
			if (declared.has(id)) bind(id);
		});
		for (const [id, slot] of slots) if (slot.kind === "ready") construct(id, slot.source);
		for (const id of declared) bind(id);
		observed.slots = slots;
	};
}
