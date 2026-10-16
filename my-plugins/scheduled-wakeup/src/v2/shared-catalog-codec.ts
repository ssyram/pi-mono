import type {
	SharedDefinition,
	SharedRegistrationIndex,
	SharedScope,
} from "./model.js";
import { parseSharedDefinition } from "./session-state-codec.js";

export const SHARED_CATALOG_VERSION = 2;

export type SharedCatalog = {
	version: number;
	definitions: SharedDefinition[];
	registrations: SharedRegistrationIndex[];
};

export function parseSharedCatalog(
	value: unknown,
	scope: SharedScope,
): SharedCatalog | undefined {
	if (
		!isRecord(value) ||
		value.version !== SHARED_CATALOG_VERSION ||
		!Array.isArray(value.definitions) ||
		!Array.isArray(value.registrations)
	)
		return undefined;
	const definitions = value.definitions.map(parseSharedDefinition);
	const registrations = value.registrations.map(parseIndex);
	if (
		definitions.some((item) => item === undefined) ||
		registrations.some((item) => item === undefined)
	)
		return undefined;
	const validDefinitions = definitions as SharedDefinition[];
	const validRegistrations = registrations as SharedRegistrationIndex[];
	if (
		validDefinitions.some((item) => item.scope !== scope) ||
		validRegistrations.some((item) => item.scope !== scope)
	)
		return undefined;
	const ids = validDefinitions.map((item) => item.id);
	const pairs = validRegistrations.map((item) =>
		JSON.stringify([item.sessionId, item.registrationId]),
	);
	if (new Set(ids).size !== ids.length || new Set(pairs).size !== pairs.length)
		return undefined;
	return {
		version: SHARED_CATALOG_VERSION,
		definitions: validDefinitions,
		registrations: validRegistrations,
	};
}

function parseIndex(value: unknown): SharedRegistrationIndex | undefined {
	if (
		!isRecord(value) ||
		(value.scope !== "workspace" && value.scope !== "global") ||
		!text(value.definitionId) ||
		!text(value.sessionId) ||
		!text(value.registrationId) ||
		typeof value.registeredAt !== "number" ||
		!Number.isSafeInteger(value.registeredAt) ||
		value.registeredAt <= 0
	)
		return undefined;
	return {
		scope: value.scope,
		definitionId: value.definitionId,
		sessionId: value.sessionId,
		registrationId: value.registrationId,
		registeredAt: value.registeredAt,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

function text(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}
