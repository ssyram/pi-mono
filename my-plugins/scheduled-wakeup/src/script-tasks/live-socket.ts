// Live-socket path resolution and liveness probing for script-task runners.
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect } from "node:net";
import { LIVE_SOCK } from "./run-record.js";

/** Unix socket paths beyond this length fail to bind (macOS sun_path is 104 bytes). */
const SAFE_SOCKET_PATH_LIMIT = 100;

/**
 * Deterministic socket path for one run dir: the in-run file when it fits, a
 * sha-derived name under tmpdir when the run dir is too deep to bind. Both the
 * runner and the catalog synthesizer derive the same path independently.
 */
export function liveSocketPath(runDir: string): string {
	const direct = join(runDir, LIVE_SOCK);
	if (direct.length <= SAFE_SOCKET_PATH_LIMIT) return direct;
	const digest = createHash("sha1").update(direct).digest("hex").slice(0, 16);
	return join(tmpdir(), `pi-sw-live-${digest}.sock`);
}

/** True while some process still listens on the socket (kernel-held; death releases it). */
export function probeLiveSocket(path: string): Promise<boolean> {
	return new Promise((resolve) => {
		const socket = connect(path);
		const done = (value: boolean): void => {
			socket.destroy();
			resolve(value);
		};
		socket.setTimeout(500, () => done(false));
		socket.once("connect", () => done(true));
		socket.once("error", () => done(false));
	});
}
