/** E1 provider-source contract mirror. Swap to provider-profiles' public module once E1 lands
 * (docs/extern-dep-design.md#e1-provider-profiles). Same constants, same shapes. */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { Provider } from "@earendil-works/pi-ai";

export const PROVIDER_SOURCE_QUERY = "provider-profiles:source:v1";
export const PROVIDER_SOURCE_READY = "provider-profiles:source-ready:v1";

export interface ProviderProfileSpec {
	readonly id: string;
	readonly apiKey?: string;
}

export interface ProviderSourceService {
	create(profile: ProviderProfileSpec): Provider;
}

export interface ProviderSourceRequest {
	readonly id: string;
	accept(source: ProviderSourceService): void;
}

export interface ProviderSourceReady {
	readonly id: string;
}

export function resolveProviderSource(
	id: string,
	bus: { emit(channel: string, data: unknown): void },
	warn: (message: string) => void,
): ProviderSourceService | undefined {
	let selected: ProviderSourceService | undefined;
	let replies = 0;
	let open = true;
	try {
		bus.emit(PROVIDER_SOURCE_QUERY, {
			id,
			accept(source: ProviderSourceService) {
				if (!open) return;
				selected = source;
				replies++;
			},
		} satisfies ProviderSourceRequest);
	} finally {
		open = false;
	}
	if (replies > 1) warn(`multiple provider sources answered for "${id}"; last synchronous reply wins`);
	return selected;
}

/** Must be the provider factory's last successful step; READY means "constructor available". */
export function provideProviderSource(
	id: string,
	source: ProviderSourceService,
	pi: Pick<ExtensionAPI, "events">,
): void {
	pi.events.on(PROVIDER_SOURCE_QUERY, (data) => {
		const request = data as ProviderSourceRequest;
		if (request.id === id) request.accept(source);
	});
	pi.events.emit(PROVIDER_SOURCE_READY, { id } satisfies ProviderSourceReady);
}
