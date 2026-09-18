import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import {
	cloneDefinition,
	type SharedDefinition,
	type SharedDeleteResult,
	type SharedRegistrationIndex,
	type SharedScope,
} from "./model.js";
import { parseSharedDefinition } from "./session-state-codec.js";

const VERSION = 2;
const STALE_MS = 30_000;
type Catalog = { version: number; definitions: SharedDefinition[]; registrations: SharedRegistrationIndex[] };
type CatalogLoadResult = { kind: "available"; catalog: Catalog } | { kind: "unavailable" };
export type RegistrationIndexStatus = "indexed" | "missing" | "unavailable";

export class SharedDefinitionStore {
	private readonly paths: Record<SharedScope, string>;

	constructor(workspaceRoot: string, globalRoot: string) {
		this.paths = {
			workspace: join(workspaceRoot, ".pi", "scheduled-wakeup", "v2", "workspace-definitions.json"),
			global: join(globalRoot, ".pi", "scheduled-wakeup", "v2", "global-definitions.json"),
		};
	}

	list(scope: SharedScope): readonly SharedDefinition[] {
		const loaded = this.load(this.paths[scope], scope);
		return loaded.kind === "available" ? loaded.catalog.definitions.map(cloneDefinition) : [];
	}

	get(scope: SharedScope, id: string): SharedDefinition | undefined {
		const loaded = this.load(this.paths[scope], scope);
		if (loaded.kind === "unavailable") return undefined;
		const definition = loaded.catalog.definitions.find((item) => item.id === id);
		return definition === undefined ? undefined : cloneDefinition(definition);
	}

	create(definition: SharedDefinition): SharedDefinition {
		return this.transaction(definition.scope, (catalog) => {
			if (catalog.definitions.some((item) => item.id === definition.id)) throw new Error(`Shared definition ${definition.id} already exists`);
			catalog.definitions.push(cloneDefinition(definition));
			return cloneDefinition(definition);
		});
	}

	indexRegistration(entry: SharedRegistrationIndex): "indexed" | "missing" {
		return this.transaction(entry.scope, (catalog) => {
			if (!catalog.definitions.some((item) => item.id === entry.definitionId)) return "missing";
			if (!catalog.registrations.some((item) => sameIndex(item, entry))) catalog.registrations.push({ ...entry });
			return "indexed";
		});
	}

	removeRegistration(entry: SharedRegistrationIndex): void {
		this.transaction(entry.scope, (catalog) => {
			catalog.registrations = catalog.registrations.filter((item) => !sameIndex(item, entry));
		});
	}

	registrationStatus(entry: SharedRegistrationIndex): RegistrationIndexStatus {
		const loaded = this.load(this.paths[entry.scope], entry.scope);
		if (loaded.kind === "unavailable") return "unavailable";
		return loaded.catalog.definitions.some((item) => item.id === entry.definitionId) && loaded.catalog.registrations.some((item) => sameIndex(item, entry))
			? "indexed"
			: "missing";
	}

	isIndexed(entry: SharedRegistrationIndex): boolean {
		return this.registrationStatus(entry) === "indexed";
	}

	listRegistrationIndex(scope: SharedScope): readonly SharedRegistrationIndex[] {
		const loaded = this.load(this.paths[scope], scope);
		return loaded.kind === "available" ? loaded.catalog.registrations.map((entry) => ({ ...entry })) : [];
	}

	delete(scope: SharedScope, definitionId: string, sessionId: string, force: boolean): SharedDeleteResult {
		const transaction = this.tryTransaction<SharedDeleteResult>(scope, (catalog) => {
			if (!catalog.definitions.some((item) => item.id === definitionId)) return { kind: "missing" };
			const registrations = catalog.registrations.filter((item) => item.definitionId === definitionId);
			if (!force && registrations.some((item) => item.sessionId !== sessionId)) return { kind: "registered-by-others" };
			catalog.definitions = catalog.definitions.filter((item) => item.id !== definitionId);
			catalog.registrations = catalog.registrations.filter((item) => item.definitionId !== definitionId);
			return { kind: "deleted" };
		});
		return transaction.kind === "busy" ? transaction : transaction.value;
	}

