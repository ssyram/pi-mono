import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import lockfile from "proper-lockfile";
import { writeSharedCatalog } from "./atomic-catalog-write.js";
import {
	cloneDefinition,
	type SharedDefinition,
	type SharedDeleteResult,
	type SharedRegistrationIndex,
	type SharedScope,
} from "./model.js";
import {
	type SharedCatalog as Catalog,
	parseSharedCatalog,
	SHARED_CATALOG_VERSION,
} from "./shared-catalog-codec.js";

const STALE_MS = 30_000;
type CatalogLoadResult =
	| { kind: "available"; catalog: Catalog }
	| { kind: "unavailable" };
export type RegistrationIndexStatus = "indexed" | "missing" | "unavailable";

export class SharedDefinitionStore {
	private readonly paths: Record<SharedScope, string>;

	constructor(workspaceRoot: string, globalRoot: string) {
		const directory = join(".pi", "scheduled-wakeup", "v2");
		this.paths = {
			workspace: join(workspaceRoot, directory, "workspace-definitions.json"),
			global: join(globalRoot, directory, "global-definitions.json"),
		};
	}

	list(scope: SharedScope): readonly SharedDefinition[] {
		const loaded = this.load(this.paths[scope], scope);
		return loaded.kind === "available"
			? loaded.catalog.definitions.map(cloneDefinition)
			: [];
	}

	get(scope: SharedScope, id: string): SharedDefinition | undefined {
		const loaded = this.load(this.paths[scope], scope);
		if (loaded.kind === "unavailable") return undefined;
		const definition = loaded.catalog.definitions.find(
			(item) => item.id === id,
		);
		return definition === undefined ? undefined : cloneDefinition(definition);
	}

	create(definition: SharedDefinition): SharedDefinition {
		return this.transaction(definition.scope, (catalog) => {
			if (catalog.definitions.some((item) => item.id === definition.id))
				throw new Error(`Shared definition ${definition.id} already exists`);
			catalog.definitions.push(cloneDefinition(definition));
			return cloneDefinition(definition);
		});
	}

	indexRegistration(entry: SharedRegistrationIndex): "indexed" | "missing" {
		return this.transaction(entry.scope, (catalog) => {
			if (!catalog.definitions.some((item) => item.id === entry.definitionId))
				return "missing";
			if (!catalog.registrations.some((item) => sameIndex(item, entry)))
				catalog.registrations.push({ ...entry });
			return "indexed";
		});
	}

	removeRegistration(entry: SharedRegistrationIndex): void {
		this.transaction(entry.scope, (catalog) => {
			catalog.registrations = catalog.registrations.filter(
				(item) => !sameIndex(item, entry),
			);
		});
	}

	registrationStatus(entry: SharedRegistrationIndex): RegistrationIndexStatus {
		const loaded = this.load(this.paths[entry.scope], entry.scope);
		if (loaded.kind === "unavailable") return "unavailable";
		return loaded.catalog.definitions.some(
			(item) => item.id === entry.definitionId,
		) && loaded.catalog.registrations.some((item) => sameIndex(item, entry))
			? "indexed"
			: "missing";
	}

	isIndexed(entry: SharedRegistrationIndex): boolean {
		return this.registrationStatus(entry) === "indexed";
	}

	listRegistrationIndex(
		scope: SharedScope,
	): readonly SharedRegistrationIndex[] {
		const loaded = this.load(this.paths[scope], scope);
		return loaded.kind === "available"
			? loaded.catalog.registrations.map((entry) => ({ ...entry }))
			: [];
	}

	delete(
		scope: SharedScope,
		definitionId: string,
		sessionId: string,
		force: boolean,
	): SharedDeleteResult {
		const transaction = this.tryTransaction<SharedDeleteResult>(
			scope,
			(catalog) => {
				if (!catalog.definitions.some((item) => item.id === definitionId))
					return { kind: "missing" };
				const registrations = catalog.registrations.filter(
					(item) => item.definitionId === definitionId,
				);
				if (
					!force &&
					registrations.some((item) => item.sessionId !== sessionId)
				)
					return { kind: "registered-by-others" };
				catalog.definitions = catalog.definitions.filter(
					(item) => item.id !== definitionId,
				);
				catalog.registrations = catalog.registrations.filter(
					(item) => item.definitionId !== definitionId,
				);
				return { kind: "deleted" };
			},
		);
		return transaction.kind === "busy" ? transaction : transaction.value;
	}

	private transaction<T>(scope: SharedScope, work: (catalog: Catalog) => T): T {
		const result = this.tryTransaction(scope, work);
		if (result.kind === "busy")
			throw new Error("Shared definition catalog is busy");
		return result.value;
	}

	private tryTransaction<T>(
		scope: SharedScope,
		work: (catalog: Catalog) => T,
	): { kind: "value"; value: T } | { kind: "busy" } {
		const path = this.paths[scope];
		mkdirSync(dirname(path), { recursive: true });
		let release: (() => void) | undefined;
		try {
			release = lockfile.lockSync(path, {
				realpath: false,
				retries: 0,
				stale: STALE_MS,
				onCompromised: () => undefined,
			});
		} catch (error) {
			if (
				typeof error === "object" &&
				error !== null &&
				"code" in error &&
				error.code === "ELOCKED"
			)
				return { kind: "busy" };
			throw error;
		}
		try {
			const loaded = this.load(path, scope);
			if (loaded.kind === "unavailable")
				throw new Error(`Shared definition catalog ${scope} is unavailable`);
			const value = work(loaded.catalog);
			writeSharedCatalog(path, loaded.catalog);
			return { kind: "value", value };
		} finally {
			if (release !== undefined) {
				try {
					release();
				} catch {
					/* stale lock was already released */
				}
			}
		}
	}

	private load(path: string, scope: SharedScope): CatalogLoadResult {
		if (!existsSync(path))
			return {
				kind: "available",
				catalog: {
					version: SHARED_CATALOG_VERSION,
					definitions: [],
					registrations: [],
				},
			};
		try {
			const catalog = parseSharedCatalog(
				JSON.parse(readFileSync(path, "utf8")),
				scope,
			);
			return catalog === undefined
				? { kind: "unavailable" }
				: { kind: "available", catalog };
		} catch {
			return { kind: "unavailable" };
		}
	}
}

function sameIndex(
	left: SharedRegistrationIndex,
	right: SharedRegistrationIndex,
): boolean {
	return (
		`${left.definitionId}\u0000${left.sessionId}\u0000${left.registrationId}` ===
		`${right.definitionId}\u0000${right.sessionId}\u0000${right.registrationId}`
	);
}
