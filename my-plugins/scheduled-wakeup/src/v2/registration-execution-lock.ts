import { createHash } from "node:crypto";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import lockfile from "proper-lockfile";

const LOCK_STALE_MS = 30_000;

export type HeldRegistrationLock = {
	compromised(): boolean;
	release(): void;
};

export class RegistrationExecutionLock {
	private readonly root: string;

	constructor(lockRoot: string, sessionId: string) {
		this.root = join(lockRoot, digest(sessionId));
	}

	tryAcquire(resource: string): HeldRegistrationLock | undefined {
		mkdirSync(this.root, { recursive: true });
		let compromised = false;
		try {
			const release = lockfile.lockSync(join(this.root, digest(resource)), {
				realpath: false,
				retries: 0,
				stale: LOCK_STALE_MS,
				onCompromised: () => {
					compromised = true;
				},
			});
			return {
				compromised: () => compromised,
				release: () => {
					try {
						release();
					} catch {
						// The stale-lock owner has already relinquished this resource.
					}
				},
			};
		} catch (error) {
			if (isLocked(error)) return undefined;
			throw error;
		}
	}
}

function digest(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

function isLocked(error: unknown): boolean {
	if (typeof error !== "object" || error === null) return false;
	return (error as Record<string, unknown>).code === "ELOCKED";
}
