import { RuntimeError } from "../runtime/runtime-error.ts";
import { startOwnedProcess } from "./owned-process.ts";

export interface JsonProcessOptions {
	readonly command: string;
	readonly args: readonly string[];
	readonly env: NodeJS.ProcessEnv;
	readonly cwd?: string;
	readonly deadline: number;
	readonly input?: unknown;
	readonly signal?: AbortSignal;
	readonly maxBytes?: number;
}

export async function readJsonProcess(options: JsonProcessOptions): Promise<unknown> {
	if (options.signal?.aborted) throw new RuntimeError("cancelled");
	if (Date.now() >= options.deadline) throw new RuntimeError("deadline-exceeded");
	const owned = startOwnedProcess(options.command, options.args, options.env, options.cwd);
	const chunks: Buffer[] = [];
	let bytes = 0;
	let failure: RuntimeError | undefined;
	const abort = (code: "cancelled" | "deadline-exceeded" | "protocol-invalid") => {
		failure ??= new RuntimeError(code);
		owned.child.kill("SIGKILL");
	};
	const onAbort = () => abort("cancelled");
	const timeout = setTimeout(() => abort("deadline-exceeded"), Math.max(0, options.deadline - Date.now()));
	timeout.unref();
	options.signal?.addEventListener("abort", onAbort, { once: true });
	owned.child.stdout.on("data", (chunk: Buffer) => {
		bytes += chunk.length;
		if (bytes > (options.maxBytes ?? 1024 * 1024)) abort("protocol-invalid");
		else chunks.push(chunk);
	});
	owned.child.stderr.resume();
	owned.child.stdin.on("error", () => { failure ??= new RuntimeError("transport-failed"); });
	try {
		owned.child.stdin.end(options.input === undefined ? undefined : JSON.stringify(options.input));
		const exit = await owned.closed;
		if (failure) throw failure;
		if (exit.spawnFailed || exit.code !== 0 || exit.signal !== null) throw new RuntimeError("transport-failed");
		try {
			return JSON.parse(Buffer.concat(chunks).toString("utf8"));
		} catch {
			throw new RuntimeError("protocol-invalid");
		}
	} finally {
		clearTimeout(timeout);
		options.signal?.removeEventListener("abort", onAbort);
		if (!(await owned.close(Date.now() + 10000))) throw new RuntimeError("transport-failed");
	}
}
