/**
 * Official provider sources (C2). Import channel: the VIRTUAL_MODULES-backed
 * "@earendil-works/pi-ai/providers/all" entry, which the built extension
 * runtime provisions for extensions. The per-provider subpath channel
 * ("@earendil-works/pi-ai/providers/<name>") is rejected by the built
 * extension runtime — T1 finding, 2026-09-22, see docs/detailed.md.
 *
 * Supported-source classification (2026-09-22 generalization): every built-in
 * factory product is a valid source EXCEPT those carrying `refreshModels`
 * (its closure filters restored dynamic models by the original factory id —
 * Q.A.7 — so cloning would mis-bind; currently only `radius`). The auth shape
 * (oauth vs api-key) is read from the factory product and drives the
 * apiKey-field rule dynamically instead of a hardcoded provider list.
 */

import type { Provider } from "@earendil-works/pi-ai";
import { builtinProviders } from "@earendil-works/pi-ai/providers/all";

interface SourceInfo {
	readonly provider: Provider;
	readonly isOAuth: boolean;
}

let sourceCache: Map<string, SourceInfo> | undefined;

/** Lazy per-process cache of read-only factory products (factories are
 * stateless; nothing ever mutates a base). */
function sourceInfos(): Map<string, SourceInfo> {
	if (sourceCache === undefined) {
		sourceCache = new Map();
		for (const provider of builtinProviders()) {
			if (provider.refreshModels !== undefined) continue;
			sourceCache.set(provider.id, { provider, isOAuth: provider.auth.oauth !== undefined });
		}
	}
	return sourceCache;
}

/** All built-in provider ids, including clone-unsafe ones (name denylist). */
export function builtinIds(): ReadonlySet<string> {
	const ids = new Set<string>();
	for (const provider of builtinProviders()) ids.add(provider.id);
	return ids;
}

/** Built-in ids usable as a profile source (refreshModels carriers excluded). */
export function supportedSourceIds(): string[] {
	return [...sourceInfos().keys()];
}

/** OAuth-backed sources reject the apiKey field; api-key sources accept it. */
export function isOAuthSource(name: string): boolean {
	return sourceInfos().get(name)?.isOAuth ?? false;
}

/** Returns the cached official factory product for a supported source. */
export function getBase(name: string): Provider {
	const base = sourceInfos().get(name)?.provider;
	if (base === undefined) {
		throw new Error(`unsupported provider: ${name}`);
	}
	return base;
}
