/** Request forwarding: ensure managed backend, then delegate to the native CN provider stream. */
import {
	lazyStream,
	type ApiStreamOptions,
	type AssistantMessageEventStream,
	type Model,
	type Provider,
	type SimpleStreamOptions,
	type TranscriptContext,
} from "@earendil-works/pi-ai";
import { toProviderError } from "./backend-failure.js";
import type { BackendOwner } from "./backend-owner.js";

function signalOf(options: ApiStreamOptions | SimpleStreamOptions | undefined): AbortSignal | undefined {
	const signal = (options as { signal?: AbortSignal } | undefined)?.signal;
	return signal instanceof AbortSignal ? signal : undefined;
}

async function ensureBackend(owner: BackendOwner, signal: AbortSignal | undefined): Promise<void> {
	const info = await owner.ensureRunning(signal ?? new AbortController().signal);
	if (info.kind !== "ok") throw toProviderError(info);
}

export function forwardStream(
	model: Model,
	context: TranscriptContext,
	owner: BackendOwner,
	nativeProvider: Provider,
	options?: ApiStreamOptions,
): AssistantMessageEventStream {
	const signal = signalOf(options);
	return lazyStream(model, async () => {
		await ensureBackend(owner, signal);
		return nativeProvider.stream(model, context, options);
	});
}

export function forwardSimpleStream(
	model: Model,
	context: TranscriptContext,
	owner: BackendOwner,
	nativeProvider: Provider,
	options?: SimpleStreamOptions,
): AssistantMessageEventStream {
	const signal = signalOf(options);
	return lazyStream(model, async () => {
		await ensureBackend(owner, signal);
		return nativeProvider.streamSimple(model, context, options);
	});
}
