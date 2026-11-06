// Shared mock-server E2E harness: boots mock-llm-server on a dedicated port
// with a temp mounts file, mounts one script, and prepares a temp agent HOME
// (models.json pointing at the mount, extensions symlinked to the live set).
// Used by e2e-tui's urgency scenario and the e2e-mock suite.
import { execFileSync, spawn } from "node:child_process";
import {
	chmodSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { connect } from "node:net";
import { setTimeout as sleep } from "node:timers/promises";

export const MOCK_SERVER = join(
	homedir(),
	"workspace/ai-tools/mock-with-pi/target/debug/mock-llm-server",
);

export async function waitForPort(port: number, timeoutMs: number): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	for (;;) {
		const ok = await new Promise<boolean>((resolve) => {
			const socket = connect(port, "127.0.0.1");
			socket.once("connect", () => {
				socket.destroy();
				resolve(true);
			});
			socket.once("error", () => resolve(false));
		});
		if (ok) return;
		if (Date.now() > deadline) throw new Error("mock-llm-server never came up");
		await sleep(200);
	}
}

export type MockServerHandle = {
	home: string;
	baseUrl: string;
	dispose(): Promise<void>;
};

export async function startMockServer(
	scriptPath: string,
	mountName: string,
	port: number,
): Promise<MockServerHandle> {
	const home = mkdtempSync(join(tmpdir(), `loop-mock-home-${mountName}-`));
	chmodSync(scriptPath, 0o755);
	const server = spawn(
		MOCK_SERVER,
		[
			"--port",
			String(port),
			"--mounts-file",
			join(home, "mounts.json"),
			"--capture-dir",
			join(home, "captures"),
		],
		{ stdio: ["ignore", "ignore", "ignore"], detached: true },
	);
	await waitForPort(port, 15_000);
	execFileSync(MOCK_SERVER, [
		"add",
		scriptPath,
		"--name",
		mountName,
		"--server-url",
		`http://127.0.0.1:${port}`,
	]);

	mkdirSync(join(home, ".pi", "agent"), { recursive: true });
	symlinkSync(
		join(homedir(), ".pi", "agent", "extensions"),
		join(home, ".pi", "agent", "extensions"),
	);
	writeFileSync(
		join(home, ".pi", "agent", "models.json"),
		JSON.stringify(
			{
				providers: {
					loopmock: {
						baseUrl: `http://127.0.0.1:${port}/${mountName}/v1`,
						api: "openai-completions",
						apiKey: "mock",
						models: [{ id: "mock-loop" }],
					},
				},
			},
			null,
			2,
		),
		"utf8",
	);
	return {
		home,
		baseUrl: `http://127.0.0.1:${port}/${mountName}/v1`,
		async dispose() {
			try {
				process.kill(-server.pid!, "SIGTERM");
			} catch {
				/* already gone */
			}
		},
	};
}

/** Dumps the newest captured mock request (roles + text heads) for failure
 * diagnosis: shows exactly what the model was shown. */
export function dumpLastCapture(handle: MockServerHandle, lines = 30): string {
	try {
		const dir = join(handle.home, "captures");
		const files = readdirSync(dir).sort();
		const last = files[files.length - 1];
		if (last === undefined) return "(no captures)";
		const body = JSON.parse(readFileSync(join(dir, last), "utf8"));
		const roles = (body.request?.context?.messages ?? []).map(
			(message: {
				role: string;
				toolName?: string;
				content: unknown;
			}) => {
			const content = message.content;
			const flat =
				typeof content === "string"
					? content
					: Array.isArray(content)
						? content
								.map((block) =>
									typeof block === "string" ? block : (block?.text ?? JSON.stringify(block).slice(0, 40)),
								)
								.join(" | ")
						: "";
				return `${message.role}${message.toolName ? `(${message.toolName})` : ""}: ${flat.slice(0, 90)}`;
			},
		);
		return `${last}\n${roles.slice(-lines).join("\n")}`;
	} catch (error) {
		return `(capture dump failed: ${String(error)})`;
	}
}

/** Seeds a session file under the mock HOME so `pi -c` resumes that id. */
export function bootstrapMockSession(
	handle: MockServerHandle,
	cwd: string,
): { sessionId: string; sessionsDir: string } {
	const real = realpathSync(cwd);
	const slug = `--${real.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
	const dir = join(handle.home, ".pi", "agent", "sessions", slug);
	mkdirSync(dir, { recursive: true });
	const id = randomUUID();
	const iso = new Date().toISOString();
	writeFileSync(
		join(dir, `${iso.replaceAll(":", "-").replaceAll(".", "-")}_${id}.jsonl`),
		`${JSON.stringify({ type: "session", version: 3, id, timestamp: iso, cwd: real })}\n`,
		"utf8",
	);
	return { sessionId: id, sessionsDir: dir };
}