	private transaction<T>(scope: SharedScope, work: (catalog: Catalog) => T): T {
		const result = this.tryTransaction(scope, work);
		if (result.kind === "busy") throw new Error("Shared definition catalog is busy");
		return result.value;
	}

	private tryTransaction<T>(scope: SharedScope, work: (catalog: Catalog) => T): { kind: "value"; value: T } | { kind: "busy" } {
		const path = this.paths[scope];
		mkdirSync(dirname(path), { recursive: true });
		let release: (() => void) | undefined;
		try {
			release = lockfile.lockSync(path, { realpath: false, retries: 0, stale: STALE_MS, onCompromised: () => undefined });
		} catch (error) {
			if (isLocked(error)) return { kind: "busy" };
			throw error;
		}
		try {
			const loaded = this.load(path, scope);
			if (loaded.kind === "unavailable") throw new Error(`Shared definition catalog ${scope} is unavailable`);
			const value = work(loaded.catalog);
			this.save(path, loaded.catalog);
			return { kind: "value", value };
		} finally {
			if (release !== undefined) {
				try { release(); } catch { /* stale lock was already released */ }
			}
		}
	}

	private load(path: string, scope: SharedScope): CatalogLoadResult {
		if (!existsSync(path)) return { kind: "available", catalog: empty() };
		try {
			const value: unknown = JSON.parse(readFileSync(path, "utf8"));
			if (!isCatalog(value)) return { kind: "unavailable" };
			const definitions = value.definitions.map(parseSharedDefinition);
			const registrations = value.registrations.map(parseIndex);
			if (definitions.some((item) => item === undefined) || registrations.some((item) => item === undefined)) return { kind: "unavailable" };
			const goodDefinitions = definitions as SharedDefinition[];
			const goodRegistrations = registrations as SharedRegistrationIndex[];
			if (goodDefinitions.some((item) => item.scope !== scope) || goodRegistrations.some((item) => item.scope !== scope)) return { kind: "unavailable" };
			if (duplicates(goodDefinitions.map((item) => item.id)) || duplicates(goodRegistrations.map(indexKey))) return { kind: "unavailable" };
			return { kind: "available", catalog: { version: VERSION, definitions: goodDefinitions, registrations: goodRegistrations } };
		} catch {
			return { kind: "unavailable" };
		}
	}

	private save(path: string, catalog: Catalog): void {
		const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
		writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
		renameSync(temporary, path);
	}
}

function parseIndex(value: unknown): SharedRegistrationIndex | undefined {
	if (!isRecord(value) || !isScope(value.scope) || !text(value.definitionId) || !text(value.sessionId) || !text(value.registrationId) || !timestamp(value.registeredAt)) return undefined;
	return { scope: value.scope, definitionId: value.definitionId, sessionId: value.sessionId, registrationId: value.registrationId, registeredAt: value.registeredAt };
}
function isCatalog(value: unknown): value is { version: unknown; definitions: unknown[]; registrations: unknown[] } {
	return isRecord(value) && value.version === VERSION && Array.isArray(value.definitions) && Array.isArray(value.registrations);
}
function sameIndex(left: SharedRegistrationIndex, right: SharedRegistrationIndex): boolean { return indexKey(left) === indexKey(right); }
function indexKey(value: SharedRegistrationIndex): string { return `${value.definitionId}\u0000${value.sessionId}\u0000${value.registrationId}`; }
function duplicates(values: readonly string[]): boolean { return new Set(values).size !== values.length; }
function empty(): Catalog { return { version: VERSION, definitions: [], registrations: [] }; }
function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === "object" && value !== null; }
function isScope(value: unknown): value is SharedScope { return value === "workspace" || value === "global"; }
function text(value: unknown): value is string { return typeof value === "string" && value.trim().length > 0; }
function timestamp(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value > 0; }
function isLocked(value: unknown): boolean { return isRecord(value) && value.code === "ELOCKED"; }
