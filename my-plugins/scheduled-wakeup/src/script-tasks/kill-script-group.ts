export function killScriptGroup(pid: number | undefined): string | null {
	if (pid === undefined) return null;
	try {
		process.kill(-pid, "SIGKILL");
		return null;
	} catch (error) {
		if (
			typeof error === "object" &&
			error !== null &&
			"code" in error &&
			error.code === "ESRCH"
		)
			return null;
		return error instanceof Error ? error.message : String(error);
	}
}
