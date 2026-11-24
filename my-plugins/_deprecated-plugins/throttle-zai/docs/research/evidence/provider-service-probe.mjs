// Research-only source-service protocol using the real Pi event bus.
export const SOURCE_QUERY = "provider-profiles:source:v1";
export const SOURCE_READY = "provider-profiles:source-ready:v1";

export function resolveSource(bus, id, warn) {
	let selected;
	let replies = 0;
	let open = true;
	try {
		bus.emit(SOURCE_QUERY, {
			id,
			accept(source) {
				if (!open) return;
				selected = source;
				replies++;
			},
		});
	} finally {
		open = false;
	}
	if (replies > 1) warn(`multiple services for ${id}; last synchronous reply wins`);
	return selected;
}

export function publishSource(pi, id, source) {
	pi.events.on(SOURCE_QUERY, (request) => {
		if (request.id === id) request.accept(source);
	});
	pi.events.emit(SOURCE_READY, { id });
}
