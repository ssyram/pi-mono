// Detached wrapper process: executes one run directory's script task and records results on disk.
import { mkdirSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { join } from "node:path";
import { executeScriptTask } from "./execute-task.js";
import {
	OUTPUT_DIR,
	RESULT_FILE,
	STATUS_FILE,
	TASK_FILE,
	parseTaskRecord,
	readJson,
	writeJsonAtomic,
} from "./run-record.js";
import { liveSocketPath, probeLiveSocket } from "./live-socket.js";
import { runScript } from "./run-script.js";
import type { ScriptResult, ScriptSpec } from "./task-spec.js";

const rawRunDir = process.argv[2];
if (rawRunDir === undefined) process.exit(2);
const runDir: string = rawRunDir;
const record = parseTaskRecord(readJson(join(runDir, TASK_FILE)));
const task = record?.payload.scriptTask;
if (record === undefined || task === undefined) process.exit(2);

let cancelled = false;
const abort = new AbortController();
process.on("SIGTERM", () => {
	cancelled = true;
	abort.abort();
});

let liveServer: Server | undefined;
if (!(await acquireLiveSocket(liveSocketPath(runDir)))) process.exit(3);

mkdirSync(join(runDir, OUTPUT_DIR), { recursive: true });
let success = 0;
let completed = 0;
let scriptPid: number | undefined;
const total = task.scripts.length;
writeStatus(0);
try {
	const run = await executeScriptTask(task, record.taskId, (script, options) => {
		const index = options?.index ?? 0;
		if (cancelled) return Promise.resolve(cancelledResult(script));
		writeStatus(index);
		return runScript(script, {
			index,
			logDir: join(runDir, OUTPUT_DIR),
			abortSignal: abort.signal,
			onSpawn: (pid) => {
				scriptPid = pid;
				writeStatus(index);
			},
		}).then((result) => {
			if (result.status === "success") success += 1;
			completed += 1;
			writeStatus(index);
			return cancelled && result.status === "failed"
				? { ...result, status: "cancelled", error: "Cancelled by request." }
				: result;
		});
	});
	writeJsonAtomic(join(runDir, RESULT_FILE), {
		cancelled,
		results: run.results,
		successCount: run.successCount,
		shouldWake: run.shouldWake,
		completedAt: run.completedAt,
		content: run.content,
	});
} catch (error) {
	writeJsonAtomic(join(runDir, RESULT_FILE), {
		cancelled,
		results: [],
		successCount: 0,
		shouldWake: false,
		completedAt: Date.now(),
		content: error instanceof Error ? error.message : String(error),
	});
} finally {
	liveServer?.close();
}

function writeStatus(currentIndex: number): void {
	writeJsonAtomic(join(runDir, STATUS_FILE), {
		pid: process.pid,
		...(scriptPid === undefined ? {} : { scriptPid }),
		currentIndex,
		success,
		completed,
		total,
		updatedAt: Date.now(),
	});
}

function cancelledResult(script: ScriptSpec): ScriptResult {
	return {
		script,
		status: "cancelled",
		exitCode: null,
		signal: null,
		stdout: "",
		stderr: "",
		error: "Cancelled by request.",
	};
}

async function acquireLiveSocket(path: string): Promise<boolean> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const server = createServer(() => undefined);
		const bound = await new Promise<boolean>((resolve) => {
			server.once("error", () => resolve(false));
			server.listen(path, () => resolve(true));
		});
		if (bound) {
			liveServer = server;
			return true;
		}
		if (await probeLiveSocket(path)) return false;
		try {
			rmSync(path, { force: true });
		} catch {
			return false;
		}
	}
	return false;
}
