import { randomUUID } from "node:crypto";
import { renameSync, rmSync, writeFileSync } from "node:fs";
import type { SharedCatalog } from "./shared-catalog-codec.js";

export function writeSharedCatalog(path: string, catalog: SharedCatalog): void {
	const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
	try {
		writeFileSync(temporary, `${JSON.stringify(catalog, null, 2)}\n`, "utf8");
		renameSync(temporary, path);
	} catch (error) {
		try {
			rmSync(temporary, { force: true });
		} catch {
			/* Preserve the primary write failure if cleanup is also denied. */
		}
		throw error;
	}
}
